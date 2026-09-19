import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractVideoId, pipedTrending } from '../src/trends/sources.js';
import { TrendRadarService } from '../src/trends/trend-service.js';

type FetchMock = (url: string, init?: unknown) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

function makeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    redis: {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => {
        store.set(k, v);
        return 'OK';
      },
    } as never,
  };
}

const trendingPayload = [
  { url: '/watch?v=aaaaaaaaaaa', title: 'T1', uploaderName: 'C1', views: 100, thumbnail: 'http://t/1.jpg' },
  { url: '/watch?v=aaaaaaaaaaa', title: 'dup', uploaderName: 'C1' },
  { url: '/watch?v=bbbbbbbbbbb', title: 'T2', uploaderName: 'C2' },
];

const okJson = (payload: unknown): FetchMock => async () => ({ ok: true, status: 200, json: async () => payload });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('extractVideoId', () => {
  it('parses ids, watch urls, and short urls', () => {
    expect(extractVideoId('aaaaaaaaaaa')).toBe('aaaaaaaaaaa');
    expect(extractVideoId('https://www.youtube.com/watch?v=bbbbbbbbbbb')).toBe('bbbbbbbbbbb');
    expect(extractVideoId('https://youtu.be/ccccccccccc')).toBe('ccccccccccc');
    expect(extractVideoId('not a video')).toBeNull();
  });
});

describe('pipedTrending', () => {
  it('normalizes and dedupes is left to the service; source parses items', async () => {
    vi.stubGlobal('fetch', vi.fn(okJson(trendingPayload)));
    const items = await pipedTrending();
    expect(items.length).toBe(3); // source returns raw parse; dedupe happens in service
    expect(items[0]).toMatchObject({ videoId: 'aaaaaaaaaaa', title: 'T1', channel: 'C1', views: 100 });
  });

  it('falls back to the next mirror when the first throws', async () => {
    const impl = vi.fn(async (url: string) => {
      if (url.includes('kavin.rocks')) throw new Error('down');
      return { ok: true, status: 200, json: async () => trendingPayload };
    });
    vi.stubGlobal('fetch', impl);
    const items = await pipedTrending();
    expect(items.length).toBeGreaterThan(0);
    expect(impl.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('returns [] when every mirror fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('all down');
    }));
    expect(await pipedTrending()).toEqual([]);
  });
});

describe('TrendRadarService', () => {
  it('dedupes by videoId and reports count', async () => {
    vi.stubGlobal('fetch', vi.fn(okJson(trendingPayload)));
    const { redis } = makeRedis();
    const service = new TrendRadarService(redis);
    const radar = await service.radar(null);
    expect(radar.count).toBe(2); // aaaaaaaaaaa + bbbbbbbbbbb
    expect(radar.items.map((i) => i.videoId)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  });

  it('serves the second read from cache without refetching', async () => {
    const fetchMock = vi.fn(okJson(trendingPayload));
    vi.stubGlobal('fetch', fetchMock);
    const { redis, store } = makeRedis();
    const service = new TrendRadarService(redis);
    await service.radar(null);
    await service.radar(null);
    expect(fetchMock.mock.calls.length).toBe(1);
    expect(store.has('trend:trending')).toBe(true);
  });
});
