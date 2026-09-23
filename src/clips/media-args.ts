import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonicalWatchUrl } from './clip-input.js';

const execFileAsync = promisify(execFile);

/**
 * Argument-array builders for yt-dlp and ffmpeg.
 *
 * These return string[] intended for execFile/spawn (NO shell). Because the
 * video id is regex-validated upstream and every path is a server-controlled
 * temp path, there is no surface for shell metacharacter injection. The unit
 * tests assert the exact flags so a regression that opens an injection hole
 * (e.g. switching to a shell string) fails loudly.
 */

export interface YtdlpOpts {
  bin?: string;
}

/** Download auto/manual captions only (no media) as VTT for the given video. */
export function ytdlpCaptionArgs(videoId: string, outTemplate: string, opts: YtdlpOpts = {}): string[] {
  void opts;
  return [
    '--skip-download',
    '--write-auto-subs',
    '--write-subs',
    '--sub-langs',
    'en,en-US,en-GB',
    '--sub-format',
    'json3/vtt/best',
    '--restrict-filenames',
    '--no-playlist',
    '--no-warnings',
    '-o',
    outTemplate,
    canonicalWatchUrl(videoId),
  ];
}

/** Download ONLY the [start, start+duration] section at a capped resolution. */
export function ytdlpSectionArgs(
  videoId: string,
  startSeconds: number,
  durationSeconds: number,
  outTemplate: string,
  maxHeight = 720,
): string[] {
  const end = startSeconds + durationSeconds;
  return [
    '-f',
    `bv*[height<=${maxHeight}]+ba/b[height<=${maxHeight}]/b`,
    '--download-sections',
    `*${startSeconds}-${end}`,
    '--force-keyframes-at-cuts',
    '--restrict-filenames',
    '--no-playlist',
    '--no-warnings',
    '-o',
    outTemplate,
    canonicalWatchUrl(videoId),
  ];
}

/**
 * Single-pass vertical render: scale+crop to 9:16 and burn the ASS captions.
 * `-threads` and `-preset veryfast` bound CPU; `+faststart` optimizes streaming.
 */
export function ffmpegVerticalBurnArgs(
  inputPath: string,
  assPath: string,
  outputPath: string,
  opts: {
    width?: number;
    height?: number;
    crf?: number;
    durationSeconds?: number;
    threads?: number;
    /** Seek the input to this timestamp (seconds) — the selected segment start. */
    startSeconds?: number;
    /** When present, pan a tracked 9:16 slice horizontally instead of a static center crop. */
    dynamicCrop?: { sourceWidth: number; sourceHeight: number; xExpression: string };
  } = {},
): string[] {
  const w = opts.width ?? 1080;
  const h = opts.height ?? 1920;
  const crf = opts.crf ?? 28;
  const threads = opts.threads ?? 2;
  // Escape the ASS path for the subtitles filter (colons/backslashes).
  const safeAss = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');

  let vf: string;
  if (opts.dynamicCrop) {
    const { sourceHeight, xExpression } = opts.dynamicCrop;
    // Vertical 9:16 slice at full source height; even width for yuv420p.
    const cropW = Math.max(2, Math.floor((sourceHeight * (w / h)) / 2) * 2);
    vf = `crop=${cropW}:${sourceHeight}:x=${xExpression}:y=0,scale=${w}:${h},subtitles='${safeAss}'`;
  } else {
    vf = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},subtitles='${safeAss}'`;
  }

  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...(opts.startSeconds !== undefined && opts.startSeconds > 0 ? ['-ss', String(opts.startSeconds)] : []),
    '-threads',
    String(threads),
    '-i',
    inputPath,
    '-vf',
    vf,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    String(crf),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
  ];
  if (opts.durationSeconds !== undefined) args.push('-t', String(opts.durationSeconds));
  args.push(outputPath);
  return args;
}

export interface VideoProbe {
  width: number;
  height: number;
  fps: number;
}

/**
 * Probe a video's width/height/fps via ffprobe. Throws on failure so callers can
 * fall back to the static center-crop path.
 */
export async function probeVideo(
  inputPath: string,
  opts: { ffprobePath?: string; timeoutMs?: number } = {},
): Promise<VideoProbe> {
  const bin = opts.ffprobePath ?? 'ffprobe';
  const { stdout } = await execFileAsync(
    bin,
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'json', inputPath],
    { timeout: opts.timeoutMs ?? 30_000, maxBuffer: 4 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number; r_frame_rate?: string }> };
  const s = parsed.streams?.[0];
  if (!s || !s.width || !s.height) throw new Error('ffprobe returned no video stream');
  let fps = 30;
  if (s.r_frame_rate && s.r_frame_rate.includes('/')) {
    const parts = s.r_frame_rate.split('/').map(Number);
    const num = parts[0];
    const den = parts[1];
    if (num !== undefined && den) fps = num / den;
  } else if (s.r_frame_rate) {
    fps = Number(s.r_frame_rate) || 30;
  }
  return { width: s.width, height: s.height, fps: Number.isFinite(fps) && fps > 0 ? fps : 30 };
}
