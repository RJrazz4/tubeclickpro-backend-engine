/**
 * Stage 3 — PARALLEL AI (the brain, TEXT ONLY). Three narrow agents emit strict
 * JSON signals; none touch pixels, so they run cheaply and concurrently. Each
 * uses the free OpenRouter router when available and falls back to a
 * deterministic heuristic when the router is null or errors — so the pipeline is
 * always $0 and never blocks on an LLM.
 */
import type { OpenRouterRouter } from '../../llm/router.js';
import { logger } from '../../observability/logger.js';
import type { CaptionCue } from '../ass-builder.js';
import { formatTranscript, heuristicSelect } from '../moment-selector.js';
import type { AudioSignal, EnergyPoint, RetentionSignal, SilenceInterval, StorySignal } from './types.js';

const JSON_ONLY = 'Return STRICT JSON only. No prose, no markdown, no code fences.';

const STORY_SYSTEM = `You are the Story Agent for a short-form clipper. Pick the single most
compelling, self-contained moment that hooks a scroller in the first second and
resolves cleanly. ${JSON_ONLY}
Schema: {"startSeconds":number,"endSeconds":number,"hookText":string,"reason":string}
hookText = a <=60 char scroll-stopper drawn from the moment.`;

const RETENTION_SYSTEM = `You are the Retention Agent for a short-form clipper. Choose tight in/out
points that maximise watch-through: start on the hook, cut before attention drops,
avoid mid-sentence starts/ends. ${JSON_ONLY}
Schema: {"startSeconds":number,"endSeconds":number,"peakType":string,"score":number,"reason":string}
peakType one of: hook|payoff|contrast|question|spike.`;

function parseJson<T>(raw: string): T {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1) throw new Error('no json object');
  return JSON.parse(cleaned.slice(first, last + 1)) as T;
}

function transcriptEnd(cues: CaptionCue[]): number {
  return cues.reduce((m, c) => Math.max(m, c.end), 0);
}

function clampWindow(start: number, end: number, cues: CaptionCue[], target: number, minDuration: number): { start: number; end: number } {
  const maxT = transcriptEnd(cues);
  let s = Math.max(0, Number.isFinite(start) ? start : 0);
  let e = Number.isFinite(end) ? end : s + target;
  e = Math.min(e, s + target, maxT > 0 ? maxT : e);
  if (e - s < minDuration) e = s + minDuration;
  return { start: s, end: e };
}

function hookFromCues(cues: CaptionCue[], start: number, end: number): string {
  const inWindow = cues.filter((c) => c.end > start && c.start < end);
  const text = (inWindow[0]?.text ?? '').trim();
  if (!text) return '';
  const clipped = text.length <= 60 ? text : `${text.slice(0, 60).replace(/\s+\S*$/, '')}…`;
  return clipped;
}

export interface AgentDeps {
  router?: OpenRouterRouter | null;
  model?: string;
  minDuration: number;
}

/** Story Agent — the compelling moment + hook. */
export async function runStoryAgent(cues: CaptionCue[], targetDuration: number, deps: AgentDeps): Promise<StorySignal> {
  const heuristic = (): StorySignal => {
    const sel = heuristicSelect(cues, targetDuration);
    const start = sel.startSeconds;
    const end = start + sel.durationSeconds;
    return { startSeconds: start, endSeconds: end, hookText: hookFromCues(cues, start, end), reason: sel.reason, source: 'heuristic' };
  };
  if (!deps.router) return heuristic();
  try {
    const transcript = formatTranscript(cues);
    if (!transcript.trim()) return heuristic();
    const res = await deps.router.complete(
      [
        { role: 'system', content: STORY_SYSTEM },
        { role: 'user', content: `Target length: ${targetDuration}s.\n\nTRANSCRIPT:\n${transcript}` },
      ],
      deps.model,
      { temperature: 0.4, max_tokens: 250 },
    );
    const p = parseJson<Partial<StorySignal>>(res.content);
    const w = clampWindow(Number(p.startSeconds), Number(p.endSeconds), cues, targetDuration, deps.minDuration);
    return {
      startSeconds: w.start,
      endSeconds: w.end,
      hookText: (p.hookText ?? hookFromCues(cues, w.start, w.end)).slice(0, 80),
      reason: p.reason ?? 'llm story pick',
      source: 'llm',
    };
  } catch (err) {
    logger.warn({ error: (err as Error).message }, 'story agent LLM failed; heuristic');
    return heuristic();
  }
}

/** Retention Agent — tight in/out points. */
export async function runRetentionAgent(cues: CaptionCue[], targetDuration: number, deps: AgentDeps): Promise<RetentionSignal> {
  const heuristic = (): RetentionSignal => {
    const sel = heuristicSelect(cues, targetDuration);
    return {
      startSeconds: sel.startSeconds,
      endSeconds: sel.startSeconds + sel.durationSeconds,
      peakType: sel.peakType,
      score: 0.5,
      reason: sel.reason,
      source: 'heuristic',
    };
  };
  if (!deps.router) return heuristic();
  try {
    const transcript = formatTranscript(cues);
    if (!transcript.trim()) return heuristic();
    const res = await deps.router.complete(
      [
        { role: 'system', content: RETENTION_SYSTEM },
        { role: 'user', content: `Target length: ${targetDuration}s.\n\nTRANSCRIPT:\n${transcript}` },
      ],
      deps.model,
      { temperature: 0.2, max_tokens: 250 },
    );
    const p = parseJson<Partial<RetentionSignal>>(res.content);
    const w = clampWindow(Number(p.startSeconds), Number(p.endSeconds), cues, targetDuration, deps.minDuration);
    return {
      startSeconds: w.start,
      endSeconds: w.end,
      peakType: p.peakType ?? 'spike',
      score: Number.isFinite(Number(p.score)) ? Number(p.score) : 0.6,
      reason: p.reason ?? 'llm retention pick',
      source: 'llm',
    };
  } catch (err) {
    logger.warn({ error: (err as Error).message }, 'retention agent LLM failed; heuristic');
    return heuristic();
  }
}

export interface AudioAgentOpts {
  minCutSeconds: number;
}

/**
 * Audio Agent — deterministic from the preprocess envelope: cut dead-air inside
 * the window, never cut through energy. Text/number-only (no LLM needed).
 */
export function runAudioAgent(
  silences: SilenceInterval[],
  energy: EnergyPoint[],
  window: { start: number; end: number },
  opts: AudioAgentOpts,
): AudioSignal {
  const loud = energy.filter((e) => Number.isFinite(e.rms) && e.rms > -45).map((e) => e.t);
  const cutSilences = silences
    .map((s) => ({ start: Math.max(s.start, window.start), end: Math.min(s.end, window.end) }))
    .filter((s) => s.end - s.start >= opts.minCutSeconds)
    // keep a silence if a loud beat lands inside it (avoid clipping a punch-in)
    .filter((s) => !loud.some((t) => t > s.start + 0.1 && t < s.end - 0.1));
  return {
    cutSilences,
    reason: `${cutSilences.length} dead-air gap(s) >= ${opts.minCutSeconds}s`,
    source: 'heuristic',
  };
}
