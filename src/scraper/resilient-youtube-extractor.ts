import type { ExtractionResult } from '../domain/extraction.js';
import { logger } from '../observability/logger.js';
import type { AgentReachRequest } from './agent-reach-runner.js';
import { ExtractionUnavailableError, providerErrorCode } from './errors.js';

export interface YouTubeExtractor {
  extract(request: AgentReachRequest): Promise<ExtractionResult>;
}

export class ResilientYouTubeExtractor implements YouTubeExtractor {
  constructor(
    private readonly primary: YouTubeExtractor,
    private readonly fallback: YouTubeExtractor,
  ) {}

  async extract(request: AgentReachRequest): Promise<ExtractionResult> {
    try {
      return await this.primary.extract(request);
    } catch (primaryError) {
      const primaryCode = providerErrorCode(primaryError, 'PRIMARY_UNKNOWN_ERROR');
      logger.warn({ primaryCode, mode: request.mode }, 'primary scraper failed; activating official API fallback');
      try {
        const result = await this.fallback.extract(request);
        return {
          ...result,
          warnings: [...result.warnings, `primary_failure:${primaryCode}`],
        };
      } catch (fallbackError) {
        const fallbackCode = providerErrorCode(fallbackError, 'FALLBACK_UNKNOWN_ERROR');
        logger.error(
          { primaryCode, fallbackCode, mode: request.mode },
          'both YouTube extraction providers failed',
        );
        throw new ExtractionUnavailableError(primaryCode, fallbackCode);
      }
    }
  }
}
