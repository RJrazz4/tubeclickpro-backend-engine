import { describe, expect, it } from 'vitest';
import { BriefService } from '../src/audience/brief-service.js';
import type { OpenRouterRouter } from '../src/llm/router.js';

const VALID_BRIEF_JSON = JSON.stringify({
  headline: 'Your audience wants budget camera content tonight',
  who: 'Mostly 18-24 male mobile viewers on Android in North India',
  where_when: '71% watch minutes from India, peaking weekday evenings',
  what_they_want: ['camera reviews', 'editing tips', 'budget tech'],
  retention_truth: '6/7 top videos lose viewers in the opening seconds',
  next_3_videos: [
    { title_idea: 'Best camera under Rs 25k', why: '37.7% watch share, zero supply', hunger_topic: 'camera review' },
    { title_idea: 'Edit like a pro in 8 minutes', why: 'editing hunger rising, ER lift 1.2x', hunger_topic: 'editing tips' },
    { title_idea: 'Rs 15k vs Rs 50k camera test', why: 'comparison formats hold 52% AVP', hunger_topic: 'camera review' },
  ],
});

function fakeSb(profile: Record<string, unknown> | null) {
  return {
    from(table: string) {
      if (table === 'audience_profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: profile, error: null }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (table === 'audience_hungers') {
        return {
          select: () => ({ eq: () => ({ order: async () => ({ data: [{ topic: 'camera review', score: 0.7, evidence: {}, rank: 1 }], error: null }) }) }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as ConstructorParameters<typeof BriefService>[0];
}

const calls: number[] = [];
const fakeRouter = {
  complete: async () => {
    calls.push(1);
    return { model: 'anthropic/claude-sonnet-4.5', content: VALID_BRIEF_JSON, usage: { promptTokens: 100, completionTokens: 400 }, keyId: 'K' };
  },
} as unknown as OpenRouterRouter;

describe('T-2C brief cache (drift contract)', () => {
  it('returns the cached brief without an LLM call when the hash matches', async () => {
    calls.length = 0;
    const cached = {
      freshness: 'fresh',
      rollups: { geo: [] },
      rollups_hash: 'HASH1',
      narrative: { built_on_hash: 'HASH1', generated_at: '2026-08-20T00:00:00Z', model: 'm', prompt_version: 'v1', brief: JSON.parse(VALID_BRIEF_JSON) },
    };
    const svc = new BriefService(fakeSb(cached), fakeRouter);
    const out = await svc.getOrGenerate('u1');
    expect(out.cached).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('regenerates when the rollups drifted (hash mismatch) — exactly one LLM call', async () => {
    calls.length = 0;
    const drifted = {
      freshness: 'fresh',
      rollups: { geo: [] },
      rollups_hash: 'HASH2',
      narrative: { built_on_hash: 'HASH1', generated_at: '2026-08-20T00:00:00Z', model: 'm', prompt_version: 'v1', brief: JSON.parse(VALID_BRIEF_JSON) },
    };
    const svc = new BriefService(fakeSb(drifted), fakeRouter);
    const out = await svc.getOrGenerate('u1');
    expect(out.cached).toBe(false);
    expect(calls).toHaveLength(1);
    expect(out.brief.next_3_videos).toHaveLength(3);
  });

  it('fails closed when no profile exists', async () => {
    await expect(new BriefService(fakeSb(null), fakeRouter).getOrGenerate('u1')).rejects.toThrow(/no_profile/);
  });
});
