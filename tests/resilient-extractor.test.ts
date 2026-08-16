import { describe, expect, it, vi } from 'vitest';
import type { ExtractionResult } from '../src/domain/extraction.js';
import { ExtractionUnavailableError, ScraperProviderError } from '../src/scraper/errors.js';
import { ResilientYouTubeExtractor } from '../src/scraper/resilient-youtube-extractor.js';

function result(source: ExtractionResult['source']): ExtractionResult {
  return {
    source,
    mode: 'basic',
    video: {
      id: 'abc123',
      title: 'Video',
      channelId: 'channel-1',
      channel: 'Creator',
      durationSeconds: 60,
      viewCount: 100,
      publishedAt: '2026-08-16T00:00:00Z',
      description: null,
      thumbnailUrl: null,
    },
    channelDetails: null,
    transcript: [],
    hookWindow: [],
    warnings: [],
  };
}

const request = { videoUrl: 'https://youtu.be/abc123', mode: 'basic' as const };

describe('primary to official API resilience', () => {
  it('uses Agent-Reach without calling the fallback when primary succeeds', async () => {
    const primary = { extract: vi.fn().mockResolvedValue(result('agent-reach/yt-dlp')) };
    const fallback = { extract: vi.fn().mockResolvedValue(result('youtube-data-api')) };
    const extractor = new ResilientYouTubeExtractor(primary, fallback);
    expect((await extractor.extract(request)).source).toBe('agent-reach/yt-dlp');
    expect(fallback.extract).not.toHaveBeenCalled();
  });

  it('automatically uses the official API after CAPTCHA/rate-limit style failure', async () => {
    const primary = {
      extract: vi
        .fn()
        .mockRejectedValue(
          new ScraperProviderError('agent-reach', 'UPSTREAM_CHALLENGE', 'Human verification requested'),
        ),
    };
    const fallback = { extract: vi.fn().mockResolvedValue(result('youtube-data-api')) };
    const extractor = new ResilientYouTubeExtractor(primary, fallback);
    const extracted = await extractor.extract(request);
    expect(extracted.source).toBe('youtube-data-api');
    expect(extracted.warnings).toContain('primary_failure:UPSTREAM_CHALLENGE');
    expect(fallback.extract).toHaveBeenCalledOnce();
  });

  it('returns one sanitized terminal error if both providers are unavailable', async () => {
    const primary = {
      extract: vi
        .fn()
        .mockRejectedValue(new ScraperProviderError('agent-reach', 'PRIMARY_TIMEOUT', 'timeout')),
    };
    const fallback = {
      extract: vi
        .fn()
        .mockRejectedValue(
          new ScraperProviderError('youtube-data-api', 'FALLBACK_RATE_LIMITED', 'quota'),
        ),
    };
    const extractor = new ResilientYouTubeExtractor(primary, fallback);
    await expect(extractor.extract(request)).rejects.toEqual(
      expect.objectContaining<Partial<ExtractionUnavailableError>>({
        primaryCode: 'PRIMARY_TIMEOUT',
        fallbackCode: 'FALLBACK_RATE_LIMITED',
      }),
    );
  });
});
