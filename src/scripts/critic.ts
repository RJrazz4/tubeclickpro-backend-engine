import type { AudienceGrounding } from '../audience/context-provider.js';
import { CRITIC_SCORES_SCHEMA, DEFAULT_BANNED_PHRASES, packageSchema, weightedTotal, type CriticScores, type ScriptPackage } from './contracts.js';

/**
 * Deterministic pre-checks — cheap rejects BEFORE any judge call.
 * A package that fails here never reaches the LLM critic (cost mandate).
 */

export type PreCheckFailure = { check: string; detail: string };

export const PASS_THRESHOLD = 85;

export function preCheckPackage(
  pkg: unknown,
  grounding: AudienceGrounding,
  extraBannedPhrases: string[] = [],
): { ok: true; value: ScriptPackage } | { ok: false; failures: PreCheckFailure[] } {
  const failures: PreCheckFailure[] = [];

  const parsed = packageSchema.safeParse(pkg);
  if (!parsed.success) {
    return {
      ok: false,
      failures: [{ check: 'schema', detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 400) }],
    };
  }
  const value = parsed.data;

  // 1. banned phrases (default + creator-specific) — hard fail
  const banned = [...DEFAULT_BANNED_PHRASES, ...extraBannedPhrases].map((p) => p.toLowerCase());
  const haystack = [value.hook.text, ...value.hook.variants, ...value.sections.map((s) => s.voiceover)]
    .join('\n')
    .toLowerCase();
  for (const phrase of banned) {
    if (haystack.includes(phrase)) {
      failures.push({ check: 'banned_phrase', detail: `"${phrase}" appears in the script` });
    }
  }

  // 2. hook budget (schema enforces <=10; double-check the promise is concrete)
  if (!/[0-9]/.test(value.hook.text) && value.hook.text.length < 40) {
    failures.push({ check: 'hook_specificity', detail: 'hook lacks a concrete number or specific promise (>=40 chars)' });
  }

  // 3. grounding references >= 3 (schema enforces) — verify they reference real grounding content
  const groundingBlob = JSON.stringify(grounding).toLowerCase();
  const refs = value.audience_evidence.grounding_references.map((r) => r.toLowerCase());
  const realRefs = refs.filter((r) =>
    groundingBlob.includes(r.slice(0, 24)) || r.includes(grounding.hunger.topic.toLowerCase().slice(0, 12)),
  );
  if (realRefs.length < 1) {
    failures.push({ check: 'grounding_references', detail: 'evidence references do not trace to the grounding block' });
  }

  // 4. evidence numbers must appear in the grounding blob
  const numbersValid = value.audience_evidence.evidence_numbers.filter((n) => {
    const digits = n.replace(/[^0-9.%]/g, '');
    return digits.length >= 1 && groundingBlob.includes(digits.replace(/\.$/, ''));
  });
  if (numbersValid.length < 1) {
    failures.push({ check: 'evidence_numbers', detail: 'cited numbers not found in the grounding block' });
  }

  // 5. language directive echoed
  if (value.language_directive !== grounding.audience.language_directive) {
    failures.push({ check: 'language_directive', detail: 'package must carry the grounding language directive verbatim' });
  }

  return failures.length === 0 ? { ok: true, value } : { ok: false, failures };
}

/** Parse + score critic output. Throws on malformed judge JSON (caller retries). */
export function parseCritic(raw: string): CriticScores {
  const cleaned = raw.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  const json = cleaned.slice(firstBrace, lastBrace + 1);
  return CRITIC_SCORES_SCHEMA.parse(JSON.parse(json));
}

export function criticVerdict(scores: CriticScores): { pass: boolean; total: number } {
  const total = weightedTotal(scores.scores);
  return { pass: total >= PASS_THRESHOLD, total };
}
