/**
 * Keyless, zero-cost public intelligence sources for the Trend Radar.
 *
 * Everything here uses endpoints that require NO API key:
 *   - YouTube oEmbed  (metadata / thumbnail for a known video id)
 *   - Public Piped API mirrors (trending + search; no key, CORS-friendly)
 *
 * Each source is defensive: on any failure it yields an empty result rather
 * than throwing, so the radar degrades gracefully and never takes the host
 * down. All network calls are bounded by a short timeout.
 */

export interface TrendItem {
  videoId: string;
  title: string;
  channel: string;
  views: number | null;
  thumbnail: string | null;
  url: string;
  source: 'piped' | 'oembed';
}

/** Public Piped API mirrors, tried in order. No key required. */
export const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.private.coffee',
] as const;

const DEFAULT_TIMEOUT_MS = 6_000;

async function getJson<T>(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Extract a YouTube video id from a raw id, watch URL, short URL, or Piped-relative path. */
export function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  const match =
    trimmed.match(/[?&]v=([A-Za-z0-9_-]{11})/) ||
    trimmed.match(/(?:^|\/)(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/) ||
    trimmed.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  return match?.[1] ?? null;
}

interface PipedVideo {
  url?: string;
  title?: string;
  uploaderName?: string;
  uploaderUrl?: string;
  views?: number;
  thumbnail?: string;
}

function parsePipedVideo(raw: PipedVideo, source: 'piped'): TrendItem | null {
  const videoId = raw.url ? extractVideoId(raw.url) : null;
  if (!videoId || !raw.title) return null;
  return {
    videoId,
    title: raw.title,
    channel: raw.uploaderName ?? '',
    views: typeof raw.views === 'number' ? raw.views : null,
    thumbnail: raw.thumbnail ?? null,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    source,
  };
}

/** Trending videos via the first reachable Piped mirror. [] on total failure. */
export async function pipedTrending(region = 'US'): Promise<TrendItem[]> {
  for (const base of PIPED_INSTANCES) {
    try {
      const data = await getJson<PipedVideo[]>(`${base}/trending?region=${encodeURIComponent(region)}`);
      if (Array.isArray(data)) {
        const items = data
          .map((v) => parsePipedVideo(v, 'piped'))
          .filter((v): v is TrendItem => v !== null);
        if (items.length > 0) return items;
      }
    } catch {
      // try the next mirror
    }
  }
  return [];
}

/** Topic search across Piped mirrors. [] on total failure. */
export async function pipedSearch(topic: string): Promise<TrendItem[]> {
  for (const base of PIPED_INSTANCES) {
    try {
      const data = await getJson<{ items?: PipedVideo[] }>(
        `${base}/search?q=${encodeURIComponent(topic)}&filter=videos`,
      );
      if (data && Array.isArray(data.items)) {
        const items = data.items
          .map((v) => parsePipedVideo(v, 'piped'))
          .filter((v): v is TrendItem => v !== null);
        if (items.length > 0) return items;
      }
    } catch {
      // try the next mirror
    }
  }
  return [];
}

interface OembedResponse {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
}

/** Keyless metadata for a known video id (title / channel / thumbnail). */
export async function oembed(videoId: string): Promise<TrendItem | null> {
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`,
    )}&format=json`;
    const data = await getJson<OembedResponse>(url);
    if (!data?.title) return null;
    return {
      videoId,
      title: data.title,
      channel: data.author_name ?? '',
      views: null,
      thumbnail: data.thumbnail_url ?? null,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      source: 'oembed',
    };
  } catch {
    return null;
  }
}
