import { describe, expect, it } from 'vitest';
import { parseVideoId, clipAtSentence } from '../src/scripts/publish-service.js';
import { briefSchema } from '../src/audience/brief-service.js';

describe('Module P: video URL parsing (manual paste)', () => {
  it.each([
    ['https://youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=abcdefghijk&t=30s', 'abcdefghijk'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/abcdefghijk', 'abcdefghijk'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('extracts the id from %s', (url, id) => {
    expect(parseVideoId(url)).toBe(id);
  });

  it.each([
    'http://youtube.com/watch?v=dQw4w9WgXcQ',          // not https
    'https://evil.example/watch?v=dQw4w9WgXcQ',         // wrong host
    'https://youtube.com/watch?v=short',                // bad id length
    'not a url',
    'https://youtube.com/playlist?list=PL123',
  ])('rejects %s', (url) => {
    expect(parseVideoId(url)).toBeNull();
  });
});

describe('voiceover text clipping', () => {
  it('clips at a sentence boundary inside the budget', () => {
    const text = `${'One sentence here. '.repeat(50)}Final sentence that would exceed.`;
    const clipped = clipAtSentence(text, 200);
    expect(clipped.length).toBeLessThanOrEqual(200);
    expect(clipped.endsWith('.')).toBe(true);
  });
  it('hard-clips when no good boundary exists', () => {
    const text = 'x'.repeat(5000);
    expect(clipAtSentence(text, 100).length).toBe(100);
  });
});

describe('T-2C: brief contract', () => {
  it('accepts a well-formed brief', () => {
    const brief = {
      headline: 'Your audience wants budget camera content tonight',
      who: 'Mostly 18-24 male mobile viewers on Android in North India',
      where_when: '71% watch minutes from India, peaking weekday evenings',
      what_they_want: ['camera reviews (37.7% watch share)', 'editing tips', 'budget tech'],
      retention_truth: '6/7 top videos lose viewers in the opening seconds — cold opens required',
      next_3_videos: [
        { title_idea: 'Best camera under ₹25,000 (tested)', why: '37.7% watch share with zero supply in 90 days', hunger_topic: 'camera review' },
        { title_idea: 'Edit like a pro in 8 minutes', why: 'editing tips hunger 0.18 and rising ER', hunger_topic: 'editing tips' },
        { title_idea: 'The ₹15k vs ₹50k camera test', why: 'comparison formats hold 52% AVP', hunger_topic: 'camera review' },
      ],
    };
    expect(briefSchema.parse(brief)).toBeTruthy();
  });
  it('rejects a brief with only 2 next videos (contract demands 3)', () => {
    const bad = {
      headline: 'x'.repeat(12), who: 'y'.repeat(20), where_when: 'z'.repeat(20),
      what_they_want: ['a', 'b', 'c'], retention_truth: 'r'.repeat(20),
      next_3_videos: [{ title_idea: 'a', why: 'b', hunger_topic: 'c' }, { title_idea: 'd', why: 'e', hunger_topic: 'f' }],
    };
    expect(() => briefSchema.parse(bad)).toThrow();
  });
});
