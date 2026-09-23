import type { CaptionCue } from './ass-builder.js';
import { parseVtt } from './vtt.js';

/**
 * Caption ingestion + windowing.
 *
 * YouTube's JSON3 track carries per-word timing (`segs[].tOffsetMs`), which is
 * what powers true word-level karaoke highlighting. VTT is the line-level
 * fallback. `sliceCues` cuts the full transcript down to the chosen clip window
 * and rebases times to 0 (the downloaded section starts at 0).
 */

interface Json3Seg {
  utf8?: string;
  tOffsetMs?: number;
}
interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Json3Seg[];
}

/** Parse YouTube JSON3 captions into cues WITH per-word timing. */
export function parseJson3Captions(raw: string): CaptionCue[] {
  let data: { events?: Json3Event[] };
  try {
    data = JSON.parse(raw) as { events?: Json3Event[] };
  } catch {
    return [];
  }
  const events = Array.isArray(data.events) ? data.events : [];
  const cues: CaptionCue[] = [];

  for (const ev of events) {
    if (!ev || !Array.isArray(ev.segs) || ev.segs.length === 0) continue;
    const startSec = (ev.tStartMs ?? 0) / 1000;
    const durSec = (ev.dDurationMs ?? 0) / 1000;
    const endSec = startSec + durSec;

    const words: Array<{ start: number; end: number; text: string }> = [];
    for (const seg of ev.segs) {
      const text = (seg.utf8 ?? '').replace(/\s+/g, ' ');
      if (!text.trim()) continue;
      words.push({ start: startSec + (seg.tOffsetMs ?? 0) / 1000, end: 0, text: text.trim() });
    }
    if (words.length === 0) continue;
    for (let i = 0; i < words.length; i += 1) {
      const cur = words[i];
      const next = words[i + 1];
      if (cur) cur.end = next ? next.start : endSec;
    }

    const text = words.map((w) => w.text).join(' ').trim();
    cues.push({ start: startSec, end: endSec, text, words });
  }
  return cues;
}

/** Dispatch on the caption file extension. */
export function parseCaptions(raw: string, format: 'json3' | 'vtt'): CaptionCue[] {
  return format === 'json3' ? parseJson3Captions(raw) : parseVtt(raw);
}

/**
 * Cut the transcript to [start, start+duration] and rebase to 0.
 * Cues/words are clamped to the window; partially-overlapping cues are trimmed.
 */
export function sliceCues(cues: CaptionCue[], startSeconds: number, durationSeconds: number): CaptionCue[] {
  const end = startSeconds + durationSeconds;
  const out: CaptionCue[] = [];
  for (const cue of cues) {
    if (cue.end <= startSeconds || cue.start >= end) continue;
    const relStart = Math.max(0, cue.start - startSeconds);
    const relEnd = Math.min(durationSeconds, cue.end - startSeconds);
    if (relEnd <= relStart) continue;
    const words = cue.words
      ?.filter((w) => w.end > startSeconds && w.start < end)
      .map((w) => ({
        start: Math.max(0, w.start - startSeconds),
        end: Math.min(durationSeconds, w.end - startSeconds),
        text: w.text,
      }));
    out.push({ start: relStart, end: relEnd, text: cue.text, ...(words && words.length ? { words } : {}) });
  }
  return out;
}
