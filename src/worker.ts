import { Worker, type Job } from 'bullmq';
import { getConfig } from './config/env.js';
import { jobPayloadSchema, type JobState, type ViralDnaJobPayload } from './domain/job.js';
import { createRedisConnection } from './infrastructure/redis.js';
import { logger } from './observability/logger.js';
import { McpContextClient } from './mcp/context-client.js';
import { MicroCritic } from './pipeline/micro-critic.js';
import { FreePipeline } from './pipeline/free-pipeline.js';
import { PremiumPipeline } from './pipeline/premium-pipeline.js';
import { createRunRepository } from './persistence/supabase-run-repository.js';
import { FREE_QUEUE_NAME, PREMIUM_QUEUE_NAME, QUEUE_BASE } from './queue/names.js';
import { AgentReachRunner } from './scraper/agent-reach-runner.js';
import { ResilientYouTubeExtractor } from './scraper/resilient-youtube-extractor.js';
import { YouTubeDataApiClient } from './scraper/youtube-data-api.js';
import { JobStore } from './services/job-store.js';
import { TierRateLimiter } from './services/tier-rate-limiter.js';
import {
  buildYoutubeSyncDeps,
  createYoutubeSyncQueue,
  createYoutubeSyncWorker,
  ensureRepeatables,
  youtubeSyncModuleEnabled,
} from './youtube/sync-queue.js';

const config = getConfig();
const redis = createRedisConnection();
const store = new JobStore(redis);
const limiter = new TierRateLimiter(redis);
const runs = createRunRepository();
if (config.NODE_ENV === 'production' && config.YOUTUBE_API_KEY.length === 0) {
  throw new Error('YOUTUBE_API_KEY is required by the production fallback engine');
}
const scraper = new ResilientYouTubeExtractor(
  new AgentReachRunner(),
  new YouTubeDataApiClient(),
);
const mcp = new McpContextClient();
const freePipeline = new FreePipeline(scraper);
const premiumPipeline = new PremiumPipeline(scraper, store, new MicroCritic(mcp));
const prefix = `${config.REDIS_KEY_PREFIX}:${QUEUE_BASE}`;
const workers: Array<Worker<ViralDnaJobPayload>> = [];

// YouTube Signal Link worker (Module O/S) — started only when configured.
if (youtubeSyncModuleEnabled()) {
  const ytDeps = buildYoutubeSyncDeps(redis);
  const ytQueue = createYoutubeSyncQueue(redis);
  void ensureRepeatables(ytQueue)
    .then(() => ytQueue.close())
    .catch((err) => logger.warn({ error: String(err) }, 'youtube repeatables failed'));
  const ytWorker = createYoutubeSyncWorker(ytDeps);
  workers.push(ytWorker as unknown as Worker<ViralDnaJobPayload>);
  logger.info({ concurrency: config.YOUTUBE_SYNC_CONCURRENCY }, 'youtube sync worker started');
}

async function persist(state: JobState): Promise<void> {
  await runs.upsert(state);
}

async function progress(jobId: string, percent: number, stage: string): Promise<void> {
  const state = await store.update(jobId, {
    status: 'processing',
    progressPercent: percent,
    stage,
  });
  await persist(state);
}

async function processJob(job: Job<ViralDnaJobPayload>): Promise<unknown> {
  const payload = jobPayloadSchema.parse(job.data);
  await progress(payload.jobId, 5, payload.tier === 'premium' ? 'vip-started' : 'conveyor-started');
  const pipeline = payload.tier === 'premium' ? premiumPipeline : freePipeline;
  const result = await pipeline.run(payload, (percent, stage) => progress(payload.jobId, percent, stage));
  return result;
}

function attachLifecycle(worker: Worker<ViralDnaJobPayload>): void {
  worker.on('completed', (job, result) => {
    void (async () => {
      const state = await store.update(job.data.jobId, {
        status: 'completed',
        progressPercent: 100,
        stage: 'completed',
        result,
      });
      await persist(state);
      await limiter.release(job.data.userId, job.data.tier, job.data.jobId);
      logger.info({ jobId: job.data.jobId, tier: job.data.tier }, 'viral DNA job completed');
    })().catch((error) => logger.error({ error, jobId: job.data.jobId }, 'completion handler failed'));
  });

  worker.on('failed', (job, error) => {
    if (!job) return;
    void (async () => {
      const attempts = job.opts.attempts ?? 1;
      const finalAttempt = job.attemptsMade >= attempts;
      const state = await store.update(job.data.jobId, {
        status: finalAttempt ? 'failed' : 'processing',
        progressPercent: 0,
        stage: finalAttempt ? 'failed' : 'retry-scheduled',
        error: { code: finalAttempt ? 'PROCESSING_FAILED' : 'RETRY_SCHEDULED', message: error.message },
      });
      await persist(state);
      if (finalAttempt) await limiter.release(job.data.userId, job.data.tier, job.data.jobId);
      logger.warn(
        { jobId: job.data.jobId, tier: job.data.tier, finalAttempt, error: error.message },
        'viral DNA job failed',
      );
    })().catch((handlerError) =>
      logger.error({ error: handlerError, jobId: job.data.jobId }, 'failure handler failed'),
    );
  });

  worker.on('error', (error) => logger.error({ error }, 'BullMQ worker error'));
}

if (config.WORKER_TIER === 'free' || config.WORKER_TIER === 'all') {
  const worker = new Worker<ViralDnaJobPayload>(FREE_QUEUE_NAME, processJob, {
    connection: createRedisConnection(),
    prefix,
    concurrency: config.FREE_WORKER_CONCURRENCY,
    limiter: { max: config.FREE_QUEUE_RATE_MAX, duration: config.FREE_QUEUE_RATE_DURATION_MS },
  });
  workers.push(worker);
  attachLifecycle(worker);
}

if (config.WORKER_TIER === 'premium' || config.WORKER_TIER === 'all') {
  const worker = new Worker<ViralDnaJobPayload>(PREMIUM_QUEUE_NAME, processJob, {
    connection: createRedisConnection(),
    prefix,
    concurrency: config.PREMIUM_WORKER_CONCURRENCY,
    limiter: { max: config.PREMIUM_QUEUE_RATE_MAX, duration: config.PREMIUM_QUEUE_RATE_DURATION_MS },
  });
  workers.push(worker);
  attachLifecycle(worker);
}

logger.info(
  {
    workerTier: config.WORKER_TIER,
    freeConcurrency: config.FREE_WORKER_CONCURRENCY,
    premiumConcurrency: config.PREMIUM_WORKER_CONCURRENCY,
  },
  'worker pool started',
);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'worker shutdown requested');
  await Promise.all(workers.map((worker) => worker.close()));
  await mcp.close();
  await redis.quit();
}

process.once('SIGINT', () => void shutdown('SIGINT').finally(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown('SIGTERM').finally(() => process.exit(0)));
