import { CostBudgetExceededError } from './errors.js';

/**
 * Per-job cost guard (mandate: script synthesis ≤ $0.12, premium quality).
 *
 * Token counts come from OpenRouter's usage blocks (authoritative). USD
 * estimates use a small price table (env-overridable JSON); when a model has
 * no entry, the guard falls back to a conservative paid-model estimate so a
 * missing price can NEVER silently disable the cap.
 */

const DEFAULT_PRICE_PER_1M: Record<string, { input: number; output: number }> = {
  // Claude-class premium defaults (conservative on purpose)
  'anthropic/claude-sonnet-4.5': { input: 3, output: 15 },
  'anthropic/claude-sonnet-4': { input: 3, output: 15 },
  'anthropic/claude-sonnet-5': { input: 3, output: 15 },
  'google/gemini-2.5-pro': { input: 1.25, output: 10 },
  // Free tier — $0 by definition
  'z-ai/glm-5.2:free': { input: 0, output: 0 },
};

const CONSERVATIVE_UNKNOWN = { input: 5, output: 25 };

export interface CostGuardOptions {
  capUsd: number;
  priceTable?: Record<string, { input: number; output: number }>;
}

export class CostGuard {
  private spentUsd = 0;
  private readonly prices: Record<string, { input: number; output: number }>;

  constructor(private readonly opts: CostGuardOptions) {
    this.prices = opts.priceTable ?? DEFAULT_PRICE_PER_1M;
  }

  /** Record one completion's usage; throws when the cap is crossed. */
  record(model: string, promptTokens: number, completionTokens: number): void {
    const price = this.prices[model] ?? CONSERVATIVE_UNKNOWN;
    this.spentUsd +=
      (promptTokens / 1_000_000) * price.input + (completionTokens / 1_000_000) * price.output;
    if (this.spentUsd > this.opts.capUsd) {
      throw new CostBudgetExceededError(this.spentUsd, this.opts.capUsd);
    }
  }

  get spent(): number {
    return this.spentUsd;
  }

  /** Pre-flight: would one more call at this estimate fit? */
  canAfford(estimatedPromptTokens: number, estimatedCompletionTokens: number, model: string): boolean {
    const price = this.prices[model] ?? CONSERVATIVE_UNKNOWN;
    const next =
      (estimatedPromptTokens / 1_000_000) * price.input +
      (estimatedCompletionTokens / 1_000_000) * price.output;
    return this.spentUsd + next <= this.opts.capUsd;
  }
}
