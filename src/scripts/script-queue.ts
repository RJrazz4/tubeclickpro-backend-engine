import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { getConfig } from '../config/env.js';
import { createRedisConnection, redisKey } from '../infrastructure/redis.js';
import { logger } from '../observability/logger.js';
import { createSupabaseAdmin } from '../youtube/quota-ledger.js';
import { createOpenRouterRouter } from '../llm/create-router.js';
import { SynthesisService, type SynthesisResult } from './synthesis-service.js';
import { ChallengeService } from '../challenge/challenge-service.js';

/**
 * script-synthesis queue. Daily quotas are Redis fixed windows checked at
 * ENQUEUE time (fast reject, no DB):
 *   free    1/day  (the daily-habit loop — locked product decision)
 *   premium 20/day
 */

export const SCRIPT_QUEUE_NAME = 'script-synthesis';

export const DAILY_QUOTA = { free: 1, premium: 20 } as const;

export type ScriptJob = { kind: 'generate'; userId: string; tier: 'free' | 'premium'; hungerTopic?: string };

export function createScriptQueue(redis: Redis): Queue<ScriptJob> {
  const config = getConfig();
  return new Queue<ScriptJob>(SCRIPT_QUEUE_NAME, {
    connection: redis.duplicate(),
    prefix: `${config.REDIS_KEY_PREFIX}:${SCRIPT_QUEUE_NAME}`,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 20_000 },
      removeOnComplete: { age: 3600, count: 200 },
      removeOnFail: { age: 86_400 },
    },
  });
}

/** Redis fixed-window daily quota. Returns the day's used count after this request. */
export async function checkDailyQuota(
  redis: Redis,
  userId: string,
  tier: 'free' | 'premium',
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const day = new Date().toISOString().slice(0, 10);
  const key = redisKey('scripts', 'quota', userId, tier, day);
  const used = await redis.incr(key);
  if (used === 1) await redis.expire(key, 90_000);
  const limit = DAILY_QUOTA[tier];
  if (used > limit) {
    await redis.decr(key); // denied requests don't consume quota
    return { allowed: false, used: used - 1, limit };
  }
  return { allowed: true, used, limit };
}

export async function enqueueGeneration(
  redis: Redis,
  job: ScriptJob,
): Promise<{ jobId: string }> {
  const queue = createScriptQueue(redis);
  try {
    const seq = new Date().toISOString().slice(0, 10);
    const added = await queue.add('job', job, { jobId: `gen:${job.userId}:${seq}:${Date.now()}` });
    return { jobId: String(added.id) };
  } finally {
    await queue.close();
  }
}

export function scriptModuleEnabled(): boolean {
  return getConfig().OPENROUTER_API_KEYS.length > 0;
}

export function createScriptWorker(redis: Redis): Worker<ScriptJob> {
  const config = getConfig();
  const router = createOpenRouterRouter();
  if (!router) throw new Error('script worker requires OPENROUTER_API_KEYS');
  const synthesis = new SynthesisService(createSupabaseAdmin(), router, redis, new ChallengeService(createSupabaseAdmin()));

  const worker = new Worker<ScriptJob>(
    SCRIPT_QUEUE_NAME,
    async (job: Job<ScriptJob>): Promise<SynthesisResult> => {
      const data = job.data;
      if (data.kind !== 'generate') throw new Error(`unknown script job: ${JSON.stringify(data)}`);
      return synthesis.generate({
        userId: data.userId,
        tier: data.tier,
        ...(data.hungerTopic !== undefined ? { hungerTopic: data.hungerTopic } : {}),
      });
    },
    {
      connection: createRedisConnection(),
      prefix: `${config.REDIS_KEY_PREFIX}:${SCRIPT_QUEUE_NAME}`,
      concurrency: 4,
    },
  );
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, error: err.message }, 'script synthesis job failed');
  });
  return worker;
}
