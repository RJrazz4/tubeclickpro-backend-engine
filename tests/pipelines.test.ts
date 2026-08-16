import { describe, expect, it, vi } from 'vitest';
import { FreePipeline } from '../src/pipeline/free-pipeline.js';
import { PremiumPipeline } from '../src/pipeline/premium-pipeline.js';
import type { ExtractionResult } from '../src/domain/extraction.js';
import type { ViralDnaJobPayload } from '../src/domain/job.js';

const payload: ViralDnaJobPayload = {
  jobId: '78212ed1-e56b-4ec0-a409-b47d519fe955',
  userId: 'user-1',
  tier: 'free',
  videoUrl: 'https://youtu.be/abc',
  outputLanguage: 'English',
  requestedAt: '2026-08-16T00:00:00.000Z',
};

function extraction(mode: 'basic' | 'deep'): ExtractionResult {
  return {
    source: 'agent-reach/yt-dlp',
    mode,
    video: {
      id: 'abc',
      title: 'A viral title',
      channel: 'Creator',
      durationSeconds: 100,
      viewCount: 100000,
      publishedAt: '20260816',
      description: null,
      thumbnailUrl: null,
    },
    transcript: [],
    hookWindow:
      mode === 'deep'
        ? [{ startSeconds: 0, durationSeconds: 2, text: 'Stop. You are doing this wrong?' }]
        : [],
    warnings: [],
  };
}

describe('tier pipelines', () => {
  it('Free invokes only basic extraction and returns no Premium analysis', async () => {
    const scraper = { extract: vi.fn().mockResolvedValue(extraction('basic')) };
    const pipeline = new FreePipeline(scraper);
    const result = await pipeline.run(payload, vi.fn().mockResolvedValue(undefined));
    expect(scraper.extract).toHaveBeenCalledWith({ videoUrl: payload.videoUrl, mode: 'basic' });
    expect(result).toMatchObject({ tier: 'free', delivery: 'polling', hookAnalysis: null, criticAudit: null });
  });

  it('Premium stores deep chunks and calls the MCP-backed critic', async () => {
    const premiumPayload = { ...payload, tier: 'premium' as const };
    const scraper = { extract: vi.fn().mockResolvedValue(extraction('deep')) };
    const store = { storeContext: vi.fn().mockResolvedValue(undefined) };
    const critic = { audit: vi.fn().mockResolvedValue({ mode: 'mcp-direct-context', score: 91 }) };
    const pipeline = new PremiumPipeline(scraper, store, critic);
    const result = await pipeline.run(premiumPayload, vi.fn().mockResolvedValue(undefined));
    expect(scraper.extract).toHaveBeenCalledWith({ videoUrl: payload.videoUrl, mode: 'deep' });
    expect(store.storeContext).toHaveBeenCalledOnce();
    expect(critic.audit).toHaveBeenCalledWith(payload.jobId, payload.userId);
    expect(result).toMatchObject({ tier: 'premium', delivery: 'sse' });
  });
});
