import {
  AllKeysDownError,
  NoKeysConfiguredError,
  RouterHttpError,
  isRetryableStatus,
} from './errors.js';
import type {
  ChatMessage,
  CompletionResult,
  KeyHealth,
  KeyState,
  OpenRouterTransport,
  PublicKeyState,
} from './types.js';

export interface OpenRouterRouterOptions {
  /** Model used when the caller doesn't override (tier models come from env). */
  model: string;
  timeoutMs: number;
  /** Usage sink — wired to the CostGuard and the platform budget tracker. */
  onUsage?: (usage: { model: string; keyId: string; promptTokens: number; completionTokens: number }) => void;
}

/**
 * Resilient OpenRouter router with automatic key rotation.
 * (Ported, battle-tested identical semantics to tubeclick-ai-manager-bot.)
 *
 * - Least-recently-used key selection spreads load across the pool.
 * - 402 (exhausted) / 429 (rate-limited) / 5xx / network error → key marked
 *   unhealthy and the SAME prompt immediately retries on the next key.
 * - Exponential cooldown per key (60s → 2m → 4m … capped 30m); sweep() revives.
 * - Non-retryable errors (e.g. 400 bad prompt) fail fast — no pointless failover.
 */
export class OpenRouterRouter {
  private keys: KeyState[];
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly transport: OpenRouterTransport;
  private readonly onUsage?: OpenRouterRouterOptions['onUsage'];

  constructor(rawKeys: string[], transport: OpenRouterTransport, opts: OpenRouterRouterOptions) {
    if (rawKeys.length === 0) throw new NoKeysConfiguredError();
    this.transport = transport;
    this.model = opts.model;
    this.timeoutMs = opts.timeoutMs;
    this.onUsage = opts.onUsage;
    this.keys = rawKeys.map((key, i) => ({
      id: `OPENROUTER_KEY_${i + 1}`,
      key,
      health: 'active' as KeyHealth,
      cooldownUntil: null,
      calls: 0,
      errors: 0,
      lastUsedAt: 0,
    }));
  }

  get keyCount(): number {
    return this.keys.length;
  }

  /** Secret-free view for /status-style surfaces and logs. */
  getKeyStates(): PublicKeyState[] {
    return this.keys.map(({ key: _key, ...rest }) => rest);
  }

  async complete(messages: ChatMessage[], model?: string, extra?: Record<string, unknown>): Promise<CompletionResult> {
    const maxAttempts = this.keys.length + 2;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const key = this.pickActiveKey();
      if (!key) {
        this.sweep();
        if (!this.pickActiveKey()) throw new AllKeysDownError(this.keys.length);
        continue;
      }

      key.lastUsedAt = Date.now();
      key.calls += 1;

      try {
        const result = await this.transport({
          apiKey: key.key,
          model: model ?? this.model,
          messages,
          timeoutMs: this.timeoutMs,
          ...(extra !== undefined ? { extra } : {}),
        });
        this.markSuccess(key);
        this.onUsage?.({
          model: result.model,
          keyId: key.id,
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
        });
        return { ...result, keyId: key.id };
      } catch (err) {
        if (err instanceof RouterHttpError && !isRetryableStatus(err.status)) {
          key.errors += 1;
          throw err;
        }
        this.markUnhealthy(key, err instanceof RouterHttpError ? err.status : 0);
      }
    }

    throw new AllKeysDownError(this.keys.length);
  }

  sweep(): void {
    const now = Date.now();
    for (const key of this.keys) {
      if (key.health !== 'active' && key.cooldownUntil !== null && key.cooldownUntil <= now) {
        key.health = 'active';
        key.cooldownUntil = null;
      }
    }
  }

  private pickActiveKey(): KeyState | null {
    const active = this.keys.filter((k) => k.health === 'active');
    if (active.length === 0) return null;
    active.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    return active[0] ?? null;
  }

  private markSuccess(key: KeyState): void {
    key.health = 'active';
    key.errors = 0;
    key.cooldownUntil = null;
  }

  private markUnhealthy(key: KeyState, status: number): void {
    key.errors += 1;
    key.cooldownUntil = Date.now() + this.cooldownMs(key.errors);
    if (status === 402) key.health = 'exhausted';
    else if (status === 429) key.health = 'rate_limited';
    else key.health = 'cooling_down';
  }

  private cooldownMs(errorCount: number): number {
    const base = 60_000;
    const cap = 30 * 60_000;
    return Math.min(base * 2 ** Math.min(errorCount - 1, 5), cap);
  }
}
