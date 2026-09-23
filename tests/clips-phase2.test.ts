// Phase 2: word-level caption timing + viral-moment selection.
// moment-selector imports the logger (which reads config at import time), so it
// is loaded dynamically after AUTH_MODE is set.
process.env.AUTH_MODE = 'development';
process.env.NODE_ENV = 'test';

import { beforeAll, describe, expect, it } from 'vitest';
import { resetConfigForTests } from '../src/config/env.js';
import { parseJson3Captions, sliceCues } from '../src/clips/captions.js';
import type { CaptionCue } from '../src/clips/ass-builder.js';

let heuristicSelect: typeof import('../src/clips/moment-selector.js').heuristicSelect;
let formatTranscript: typeof import('../src/clips/moment-selector.js').formatTranscript;
let MomentSelector: typeof import('../src/clips/moment-selector.js').MomentSelector;

beforeAll(async () => {
  resetConfigForTests();
  ({ heuristicSelect, formatTranscript, MomentSelector } = await import('../src/clips/moment-selector.js'));
});

const JSON3 = JSON.stringify({
  events: [
    { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'Hello', tOffsetMs: 0 }, { utf8: ' world', tOffsetMs: 600 }] },
    { tStartMs: 2000, dDurationMs: 1500, segs: [{ utf8: 'Bye', tOffsetMs: 0 }] },
    { tStartMs: 3500, segs: [{ utf8: '\n' }] }, // newline-only event → skipped
  ],
});

describe('parseJson3Captions (word-level timing)', () => {
  it('derives per-word start/end from tOffsetMs and skips empty events', () => {
    const cues = parseJson3Captions(JSON3);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ start: 0, end: 2, text: 'Hello world' });
    expect(cues[0]?.words).toEqual([
      { start: 0, end: 0.6, text: 'Hello' },
      { start: 0.6, end: 2, text: 'world' },
    ]);
    expect(cues[1]).toMatchObject({ start: 2, end: 3.5, text: 'Bye' });
  });

  it('returns [] on invalid json', () => {
    expect(parseJson3Captions('not json')).toEqual([]);
  });
});

describe('sliceCues (window + rebase)', () => {
  it('cuts to the window, rebases to 0, and trims words', () => {
    const cues = parseJson3Captions(JSON3);
    const sliced = sliceCues(cues, 1, 2); // window [1,3]
    expect(sliced).toHaveLength(2);
    expect(sliced[0]).toMatchObject({ start: 0, end: 1, text: 'Hello world' });
    // only "world" (0.6–2) overlaps [1,3]; rebased to 0–1
    expect(sliced[0]?.words).toEqual([{ start: 0, end: 1, text: 'world' }]);
    expect(sliced[1]).toMatchObject({ start: 1, end: 2, text: 'Bye' });
  });
});

describe('viral-moment heuristic', () => {
  const cold = (start: number, text: string): CaptionCue => ({ start, end: start + 5, text });
  const cues: CaptionCue[] = [
    cold(0, 'hey everyone welcome back to the channel'),
    cold(5, 'today we are just going to chat a bit'),
    cold(10, 'nothing much happening here just filler'),
    cold(15, 'um so yeah lets maybe get into it soon'),
    cold(20, 'the secret truth nobody tells you about this'),
    cold(25, 'this one mistake is why 99% of people fail'),
    cold(30, 'stop doing this right now or you will regret it'),
    cold(35, 'the real reason is actually shocking and banned'),
    cold(40, 'here is the payoff you have been waiting for'),
    cold(45, 'and that is the quotable line everyone repeats'),
    cold(50, 'anyway thanks for watching see you next time'),
    cold(55, 'do not forget to subscribe and like'),
  ];

  it('selects the hook-dense window, not the intro', () => {
    const sel = heuristicSelect(cues, 30);
    expect(sel.startSeconds).toBe(20);
    expect(sel.durationSeconds).toBe(30);
    expect(sel.peakType).toBe('hook');
  });

  it('formats the transcript with [m:ss] prefixes', () => {
    const t = formatTranscript(cues);
    expect(t).toContain('[0:00]');
    expect(t).toContain('[0:20] the secret truth');
  });

  it('MomentSelector with no router falls back to the heuristic', async () => {
    const sel = await new MomentSelector().select(cues, 30);
    expect(sel.startSeconds).toBe(20);
    expect(sel.durationSeconds).toBe(30);
  });
});
