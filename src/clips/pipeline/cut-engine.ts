/**
 * Stage 5 — FAST CUT ENGINE (the hands). Builds shell-free ffmpeg argv to cut the
 * kept segments out of the source and join them in ONE encode pass via a
 * trim/atrim + concat filtergraph. The caller then runs the existing face-track +
 * caption burn on the joined media.
 */
import type { EditSegment } from './types.js';

export interface CutOpts {
  crf?: number;
}

/** True when the plan actually removes something (so a concat pass is needed). */
export function needsConcat(segments: EditSegment[], inputDuration: number): boolean {
  if (segments.length !== 1) return true;
  const s = segments[0]!;
  // A single segment covering (essentially) the whole input needs no re-cut.
  return s.start > 0.05 || (inputDuration > 0 && s.end < inputDuration - 0.05);
}

/**
 * ffmpeg argv that trims each kept segment and concatenates them (video+audio)
 * into one output at source resolution. Passed as argv (no shell), so the
 * filtergraph's commas/semicolons are inert.
 */
export function buildCutConcatArgs(
  inputPath: string,
  segments: EditSegment[],
  outputPath: string,
  opts: CutOpts = {},
): string[] {
  const crf = opts.crf ?? 23;
  const parts: string[] = [];
  const labels: string[] = [];
  segments.forEach((s, i) => {
    const a = s.start.toFixed(3);
    const b = s.end.toFixed(3);
    parts.push(`[0:v]trim=start=${a}:end=${b},setpts=PTS-STARTPTS[v${i}]`);
    parts.push(`[0:a]atrim=start=${a}:end=${b},asetpts=PTS-STARTPTS[a${i}]`);
    labels.push(`[v${i}][a${i}]`);
  });
  const fc = `${parts.join(';')};${labels.join('')}concat=n=${segments.length}:v=1:a=1[vout][aout]`;
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', inputPath,
    '-filter_complex', fc,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath,
  ];
}
