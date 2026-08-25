import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from '../config/env.js';
import { createRedisConnection, redisKey } from '../infrastructure/redis.js';
import { logger } from '../observability/logger.js';
import { createSupabaseAdmin, createQuotaLedger, QuotaLedger } from './quota-ledger.js';
import { SyncService, type SyncOutcome } from './sync-service.js';
import { TokenProvider, ConnectionRevokedError } from './token-provider.js';
import { YouTubeAnalyticsClient } from './analytics-client.js';

/**
 * youtube-sync queue — one queue, four job types:
 *   full-sync        { userId }          enqueued on connect
 *   daily-refresh    { userId }          enqueued per user by the nightly sweep
 *   daily-sweep      {}                  repeatable: finds active connections,
 *                                       enqueues daily-refresh with jitter
 *   maintenance      {}                  repeatable: prune raw (30d TTL),
 *                                       oauth state, flush quota ledger to DB
 *
 * 10k-user notes: per-user dedupe via jobId (BullMQ drops duplicates), a
 * queue-level rate limit, and concurrency from config. The sweep staggers
 * per-user jobs with random delay so 10k connections never stampede.
 */

export const YOUTUBE_SYNC_QUEUE_NAME = 'youtube-sync';

export type YoutubeSyncJob =
  | { kind: 'full-sync'; userId: string }
  | { kind: 'daily-refresh'; userId: string }
  | { kind: 'compute-profile'; userId: string }
  | { kind: 'daily-sweep' }
  | { kind: 'maintenance' };

export function createYoutubeSyncQueue(redis: Redis): Queue<YoutubeSyncJob> {
  const config = getConfig();
  return new Queue<YoutubeSyncJob>(YOUTUBE_SYNC_QUEUE_NAME, {
    connection: redis.duplicate(),
    prefix: `${config.REDIS_KEY_PREFIX}:${YOUTUBE_SYNC_QUEUE_NAME}`,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 15_000 },
      removeOnComplete: { age: 3600, count: 500 },
      removeOnFail: { age: 86_400 },
    },
  });
}

export function youtubeSyncModuleEnabled(): boolean {
  const config = getConfig();
  return Boolean(
    config.GOOGLE_OAUTH_CLIENT_ID &&
      config.GOOGLE_OAUTH_CLIENT_SECRET &&
      config.GOOGLE_OAUTH_REDIRECT_URL &&
      config.YOUTUBE_TOKEN_MASTER_KEY,
  );
}

export interface YoutubeSyncDeps {
  redis: Redis;
  sb: SupabaseClient;
  tokens: TokenProvider;
  analytics: YouTubeAnalyticsClient;
  ledger: QuotaLedger;
}

export function buildYoutubeSyncDeps(redis: Redis): YoutubeSyncDeps {
  const sb = createSupabaseAdmin();
  const ledger = createQuotaLedger(redis);
  return {
    redis,
    sb,
    tokens: new TokenProvider(redis, sb),
    analytics: new YouTubeAnalyticsClient(ledger),
    ledger,
  };
}

/** Post-sync trigger: recompute the Hunger Profile (deduped per user+date). */
export async function enqueueComputeProfile(redis: Redis, userId: string): Promise<void> {
  const queue = createYoutubeSyncQueue(redis);
  try {
    await queue.add('job', { kind: 'compute-profile', userId } satisfies YoutubeSyncJob, {
      jobId: `profile:${new Date().toISOString().slice(0, 13)}:${userId}`,
      attempts: 2,
    });
  } finally {
    await queue.close();
  }
}

export async function enqueueFullSync(queue: Queue<YoutubeSyncJob>, userId: string): Promise<void> {
  await queue.add('job', { kind: 'full-sync', userId } satisfies YoutubeSyncJob, {
    // jobId dedupe: a second connect while one backfill is queued is a no-op.
    jobId: `full-sync:${userId}`,
  });
}

export function createYoutubeSyncWorker(deps: YoutubeSyncDeps): Worker<YoutubeSyncJob> {
  const config = getConfig();
  const sync = new SyncService(deps.sb, deps.redis, deps.tokens, deps.analytics);
  const worker = new Worker<YoutubeSyncJob>(
    YOUTUBE_SYNC_QUEUE_NAME,
    async (job: Job<YoutubeSyncJob>) => runJob(job, deps, sync),
    {
      connection: createRedisConnection(),
      prefix: `${config.REDIS_KEY_PREFIX}:${YOUTUBE_SYNC_QUEUE_NAME}`,
      concurrency: config.YOUTUBE_SYNC_CONCURRENCY,
    },
  );
  worker.on('failed', (job, err) => {
    if (err instanceof ConnectionRevokedError && job) {
      logger.warn({ jobId: job.id, userId: (job.data as YoutubeSyncJob & { userId?: string }).userId }, 'sync aborted - connection revoked');
    } else {
      logger.error({ jobId: job?.id, error: err.message }, 'youtube sync job failed');
    }
  });
  return worker;
}

async function runJob(
  job: Job<YoutubeSyncJob>,
  deps: YoutubeSyncDeps,
  sync: SyncService,
): Promise<SyncOutcome | { ok: true } | Record<string, unknown>> {
  const data = job.data;
  switch (data.kind) {
    case 'full-sync': {
      const outcome = await sync.run(data.userId, 'full');
      await enqueueComputeProfile(deps.redis, data.userId);
      return outcome;
    }
    case 'daily-refresh': {
      const outcome = await sync.run(data.userId, 'daily');
      await enqueueComputeProfile(deps.redis, data.userId);
      return outcome;
    }
    case 'compute-profile': {
      const { data: result, error } = await deps.sb.rpc('compute_audience_profile', {
        p_user_id: data.userId,
      });
      if (error) throw new Error(`compute_profile_failed: ${error.message}`);
      logger.info({ userId: data.userId, result }, 'audience profile computed');
      return result as Record<string, unknown>;
    }
    case 'daily-sweep': {
      const { data: connections } = await deps.sb
        .from('youtube_connections')
        .select('user_id')
        .eq('status', 'active');
      const users = (connections ?? []) as Array<{ user_id: string }>;
      const queue = createYoutubeSyncQueue(deps.redis);
      for (const u of users) {
        await queue.add('job', { kind: 'daily-refresh', userId: u.user_id } satisfies YoutubeSyncJob, {
          jobId: `daily:${new Date().toISOString().slice(0, 10)}:${u.user_id}`,
          // Stagger: 0–30 min random delay keeps 10k users off one thundering
          // herd while staying inside the nightly window.
          delay: Math.floor(Math.random() * 30 * 60 * 1000),
        });
      }
      await queue.close();
      logger.info({ users: users.length }, 'daily sweep enqueued');
      return { ok: true };
    }
    case 'maintenance': {
      // 1. Prune expired raw reports + oauth state (RPC, service-role only).
      await deps.sb.rpc('prune_youtube_raw');
      await deps.sb.rpc('prune_youtube_oauth_state');
      // 2. Flush the Redis quota buffer into the durable ledger.
      const rows = await deps.ledger.drainForFlush(1000);
      const flushed = await QuotaLedger.flushToDb(deps.sb, rows as Array<Record<string, unknown>>);
      if (flushed > 0) logger.info({ flushed }, 'quota ledger flushed');
      // 3. Module P closed loop: measure outcomes published >= 7 days ago.
      try {
        const { PublishService } = await import('../scripts/publish-service.js');
        const { createVoiceGenerationService } = await import('../voice/create-voice-service.js');
        const publisher = new PublishService(
          deps.sb, deps.redis, createVoiceGenerationService(deps.redis),
          deps.tokens, deps.analytics,
        );
        const measured = await publisher.measurePending(20);
        if (measured > 0) logger.info({ measured }, 'script outcomes measured');
      } catch (err) {
        logger.warn({ error: String(err) }, 'outcome measurement skipped');
      }
      return { ok: true };
    }
    default:
      throw new Error(`unknown youtube sync job: ${JSON.stringify(job.data)}`);
  }
}

/** Register the repeatable sweep + maintenance schedulers (idempotent). */
export async function ensureRepeatables(queue: Queue<YoutubeSyncJob>): Promise<void> {
  // BullMQ 6 job schedulers (the modern replacement for repeat job options).
  // 01:15 UTC daily = 06:45 IST — yesterday's analytics is finalized by then.
  await queue.upsertJobScheduler(
    'daily-sweep',
    { pattern: '15 1 * * *' },
    { data: { kind: 'daily-sweep' } satisfies YoutubeSyncJob as unknown as YoutubeSyncJob },
  );
  await queue.upsertJobScheduler(
    'maintenance',
    { pattern: '*/30 * * * *' },
    { data: { kind: 'maintenance' } satisfies YoutubeSyncJob as unknown as YoutubeSyncJob },
  );
}
