import { describe, expect, it } from 'vitest';
import { applyProfileTier, type HungerCard, type ProfileLike } from '../src/audience/tier.js';

const profile: ProfileLike = {
  freshness: 'fresh',
  computed_at: '2026-08-25T10:00:00Z',
  rollups: {
    top_country: 'IN',
    geo: [{ country: 'IN', watch_share_pct: 71 }],
    demo_pyramid: [
      { age_group: 'age18-24', gender: 'male', view_share_pct: 46 },
      { age_group: 'age25-34', gender: 'male', view_share_pct: 22 },
      { age_group: 'age35-44', gender: 'male', view_share_pct: 18 },
    ],
    traffic_mix: [{ source: 'BROWSE', share_pct: 40 }],
  },
  narrative: { brief: 'cached narrative' },
};

const hungers: HungerCard[] = Array.from({ length: 5 }, (_, i) => ({
  topic: `topic-${i + 1}`,
  rank: i + 1,
  score: 0.9 - i * 0.15,
  evidence: { watch_share_pct: 30 - i * 5 },
}));

describe('audience profile tier gating (free = top-3 teaser)', () => {
  it('free tier sees exactly 3 cards + teasers + upsell, never the narrative', () => {
    const out = applyProfileTier(profile, hungers, 'free');
    expect(out.tier).toBe('free');
    expect(out.hungers).toHaveLength(3);
    expect(out.lockedHungerCount).toBe(2);
    expect(out.upsell?.message).toContain('topic-1');
    expect(out.narrative).toBeUndefined();
    expect(out.rollups.traffic_mix).toBeUndefined();
    expect((out.rollups.demo_pyramid as unknown[]).length).toBe(2);
  });

  it('premium tier sees all cards, full rollups, and the narrative', () => {
    const out = applyProfileTier(profile, hungers, 'premium');
    expect(out.hungers).toHaveLength(5);
    expect(out.lockedHungerCount).toBe(0);
    expect(out.rollups.traffic_mix).toBeDefined();
    expect(out.narrative).toEqual({ brief: 'cached narrative' });
    expect(out.upsell).toBeUndefined();
  });

  it('fewer than 3 cards: no fake locked count', () => {
    const out = applyProfileTier(profile, hungers.slice(0, 2), 'free');
    expect(out.hungers).toHaveLength(2);
    expect(out.lockedHungerCount).toBe(0);
  });
});
