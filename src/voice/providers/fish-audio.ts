import { getConfig } from '../../config/env.js';
import type { ProviderAudio, VoiceGenerationRequest, VoiceProvider } from '../contracts.js';
import { VoiceProviderError } from '../errors.js';
import { fetchProviderAudio } from '../http-audio.js';
import { parseJsonMap, type StringVoiceMap } from '../voice-maps.js';

export class FishAudioProvider implements VoiceProvider {
  readonly name = 'fish-audio' as const;
  private readonly config = getConfig();
  private readonly voices = parseJsonMap<StringVoiceMap>(
    this.config.FISH_AUDIO_VOICE_MAP_JSON,
    'FISH_AUDIO_VOICE_MAP_JSON',
  );

  isConfigured(): boolean {
    return Boolean(this.config.FISH_AUDIO_API_KEY && Object.keys(this.voices).length > 0);
  }

  async generate(request: VoiceGenerationRequest): Promise<ProviderAudio> {
    const referenceId = this.voices[request.voiceAlias];
    if (!this.config.FISH_AUDIO_API_KEY || !referenceId) {
      throw new VoiceProviderError(this.name, 'NOT_CONFIGURED', 'Fish Audio voice is not configured');
    }
    const url = new URL('/v1/tts', this.config.FISH_AUDIO_BASE_URL);
    const result = await fetchProviderAudio({
      provider: this.name,
      url,
      headers: {
        'content-type': 'application/json',
        accept: 'audio/mpeg',
        authorization: `Bearer ${this.config.FISH_AUDIO_API_KEY}`,
        model: this.config.FISH_AUDIO_MODEL_ID,
      },
      body: {
        text: request.text,
        reference_id: referenceId,
        format: 'mp3',
        sample_rate: 44100,
        mp3_bitrate: 128,
        normalize: true,
        latency: 'balanced',
        prosody: { speed: request.speed, volume: 0, normalize_loudness: true },
      },
    });
    return { provider: this.name, ...result };
  }
}
