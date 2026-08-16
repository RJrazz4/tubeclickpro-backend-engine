import { getConfig } from '../../config/env.js';
import type { ProviderAudio, VoiceGenerationRequest, VoiceProvider } from '../contracts.js';
import { VoiceProviderError } from '../errors.js';
import { fetchProviderAudio } from '../http-audio.js';
import { configuredUrl, parseJsonMap, type StringVoiceMap } from '../voice-maps.js';

export class ChatTtsProvider implements VoiceProvider {
  readonly name = 'chattts' as const;
  private readonly config = getConfig();
  private readonly endpoint = configuredUrl(this.config.CHATTTS_URL, 'CHATTTS_URL');
  private readonly voices = parseJsonMap<StringVoiceMap>(
    this.config.CHATTTS_VOICE_MAP_JSON,
    'CHATTTS_VOICE_MAP_JSON',
  );

  isConfigured(): boolean {
    return Boolean(this.endpoint && Object.keys(this.voices).length > 0);
  }

  async generate(request: VoiceGenerationRequest): Promise<ProviderAudio> {
    const speaker = this.voices[request.voiceAlias];
    if (!this.endpoint || !speaker) {
      throw new VoiceProviderError(this.name, 'NOT_CONFIGURED', 'ChatTTS voice is not configured');
    }
    const result = await fetchProviderAudio({
      provider: this.name,
      url: this.endpoint,
      headers: {
        'content-type': 'application/json',
        accept: 'audio/wav,audio/*',
        ...(this.config.CHATTTS_API_KEY
          ? { authorization: `Bearer ${this.config.CHATTTS_API_KEY}` }
          : {}),
      },
      body: {
        text: request.text,
        speaker,
        speed: request.speed,
        format: 'wav',
      },
    });
    return { provider: this.name, ...result };
  }
}
