import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../auth/auth-service.js';
import { AppError } from '../domain/errors.js';
import { createSupabaseAdmin } from '../youtube/quota-ledger.js';
import { applyProfileTier, type HungerCard, type ProfileLike } from '../audience/tier.js';

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
}

export async function registerAudienceRoutes(
  app: FastifyInstance,
  dependencies: AudienceRouteDependencies,
): Promise<void> {
  const sb = createSupabaseAdmin();

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
