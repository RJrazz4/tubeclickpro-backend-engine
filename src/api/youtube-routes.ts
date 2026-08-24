import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { AuthService } from '../auth/auth-service.js';
import { AppError, ForbiddenError } from '../domain/errors.js';
import { redisKey } from '../infrastructure/redis.js';
import {
  buildYoutubeSyncDeps,
  createYoutubeSyncQueue,
  enqueueFullSync,
  youtubeSyncModuleEnabled,
  type YoutubeSyncDeps,
} from '../youtube/sync-queue.js';
import { ConnectionService } from '../youtube/connection-service.js';

/**
 * Module O HTTP surface.
 *
 *   GET    /api/youtube/auth-url      (Supabase JWT)  → { authUrl } for the
 *            frontend "Connect YouTube" button — the ONLY sanctioned copy
 *            (never "Sign in with Google").
 *   GET    /api/youtube/callback      (Google hit)    → completes the
 *            handshake via the single-use state row, then 302 to the app.
 *   GET    /api/youtube/connection    (Supabase JWT)  → status card payload.
 *   DELETE /api/youtube/connection    (Supabase JWT)  → revoke + purge vault.
 *   POST   /api/youtube/sync          (Supabase JWT, premium) → on-demand
 *            re-sync, rate-limited to 1/hour/user.
 */

export interface YoutubeRouteDependencies {
  auth: AuthService;
  redis: Redis;
  deps?: YoutubeSyncDeps;
}

function moduleUnavailable(): never {
  throw new AppError('YouTube module is not configured on this deployment', 503, 'YOUTUBE_MODULE_DISABLED');
}

export async function registerYoutubeRoutes(
  app: FastifyInstance,
  dependencies: YoutubeRouteDependencies,
): Promise<void> {
  const enabled = youtubeSyncModuleEnabled();
  const deps = dependencies.deps ?? (enabled ? buildYoutubeSyncDeps(dependencies.redis) : undefined);
  const connections = deps
    ? new ConnectionService(deps.sb, deps.redis, deps.analytics, async (userId) => {
        const queue = createYoutubeSyncQueue(deps.redis);
        try {
          await enqueueFullSync(queue, userId);
        } finally {
          await queue.close();
        }
      })
    : null;

  app.get('/api/youtube/auth-url', async (request, reply) => {
    if (!enabled || !connections) moduleUnavailable();
    const user = await dependencies.auth.authenticate(request.headers);
    const redirectTo =
      typeof (request.query as { redirectTo?: string } | undefined)?.redirectTo === 'string' &&
      (request.query as { redirectTo: string }).redirectTo.startsWith('/')
        ? (request.query as { redirectTo: string }).redirectTo
        : '/';
    const { authUrl } = await connections.beginConnect(user.id, redirectTo);
    return reply.code(200).send({ authUrl, buttonText: 'Connect YouTube' });
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/youtube/callback',
    async (request, reply) => {
      if (!enabled || !connections) moduleUnavailable();
      const config = (await import('../config/env.js')).getConfig();
      const { code, state, error } = request.query;
      if (error) {
        return reply.redirect(`${config.YOUTUBE_CONNECT_ERROR_URL}&reason=${encodeURIComponent(error)}`, 302);
      }
      if (!code || !state) {
        return reply.redirect(`${config.YOUTUBE_CONNECT_ERROR_URL}&reason=missing_params`, 302);
      }
      try {
        await connections.completeConnect(state, code);
      } catch (err) {
        request.log.warn({ err: String(err) }, 'youtube connect failed');
        return reply.redirect(`${config.YOUTUBE_CONNECT_ERROR_URL}&reason=connect_failed`, 302);
      }
      return reply.redirect(config.YOUTUBE_CONNECT_SUCCESS_URL, 302);
    },
  );

  app.get('/api/youtube/connection', async (request) => {
    if (!enabled || !connections) moduleUnavailable();
    const user = await dependencies.auth.authenticate(request.headers);
    return connections.getStatus(user.id);
  });

  app.delete('/api/youtube/connection', async (request, reply) => {
    if (!enabled || !connections) moduleUnavailable();
    const user = await dependencies.auth.authenticate(request.headers);
    await connections.disconnect(user.id);
    return reply.code(204).send();
  });

  app.post('/api/youtube/sync', async (request, reply) => {
    if (!enabled || !deps || !connections) moduleUnavailable();
    const user = await dependencies.auth.authenticate(request.headers);
    if (user.tier !== 'premium') {
      throw new ForbiddenError('On-demand sync is a Pro feature', 'PRO_REQUIRED');
    }
    // 1/hour per user (Redis fixed-window; O(1), no DB).
    const windowKey = redisKey('yt', 'syncrl', user.id, new Date().toISOString().slice(0, 13));
    const used = await dependencies.redis.incr(windowKey);
    if (used === 1) await dependencies.redis.expire(windowKey, 3600);
    if (used > 1) {
      throw new AppError('Sync already requested recently', 429, 'SYNC_RATE_LIMITED', {
        retryAfterSeconds: 3600,
      });
    }
    const status = await connections.getStatus(user.id);
    if (!status.connected || status.status !== 'active') {
      throw new AppError('No active YouTube connection', 409, 'NOT_CONNECTED');
    }
    const queue = createYoutubeSyncQueue(deps.redis);
    try {
      await enqueueFullSync(queue, user.id);
    } finally {
      await queue.close();
    }
    return reply.code(202).send({ status: 'queued' });
  });
}
