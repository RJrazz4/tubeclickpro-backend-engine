import type { OpenRouterRouter } from '../llm/router.js';
import { logger } from '../observability/logger.js';
import type { CaptionCue } from './ass-builder.js';

/**
 * Viral-moment auto-selection.
 *
 * Primary path: an OpenRouter free-tier model scores the timestamped transcript
 * and returns the single highest-retention window. Fallback path: a deterministic
 * heuristic (hook-density scoring) so the clipper still auto-selects with zero
 * API keys. Both return a clamped, sentence-aligned window.
 */

export interface MomentSelection {
  startSeconds: number;
  durationSeconds: number;
  reason: string;
  peakType: string;
}

const MOMENT_SYSTEM_PROMPT = `You are a ruthless short-form retention editor. You are given a timestamped transcript of a long video. Your ONLY job is to find the SINGLE most viral clip window — the highest-retention peak — of the requested length.

STRICT RULES:
1. Identify a HIGH-RETENTION PEAK: a strong hook, an open loop, an emotional spike, a surprising/contrarian claim, a concrete payoff, or a quotable one-liner.
2. The window MUST begin at a natural sentence boundary and contain a self-contained mini-arc (setup → spike). NEVER start mid-word or mid-thought.
3. HARD-AVOID: intros, "welcome back", channel housekeeping, sponsor/ad reads, slow exposition, and any segment that needs prior context to land.
4. Prefer the earliest strong peak if several tie. Do not pad — every second must earn retention.
5. The window length must not exceed the requested duration.

Return STRICT JSON ONLY (no prose, no markdown):
{"startSeconds": <int>, "durationSeconds": <int>, "reason": "<= 20 words", "peakType": "hook|spike|payoff|quote"}`;

function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Compact `[m:ss] text` transcript for the model (bounded to ~12k chars). */
export function formatTranscript(cues: CaptionCue[], maxChars = 12_000): string {
  const lines: string[] = [];
  let total = 0;
  for (const cue of cues) {
    const line = `[${mmss(cue.start)}] ${cue.text}`;
    if (total + line.length > maxChars) break;
    lines.push(line);
    total += line.length + 1;
  }
  return lines.join('\n');
}

const HOOK_WORDS = [
  'secret', 'secrets', 'shocking', 'mistake', 'never', 'nobody', 'truth', 'finally', 'warning',
  'stop', 'real reason', 'the problem', 'but here', 'turns out', 'actually', 'worst', 'best',
  'why', 'how', 'what if', 'this is', 'don’t', "don't", 'insane', 'crazy', 'illegal', 'banned',
];

function countHooks(text: string): number {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const kw of HOOK_WORDS) if (lower.includes(kw)) hits += 1;
  return hits;
}

/**
 * Deterministic fallback: slide the window over sentence boundaries and score
 * hook-density. A window that OPENS on a hook line gets a large anchor bonus,
 * because a viral short must start strong, not warm up into its peak.
 */
export function heuristicSelect(cues: CaptionCue[], targetDuration: number): MomentSelection {
  if (cues.length === 0) return { startSeconds: 0, durationSeconds: targetDuration, reason: 'empty transcript', peakType: 'hook' };
  const totalEnd = cues[cues.length - 1]?.end ?? 0;
  const starts = cues.map((c) => c.start).filter((s) => s + targetDuration <= Math.max(totalEnd, targetDuration));
  const candidates = starts.length > 0 ? starts : [0];

  let best = { start: candidates[0] ?? 0, score: -Infinity };
  for (const start of candidates) {
    const end = start + targetDuration;
    let score = 0;
    let anchored = false;
    for (const cue of cues) {
      if (cue.end <= start || cue.start >= end) continue;
      const words = cue.text.split(/\s+/).filter(Boolean).length;
      const hits = countHooks(cue.text);
      score += words + hits * 6; // density + hook language
      if (/\d/.test(cue.text)) score += 2; // concrete numbers
      if (/\?$/.test(cue.text.trim())) score += 3; // question = open loop
      if (!anchored) {
        score += hits * 8; // the opening line must carry the hook
        anchored = true;
      }
    }
    score -= start * 0.001; // prefer the earliest peak on ties
    if (score > best.score) best = { start, score };
  }
  return {
    startSeconds: Math.max(0, Math.floor(best.start)),
    durationSeconds: targetDuration,
    reason: 'highest hook-density window (heuristic)',
    peakType: 'hook',
  };
}

function clampSelection(sel: Partial<MomentSelection>, cues: CaptionCue[], targetDuration: number): MomentSelection {
  const totalEnd = cues.length ? (cues[cues.length - 1]?.end ?? 0) : 0;
  const duration = Math.max(5, Math.min(Math.floor(sel.durationSeconds ?? targetDuration), targetDuration));
  const maxStart = Math.max(0, Math.floor(totalEnd - duration));
  const start = Math.max(0, Math.min(Math.floor(sel.startSeconds ?? 0), maxStart));
  return {
    startSeconds: start,
    durationSeconds: duration,
    reason: typeof sel.reason === 'string' ? sel.reason.slice(0, 160) : 'auto-selected peak',
    peakType: typeof sel.peakType === 'string' ? sel.peakType : 'hook',
  };
}

export interface MomentSelectorDeps {
  router?: OpenRouterRouter | null;
  model?: string;
  timeoutMs?: number;
}

export class MomentSelector {
  constructor(private readonly deps: MomentSelectorDeps = {}) {}

  async select(cues: CaptionCue[], targetDuration: number): Promise<MomentSelection> {
    if (!this.deps.router) return heuristicSelect(cues, targetDuration);
    try {
      const transcript = formatTranscript(cues);
      if (!transcript.trim()) return heuristicSelect(cues, targetDuration);
      const result = await this.deps.router.complete(
        [
          { role: 'system', content: MOMENT_SYSTEM_PROMPT },
          { role: 'user', content: `Requested clip length: ${targetDuration} seconds.\n\nTRANSCRIPT:\n${transcript}` },
        ],
        this.deps.model,
        { temperature: 0.4, max_tokens: 300 },
      );
      const cleaned = result.content.replace(/```(?:json)?/gi, '').trim();
      const first = cleaned.indexOf('{');
      const last = cleaned.lastIndexOf('}');
      const parsed = JSON.parse(cleaned.slice(first, last + 1)) as Partial<MomentSelection>;
      const sel = clampSelection(parsed, cues, targetDuration);
      logger.info({ startSeconds: sel.startSeconds, peakType: sel.peakType }, 'viral moment selected (llm)');
      return sel;
    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'viral moment LLM failed; using heuristic');
      return heuristicSelect(cues, targetDuration);
    }
  }
}
