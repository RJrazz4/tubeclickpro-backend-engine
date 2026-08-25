import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { AuthService } from '../auth/auth-service.js';
import { executeRequestSchema } from '../domain/job.js';
import { ForbiddenError } from '../domain/errors.js';
import { JobService } from '../services/job-service.js';
import { JobStore } from '../services/job-store.js';
import { createRedisConnection } from '../infrastructure/redis.js';
import { voiceGenerationRequestSchema } from '../voice/contracts.js';
import type { VoiceGenerationService } from '../voice/voice-generation-service.js';
import { registerYoutubeRoutes } from './youtube-routes.js';
import { registerAudienceRoutes } from './audience-routes.js';
import { registerScriptRoutes } from './script-routes.js';
import { registerChallengeRoutes } from './challenge-routes.js';

const jobQuerySchema = z.object({ jobId: z.string().uuid() });
const idempotencyKeySchema = z.string().uuid();

export interface RouteDependencies {
  auth: AuthService;
  jobs: JobService;
  store: JobStore;
  redis: Redis;
  voice: VoiceGenerationService;
}

export async function registerRoutes(app: FastifyInstance, dependencies: RouteDependencies): Promise<void> {
  app.get('/healthz', async () => ({ status: 'ok', service: 'tubeclickpro-backend-engine' }));

  app.get('/readyz', async (_request, reply) => {
    const pong = await dependencies.redis.ping();
    if (pong !== 'PONG') return reply.code(503).send({ status: 'not-ready' });
    return { status: 'ready', redis: 'ok' };
  });

  await registerYoutubeRoutes(app, { auth: dependencies.auth, redis: dependencies.redis });
  await registerAudienceRoutes(app, { auth: dependencies.auth, redis: dependencies.redis });
  await registerScriptRoutes(app, { auth: dependencies.auth, redis: dependencies.redis });
  await registerChallengeRoutes(app, { auth: dependencies.auth });

  app.post('/api/voice/generate', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers);
    const input = voiceGenerationRequestSchema.parse(request.body);
    const rawIdempotencyKey = request.headers['idempotency-key'];
    const idempotencyKey = idempotencyKeySchema.parse(
      Array.isArray(rawIdempotencyKey) ? rawIdempotencyKey[0] : rawIdempotencyKey,
    );
    const generated = await dependencies.voice.generate(user, input, idempotencyKey);

    return reply
      .code(200)
      .header('Content-Type', generated.contentType)
      .header('Content-Length', String(generated.audio.length))
      .header('Cache-Control', 'private, no-store')
      .header('X-Voice-Provider', generated.provider)
      .header('X-Voice-Fallback-Depth', String(generated.fallbackDepth))
      .send(generated.audio);
  });

  app.post('/api/viral-dna/execute', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers);
    const input = executeRequestSchema.parse(request.body);
    const state = await dependencies.jobs.enqueue(user, input);
    return reply.code(202).send({
      jobId: state.jobId,
      status: state.status,
      tier: state.tier,
      queueClass: state.queueClass,
      delivery: state.delivery,
      statusUrl: `/api/viral-dna/status?jobId=${state.jobId}`,
      ...(state.tier === 'premium'
        ? { streamUrl: `/api/viral-dna/stream?jobId=${state.jobId}` }
        : { upgradeRequiredForStreaming: true }),
    });
  });

  app.get('/api/viral-dna/status', async (request) => {
    const user = await dependencies.auth.authenticate(request.headers);
    const { jobId } = jobQuerySchema.parse(request.query);
    return await dependencies.jobs.getOwnedJob(user, jobId);
  });

  app.get('/api/viral-dna/stream', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers);
    if (user.tier !== 'premium') {
      throw new ForbiddenError('Real-time SSE delivery requires Premium', 'PREMIUM_STREAM_REQUIRED');
    }

    const { jobId } = jobQuerySchema.parse(request.query);
    const state = await dependencies.jobs.getOwnedJob(user, jobId);
    if (state.tier !== 'premium') {
      throw new ForbiddenError('Free Conveyor jobs are delivered through polling', 'FREE_JOB_POLLING_ONLY');
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`event: snapshot\ndata: ${JSON.stringify(state)}\n\n`);

    const subscriber = createRedisConnection();
    const channel = dependencies.store.eventChannel(user.id, jobId);
    await subscriber.subscribe(channel);
    subscriber.on('message', (_channel: string, message: string) => {
      if (!reply.raw.destroyed) reply.raw.write(`event: progress\ndata: ${message}\n\n`);
    });
    const heartbeat = setInterval(() => {
      if (!reply.raw.destroyed) reply.raw.write(': heartbeat\n\n');
    }, 15_000);

    const cleanup = (): void => {
      clearInterval(heartbeat);
      void subscriber.unsubscribe(channel).finally(() => subscriber.quit());
    };
    request.raw.once('close', cleanup);
  });
}
