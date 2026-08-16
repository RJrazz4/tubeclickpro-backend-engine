import type { VoiceProviderName } from './contracts.js';

export class VoiceProviderError extends Error {
  constructor(
    readonly provider: VoiceProviderName,
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'VoiceProviderError';
  }
}

export class VoiceConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoiceConfigurationError';
  }
}
