import { describe, expect, it } from 'vitest';
import {
  buildFaceTrackExpression,
  buildPanXExpression,
  segmentPath,
  smoothSeries,
  tripodPath,
  verticalCropWidth,
  type FaceCenter,
} from '../src/clips/face-track.js';
import { ffmpegVerticalBurnArgs } from '../src/clips/media-args.js';
import { buildAss } from '../src/clips/ass-builder.js';

const EC = `${String.fromCharCode(92)},`; // the escaped comma "\," ffmpeg needs
const SRC = { sourceWidth: 1280, sourceHeight: 720, targetWidth: 1080, targetHeight: 1920 };

function line(x: number, n = 30, dt = 1 / 6): FaceCenter[] {
  return Array.from({ length: n }, (_, i) => ({ t: i * dt, x, y: 360 }));
}

describe('face-track geometry', () => {
  it('computes the 9:16 slice width at full source height (even, clamped)', () => {
    expect(verticalCropWidth(SRC)).toBe(404); // floor(720*9/16 /2)*2
    expect(verticalCropWidth({ sourceWidth: 1920, sourceHeight: 1080 })).toBe(606);
    // a source narrower than the slice clamps to the source width
    expect(verticalCropWidth({ sourceWidth: 200, sourceHeight: 720 })).toBe(200);
  });

  it('smooths jitter without changing the endpoints much', () => {
    const jittery = [300, 320, 280, 310, 290, 300].map((x, i) => ({ t: i / 6, x, y: 0 }));
    const sm = smoothSeries(jittery);
    expect(sm).toHaveLength(6);
    // moving average keeps every value within the input range
    for (const p of sm) expect(p.x).toBeGreaterThanOrEqual(280 - 1e-9);
  });
});

describe('tripod camera', () => {
  it('holds still inside the dead-zone and pans when the face drifts out', () => {
    const cropW = 404;
    // tiny drift inside the safe zone -> camera barely moves
    const still = tripodPath(line(640, 10), cropW, 1280, 6);
    const stillSpan = Math.max(...still.map((p) => p.x)) - Math.min(...still.map((p) => p.x));
    expect(stillSpan).toBeLessThan(cropW * 0.25);

    // a big jump -> camera travels toward the new face position
    const jump = tripodPath([...line(200, 6), ...line(1000, 24)], cropW, 1280, 6);
    expect(jump[jump.length - 1]!.x).toBeGreaterThan(jump[0]!.x);
  });

  it('clamps the camera centre so the slice never leaves the frame', () => {
    const cropW = 404;
    const left = tripodPath(line(0, 40), cropW, 1280, 6);
    const right = tripodPath(line(1280, 40), cropW, 1280, 6);
    for (const p of left) expect(p.x).toBeGreaterThanOrEqual(cropW / 2 - 1);
    for (const p of right) expect(p.x).toBeLessThanOrEqual(1280 - cropW / 2 + 1);
  });
});

describe('segmentPath + expression compiler', () => {
  it('stores crop LEFT edges clamped to [0, W-cropW]', () => {
    const cropW = verticalCropWidth(SRC);
    const segs = segmentPath(tripodPath(line(0, 30), cropW, 1280, 6), SRC, cropW);
    for (const s of segs) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(1280 - cropW);
    }
  });

  it('caps nesting so the expression cannot blow the ffmpeg buffer', () => {
    const cropW = verticalCropWidth(SRC);
    // 200 distinct positions would be 200 segments uncapped
    const moving = Array.from({ length: 200 }, (_, i) => ({ t: i / 6, x: 100 + i * 5, y: 0 }));
    const segs = segmentPath(moving, SRC, cropW);
    expect(segs.length).toBeLessThanOrEqual(16);
  });

  it('escapes commas and falls back to a centered slice', () => {
    const expr = buildPanXExpression([{ x: 10, end: 1 }, { x: 50, end: 2 }], 404)!;
    expect(expr.startsWith('if(lt(t')).toBe(true);
    expect(expr).toContain(`if(lt(t${EC}`); // escaped comma, not a bare one
    expect(expr).not.toContain('lt(t,'); // no UNescaped comma after t
    expect(expr).toContain('(iw-404)/2'); // centered fallback innermost
    expect(buildPanXExpression([], 404)).toBeNull();
  });
});

describe('buildFaceTrackExpression (full pipeline)', () => {
  it('returns null with no faces so the caller center-crops', () => {
    expect(buildFaceTrackExpression([], SRC)).toBeNull();
  });

  it('compiles a panning expression that tracks a right-moving face', () => {
    const expr = buildFaceTrackExpression([...line(200, 12), ...line(1000, 18)], SRC)!;
    expect(expr).toBeTruthy();
    expect(expr.startsWith('if(lt(t')).toBe(true);
    expect(expr).toContain(EC);
    // every literal crop-x in the expression is a clamped, non-negative integer
    const xs = [...expr.matchAll(new RegExp(`${EC.replace('\\', '\\\\')}(\\d+)${EC.replace('\\', '\\\\')}`, 'g'))].map((m) => Number(m[1]));
    expect(xs.length).toBeGreaterThan(0);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1280 - verticalCropWidth(SRC));
    }
  });
});

describe('media-args dynamic crop + seek', () => {
  it('crops a tracked slice in source space then upscales', () => {
    const args = ffmpegVerticalBurnArgs('/tmp/src.mp4', '/tmp/c.ass', '/tmp/out.mp4', {
      dynamicCrop: { sourceWidth: 1280, sourceHeight: 720, xExpression: 'if(lt(t\\,1.0)\\,0\\,(iw-404)/2)' },
    });
    const vf = args[args.indexOf('-vf') + 1]!;
    expect(vf).toContain('crop=404:720:x=');
    expect(vf).toContain(':y=0,scale=1080:1920');
    expect(vf).toContain("subtitles='/tmp/c.ass'");
  });

  it('inserts an input seek before -i when startSeconds is given', () => {
    const args = ffmpegVerticalBurnArgs('/tmp/src.mp4', '/tmp/c.ass', '/tmp/out.mp4', { startSeconds: 12.5 });
    const ss = args.indexOf('-ss');
    const i = args.indexOf('-i');
    expect(ss).toBeGreaterThan(-1);
    expect(ss).toBeLessThan(i);
    expect(args[ss + 1]).toBe('12.5');
  });

  it('omits -ss when no start is requested', () => {
    const args = ffmpegVerticalBurnArgs('/tmp/src.mp4', '/tmp/c.ass', '/tmp/out.mp4', {});
    expect(args).not.toContain('-ss');
  });
});

describe('premium ASS (ViralMint-style)', () => {
  const cues = [{ start: 0, end: 2, text: 'hello there' }];

  it('declares TV.709 and a raised safe-zone margin', () => {
    const ass = buildAss(cues, { playResX: 1080, playResY: 1920 });
    expect(ass).toContain('YCbCr Matrix: TV.709');
    expect(ass).toContain('ScaledBorderAndShadow: yes');
    // portrait safe-zone floor = round(1920*0.09) = 173
    expect(ass).toContain(',80,80,173,1');
  });

  it('adds a faded top-center hook overlay only when hookText is set', () => {
    const withHook = buildAss(cues, { hookText: 'Stop scrolling', hookDurationSeconds: 3 });
    expect(withHook).toContain('Style: Hook');
    expect(withHook).toContain('fad(300,500)');
    expect(withHook).toContain(',Hook,');
    expect(buildAss(cues)).not.toContain('Style: Hook');
  });

  it('sanitizes braces in the hook text', () => {
    const ass = buildAss(cues, { hookText: '{\\an8}injected' });
    expect(ass).not.toContain('{\\an8}injected');
  });
});
