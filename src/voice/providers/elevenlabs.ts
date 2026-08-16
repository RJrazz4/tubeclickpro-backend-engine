import { getConfig } from '../../config/env.js';
import type { ProviderAudio, VoiceGenerationRequest, VoiceProvider } from '../contracts.js';
import { VoiceProviderError } from '../errors.js';
import { fetchProviderAudio } from '../http-audio.js';
import { parseJsonMap, type StringVoiceMap } from '../voice-maps.js';

const DEFAULT_ELEVENLABS_VOICES: StringVoiceMap = {
  george: 'JBFqnCBsd6RMkjVDRZzb',
  sarah: 'EXAVITQu4vr4xnSDxMaL',
  laura: 'FGY2WhTYpPnrIDTdsKH5',
  charlie: 'IKne3meq5aSn9XLyUdCD',
  brian: 'nPczCjzI2devNBz1zQrb',
  daniel: 'onwK4e9ZLuTAKqWW03F9',
  liam: 'TX3LPaxmHKxFdv7VOQHJ',
  alice: 'Xb7hH8MSUJpSbSDYk0k2',
  matilda: 'XrExE9yKIg1WjnnlVkGX',
  will: 'bIHbv24MWmeRgasZH58o',
  jessica: 'cgSgspJ2msm6clMCkdW9',
  eric: 'cjVigY5qzO86Huf0OWal',
  chris: 'iP95p4xoKVk53GoZ742B',
  lily: 'pFZP5JQG7iQjIQuC4Bku',
};

export class ElevenLabsProvider implements VoiceProvider {
  readonly name = 'elevenlabs' as const;
  private readonly config = getConfig();
  private readonly voices = {
    ...DEFAULT_ELEVENLABS_VOICES,
    ...parseJsonMap<StringVoiceMap>(
      this.config.ELEVENLABS_VOICE_MAP_JSON,
      'ELEVENLABS_VOICE_MAP_JSON',
    ),
  };

  isConfigured(): boolean {
    return Boolean(this.config.ELEVENLABS_API_KEY && Object.keys(this.voices).length > 0);
  }

  async generate(request: VoiceGenerationRequest): Promise<ProviderAudio> {
    const voiceId = this.voices[request.voiceAlias];
    if (!this.config.ELEVENLABS_API_KEY || !voiceId) {
      throw new VoiceProviderError(this.name, 'NOT_CONFIGURED', 'ElevenLabs voice is not configured');
    }
    const url = new URL(
      `/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      this.config.ELEVENLABS_BASE_URL,
    );
    url.searchParams.set('output_format', 'mp3_44100_128');

    const result = await fetchProviderAudio({
      provider: this.name,
      url,
      headers: {
        'content-type': 'application/json',
        accept: 'audio/mpeg',
        'xi-api-key': this.config.ELEVENLABS_API_KEY,
      },
      body: {
        text: request.text,
        model_id: this.config.ELEVENLABS_MODEL_ID,
        voice_settings: {
          stability: request.stability,
          similarity_boost: 0.75,
          speed: request.speed,
        },
      },
    });

    return { provider: this.name, ...result };
  }
}
