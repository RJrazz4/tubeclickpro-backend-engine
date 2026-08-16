import { getConfig } from '../../config/env.js';
import type { ProviderAudio, VoiceGenerationRequest, VoiceProvider } from '../contracts.js';
import { VoiceProviderError } from '../errors.js';
import { fetchProviderAudio } from '../http-audio.js';
import {
  configuredUrl,
  parseJsonMap,
  type GptSovitsVoiceMap,
} from '../voice-maps.js';

export class GptSovitsProvider implements VoiceProvider {
  readonly name = 'gpt-sovits' as const;
  private readonly config = getConfig();
  private readonly endpoint = configuredUrl(this.config.GPT_SOVITS_URL, 'GPT_SOVITS_URL');
  private readonly voices = parseJsonMap<GptSovitsVoiceMap>(
    this.config.GPT_SOVITS_VOICE_MAP_JSON,
    'GPT_SOVITS_VOICE_MAP_JSON',
  );

  isConfigured(): boolean {
    return Boolean(this.endpoint && Object.keys(this.voices).length > 0);
  }

  async generate(request: VoiceGenerationRequest): Promise<ProviderAudio> {
    const voice = this.voices[request.voiceAlias];
    if (!this.endpoint || !voice?.refAudioPath) {
      throw new VoiceProviderError(this.name, 'NOT_CONFIGURED', 'GPT-SoVITS voice is not configured');
    }
    const result = await fetchProviderAudio({
      provider: this.name,
      url: this.endpoint,
      headers: {
        'content-type': 'application/json',
        accept: 'audio/wav,audio/*',
        ...(this.config.GPT_SOVITS_API_KEY
          ? { authorization: `Bearer ${this.config.GPT_SOVITS_API_KEY}` }
          : {}),
      },
      body: {
        text: request.text,
        text_lang: voice.textLang ?? 'en',
        ref_audio_path: voice.refAudioPath,
        prompt_text: voice.promptText ?? '',
        prompt_lang: voice.promptLang ?? 'en',
        text_split_method: 'cut5',
        speed_factor: request.speed,
        streaming_mode: false,
        media_type: 'wav',
      },
    });
    return { provider: this.name, ...result };
  }
}
