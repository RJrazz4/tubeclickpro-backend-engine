import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthService } from '../auth/auth-service.js';
import { AppError } from '../domain/errors.js';
import { createSupabaseAdmin } from '../youtube/quota-ledger.js';
import { ChallengeService } from '../challenge/challenge-service.js';

/**
 * Module G HTTP surface (all server-authoritative):
 *   GET    /api/challenge          state + 30-cell calendar + today's drop
 *   POST   /api/challenge/enroll   {timezone} (IANA, pinned)
 *   DELETE /api/challenge          abandon (keeps history + badges earned)
 *
 * There is deliberately NO check-in endpoint: generating the Daily Action
 * Script IS the check-in (the synthesis worker records the day).
 */
export interface ChallengeRouteDependencies {
  auth: AuthService;
}

const enrollSchema = z.object({ timezone: z.string().min(3).max(64) });

export async function registerChallengeRoutes(
  app: FastifyInstance,
  dependencies: ChallengeRouteDependencies,
): Promise<void> {
  const sb = createSupabaseAdmin();
  const challenge = new ChallengeService(sb);

  app.get('/api/challenge', async (request) => {
    const user = await dependencies.auth.authenticate(request.headers);
    return challenge.getState(user.id);
  });

  app.post('/api/challenge/enroll', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers);
    const input = enrollSchema.parse(request.body ?? {});
    try {
      const state = await challenge.enroll(user.id, input.timezone);
      return reply.code(201).send(state);
    } catch (err) {
      const message = (err as Error).message;
      if (message === 'invalid_timezone') {
        throw new AppError('Unknown timezone (use an IANA zone like Asia/Kolkata)', 400, 'INVALID_TIMEZONE');
      }
      if (message === 'already_enrolled') {
        throw new AppError('Challenge already active', 409, 'ALREADY_ENROLLED');
      }
      throw err;
    }
  });

  app.delete('/api/challenge', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers);
    await challenge.abandon(user.id);
    return reply.code(204).send();
  });
}
