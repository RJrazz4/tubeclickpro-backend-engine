import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { registerRoutes } from './api/routes.js';
import { createAuthService } from './auth/auth-service.js';
import { getConfig } from './config/env.js';
import { AppError } from './domain/errors.js';
import { createRedisConnection } from './infrastructure/redis.js';
import { createRunRepository } from './persistence/supabase-run-repository.js';
import { closeQueues, createViralDnaQueues } from './queue/queues.js';
import { JobService } from './services/job-service.js';
import { JobStore } from './services/job-store.js';
import { TierRateLimiter } from './services/tier-rate-limiter.js';
import { createVoiceGenerationService } from './voice/create-voice-service.js';

export async function buildApp(): Promise<FastifyInstance> {
  const config = getConfig();
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: {
        paths: ['req.headers.authorization', 'authorization', '*.token', '*.access_token'],
        censor: '[REDACTED]',
      },
    },
    trustProxy: true,
    requestIdHeader: 'x-request-id',
    bodyLimit: 64 * 1024,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.CORS_ORIGINS.split(',').map((origin) => origin.trim()),
    credentials: true,
    exposedHeaders: ['X-Voice-Provider', 'X-Voice-Fallback-Depth'],
  });

  const redis = createRedisConnection();
  const queues = createViralDnaQueues(redis);
  const store = new JobStore(redis);
  const jobs = new JobService(
    queues,
    store,
    new TierRateLimiter(redis),
    createRunRepository(),
  );

  await registerRoutes(app, {
    auth: createAuthService(),
    jobs,
    store,
    redis,
    voice: createVoiceGenerationService(redis),
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', issues: error.issues },
      });
    }
    if (error instanceof AppError) {
      if (error.statusCode === 429 && error.details?.retryAfterSeconds) {
        reply.header('Retry-After', String(error.details.retryAfterSeconds));
      }
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    request.log.error({ error }, 'unhandled request error');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  app.addHook('onClose', async () => {
    await closeQueues(queues);
    await redis.quit();
  });

  return app;
}
