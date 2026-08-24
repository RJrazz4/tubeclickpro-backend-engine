export class NoKeysConfiguredError extends Error {
  constructor() {
    super('No OPENROUTER_API_KEYS configured for the LLM gateway');
    this.name = 'NoKeysConfiguredError';
  }
}

export class AllKeysDownError extends Error {
  constructor(keyCount: number) {
    super(`All ${keyCount} OpenRouter keys are down (exhausted / rate-limited / cooling down)`);
    this.name = 'AllKeysDownError';
  }
}

export class RouterHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`OpenRouter HTTP ${status}: ${message.slice(0, 200)}`);
    this.name = 'RouterHttpError';
  }
}

/** 402 (out of credit), 429 (rate limit), 5xx (transient) — rotate keys. */
export function isRetryableStatus(status: number): boolean {
  return status === 402 || status === 429 || status >= 500;
}

export class CostBudgetExceededError extends Error {
  constructor(
    readonly spentUsd: number,
    readonly capUsd: number,
  ) {
    super(`Script synthesis cost budget exceeded: $${spentUsd.toFixed(4)} > $${capUsd.toFixed(4)}`);
    this.name = 'CostBudgetExceededError';
  }
}
