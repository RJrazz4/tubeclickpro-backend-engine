import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { getConfig } from '../config/env.js';
import { createRedisConnection, redisKey } from '../infrastructure/redis.js';
import { logger } from '../observability/logger.js';
import { createSupabaseAdmin } from '../youtube/quota-ledger.js';
import { createOpenRouterRouter } from '../llm/create-router.js';
import { ClipStateStore } from './clip-state.js';
import { SupabaseClipStore } from './clip-store.js';
import { ClipWorkerService } from './clip-worker-service.js';
import { MomentSelector } from './moment-selector.js';
import { clipIdempotencyKey, type CaptionStyle } from './clip-input.js';

/**
 * clip-render queue. The web tier only enqueues (fast, non-blocking); a separate
 * worker service drains at a bounded rate. Quotas are Redis fixed windows checked
 * at ENQUEUE time. Job ids are the idempotency key, so identical requests dedupe.
 */

export const CLIP_QUEUE_NAME = 'clip-render';

export type ClipJob = {
  kind: 'render';
  jobId: string;
  userId: string;
  tier: 'free' | 'premium';
  videoId: string;
  startSeconds: number;
  durationSeconds: number;
  captionStyle: CaptionStyle;
  autoSelect: boolean;
};

export function createClipQueue(redis: Redis): Queue<ClipJob> {
  const config = getConfig();
  return new Queue<ClipJob>(CLIP_QUEUE_NAME, {
    connection: redis.duplicate(),
    prefix: `${config.REDIS_KEY_PREFIX}:${CLIP_QUEUE_NAME}`,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 15_000 },
      removeOnComplete: { age: 3600, count: 200 },
      removeOnFail: { age: 86_400 },
    },
  });
}

/** Redis fixed-window daily clip quota. Denied requests don't consume quota. */
export async function checkClipQuota(
  redis: Redis,
  userId: string,
  tier: 'free' | 'premium',
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const config = getConfig();
  const limit = tier === 'premium' ? config.CLIPS_PREMIUM_PER_DAY : config.CLIPS_FREE_PER_DAY;
  const day = new Date().toISOString().slice(0, 10);
  const key = redisKey('clips', 'quota', userId, tier, day);
  const used = await redis.incr(key);
  if (used === 1) await redis.expire(key, 90_000);
  if (used > limit) {
    await redis.decr(key);
    return { allowed: false, used: used - 1, limit };
  }
  return { allowed: true, used, limit };
}

export async function enqueueClip(
  redis: Redis,
  job: Omit<ClipJob, 'jobId'>,
): Promise<{ jobId: string; deduped: boolean }> {
  const jobId = clipIdempotencyKey(job.userId, job.videoId, job.startSeconds, job.durationSeconds, job.captionStyle, job.autoSelect);
  const full: ClipJob = { ...job, jobId };
  const queue = createClipQueue(redis);
  try {
    const existing = await queue.getJob(jobId);
    if (existing) return { jobId, deduped: true };
    await new ClipStateStore(redis).init(jobId, job.userId);
    await queue.add('job', full, { jobId });
    return { jobId, deduped: false };
  } finally {
    await queue.close();
  }
}

/** Module gate: disabled unless CLIPS_ENABLED=true (routes 503 until then). */
export function clipModuleEnabled(): boolean {
  return getConfig().CLIPS_ENABLED;
}

export function createClipWorker(redis: Redis): Worker<ClipJob> {
  const config = getConfig();
  const store = new SupabaseClipStore(createSupabaseAdmin(), config.CLIPS_STORAGE_BUCKET);
  // Free-tier model for viral-moment selection (zero API cost); null router →
  // the selector transparently falls back to the deterministic heuristic.
  const selector = new MomentSelector({ router: createOpenRouterRouter(), model: config.OPENROUTER_MODEL_FREE });
  const service = new ClipWorkerService({ redis, store, config, selector });

  const worker = new Worker<ClipJob>(
    CLIP_QUEUE_NAME,
    async (job: Job<ClipJob>) => service.render(job.data, (p) => void job.updateProgress(p)),
    {
      connection: createRedisConnection(),
      prefix: `${config.REDIS_KEY_PREFIX}:${CLIP_QUEUE_NAME}`,
      concurrency: config.CLIPS_WORKER_CONCURRENCY,
      limiter: { max: config.CLIPS_QUEUE_RATE_MAX, duration: config.CLIPS_QUEUE_RATE_DURATION_MS },
    },
  );
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, error: err.message }, 'clip render job failed');
  });
  return worker;
}
