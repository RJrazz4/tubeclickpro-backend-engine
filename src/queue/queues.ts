import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { ViralDnaJobPayload } from '../domain/job.js';
import { getConfig } from '../config/env.js';
import { FREE_QUEUE_NAME, PREMIUM_QUEUE_NAME, QUEUE_BASE } from './names.js';

export interface ViralDnaQueues {
  free: Queue<ViralDnaJobPayload>;
  premium: Queue<ViralDnaJobPayload>;
}

export function createViralDnaQueues(connection: Redis): ViralDnaQueues {
  const prefix = `${getConfig().REDIS_KEY_PREFIX}:${QUEUE_BASE}`;
  const defaults = {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 3000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86400, count: 1000 },
  };

  return {
    free: new Queue<ViralDnaJobPayload>(FREE_QUEUE_NAME, {
      connection,
      prefix,
      defaultJobOptions: defaults,
    }),
    premium: new Queue<ViralDnaJobPayload>(PREMIUM_QUEUE_NAME, {
      connection,
      prefix,
      defaultJobOptions: defaults,
    }),
  };
}

export async function closeQueues(queues: ViralDnaQueues): Promise<void> {
  await Promise.all([queues.free.close(), queues.premium.close()]);
}
