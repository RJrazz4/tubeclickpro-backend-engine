import type { Redis } from 'ioredis';
import { oembed, pipedSearch, pipedTrending, type TrendItem } from './sources.js';

export interface TrendRadar {
  generatedAt: string;
  topic: string | null;
  count: number;
  items: TrendItem[];
}

const CACHE_TTL_SECONDS = 600; // 10 minutes keeps cost at zero and dodges rate limits.

/**
 * Aggregates keyless trend sources and caches the result in Redis so repeated
 * radar reads are free and the public mirrors are never hammered.
 */
export class TrendRadarService {
  constructor(private readonly redis: Redis) {}

  private cacheKey(topic: string | null): string {
    return topic ? `trend:search:${topic.toLowerCase()}` : 'trend:trending';
  }

  async radar(topic?: string | null): Promise<TrendRadar> {
    const key = this.cacheKey(topic ?? null);

    const cached = await this.readCache<TrendRadar>(key);
    if (cached) return cached;

    const raw = topic ? await pipedSearch(topic) : await pipedTrending();
    const items = dedupeById(raw);

    const radar: TrendRadar = {
      generatedAt: new Date().toISOString(),
      topic: topic ?? null,
      count: items.length,
      items,
    };
    await this.writeCache(key, radar);
    return radar;
  }

  /** Keyless deep-dive on a single video (metadata + thumbnail). */
  async intel(videoId: string): Promise<TrendItem | null> {
    return oembed(videoId);
  }

  private async readCache<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private async writeCache(key: string, value: TrendRadar): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS);
    } catch {
      // cache is best-effort; a write failure must not break the read path
    }
  }
}

function dedupeById(items: TrendItem[]): TrendItem[] {
  const seen = new Set<string>();
  const out: TrendItem[] = [];
  for (const item of items) {
    if (seen.has(item.videoId)) continue;
    seen.add(item.videoId);
    out.push(item);
  }
  return out;
}
