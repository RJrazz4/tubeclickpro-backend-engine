/**
 * Stage 4 — the deterministic planner. Pure functions only (no I/O), so the
 * brain→hands contract is fully unit-testable.
 */
import type { CaptionCue } from '../ass-builder.js';
import type { CaptionStyle } from '../clip-input.js';
import type { AgentSignals, EditPlan, EditSegment, SilenceInterval } from './types.js';

export interface SilenceOpts {
  /** Only cut silences at least this long (seconds). */
  minCutSeconds: number;
  /** Drop kept fragments shorter than this (seconds). */
  minKeepSeconds: number;
  /** Hard cap on kept segments (protects the concat graph). */
  maxSegments: number;
}

const DEFAULT_SILENCE_OPTS: SilenceOpts = { minCutSeconds: 0.4, minKeepSeconds: 0.35, maxSegments: 12 };

/** Merge + sort intervals. */
function mergeIntervals(iv: SilenceInterval[]): SilenceInterval[] {
  if (iv.length === 0) return [];
  const sorted = [...iv].sort((a, b) => a.start - b.start);
  const out: SilenceInterval[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else out.push({ ...cur });
  }
  return out;
}

/**
 * Subtract silence intervals from [ws, we], returning the kept segments.
 * Silences shorter than minCutSeconds are kept (natural pauses). Tiny fragments
 * are dropped, and the segment count is capped by merging the shortest cuts.
 */
export function removeSilences(ws: number, we: number, silences: SilenceInterval[], opts: SilenceOpts = DEFAULT_SILENCE_OPTS): EditSegment[] {
  const cuts = mergeIntervals(silences)
    .map((s) => ({ start: Math.max(s.start, ws), end: Math.min(s.end, we) }))
    .filter((s) => s.end - s.start >= opts.minCutSeconds && s.end > s.start);

  // Walk the window, carving out each cut.
  let segments: EditSegment[] = [];
  let cursor = ws;
  for (const cut of cuts) {
    if (cut.start > cursor) segments.push({ start: cursor, end: cut.start });
    cursor = Math.max(cursor, cut.end);
  }
  if (cursor < we) segments.push({ start: cursor, end: we });

  // Drop fragments that are too short to be watchable.
  segments = segments.filter((s) => s.end - s.start >= opts.minKeepSeconds);
  if (segments.length === 0) return [{ start: ws, end: we }];

  // Cap the segment count by removing the shortest cuts (re-merging neighbours).
  while (segments.length > opts.maxSegments) {
    let minGap = Infinity;
    let minIdx = 1;
    for (let i = 1; i < segments.length; i++) {
      const gap = segments[i]!.start - segments[i - 1]!.end;
      if (gap < minGap) {
        minGap = gap;
        minIdx = i;
      }
    }
    const a = segments[minIdx - 1]!;
    const b = segments[minIdx]!;
    segments.splice(minIdx - 1, 2, { start: a.start, end: b.end });
  }
  return segments;
}

/** Cumulative output start time for each kept segment. */
function outputOffsets(segments: EditSegment[]): number[] {
  const offs: number[] = [];
  let acc = 0;
  for (const s of segments) {
    offs.push(acc);
    acc += s.end - s.start;
  }
  return offs;
}

/** Total output duration after cuts. */
export function outputDuration(segments: EditSegment[]): number {
  return segments.reduce((sum, s) => sum + (s.end - s.start), 0);
}

/**
 * Map a source timestamp to the output (post-cut) timeline, or null if it lands
 * inside a removed silence.
 */
export function sourceToOutput(t: number, segments: EditSegment[], offsets: number[]): number | null {
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    if (t >= s.start && t <= s.end) return offsets[i]! + (t - s.start);
  }
  return null;
}

/**
 * Rebase source-timed cues onto the output timeline. Cues inside a removed
 * silence are dropped; cues straddling a cut are clamped to the kept side.
 */
export function remapCues(cues: CaptionCue[], segments: EditSegment[]): CaptionCue[] {
  const offsets = outputOffsets(segments);
  const out: CaptionCue[] = [];
  for (const cue of cues) {
    const s = sourceToOutput(cue.start, segments, offsets);
    if (s === null) continue;
    let e = sourceToOutput(cue.end, segments, offsets);
    if (e === null || e <= s) {
      // ends inside a cut — clamp to the end of the kept segment containing start
      const idx = segments.findIndex((seg) => cue.start >= seg.start && cue.start <= seg.end);
      if (idx === -1) continue;
      e = offsets[idx]! + (segments[idx]!.end - segments[idx]!.start);
    }
    const words = cue.words
      ?.map((w) => {
        const ws = sourceToOutput(w.start, segments, offsets);
        const we = sourceToOutput(w.end, segments, offsets);
        return ws !== null && we !== null && we > ws ? { start: ws, end: we, text: w.text } : null;
      })
      .filter((w): w is { start: number; end: number; text: string } => w !== null);
    out.push({ start: s, end: e, text: cue.text, ...(words && words.length ? { words } : {}) });
  }
  return out;
}

export interface PlanOpts {
  targetDuration: number;
  minDuration: number;
  captionStyle: CaptionStyle;
  silence: SilenceOpts;
  faceTrack: boolean;
}

/**
 * Merge the three agent signals into a deterministic EditPlan. The window comes
 * from Retention (tight in/out) with Story as fallback; the Audio agent's
 * silences are carved out; captions are rebased to the output timeline.
 */
export function buildEditPlan(
  signals: AgentSignals,
  cues: CaptionCue[],
  opts: PlanOpts,
): EditPlan {
  const primary = signals.retention;
  const fallback = signals.story;
  let start = Number.isFinite(primary.startSeconds) ? primary.startSeconds : fallback.startSeconds;
  let end = Number.isFinite(primary.endSeconds) ? primary.endSeconds : fallback.endSeconds;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    start = fallback.startSeconds;
    end = fallback.endSeconds;
  }
  // Clamp to the requested length and a sane floor.
  start = Math.max(0, start);
  end = Math.min(end, start + opts.targetDuration);
  if (end - start < opts.minDuration) end = start + opts.minDuration;

  const segments = removeSilences(start, end, signals.audio.cutSilences, opts.silence);
  const captions = remapCues(
    cues.filter((c) => c.end > start && c.start < end),
    segments,
  );

  const plan: EditPlan = {
    startSeconds: start,
    endSeconds: end,
    segments,
    outputDuration: outputDuration(segments),
    captions,
    faceTrack: opts.faceTrack,
    captionStyle: opts.captionStyle,
    reason: `retention(${primary.source}): ${primary.reason} | story(${fallback.source}): ${fallback.reason} | audio(${signals.audio.source}): ${signals.audio.reason}`,
  };
  if (signals.story.hookText) plan.hookText = signals.story.hookText;
  return plan;
}
