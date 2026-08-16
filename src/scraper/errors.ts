export type ScraperProvider = 'agent-reach' | 'youtube-data-api';

export class ScraperProviderError extends Error {
  constructor(
    readonly provider: ScraperProvider,
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ScraperProviderError';
  }
}

export class ExtractionUnavailableError extends Error {
  constructor(
    readonly primaryCode: string,
    readonly fallbackCode: string,
  ) {
    super('Both the primary and fallback YouTube extraction providers are unavailable');
    this.name = 'ExtractionUnavailableError';
  }
}

export function providerErrorCode(error: unknown, fallback = 'UNKNOWN_PROVIDER_ERROR'): string {
  return error instanceof ScraperProviderError ? error.code : fallback;
}
