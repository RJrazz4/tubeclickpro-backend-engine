import { describe, expect, it } from 'vitest';
import { voiceGenerationRequestSchema } from '../src/voice/contracts.js';

describe('voice generation contract', () => {
  it('accepts only allowlisted TubeClick aliases', () => {
    expect(
      voiceGenerationRequestSchema.parse({
        text: 'Hello',
        voiceAlias: 'daniel',
        stability: 0.5,
        speed: 1,
        outputFormat: 'mp3',
      }).voiceAlias,
    ).toBe('daniel');
  });

  it('rejects raw provider voice IDs and unsafe settings', () => {
    expect(() =>
      voiceGenerationRequestSchema.parse({
        text: 'Hello',
        voiceAlias: 'raw-provider-id',
        stability: 2,
        speed: 5,
        outputFormat: 'wav',
      }),
    ).toThrow();
  });
});
