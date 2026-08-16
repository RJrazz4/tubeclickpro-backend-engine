import { describe, expect, it, vi } from 'vitest';
import type { VoiceProvider } from '../src/voice/contracts.js';
import { VoiceProviderError } from '../src/voice/errors.js';
import { VoiceRouter } from '../src/voice/voice-router.js';

const request = {
  text: 'Hello TubeClick',
  voiceAlias: 'daniel' as const,
  stability: 0.5,
  speed: 1,
  outputFormat: 'mp3' as const,
};

function provider(name: VoiceProvider['name'], result: 'success' | 'failure', configured = true): VoiceProvider {
  return {
    name,
    isConfigured: () => configured,
    generate: vi.fn(async () => {
      if (result === 'failure') {
        throw new VoiceProviderError(name, 'RATE_LIMITED', 'provider failed');
      }
      return { provider: name, audio: Buffer.from('ID3audio'), contentType: 'audio/mpeg' };
    }),
  };
}

describe('VoiceRouter', () => {
  it('uses the first configured high-tier provider when it succeeds', async () => {
    const eleven = provider('elevenlabs', 'success');
    const fish = provider('fish-audio', 'success');
    const router = new VoiceRouter([eleven, fish], { toMp3: vi.fn(async (audio) => audio.audio) });
    const result = await router.generate(request);
    expect(result.provider).toBe('elevenlabs');
    expect(result.fallbackDepth).toBe(0);
    expect(fish.generate).not.toHaveBeenCalled();
  });

  it('silently cascades from high-tier failure to an open-source provider', async () => {
    const eleven = provider('elevenlabs', 'failure');
    const fish = provider('fish-audio', 'failure');
    const piper = provider('piper', 'success');
    const router = new VoiceRouter([eleven, fish, piper], {
      toMp3: vi.fn(async (audio) => audio.audio),
    });
    const result = await router.generate(request);
    expect(result.provider).toBe('piper');
    expect(result.fallbackDepth).toBe(2);
  });

  it('returns a controlled 503 rather than an unhandled 500 when all providers fail', async () => {
    const router = new VoiceRouter(
      [provider('elevenlabs', 'failure'), provider('chattts', 'failure')],
      { toMp3: vi.fn(async (audio) => audio.audio) },
    );
    await expect(router.generate(request)).rejects.toMatchObject({
      statusCode: 503,
      code: 'VOICE_PROVIDERS_UNAVAILABLE',
    });
  });
});
