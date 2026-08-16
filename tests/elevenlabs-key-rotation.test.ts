import { describe, expect, it, vi } from 'vitest';
import { ElevenLabsProvider } from '../src/voice/providers/elevenlabs.js';

const request = {
  text: 'Hello rotation',
  voiceAlias: 'daniel' as const,
  stability: 0.5,
  speed: 1,
  outputFormat: 'mp3' as const,
};

function audioResponse(status = 200): Response {
  return new Response(status === 200 ? Buffer.from('ID3audio') : JSON.stringify({ detail: 'quota' }), {
    status,
    headers: { 'content-type': status === 200 ? 'audio/mpeg' : 'application/json' },
  });
}

describe('ElevenLabs API key pool', () => {
  it('retries with the next key after a 429 and succeeds before router fallback', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(audioResponse(429))
      .mockResolvedValueOnce(audioResponse(200));
    const provider = new ElevenLabsProvider(' key-one, key-two ', fetchMock);

    const result = await provider.generate(request);
    expect(result.provider).toBe('elevenlabs');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const secondHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(firstHeaders['xi-api-key']).toBe('key-one');
    expect(secondHeaders['xi-api-key']).toBe('key-two');
  });

  it('exhausts every key before allowing VoiceRouter to cascade', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(audioResponse(429));
    const provider = new ElevenLabsProvider(['key-one', 'key-two', 'key-three'], fetchMock);

    await expect(provider.generate(request)).rejects.toMatchObject({
      code: 'KEY_POOL_EXHAUSTED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
