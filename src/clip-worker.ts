import { getConfig } from './config/env.js';
import { createRedisConnection } from './infrastructure/redis.js';
import { logger } from './observability/logger.js';
import { clipModuleEnabled, createClipWorker } from './clips/clip-queue.js';

/**
 * Dedicated Clip Render worker process.
 *
 * Runs ONLY the clip-render queue so it can live in its own Docker service
 * (bundling ffmpeg + yt-dlp) without starting the other BullMQ consumers that
 * the main `worker.ts` owns. This is the process the Render clip-worker service
 * runs (`npm run start:clip-worker`).
 *
 * Exits immediately (0) when CLIPS_ENABLED is false so a mis-set env doesn't
 * leave an idle container burning a free-tier instance.
 */

const config = getConfig();

if (!clipModuleEnabled()) {
  logger.warn('CLIPS_ENABLED is false — clip worker has nothing to do; exiting');
  process.exit(0);
}

const redis = createRedisConnection();
const worker = createClipWorker(redis);

logger.info(
  { queue: 'clip-render', concurrency: config.CLIPS_WORKER_CONCURRENCY, bin: { ffmpeg: config.FFMPEG_BIN, ytdlp: config.CLIPS_YTDLP_BIN } },
  'clip render worker started (dedicated)',
);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'clip worker shutdown requested');
  await worker.close();
  await redis.quit();
}

process.once('SIGINT', () => void shutdown('SIGINT').finally(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown('SIGTERM').finally(() => process.exit(0)));
