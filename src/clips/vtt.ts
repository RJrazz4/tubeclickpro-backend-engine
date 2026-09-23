import type { CaptionCue } from './ass-builder.js';

/**
 * Minimal, dependency-free WebVTT parser (YouTube auto-caption format).
 * Pure string → cues, fully unit-testable. Strips inline tags (<c>, <00:00:01.000>)
 * and dedupes YouTube's rolling-window duplicate lines.
 */

function parseTimestamp(ts: string): number | null {
  const m = ts.trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/);
  if (!m) return null;
  const hours = m[1] ? parseInt(m[1], 10) : 0;
  const minutes = parseInt(m[2] ?? '0', 10);
  const seconds = parseInt(m[3] ?? '0', 10);
  const millis = parseInt((m[4] ?? '0').padEnd(3, '0'), 10);
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

export function parseVtt(vtt: string, offsetSeconds = 0): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const blocks = vtt.replace(/\r/g, '').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim().length > 0);
    const arrowIdx = lines.findIndex((l) => l.includes('-->'));
    if (arrowIdx === -1) continue;
    const arrowLine = lines[arrowIdx];
    if (!arrowLine) continue;
    const [startRaw, endRaw] = arrowLine.split('-->');
    if (!startRaw || !endRaw) continue;
    const start = parseTimestamp(startRaw);
    const end = parseTimestamp(endRaw);
    if (start === null || end === null || end <= start) continue;
    const text = stripTags(lines.slice(arrowIdx + 1).join(' '));
    if (!text) continue;
    cues.push({ start: Math.max(0, start - offsetSeconds), end: Math.max(0, end - offsetSeconds), text });
  }
  return dedupeRolling(cues);
}

/** YouTube auto-captions repeat the previous line in a rolling window; drop exact consecutive dupes. */
function dedupeRolling(cues: CaptionCue[]): CaptionCue[] {
  const out: CaptionCue[] = [];
  for (const cue of cues) {
    const prev = out[out.length - 1];
    if (prev && prev.text === cue.text) continue;
    out.push(cue);
  }
  return out;
}
