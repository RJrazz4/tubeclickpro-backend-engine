import { describe, expect, it } from 'vitest';
import { TIER_POLICY } from '../src/domain/tier.js';

const source = {
  source: 'agent-reach/yt-dlp' as const,
  mode: 'basic' as const,
  video: {
    id: 'abc123',
    title: 'Test',
    channel: 'Channel',
    durationSeconds: 120,
    viewCount: 1000,
    publishedAt: '20260816',
    description: 'Description',
    thumbnailUrl: null,
  },
  transcript: [],
  hookWindow: [],
  warnings: [],
};

describe('tier policy', () => {
  it('keeps Free on Conveyor polling without deep analysis', () => {
    expect(TIER_POLICY.free).toEqual({
      delivery: 'polling',
      queueClass: 'conveyor',
      deepHookAnalysis: false,
      microCritic: false,
    });
  });

  it('keeps Premium on VIP SSE with deep analysis', () => {
    expect(TIER_POLICY.premium).toEqual({
      delivery: 'sse',
      queueClass: 'vip',
      deepHookAnalysis: true,
      microCritic: true,
    });
  });

  it('does not accidentally mutate shared fixture state', () => {
    expect(source.mode).toBe('basic');
  });
});
