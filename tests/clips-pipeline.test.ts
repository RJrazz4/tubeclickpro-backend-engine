// edit-plan/cut-engine are config-free (type-only imports) so they import
// statically. agents.ts pulls in the logger (which reads config at import time),
// so — like clip-worker-service.test.ts — we set AUTH_MODE first and import the
// agents dynamically in beforeAll.
process.env.AUTH_MODE = 'development';
process.env.NODE_ENV = 'test';

import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildEditPlan,
  outputDuration,
  removeSilences,
  remapCues,
  sourceToOutput,
} from '../src/clips/pipeline/edit-plan.js';
import { buildCutConcatArgs, needsConcat } from '../src/clips/pipeline/cut-engine.js';
import type { CaptionCue } from '../src/clips/ass-builder.js';
import type { AgentSignals } from '../src/clips/pipeline/types.js';

let runAudioAgent: typeof import('../src/clips/pipeline/agents.js').runAudioAgent;
let runStoryAgent: typeof import('../src/clips/pipeline/agents.js').runStoryAgent;
let runRetentionAgent: typeof import('../src/clips/pipeline/agents.js').runRetentionAgent;

beforeAll(async () => {
  ({ runAudioAgent, runStoryAgent, runRetentionAgent } = await import('../src/clips/pipeline/agents.js'));
});

const cues: CaptionCue[] = [
  { start: 0, end: 2, text: 'hello world' },
  { start: 2.2, end: 2.9, text: 'um' }, // lands in the cut below
  { start: 3.5, end: 4.5, text: 'second line' },
];

describe('edit-plan: silence carving', () => {
  const opts = { minCutSeconds: 0.4, minKeepSeconds: 0.35, maxSegments: 12 };

  it('removes long silences and keeps short natural pauses', () => {
    const segs = removeSilences(0, 10, [{ start: 4, end: 6 }], opts); // 2s gap
    expect(segs).toEqual([
      { start: 0, end: 4 },
      { start: 6, end: 10 },
    ]);
    // a 0.2s pause is below minCutSeconds -> untouched
    expect(removeSilences(0, 10, [{ start: 4, end: 4.2 }], opts)).toEqual([{ start: 0, end: 10 }]);
  });

  it('drops tiny fragments and caps the segment count', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ start: i * 1 + 0.4, end: i * 1 + 0.9 }));
    const segs = removeSilences(0, 21, many, { ...opts, maxSegments: 6 });
    expect(segs.length).toBeLessThanOrEqual(6);
    for (const s of segs) expect(s.end - s.start).toBeGreaterThanOrEqual(opts.minKeepSeconds - 1e-9);
  });

  it('computes output duration as the sum of kept segments', () => {
    expect(outputDuration([{ start: 0, end: 4 }, { start: 6, end: 10 }])).toBe(8);
  });
});

describe('edit-plan: caption rebasing', () => {
  const segments = [
    { start: 0, end: 2 },
    { start: 3, end: 5 },
  ];

  it('maps source time onto the output timeline and drops cues inside a cut', () => {
    const out = remapCues(cues, segments);
    // cue@0 -> 0; cue@2.2 is inside the 2..3 cut -> dropped; cue@3.5 -> 2 + 0.5 = 2.5
    expect(out.map((c) => c.text)).toEqual(['hello world', 'second line']);
    expect(out[1]!.start).toBeCloseTo(2.5, 5);
  });

  it('sourceToOutput returns null inside a removed gap', () => {
    const offs = [0, 2];
    expect(sourceToOutput(1, segments, offs)).toBe(1);
    expect(sourceToOutput(2.5, segments, offs)).toBeNull();
    expect(sourceToOutput(3.5, segments, offs)).toBeCloseTo(2.5, 5);
  });
});

describe('edit-plan: buildEditPlan merge', () => {
  it('takes the window from retention, carves audio silences, rebases captions', () => {
    const signals: AgentSignals = {
      story: { startSeconds: 0, endSeconds: 6, hookText: 'Watch this', reason: 's', source: 'heuristic' },
      retention: { startSeconds: 0, endSeconds: 5, peakType: 'hook', score: 0.8, reason: 'r', source: 'llm' },
      audio: { cutSilences: [{ start: 2, end: 3 }], reason: 'a', source: 'heuristic' },
    };
    const plan = buildEditPlan(signals, cues, {
      targetDuration: 30,
      minDuration: 5,
      captionStyle: 'karaoke',
      silence: { minCutSeconds: 0.4, minKeepSeconds: 0.35, maxSegments: 12 },
      faceTrack: true,
    });
    expect(plan.endSeconds).toBe(5); // retention window wins
    expect(plan.segments).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ]);
    expect(plan.outputDuration).toBe(4);
    expect(plan.hookText).toBe('Watch this');
    expect(plan.faceTrack).toBe(true);
    expect(plan.captions.map((c) => c.text)).toEqual(['hello world', 'second line']);
  });
});

describe('audio agent (deterministic)', () => {
  it('cuts dead-air >= threshold but spares silences containing energy', () => {
    const silences = [
      { start: 1, end: 2 }, // 1s -> cut
      { start: 5, end: 5.2 }, // 0.2s -> keep (below threshold)
      { start: 8, end: 9.5 }, // 1.5s but loud beat inside -> keep
    ];
    const energy = [{ t: 8.7, rms: -20 }];
    const sig = runAudioAgent(silences, energy, { start: 0, end: 10 }, { minCutSeconds: 0.4 });
    expect(sig.cutSilences).toEqual([{ start: 1, end: 2 }]);
    expect(sig.source).toBe('heuristic');
  });
});

describe('story/retention agents fall back without a router', () => {
  const transcript: CaptionCue[] = [
    { start: 0, end: 3, text: 'the secret nobody tells you about editing' },
    { start: 3, end: 6, text: 'is that cuts should breathe' },
    { start: 6, end: 9, text: 'and silence is a tool' },
  ];

  it('story agent returns a heuristic window + hook when router is null', async () => {
    const s = await runStoryAgent(transcript, 6, { router: null, minDuration: 5 });
    expect(s.source).toBe('heuristic');
    expect(s.endSeconds).toBeGreaterThan(s.startSeconds);
    expect(typeof s.hookText).toBe('string');
  });

  it('retention agent returns a heuristic window when router is null', async () => {
    const r = await runRetentionAgent(transcript, 6, { router: null, minDuration: 5 });
    expect(r.source).toBe('heuristic');
    expect(r.endSeconds - r.startSeconds).toBeLessThanOrEqual(6 + 1e-6);
  });
});

describe('cut engine argv', () => {
  it('builds a trim+concat filtergraph mapping video and audio', () => {
    const args = buildCutConcatArgs('/tmp/src.mp4', [{ start: 0, end: 2 }, { start: 3, end: 5 }], '/tmp/joined.mp4');
    const fc = args[args.indexOf('-filter_complex') + 1]!;
    expect(fc).toContain('trim=start=0.000:end=2.000');
    expect(fc).toContain('atrim=start=3.000:end=5.000');
    expect(fc).toContain('concat=n=2:v=1:a=1[vout][aout]');
    expect(args).toContain('-map');
    expect(args[args.length - 1]).toBe('/tmp/joined.mp4');
  });

  it('needsConcat is false only for a single full-span segment', () => {
    expect(needsConcat([{ start: 0, end: 10 }], 10)).toBe(false);
    expect(needsConcat([{ start: 0, end: 10 }], 12)).toBe(true);
    expect(needsConcat([{ start: 0, end: 4 }, { start: 6, end: 10 }], 10)).toBe(true);
  });
});
