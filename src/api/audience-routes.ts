import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../auth/auth-service.js';
import { AppError } from '../domain/errors.js';
import { createSupabaseAdmin } from '../youtube/quota-ledger.js';
import { applyProfileTier, type HungerCard, type ProfileLike } from '../audience/tier.js';
import { BriefService } from '../audience/brief-service.js';
import { createOpenRouterRouter, llmModuleEnabled } from '../llm/create-router.js';
import { redisKey } from '../infrastructure/redis.js';

/**
 * Audience Engine read API (T‑2A-03 verification surface; full dashboard
 * wiring is T‑2A-04).
 *
 *   GET /api/audience/profile   (Supabase JWT)
 *     free    → top-3 hunger teaser + geo/demo teasers + upsell
 *     premium → full rollups + all cards + narrative (once 2C lands)
 */
export interface AudienceRouteDependencies {
  auth: AuthService;
  redis: import('ioredis').Redis;
}

export async function registerAudienceRoutes(
  app: FastifyInstance,
  dependencies: AudienceRouteDependencies,
): Promise<void> {
  const sb = createSupabaseAdmin();

  // T‑2C: the cached Audience Brief (premium). Regenerates only on data drift.
  app.post('/api/audience/brief', async (request, reply) => {
    if (!llmModuleEnabled()) {
      throw new AppError('Brief generation is not configured (no OPENROUTER_API_KEYS)', 503, 'LLM_MODULE_DISABLED');
    }
    const user = await dependencies.auth.authenticate(request.headers);
    if (user.tier !== 'premium') {
      throw new AppError('The Audience Brief is a Pro feature', 403, 'PRO_REQUIRED');
    }
    const day = new Date().toISOString().slice(0, 10);
    const rlKey = redisKey('brief', 'rl', user.id, day);
    const used = await dependencies.redis.incr(rlKey);
    if (used === 1) await dependencies.redis.expire(rlKey, 90_000);
    if (used > 3) {
      throw new AppError('Brief limit reached (3/day)', 429, 'BRIEF_RATE_LIMITED', { retryAfterSeconds: 86_400 });
    }

    const router = createOpenRouterRouter();
    if (!router) throw new AppError('LLM gateway unavailable', 503, 'LLM_MODULE_DISABLED');
    const brief = await new BriefService(sb, router).getOrGenerate(user.id);
    return reply.code(200).send({ ...brief, quota: { used, limit: 3 } });
  });

  app.get('/api/audience/profile', async (request) => {
    const user = await dependencies.auth.authenticate(request.headers);

    const { data: profileRow, error: pErr } = await sb
      .from('audience_profiles')
      .select('freshness, computed_at, rollups, rollups_hash, narrative')
      .eq('user_id', user.id)
      .maybeSingle();
    if (pErr) throw new AppError('Profile lookup failed', 500, 'PROFILE_LOOKUP_FAILED');
    if (!profileRow) {
      throw new AppError('No audience profile yet — connect YouTube to begin', 404, 'NO_PROFILE');
    }
    const profile = profileRow as unknown as ProfileLike & { rollups_hash: string };

    const { data: hungerRows } = await sb
      .from('audience_hungers')
      .select('topic, rank, score, evidence, geo')
      .eq('user_id', user.id)
      .order('rank', { ascending: true });
    const hungers = (hungerRows ?? []) as unknown as HungerCard[];

    return applyProfileTier(profile, hungers, user.tier);
  });
}
