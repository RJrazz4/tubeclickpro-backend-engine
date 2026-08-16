import { z } from 'zod';
import { getConfig } from '../config/env.js';
import { extractionResultSchema, type ExtractionResult } from '../domain/extraction.js';
import { ScraperProviderError } from './errors.js';
import type { AgentReachRequest } from './agent-reach-runner.js';

const thumbnailSchema = z.object({ url: z.string() }).passthrough();
const thumbnailsSchema = z.record(z.string(), thumbnailSchema).optional();
const videoResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      snippet: z.object({
        title: z.string(),
        description: z.string().default(''),
        channelId: z.string(),
        channelTitle: z.string(),
        publishedAt: z.string(),
        thumbnails: thumbnailsSchema,
      }),
      statistics: z
        .object({
          viewCount: z.string().optional(),
        })
        .optional(),
      contentDetails: z
        .object({
          duration: z.string().optional(),
        })
        .optional(),
    }),
  ),
});

const channelResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      snippet: z.object({
        title: z.string(),
        description: z.string().default(''),
        customUrl: z.string().optional(),
        thumbnails: thumbnailsSchema,
      }),
      statistics: z
        .object({
          subscriberCount: z.string().optional(),
          videoCount: z.string().optional(),
          viewCount: z.string().optional(),
        })
        .optional(),
    }),
  ),
});

type FetchLike = typeof fetch;

function videoIdFromUrl(value: string): string {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  let candidate: string | null = null;
  if (host === 'youtu.be') candidate = url.pathname.split('/').filter(Boolean)[0] ?? null;
  else if (url.pathname === '/watch') candidate = url.searchParams.get('v');
  else {
    const segments = url.pathname.split('/').filter(Boolean);
    if (['shorts', 'embed', 'live'].includes(segments[0] ?? '')) candidate = segments[1] ?? null;
  }
  if (!candidate || !/^[A-Za-z0-9_-]{6,20}$/.test(candidate)) {
    throw new ScraperProviderError('youtube-data-api', 'INVALID_VIDEO_ID', 'Unable to derive video ID');
  }
  return candidate;
}

function finiteNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function isoDurationSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!match) return null;
  return (
    Number(match[1] ?? 0) * 86400 +
    Number(match[2] ?? 0) * 3600 +
    Number(match[3] ?? 0) * 60 +
    Number(match[4] ?? 0)
  );
}

function bestThumbnail(thumbnails: z.infer<typeof thumbnailsSchema>): string | null {
  if (!thumbnails) return null;
  for (const key of ['maxres', 'standard', 'high', 'medium', 'default']) {
    const url = thumbnails[key]?.url;
    if (url) return url;
  }
  return Object.values(thumbnails)[0]?.url ?? null;
}

export class YouTubeDataApiClient {
  constructor(
    private readonly apiKey = getConfig().YOUTUBE_API_KEY,
    private readonly fetchImpl: FetchLike = globalThis.fetch,
  ) {}

  private async request(path: 'videos' | 'channels', params: Record<string, string>): Promise<unknown> {
    if (!this.apiKey) {
      throw new ScraperProviderError(
        'youtube-data-api',
        'FALLBACK_NOT_CONFIGURED',
        'YOUTUBE_API_KEY is not configured',
      );
    }
    const config = getConfig();
    const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
    for (const [key, value] of Object.entries({ ...params, key: this.apiKey })) {
      url.searchParams.set(key, value);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(config.YOUTUBE_API_TIMEOUT_MS),
      });
    } catch (error) {
      throw new ScraperProviderError(
        'youtube-data-api',
        'FALLBACK_NETWORK_ERROR',
        'YouTube Data API request failed',
        { cause: error },
      );
    }

    if (!response.ok) {
      const code = response.status === 429 ? 'FALLBACK_RATE_LIMITED' : `FALLBACK_HTTP_${response.status}`;
      throw new ScraperProviderError('youtube-data-api', code, 'YouTube Data API rejected the request');
    }
    try {
      return (await response.json()) as unknown;
    } catch (error) {
      throw new ScraperProviderError(
        'youtube-data-api',
        'FALLBACK_INVALID_RESPONSE',
        'YouTube Data API returned invalid JSON',
        { cause: error },
      );
    }
  }

  async extract(request: AgentReachRequest): Promise<ExtractionResult> {
    const videoId = videoIdFromUrl(request.videoUrl);
    const videos = videoResponseSchema.parse(
      await this.request('videos', {
        part: 'snippet,statistics,contentDetails',
        id: videoId,
        maxResults: '1',
      }),
    );
    const video = videos.items[0];
    if (!video) {
      throw new ScraperProviderError('youtube-data-api', 'VIDEO_NOT_FOUND', 'Video not found');
    }

    const warnings = [
      'primary_agent_reach_unavailable',
      'fallback_youtube_data_api_used',
      'official_api_does_not_provide_transcripts',
    ];

    let channelDetails: ExtractionResult['channelDetails'] = {
      id: video.snippet.channelId,
      title: video.snippet.channelTitle,
      description: null,
      customUrl: null,
      subscriberCount: null,
      videoCount: null,
      viewCount: null,
      thumbnailUrl: null,
    };

    try {
      const channels = channelResponseSchema.parse(
        await this.request('channels', {
          part: 'snippet,statistics',
          id: video.snippet.channelId,
          maxResults: '1',
        }),
      );
      const channel = channels.items[0];
      if (channel) {
        channelDetails = {
          id: channel.id,
          title: channel.snippet.title,
          description: channel.snippet.description || null,
          customUrl: channel.snippet.customUrl ?? null,
          subscriberCount: finiteNumber(channel.statistics?.subscriberCount),
          videoCount: finiteNumber(channel.statistics?.videoCount),
          viewCount: finiteNumber(channel.statistics?.viewCount),
          thumbnailUrl: bestThumbnail(channel.snippet.thumbnails),
        };
      }
    } catch (error) {
      warnings.push(
        error instanceof ScraperProviderError
          ? `channel_lookup_partial:${error.code}`
          : 'channel_lookup_partial:INVALID_RESPONSE',
      );
    }

    return extractionResultSchema.parse({
      source: 'youtube-data-api',
      mode: request.mode,
      video: {
        id: video.id,
        title: video.snippet.title,
        channelId: video.snippet.channelId,
        channel: video.snippet.channelTitle,
        durationSeconds: isoDurationSeconds(video.contentDetails?.duration),
        viewCount: finiteNumber(video.statistics?.viewCount),
        publishedAt: video.snippet.publishedAt,
        description: video.snippet.description || null,
        thumbnailUrl: bestThumbnail(video.snippet.thumbnails),
      },
      channelDetails,
      transcript: [],
      hookWindow: [],
      warnings,
    });
  }
}
