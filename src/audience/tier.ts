/**
 * Tier gating for audience data (locked product decision: FREE sees the
 * Hunger top-3 teaser; PREMIUM sees everything + the 2C narrative).
 * Pure — unit-tested; the route layer just applies it.
 */

export interface HungerCard {
  topic: string;
  rank: number;
  score: number | string;
  evidence: Record<string, unknown>;
  geo?: Record<string, unknown>;
}

export interface ProfileLike {
  freshness: string;
  computed_at: string;
  rollups: Record<string, unknown>;
  narrative?: Record<string, unknown> | null;
}

export interface TieredProfile {
  freshness: string;
  computedAt: string;
  tier: 'free' | 'premium';
  hungers: HungerCard[];
  lockedHungerCount: number;
  rollups: Record<string, unknown>;
  narrative?: Record<string, unknown> | null;
  upsell?: { message: string };
}

export const FREE_HUNGER_TEASER_COUNT = 3;

export function applyProfileTier(
  profile: ProfileLike,
  hungers: HungerCard[],
  tier: 'free' | 'premium',
): TieredProfile {
  const base: TieredProfile = {
    freshness: profile.freshness,
    computedAt: profile.computed_at,
    tier,
    hungers: hungers.slice(0, FREE_HUNGER_TEASER_COUNT),
    lockedHungerCount: Math.max(0, hungers.length - FREE_HUNGER_TEASER_COUNT),
    rollups: {},
  };

  if (tier === 'premium') {
    return {
      freshness: base.freshness,
      computedAt: base.computedAt,
      tier,
      hungers,
      lockedHungerCount: 0,
      rollups: profile.rollups,
      narrative: profile.narrative ?? null,
    };
  }

  // Free tier: top-3 cards + the two most persuasive rollup teasers only.
  return {
    ...base,
    hungers: base.hungers,
    rollups: {
      top_country: profile.rollups.top_country ?? null,
      geo: profile.rollups.geo ?? [],
      demo_pyramid: Array.isArray(profile.rollups.demo_pyramid)
        ? (profile.rollups.demo_pyramid as unknown[]).slice(0, 2)
        : [],
    },
    upsell: {
      message: `Your audience is hungry for ${hungers[0]?.topic ?? 'more'}. Unlock all ${hungers.length} hunger cards, retention analysis, and AI scripts with Pro.`,
    },
  };
}
