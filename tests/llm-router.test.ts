import { describe, expect, it } from 'vitest';
import { AllKeysDownError, NoKeysConfiguredError, RouterHttpError, CostBudgetExceededError } from '../src/llm/errors.js';
import { OpenRouterRouter } from '../src/llm/router.js';
import { CostGuard } from '../src/llm/cost-guard.js';
import type { ChatMessage, OpenRouterTransport } from '../src/llm/types.js';

const MSGS: ChatMessage[] = [{ role: 'user', content: 'hook?' }];

function ok(content = 'done', model = 'anthropic/claude-sonnet-4.5') {
  return {
    model,
    content,
    usage: { promptTokens: 100, completionTokens: 50 },
  };
}

/** Transport script: each call pops the next scripted response (value or error). */
function scripted(steps: Array<{ status?: number; body?: unknown }>): OpenRouterTransport & { calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const fn = async (req: { apiKey: string }) => {
    calls.push(req.apiKey);
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    if (step.status !== undefined && step.status !== 200) {
      throw new RouterHttpError(step.status, 'scripted');
    }
    return (step.body ?? ok()) as Awaited<ReturnType<OpenRouterTransport>>;
  };
  return Object.assign(fn, { calls });
}

describe('OpenRouter router (ported failover semantics)', () => {
  it('rejects construction with zero keys', () => {
    expect(() => new OpenRouterRouter([], scripted([]), { model: 'm', timeoutMs: 1000 })).toThrow(NoKeysConfiguredError);
  });

  it('rotates keys on 402 (exhausted) and still completes', async () => {
    const t = scripted([{ status: 402 }, {}]);
    const r = new OpenRouterRouter(['k1', 'k2'], t, { model: 'm', timeoutMs: 1000 });
    const out = await r.complete(MSGS);
    expect(out.keyId).toBe('OPENROUTER_KEY_2');
    expect(t.calls).toEqual(['k1', 'k2']);
    expect(r.getKeyStates()[0].health).toBe('exhausted');
  });

  it('rotates keys on 429 and 5xx (transient classes)', async () => {
    const t = scripted([{ status: 429 }, { status: 500 }, {}]);
    const r = new OpenRouterRouter(['k1', 'k2', 'k3'], t, { model: 'm', timeoutMs: 1000 });
    const out = await r.complete(MSGS);
    expect(out.keyId).toBe('OPENROUTER_KEY_3');
    expect(r.getKeyStates().map((k) => k.health)).toEqual(['rate_limited', 'cooling_down', 'active']);
  });

  it('fails fast on non-retryable 400 (no pointless failover)', async () => {
    const t = scripted([{ status: 400 }]);
    const r = new OpenRouterRouter(['k1', 'k2'], t, { model: 'm', timeoutMs: 1000 });
    await expect(r.complete(MSGS)).rejects.toBeInstanceOf(RouterHttpError);
    expect(t.calls).toEqual(['k1']); // never touched k2
  });

  it('throws AllKeysDown when every key is out', async () => {
    const t = scripted([{ status: 402 }]);
    const r = new OpenRouterRouter(['k1', 'k2'], t, { model: 'm', timeoutMs: 1000 });
    await expect(r.complete(MSGS)).rejects.toBeInstanceOf(AllKeysDownError);
  });

  it('spreads load least-recently-used across healthy keys', async () => {
    const t = scripted([{}, {}, {}]);
    const r = new OpenRouterRouter(['k1', 'k2'], t, { model: 'm', timeoutMs: 1000 });
    await r.complete(MSGS);
    await r.complete(MSGS);
    expect(t.calls).toEqual(['k1', 'k2']);
  });

  it('reports usage through onUsage (cost wiring)', async () => {
    const seen: number[] = [];
    const t = scripted([{}]);
    const r = new OpenRouterRouter(['k1'], t, {
      model: 'm',
      timeoutMs: 1000,
      onUsage: (u) => seen.push(u.promptTokens, u.completionTokens),
    });
    await r.complete(MSGS);
    expect(seen).toEqual([100, 50]);
  });
});

describe('CostGuard (the $0.12 mandate)', () => {
  it('accumulates known-model spend and throws past the cap', () => {
    const g = new CostGuard({ capUsd: 0.0046 });
    g.record('anthropic/claude-sonnet-4.5', 1000, 100); // $0.0045 <= 0.0046
    expect(g.spent).toBeGreaterThan(0.004);
    expect(() => g.record('anthropic/claude-sonnet-4.5', 1000, 100)).toThrow(CostBudgetExceededError);
  });

  it('free models cost nothing', () => {
    const g = new CostGuard({ capUsd: 0.0001 });
    g.record('z-ai/glm-5.2:free', 1_000_000, 1_000_000);
    expect(g.spent).toBe(0);
  });

  it('unknown models use conservative pricing (cap can never silently vanish)', () => {
    const g = new CostGuard({ capUsd: 5.0 }); // boundary: 5.0 not > 5.0 passes; any more throws
    g.record('mystery/model', 1_000_000, 0); // conservative estimate = exactly $5.00
    expect(g.spent).toBeCloseTo(5.0, 6);
    expect(() => g.record('mystery/model', 1, 1)).toThrow(CostBudgetExceededError);
  });

  it('canAfford pre-flight rejects calls that would cross the cap', () => {
    const g = new CostGuard({ capUsd: 0.12 });
    // 20k in * $3/M = $0.06 + 8k out * $15/M = $0.12 => $0.18 > $0.12 cap
    expect(g.canAfford(20_000, 8_000, 'anthropic/claude-sonnet-4.5')).toBe(false);
    expect(g.canAfford(10_000, 4_000, 'anthropic/claude-sonnet-4.5')).toBe(true); // $0.09 <= cap
  });
});
