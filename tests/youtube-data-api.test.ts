import { describe, expect, it, vi } from 'vitest';
import { YouTubeDataApiClient } from '../src/scraper/youtube-data-api.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('YouTube Data API fallback', () => {
  it('fetches video and channel metadata without inventing transcript data', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: 'abc123',
              snippet: {
                title: 'Fallback video',
                description: 'Description',
                channelId: 'UC123',
                channelTitle: 'Fallback channel',
                publishedAt: '2026-08-16T01:02:03Z',
                thumbnails: { high: { url: 'https://img.youtube.com/high.jpg' } },
              },
              statistics: { viewCount: '123456' },
              contentDetails: { duration: 'PT1M30S' },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: 'UC123',
              snippet: {
                title: 'Fallback channel',
                description: 'Channel description',
                customUrl: '@fallback',
                thumbnails: { default: { url: 'https://img.youtube.com/channel.jpg' } },
              },
              statistics: {
                subscriberCount: '5000',
                videoCount: '120',
                viewCount: '900000',
              },
            },
          ],
        }),
      );

    const client = new YouTubeDataApiClient('test-api-key', fetchMock);
    const result = await client.extract({ videoUrl: 'https://youtu.be/abc123', mode: 'deep' });

    expect(result).toMatchObject({
      source: 'youtube-data-api',
      mode: 'deep',
      video: { id: 'abc123', durationSeconds: 90, viewCount: 123456 },
      channelDetails: { id: 'UC123', subscriberCount: 5000, videoCount: 120 },
      transcript: [],
      hookWindow: [],
    });
    expect(result.warnings).toContain('official_api_does_not_provide_transcripts');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstUrl = fetchMock.mock.calls[0]?.[0];
    expect(String(firstUrl)).toContain('/youtube/v3/videos');
  });

  it('rotates to the next key after YouTube 403 quota exhaustion', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: { reason: 'quotaExceeded' } }, 403))
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: 'abc123',
              snippet: {
                title: 'Rotated video',
                description: '',
                channelId: 'UC123',
                channelTitle: 'Channel',
                publishedAt: '2026-08-16T00:00:00Z',
                thumbnails: {},
              },
              statistics: { viewCount: '1' },
              contentDetails: { duration: 'PT1S' },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ items: [] }));

    const client = new YouTubeDataApiClient(' key-one, key-two ', fetchMock);
    const result = await client.extract({ videoUrl: 'https://youtu.be/abc123', mode: 'basic' });

    expect(result.video.title).toBe('Rotated video');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('key=key-one');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('key=key-two');
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('key=key-two');
  });

  it('reports controlled exhaustion after every YouTube key is quota-limited', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: { reason: 'quotaExceeded' } }, 403));
    const client = new YouTubeDataApiClient(['key-one', 'key-two'], fetchMock);
    await expect(
      client.extract({ videoUrl: 'https://youtu.be/abc123', mode: 'basic' }),
    ).rejects.toMatchObject({ code: 'FALLBACK_KEYS_EXHAUSTED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails clearly when the backup key is not configured', async () => {
    const client = new YouTubeDataApiClient('', vi.fn<typeof fetch>());
    await expect(client.extract({ videoUrl: 'https://youtu.be/abc123', mode: 'basic' })).rejects.toMatchObject({
      code: 'FALLBACK_NOT_CONFIGURED',
    });
  });
});
