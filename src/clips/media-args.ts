import { canonicalWatchUrl } from './clip-input.js';

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
  opts: { width?: number; height?: number; crf?: number; durationSeconds?: number; threads?: number } = {},
): string[] {
  const w = opts.width ?? 1080;
  const h = opts.height ?? 1920;
  const crf = opts.crf ?? 28;
  const threads = opts.threads ?? 2;
  // Escape the ASS path for the subtitles filter (colons/backslashes).
  const safeAss = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},subtitles='${safeAss}'`;

  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
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
