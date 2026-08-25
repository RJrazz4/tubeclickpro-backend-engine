import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { DEFAULT_BANNED_PHRASES, packageSchema, weightedTotal, type ScriptPackage } from '../src/scripts/contracts.js';
import { criticVerdict, parseCritic, preCheckPackage } from '../src/scripts/critic.js';
import { languageDirective, retentionLessons } from '../src/audience/context-provider.js';
import { outlineMessages, scriptMessages, PROMPT_VERSION } from '../src/scripts/prompts-v1.js';
import type { AudienceGrounding } from '../src/audience/context-provider.js';

const grounding: AudienceGrounding = {
  channel: { title: 'Test Channel', niche: 'tech', tone: null, banned_phrases: ['my personal opinion is'], source: 'channel_profiles' },
  audience: {
    primary_geo: { country: 'IN', share_pct: 71 },
    language_directive: languageDirective('IN'),
    demo_pyramid: 'age18-24 ♂ 46% · age25-34 ♂ 22%',
    retention_lessons: ['6/7 of your top videos lose viewers in the opening seconds — cold-open, no throat-clearing'],
  },
  hunger: {
    topic: 'camera review',
    score: 0.72839,
    evidence: { watch_share_pct: 37.7, engagement_rate: 0.0764, hook_retention: 0.78, demand_videos_28d: 3, supply_videos_90d: 0 },
  },
  co_hungers: [{ topic: 'tech', score: 0.475 }],
  format_directive: '8-11 minute long-form with chaptered retention beats, mobile-first pacing',
  timing: { note: 'day-of-week strength in rollups' },
};

function validPackage(): ScriptPackage {
  return {
    hunger_topic: 'camera review',
    language_directive: grounding.audience.language_directive,
    hook: { text: 'This ₹25,000 camera beats models twice its price — number 2 will shock you', seconds: 8, variants: ['The camera pros hide from you at ₹25,000', 'Why 37.7% of your watch time says you want this camera'] },
    beats: Array.from({ length: 7 }, (_, i) => ({ title: `beat ${i + 1}`, purpose: `serve the camera hunger ${i + 1}`, seconds: 60 })),
    sections: [
      { heading: 'cold open', voiceover: 'x'.repeat(120), b_roll_cues: ['b-roll'] },
      { heading: 'the case', voiceover: 'y'.repeat(120), b_roll_cues: ['b-roll'] },
      { heading: 'verdict', voiceover: 'z'.repeat(120), b_roll_cues: ['b-roll'] },
    ],
    title_variants: ['5 titles', 'with specificity', 'and curiosity gaps', 'under 70 chars', 'always exactly five'],
    thumbnail_texts: ['₹25K CAMERA', 'PROS HIDE THIS', 'BEATS ₹50K'],
    description: 'd'.repeat(100),
    tags: ['camera', 'tech', 'review', 'budget', 'india'],
    chapters: [{ label: 'intro', at_second: 0 }, { label: 'test', at_second: 90 }, { label: 'verdict', at_second: 400 }],
    voice_map: [{ line: 'this camera beats models twice its price', voice_alias: 'narrator' }],
    posting_window: { note: 'evening IN peak' },
    audience_evidence: {
      grounding_references: ['camera review hunger with watch_share_pct 37.7', 'IN primary geo 71%', 'hook_retention 0.78'],
      evidence_numbers: ['37.7% watch share', '0.78 hook retention', '71% IN'],
    },
  };
}

describe('ScriptPackage v1 contract', () => {
  it('accepts the golden package', () => {
    expect(packageSchema.parse(validPackage())).toBeTruthy();
  });
  it('rejects a 9-second-budget violation and wrong title counts', () => {
    const bad = validPackage();
    (bad.hook as { seconds: number }).seconds = 14;
    expect(() => packageSchema.parse(bad)).toThrow();
    const bad2 = validPackage();
    bad2.title_variants = bad2.title_variants.slice(0, 4);
    expect(() => packageSchema.parse(bad2)).toThrow();
  });
  it('weights the critic rubric to exactly 100 (grounding 25%)', () => {
    expect(weightedTotal({ audience_grounding: 100, hook_strength: 100, retention_engineering: 100, craft: 100, packaging: 100 })).toBe(100);
    expect(weightedTotal({ audience_grounding: 0, hook_strength: 100, retention_engineering: 100, craft: 100, packaging: 100 })).toBe(75);
  });
});

describe('deterministic pre-checks (cheap rejects before any judge call)', () => {
  it('passes the golden package', () => {
    const out = preCheckPackage(validPackage(), grounding, ['my personal opinion is']);
    expect(out.ok).toBe(true);
  });
  it('hard-fails banned phrases — defaults AND creator-specific', () => {
    for (const banned of [DEFAULT_BANNED_PHRASES[0], 'my personal opinion is']) {
      const bad = validPackage();
      bad.sections[0].voiceover = `${banned} ${'x'.repeat(120)}`;
      const out = preCheckPackage(bad, grounding, ['my personal opinion is']);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.failures.some((f) => f.check === 'banned_phrase')).toBe(true);
    }
  });
  it('fails evidence numbers that are not in the grounding block', () => {
    const bad = validPackage();
    bad.audience_evidence.evidence_numbers = ['99.9% fake share', 'made up', '12x invented'];
    const out = preCheckPackage(bad, grounding, []);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.failures.some((f) => f.check === 'evidence_numbers')).toBe(true);
  });
  it('fails a language directive mismatch', () => {
    const bad = validPackage();
    bad.language_directive = 'formal English';
    const out = preCheckPackage(bad, grounding, []);
    expect(out.ok).toBe(false);
  });
});

describe('critic parsing + verdict', () => {
  it('parses fenced judge JSON and applies the 85 gate', () => {
    const raw = '```json\n{"scores":{"audience_grounding":90,"hook_strength":85,"retention_engineering":80,"craft":88,"packaging":82},"verdict":"pass","fixes":[]}\n```';
    const scores = parseCritic(raw);
    const v = criticVerdict(scores);
    expect(v.total).toBeGreaterThanOrEqual(85);
    expect(v.pass).toBe(true);
  });
  it('fails below threshold', () => {
    const v = criticVerdict({ scores: { audience_grounding: 40, hook_strength: 50, retention_engineering: 50, craft: 60, packaging: 60 }, verdict: 'repair', fixes: [] });
    expect(v.pass).toBe(false);
    expect(v.total).toBeLessThan(85);
  });
});

describe('grounding + prompt assembly (no data, no text)', () => {
  it('language directives map correctly', () => {
    expect(languageDirective('IN')).toMatch(/Hinglish/);
    expect(languageDirective('US')).toMatch(/American English/);
    expect(languageDirective(null)).toMatch(/international English/);
  });
  it('retention lessons derive from rollup classes', () => {
    const lessons = retentionLessons({ retention_top20: Array.from({ length: 6 }, () => ({ class: 'weak_hook' })) });
    expect(lessons[0]).toMatch(/cold-open/);
  });
  it('prompts embed the grounding JSON verbatim and the hunger topic', () => {
    const msgs = outlineMessages({ grounding, groundingJson: JSON.stringify(grounding), bannedPhrases: [] });
    const blob = msgs.map((m) => m.content).join('\n');
    expect(blob).toContain('"camera review"');
    expect(blob).toContain('37.7');
    expect(blob).toContain('Hinglish');
    expect(scriptMessages({ grounding, groundingJson: JSON.stringify(grounding), bannedPhrases: [] }, {}).length).toBe(2);
    expect(PROMPT_VERSION).toBe('v1');
  });
});
