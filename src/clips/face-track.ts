/**
 * Face-tracking camera for the zero-cost clipper (podcli/hotclip style).
 *
 * Takes per-frame face centers (produced by a Python YuNet helper) and compiles
 * them into a single FFmpeg crop `x` expression — nested `if(lt(t\,END)\,X\,...)`
 * evaluated per frame — so one ffmpeg pass pans a 9:16 slice across the source.
 *
 * Pipeline: smooth -> tripod camera (dead-zone + speed-limited pan) -> collapse
 * to segments (crop LEFT edge) -> compile nested-if expression.
 *
 * Pure/synchronous: no I/O here, so it is trivially unit-testable.
 */

export interface FaceCenter {
  /** seconds relative to the trimmed clip start */
  t: number;
  /** face centre x in SOURCE pixels */
  x: number;
  /** face centre y in SOURCE pixels */
  y: number;
}

export interface SourceGeometry {
  sourceWidth: number;
  sourceHeight: number;
  /** output width  (default 1080) */
  targetWidth?: number;
  /** output height (default 1920) */
  targetHeight?: number;
  /** face-center sampling rate (samples/sec) used to derive pan dt (default 30) */
  fps?: number;
}

export interface PanSegment {
  /** crop LEFT edge x (source px, clamped to [0, W-cropW]) to use until `end` */
  x: number;
  /** segment end time (seconds) */
  end: number;
}

/** Width (source px) of the vertical 9:16 slice at full source height. */
export function verticalCropWidth(source: SourceGeometry): number {
  const tw = source.targetWidth ?? 1080;
  const th = source.targetHeight ?? 1920;
  const w = Math.floor((source.sourceHeight * (tw / th)) / 2) * 2;
  return Math.max(2, Math.min(w, source.sourceWidth));
}

function clampCenter(center: number, half: number, sourceWidth: number): number {
  if (!Number.isFinite(center)) return sourceWidth / 2;
  return Math.min(Math.max(center, half), sourceWidth - half);
}

/** Moving-average smoothing of x positions to kill per-frame jitter. */
export function smoothSeries(centers: FaceCenter[], window = 5): FaceCenter[] {
  if (centers.length === 0) return [];
  const n = centers.length;
  const out: FaceCenter[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - window + 1);
    let sum = 0;
    let count = 0;
    for (let j = start; j <= i; j++) {
      const cj = centers[j];
      if (cj) {
        sum += cj.x;
        count++;
      }
    }
    const anchor = centers[i];
    out.push({ t: anchor?.t ?? i, x: count > 0 ? sum / count : 0, y: anchor?.y ?? 0 });
  }
  return out;
}

/**
 * Tripod camera over the (already smoothed) face centers. Returns the camera
 * CENTRE per frame:
 * - still while the face stays within the safe zone (dead-zone),
 * - smooth pan when it drifts out,
 * - quick re-center when it jumps more than half the crop width.
 */
export function tripodPath(centers: FaceCenter[], cropW: number, sourceWidth: number, fps = 30): FaceCenter[] {
  const first = centers[0];
  if (!first) return [];
  const half = cropW / 2;
  const safeZone = cropW * 0.22;
  const dt = 1 / fps;
  const out: FaceCenter[] = [];
  let cx = clampCenter(first.x, half, sourceWidth);

  for (const c of centers) {
    const diff = c.x - cx;
    const absDiff = Math.abs(diff);
    if (absDiff > safeZone) {
      const speed = absDiff > half ? 360 : 72; // px/s
      const step = speed * dt;
      cx = absDiff > step ? cx + Math.sign(diff) * step : c.x;
    }
    cx = clampCenter(cx, half, sourceWidth);
    out.push({ t: c.t, x: Math.round(cx), y: c.y });
  }
  return out;
}

/**
 * Collapse a per-frame camera path into segments holding the crop LEFT edge
 * (dedupe consecutive equal positions), capped so the nested expression never
 * blows up FFmpeg's expression buffer.
 */
export function segmentPath(camera: FaceCenter[], source: SourceGeometry, cropW: number, maxSegments = 16): PanSegment[] {
  const half = cropW / 2;
  const maxLeft = Math.max(0, source.sourceWidth - cropW);
  const out: PanSegment[] = [];
  let lastX: number | null = null;
  for (let i = 0; i < camera.length; i++) {
    const ci = camera[i];
    if (!ci) continue;
    const left = Math.max(0, Math.min(Math.round(ci.x - half), maxLeft));
    if (lastX === null || Math.abs(left - lastX) >= 1) {
      const next = camera[i + 1];
      const tEnd = next ? next.t : ci.t + 1 / 30;
      out.push({ x: left, end: tEnd });
      lastX = left;
    }
  }
  while (out.length > maxSegments) {
    const merged: PanSegment[] = [];
    for (let i = 0; i < out.length; i += 2) {
      const a = out[i];
      if (!a) continue;
      const b = out[i + 1];
      merged.push(b ? { x: b.x, end: b.end } : { x: a.x, end: a.end });
    }
    out.length = 0;
    out.push(...merged);
  }
  return out;
}

/**
 * Compile segments into one nested `if(lt(t\,END)\,X\,...)` expression evaluated
 * per frame. Commas are escaped (\,) because a comma separates filters; the
 * backslash is built via char code so it is unambiguous in source.
 */
export function buildPanXExpression(segments: PanSegment[], cropW: number): string | null {
  if (!segments.length) return null;
  const EC = `${String.fromCharCode(92)},`; // -> "\,"
  // Innermost fallback: center the slice when t exceeds the last segment.
  let chain = `(iw-${cropW})/2`;
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    if (!s) continue;
    chain = `if(lt(t${EC}${s.end.toFixed(3)})${EC}${s.x}${EC}${chain})`;
  }
  return chain;
}

/**
 * Full pipeline: centers -> smooth -> tripod -> segments -> FFmpeg x expression.
 * Returns null when there are no usable faces (caller falls back to center crop).
 */
export function buildFaceTrackExpression(centers: FaceCenter[], source: SourceGeometry): string | null {
  if (!centers || centers.length === 0) return null;
  const cropW = verticalCropWidth(source);
  const camera = tripodPath(smoothSeries(centers), cropW, source.sourceWidth, source.fps ?? 30);
  const segments = segmentPath(camera, source, cropW);
  return buildPanXExpression(segments, cropW);
}
