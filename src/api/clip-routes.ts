import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { AuthService } from '../auth/auth-service.js';
import { AppError, ForbiddenError } from '../domain/errors.js';
import { getConfig } from '../config/env.js';
import {
  clipRequestSchema,
  clampWindow,
  resolveVideoId,
} from '../clips/clip-input.js';
import { ClipStateStore } from '../clips/clip-state.js';
import { checkClipQuota, clipModuleEnabled, enqueueClip } from '../clips/clip-queue.js';

/**
 * Zero-Cost Viral Shorts Clipper API.
 *
 *   POST /api/clips        {url, startSeconds?, durationSeconds?, captionStyle?}
 *                          → 202 {jobId, deduped, quota}  (never blocks on ffmpeg)
 *   GET  /api/clips/:id    → {status, progress, stage, url?}
 *
 * The request path only validates + enqueues; rendering happens on the worker
 * tier. This is what lets the endpoint survive a 10k-click stampede.
 */

export interface ClipRouteDependencies {
  auth: AuthService;
  redis: Redis;
}

export async function registerClipRoutes(
  app: FastifyInstance,
  dependencies: ClipRouteDependencies,
): Promise<void> {
  const state = new ClipStateStore(dependencies.redis);

  app.post('/api/clips', async (request, reply) => {
    if (!clipModuleEnabled()) {
      throw new AppError('Clipper is not configured (CLIPS_ENABLED=false)', 503, 'CLIPS_MODULE_DISABLED');
    }
    const user = await dependencies.auth.authenticate(request.headers);
    const input = clipRequestSchema.parse(request.body ?? {});

    const videoId = resolveVideoId(input.url);
    if (!videoId) {
      throw new AppError('Provide a valid YouTube URL (watch, youtu.be, or shorts)', 400, 'BAD_VIDEO_URL');
    }

    const { startSeconds, durationSeconds } = clampWindow(
      input.startSeconds,
      input.durationSeconds,
      getConfig().CLIPS_MAX_DURATION_SECONDS,
    );

    const quota = await checkClipQuota(dependencies.redis, user.id, user.tier);
    if (!quota.allowed) {
      throw new AppError(
        `Daily ${user.tier} clip limit reached (${quota.limit}/day)`,
        429,
        'CLIP_QUOTA_REACHED',
        { retryAfterSeconds: 86_400 },
      );
    }

    const { jobId, deduped } = await enqueueClip(dependencies.redis, {
      kind: 'render',
      userId: user.id,
      tier: user.tier,
      videoId,
      startSeconds,
      durationSeconds,
      captionStyle: input.captionStyle,
    });

    return reply.code(202).send({
      status: deduped ? 'deduped' : 'queued',
      jobId,
      videoId,
      window: { startSeconds, durationSeconds },
      quota: { used: quota.used, limit: quota.limit },
    });
  });

  app.get<{ Params: { id: string } }>('/api/clips/:id', async (request) => {
    const user = await dependencies.auth.authenticate(request.headers);
    const clip = await state.get(request.params.id);
    if (!clip) throw new AppError('Not found', 404, 'NOT_FOUND');
    if (clip.userId !== user.id) throw new ForbiddenError('Not your clip');
    return clip;
  });
}
