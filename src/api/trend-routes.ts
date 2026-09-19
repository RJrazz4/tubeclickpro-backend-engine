import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import type { AuthService } from '../auth/auth-service.js';
import { extractVideoId } from '../trends/sources.js';
import { TrendRadarService } from '../trends/trend-service.js';

/**
 * Trend Radar HTTP surface (zero-cost, keyless intelligence).
 *
 *   GET /api/trends?topic=        (Supabase JWT) → live trending / topic radar
 *   GET /api/trends/intel?video=  (Supabase JWT) → keyless metadata for a video
 */

const trendsQuerySchema = z.object({ topic: z.string().max(200).optional() });
const intelQuerySchema = z.object({ video: z.string().min(1).max(500) });

export interface TrendRouteDependencies {
  auth: AuthService;
  redis: Redis;
}

export async function registerTrendRoutes(
  app: FastifyInstance,
  dependencies: TrendRouteDependencies,
): Promise<void> {
  const service = new TrendRadarService(dependencies.redis);

  app.get('/api/trends', async (request) => {
    await dependencies.auth.authenticate(request.headers);
    const { topic } = trendsQuerySchema.parse(request.query ?? {});
    return service.radar(topic ?? null);
  });

  app.get('/api/trends/intel', async (request, reply) => {
    await dependencies.auth.authenticate(request.headers);
    const { video } = intelQuerySchema.parse(request.query ?? {});
    const id = extractVideoId(video);
    if (!id) return reply.code(400).send({ error: { code: 'BAD_VIDEO', message: 'unrecognised video id/url' } });
    const intel = await service.intel(id);
    if (!intel) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'no metadata available' } });
    return intel;
  });
}
