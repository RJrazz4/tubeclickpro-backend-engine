/**
 * Stage 1 — FAST PREPROCESS. Cheap, single-pass ffmpeg analysis of the (short)
 * candidate media: duration, scene-change marks, silence intervals, an audio
 * wav (the waveform source for STT fallback + energy), and a coarse 1/sec RMS
 * energy envelope. Every detector degrades to empty on failure so a render never
 * hard-fails because an analysis pass choked.
 *
 * All commands go through the shell-free CommandRunner (execFile argv arrays).
 */
import type { CommandRunner } from '../media-runner.js';
import type { EnergyPoint, PreprocessResult, SceneMark, SilenceInterval } from './types.js';

export interface PreprocessDeps {
  ffmpegBin: string;
  ffprobeBin: string;
  runner: CommandRunner;
  timeoutMs: number;
  sceneThreshold: number;
  silenceDb: number;
  silenceMinSeconds: number;
}

/** Container duration in seconds (ffprobe format=duration). */
export async function probeDuration(mediaPath: string, deps: PreprocessDeps): Promise<number> {
  const { stdout } = await deps.runner(
    deps.ffprobeBin,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', mediaPath],
    { timeoutMs: deps.timeoutMs },
  );
  const d = Number(stdout.trim());
  return Number.isFinite(d) && d > 0 ? d : 0;
}

/** Extract 16 kHz mono wav — the waveform used by energy + the STT fallback. */
export async function extractAudio(mediaPath: string, wavPath: string, deps: PreprocessDeps): Promise<void> {
  await deps.runner(
    deps.ffmpegBin,
    ['-hide_banner', '-loglevel', 'error', '-y', '-i', mediaPath, '-vn', '-ac', '1', '-ar', '16000', wavPath],
    { timeoutMs: deps.timeoutMs },
  );
}

/** Scene-change marks via the ffmpeg scene detector (parsed from stdout). */
export async function detectScenes(mediaPath: string, deps: PreprocessDeps): Promise<SceneMark[]> {
  try {
    const { stdout } = await deps.runner(
      deps.ffmpegBin,
      [
        '-hide_banner', '-i', mediaPath,
        '-vf', `select='gt(scene,${deps.sceneThreshold})',metadata=print:file=-`,
        '-an', '-f', 'null', '-',
      ],
      { timeoutMs: deps.timeoutMs },
    );
    const marks: SceneMark[] = [];
    let lastT: number | null = null;
    for (const line of stdout.split('\n')) {
      const pt = line.match(/pts_time:([0-9.]+)/);
      if (pt) {
        lastT = Number(pt[1]);
        continue;
      }
      const sc = line.match(/lavfi\.scene_score=([0-9.eE+-]+)/);
      if (sc && lastT !== null) {
        marks.push({ t: lastT, score: Number(sc[1]) });
        lastT = null;
      }
    }
    return marks;
  } catch {
    return [];
  }
}

/** Silence intervals via silencedetect (parsed from stderr). */
export async function detectSilences(wavPath: string, deps: PreprocessDeps): Promise<SilenceInterval[]> {
  try {
    const { stderr } = await deps.runner(
      deps.ffmpegBin,
      [
        '-hide_banner', '-i', wavPath,
        '-af', `silencedetect=noise=${deps.silenceDb}dB:d=${deps.silenceMinSeconds}`,
        '-f', 'null', '-',
      ],
      { timeoutMs: deps.timeoutMs, maxBufferBytes: 16 * 1024 * 1024 },
    );
    const out: SilenceInterval[] = [];
    let start: number | null = null;
    for (const line of stderr.split('\n')) {
      const s = line.match(/silence_start:\s*([0-9.eE+-]+)/);
      if (s) {
        start = Number(s[1]);
        continue;
      }
      const e = line.match(/silence_end:\s*([0-9.eE+-]+)/);
      if (e && start !== null) {
        out.push({ start, end: Number(e[1]) });
        start = null;
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Coarse 1/sec RMS energy envelope (best-effort; empty on any parse failure). */
export async function energyProfile(wavPath: string, deps: PreprocessDeps): Promise<EnergyPoint[]> {
  try {
    const { stdout } = await deps.runner(
      deps.ffmpegBin,
      [
        '-hide_banner', '-i', wavPath,
        '-af', 'aresample=8000,asetnsamples=n=8000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
        '-f', 'null', '-',
      ],
      { timeoutMs: deps.timeoutMs, maxBufferBytes: 16 * 1024 * 1024 },
    );
    const pts: EnergyPoint[] = [];
    let lastT: number | null = null;
    for (const line of stdout.split('\n')) {
      const pt = line.match(/pts_time:([0-9.]+)/);
      if (pt) {
        lastT = Number(pt[1]);
        continue;
      }
      const rms = line.match(/RMS_level=([0-9.eE+-]+|inf)/);
      if (rms && lastT !== null) {
        pts.push({ t: lastT, rms: rms[1] === 'inf' ? -Infinity : Number(rms[1]) });
        lastT = null;
      }
    }
    return pts;
  } catch {
    return [];
  }
}

/** Run the full preprocess stage. Analysis passes run in parallel (short clip). */
export async function runPreprocess(mediaPath: string, wavPath: string, deps: PreprocessDeps): Promise<PreprocessResult> {
  const duration = await probeDuration(mediaPath, deps).catch(() => 0);
  await extractAudio(mediaPath, wavPath, deps).catch(() => undefined);
  const [scenes, silences, energy] = await Promise.all([
    detectScenes(mediaPath, deps),
    detectSilences(wavPath, deps),
    energyProfile(wavPath, deps),
  ]);
  return { duration, scenes, silences, energy };
}
