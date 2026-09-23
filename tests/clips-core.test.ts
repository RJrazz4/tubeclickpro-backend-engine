import { describe, expect, it } from 'vitest';
import {
  canonicalWatchUrl,
  clampWindow,
  clipIdempotencyKey,
  resolveVideoId,
} from '../src/clips/clip-input.js';
import { assTime, buildAss } from '../src/clips/ass-builder.js';
import {
  ffmpegVerticalBurnArgs,
  ytdlpCaptionArgs,
  ytdlpSectionArgs,
} from '../src/clips/media-args.js';
import { parseVtt } from '../src/clips/vtt.js';

describe('clip-input', () => {
  it('resolves video ids from every YouTube URL shape', () => {
    expect(resolveVideoId('aaaaaaaaaaa')).toBe('aaaaaaaaaaa');
    expect(resolveVideoId('https://www.youtube.com/watch?v=bbbbbbbbbbb')).toBe('bbbbbbbbbbb');
    expect(resolveVideoId('https://youtu.be/ccccccccccc')).toBe('ccccccccccc');
    expect(resolveVideoId('https://www.youtube.com/shorts/ddddddddddd')).toBe('ddddddddddd');
    expect(resolveVideoId('https://evil.example.com/watch?v=eeeeeeeeeee')).toBe('eeeeeeeeeee');
    expect(resolveVideoId('not a url')).toBeNull();
  });

  it('builds a canonical watch url we control', () => {
    expect(canonicalWatchUrl('aaaaaaaaaaa')).toBe('https://www.youtube.com/watch?v=aaaaaaaaaaa');
  });

  it('clamps the window to the configured max and a 5s floor', () => {
    expect(clampWindow(0, 30, 30)).toEqual({ startSeconds: 0, durationSeconds: 30 });
    expect(clampWindow(0, 999, 30)).toEqual({ startSeconds: 0, durationSeconds: 30 });
    expect(clampWindow(-5, 2, 30)).toEqual({ startSeconds: 0, durationSeconds: 5 });
  });

  it('produces a deterministic, change-sensitive idempotency key', () => {
    const a = clipIdempotencyKey('u1', 'aaaaaaaaaaa', 0, 30, 'karaoke', false);
    const b = clipIdempotencyKey('u1', 'aaaaaaaaaaa', 0, 30, 'karaoke', false);
    const c = clipIdempotencyKey('u1', 'aaaaaaaaaaa', 5, 30, 'karaoke', false);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith('clip:')).toBe(true);
    // autoSelect ignores the caller's start (the engine picks the window)
    const d = clipIdempotencyKey('u1', 'aaaaaaaaaaa', 0, 30, 'karaoke', true);
    const e = clipIdempotencyKey('u1', 'aaaaaaaaaaa', 99, 30, 'karaoke', true);
    expect(d).toBe(e);
    expect(d).not.toBe(a);
  });
});

describe('ass-builder', () => {
  it('formats ASS timestamps as H:MM:SS.cc', () => {
    expect(assTime(0)).toBe('0:00:00.00');
    expect(assTime(65.5)).toBe('0:01:05.50');
    expect(assTime(3661.25)).toBe('1:01:01.25');
  });

  it('builds a valid ASS doc with style + dialogue and skips empty cues', () => {
    const ass = buildAss(
      [
        { start: 0, end: 2, text: 'Hello world' },
        { start: 2, end: 4, text: '   ' },
      ],
      { style: 'bold' },
    );
    expect(ass).toContain('[Script Info]');
    expect(ass).toContain('[V4+ Styles]');
    expect(ass).toContain('Style: Default,Impact');
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:02.00,Default');
    expect(ass).toContain('Hello world');
    // the blank cue is dropped → exactly one Dialogue line
    expect(ass.match(/Dialogue:/g)?.length).toBe(1);
  });

  it('emits karaoke \\kf tags and neutralizes ASS override braces', () => {
    const ass = buildAss(
      [{ start: 0, end: 2, text: 'two words', words: [{ start: 0, end: 1, text: 'two' }, { start: 1, end: 2, text: 'words' }] }],
      { style: 'karaoke' },
    );
    expect(ass).toContain('{\\kf100}two');
    expect(ass).toContain('{\\kf100}words');
    expect(buildAss([{ start: 0, end: 1, text: '{\\an8}injected' }], { style: 'bold' })).not.toContain('{\\an8}');
  });
});

describe('media-args (shell-free arg arrays)', () => {
  it('caption args skip download and use the canonical url', () => {
    const args = ytdlpCaptionArgs('aaaaaaaaaaa', '/tmp/x/cap.%(ext)s');
    expect(args).toContain('--skip-download');
    expect(args).toContain('json3/vtt/best');
    expect(args).toContain('--restrict-filenames');
    expect(args[args.length - 1]).toBe('https://www.youtube.com/watch?v=aaaaaaaaaaa');
  });

  it('section args bound the download to the requested window', () => {
    const args = ytdlpSectionArgs('bbbbbbbbbbb', 10, 30, '/tmp/x/src.%(ext)s');
    const i = args.indexOf('--download-sections');
    expect(args[i + 1]).toBe('*10-40');
    expect(args[args.length - 1]).toBe('https://www.youtube.com/watch?v=bbbbbbbbbbb');
  });

  it('ffmpeg args burn subs, force vertical, and put output last', () => {
    const args = ffmpegVerticalBurnArgs('/tmp/x/src.mp4', '/tmp/x/captions.ass', '/tmp/x/out.mp4', { durationSeconds: 30 });
    const vf = args[args.indexOf('-vf') + 1];
    expect(vf).toContain('scale=1080:1920');
    expect(vf).toContain('crop=1080:1920');
    expect(vf).toContain("subtitles='/tmp/x/captions.ass'");
    expect(args[args.length - 1]).toBe('/tmp/x/out.mp4');
    expect(args).toContain('+faststart');
  });

  it('never emits shell metacharacters into any argument (injection guard)', () => {
    const arrays = [
      ytdlpCaptionArgs('aaaaaaaaaaa', '/tmp/cap.%(ext)s'),
      ytdlpSectionArgs('aaaaaaaaaaa', 0, 30, '/tmp/src.%(ext)s'),
      ffmpegVerticalBurnArgs('/tmp/src.mp4', '/tmp/c.ass', '/tmp/out.mp4', {}),
    ];
    for (const arr of arrays) {
      expect(Array.isArray(arr)).toBe(true);
      for (const a of arr) {
        expect(typeof a).toBe('string');
        expect(a).not.toMatch(/[;|`$]|&&|\|\||>/);
      }
    }
  });
});

describe('vtt parser', () => {
  const sample = [
    'WEBVTT',
    '',
    '00:00:00.000 --> 00:00:02.000',
    '<c> Hello world</c>',
    '',
    '00:00:02.000 --> 00:00:04.000',
    'Hello world',
    '',
    '00:00:04.000 --> 00:00:06.500',
    'Second line',
  ].join('\n');

  it('parses cues, strips tags, and dedupes rolling repeats', () => {
    const cues = parseVtt(sample);
    expect(cues).toEqual([
      { start: 0, end: 2, text: 'Hello world' },
      { start: 4, end: 6.5, text: 'Second line' },
    ]);
  });

  it('applies the window offset', () => {
    const cues = parseVtt(sample, 2);
    expect(cues[0]).toMatchObject({ start: 0, end: 0 });
    expect(cues[1]).toMatchObject({ start: 2, end: 4.5 });
  });
});
