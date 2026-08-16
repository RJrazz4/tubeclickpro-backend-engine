import { AppError } from '../domain/errors.js';
import { logger } from '../observability/logger.js';
import type {
  VoiceGenerationRequest,
  VoiceGenerationResult,
  VoiceProvider,
} from './contracts.js';
import { AudioNormalizer } from './audio-normalizer.js';
import { VoiceProviderError } from './errors.js';
import { ChatTtsProvider } from './providers/chattts.js';
import { ElevenLabsProvider } from './providers/elevenlabs.js';
import { FishAudioProvider } from './providers/fish-audio.js';
import { GptSovitsProvider } from './providers/gpt-sovits.js';
import { PiperProvider } from './providers/piper.js';

export class VoiceRouter {
  constructor(
    private readonly providers: VoiceProvider[],
    private readonly normalizer: AudioNormalizer,
  ) {}

  async generate(request: VoiceGenerationRequest): Promise<VoiceGenerationResult> {
    const configured = this.providers.filter((provider) => provider.isConfigured());
    if (configured.length === 0) {
      throw new AppError(
        'Neural voice providers are not configured',
        503,
        'VOICE_PROVIDERS_NOT_CONFIGURED',
      );
    }

    const failures: Array<{ provider: string; code: string }> = [];
    for (let index = 0; index < configured.length; index += 1) {
      const provider = configured[index]!;
      try {
        const generated = await provider.generate(request);
        const audio = await this.normalizer.toMp3(generated);
        logger.info(
          { provider: provider.name, fallbackDepth: index, characters: request.text.length },
          'neural voice generated',
        );
        return {
          provider: provider.name,
          audio,
          contentType: 'audio/mpeg',
          fallbackDepth: index,
        };
      } catch (error) {
        const code = error instanceof VoiceProviderError ? error.code : 'UNKNOWN_PROVIDER_FAILURE';
        failures.push({ provider: provider.name, code });
        logger.warn(
          { provider: provider.name, code, fallbackDepth: index },
          'voice provider failed; cascading to next provider',
        );
      }
    }

    throw new AppError(
      'Voice generation is temporarily unavailable',
      503,
      'VOICE_PROVIDERS_UNAVAILABLE',
      { attempts: failures },
    );
  }
}

export function createVoiceRouter(): VoiceRouter {
  return new VoiceRouter(
    [
      new ElevenLabsProvider(),
      new FishAudioProvider(),
      new GptSovitsProvider(),
      new PiperProvider(),
      new ChatTtsProvider(),
    ],
    new AudioNormalizer(),
  );
}
