import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Redis } from 'ioredis';
import { getConfig, type AppConfig } from '../config/env.js';
import { logger } from '../observability/logger.js';
import { ClipStateStore } from './clip-state.js';
import { buildAss, type CaptionCue } from './ass-builder.js';
import { parseCaptions, sliceCues } from './captions.js';
import { ffmpegVerticalBurnArgs, probeVideo, ytdlpCaptionArgs, ytdlpSectionArgs } from './media-args.js';
import { buildFaceTrackExpression, type FaceCenter } from './face-track.js';
import { execFileRunner, type CommandRunner } from './media-runner.js';
import { MomentSelector } from './moment-selector.js';
import type { ClipStore } from './clip-store.js';
import type { ClipJob } from './clip-queue.js';

/**
 * Renders one clip:
 *   captions (full transcript, word-timed) → viral-moment select → slice window
 *   → section download → karaoke ASS → single-pass vertical burn-in → upload.
 *
 * All temp files live in a per-job mkdtemp dir wiped in `finally`. Heavy work is
 * delegated to child processes (see media-runner). Viral-moment selection uses
 * OpenRouter when a router is injected, else a deterministic heuristic.
 */

export interface ClipWorkerDeps {
  redis: Redis;
  store: ClipStore;
  config?: AppConfig;
  runner?: CommandRunner;
  selector?: MomentSelector;
}

const VIDEO_EXTS = ['.mp4', '.webm', '.mkv', '.mov'];

async function findByExt(dir: string, exts: string[]): Promise<string | null> {
  const files = await readdir(dir);
  const hit = files.find((f) => exts.some((e) => f.toLowerCase().endsWith(e)));
  return hit ? join(dir, hit) : null;
}

export class ClipWorkerService {
  private readonly state: ClipStateStore;
  private readonly config: AppConfig;
  private readonly runner: CommandRunner;
  private readonly selector: MomentSelector;

  constructor(private readonly deps: ClipWorkerDeps) {
    this.state = new ClipStateStore(deps.redis);
    this.config = deps.config ?? getConfig();
    this.runner = deps.runner ?? execFileRunner;
    this.selector = deps.selector ?? new MomentSelector();
  }

  async render(
    job: ClipJob,
    onProgress?: (percent: number, stage: string) => void,
  ): Promise<{ url: string; selection: { startSeconds: number; durationSeconds: number; reason: string; peakType: string } }> {
    const report = (progress: number, stage: string): void => {
      onProgress?.(progress, stage);
      void this.state.patch(job.jobId, { status: 'processing', progress, stage });
    };

    const workDir = await mkdtemp(join(tmpdir(), 'clip-'));
    try {
      // 1 — full transcript captions (word timing when JSON3 is available).
      // Best-effort: a 429 on a stray translated variant or a missing track must
      // not fail the render — proceed with whatever caption file was written.
      report(8, 'captions');
      try {
        await this.runner(
          this.config.CLIPS_YTDLP_BIN,
          ytdlpCaptionArgs(job.videoId, join(workDir, 'cap.%(ext)s')),
          { timeoutMs: this.config.CLIPS_YTDLP_TIMEOUT_MS, cwd: workDir },
        );
      } catch (err) {
        logger.warn({ jobId: job.jobId, error: (err as Error).message }, 'caption fetch incomplete; continuing');
      }
      const capPath = await findByExt(workDir, ['.json3', '.vtt']);
      let fullCues: CaptionCue[] = [];
      if (capPath) {
        const raw = await readFile(capPath, 'utf8');
        fullCues = parseCaptions(raw, capPath.toLowerCase().endsWith('.json3') ? 'json3' : 'vtt');
      }

      // 2 — choose the window (auto-select the viral peak, or honor the caller's start)
      report(20, 'select');
      const selection = job.autoSelect
        ? await this.selector.select(fullCues, job.durationSeconds)
        : { startSeconds: job.startSeconds, durationSeconds: job.durationSeconds, reason: 'manual window', peakType: 'manual' };
      await this.state.patch(job.jobId, { selection });

      // 3 — slice word-level captions to the window, rebased to 0
      const cues = sliceCues(fullCues, selection.startSeconds, selection.durationSeconds);

      // 4 — download ONLY the selected section
      report(40, 'download');
      await this.runner(
        this.config.CLIPS_YTDLP_BIN,
        ytdlpSectionArgs(job.videoId, selection.startSeconds, selection.durationSeconds, join(workDir, 'src.%(ext)s')),
        { timeoutMs: this.config.CLIPS_YTDLP_TIMEOUT_MS, cwd: workDir },
      );
      const inputPath = await findByExt(workDir, VIDEO_EXTS);
      if (!inputPath) throw new Error('clip_source_missing: section download produced no media');

      // 5 — build karaoke ASS from the sliced cues
      report(58, 'captions-render');
      const ass = buildAss(cues, {
        style: job.captionStyle,
        playResX: this.config.CLIPS_OUTPUT_WIDTH,
        playResY: this.config.CLIPS_OUTPUT_HEIGHT,
      });
      const assPath = join(workDir, 'captions.ass');
      await writeFile(assPath, ass, 'utf8');

      // 5b — dynamic face-tracking crop (best-effort; center crop on any failure)
      report(64, 'face-track');
      const dynamicCrop = await this.detectFaceCrop(inputPath, selection.durationSeconds, job.jobId);

      // 6 — single-pass vertical burn-in
      report(72, 'encode');
      const outputPath = join(workDir, 'out.mp4');
      await this.runner(
        this.config.FFMPEG_BIN,
        ffmpegVerticalBurnArgs(inputPath, assPath, outputPath, {
          width: this.config.CLIPS_OUTPUT_WIDTH,
          height: this.config.CLIPS_OUTPUT_HEIGHT,
          durationSeconds: selection.durationSeconds,
          ...(dynamicCrop ? { dynamicCrop } : {}),
        }),
        { timeoutMs: this.config.CLIPS_FFMPEG_TIMEOUT_MS, cwd: workDir },
      );

      // 7 — publish
      report(90, 'upload');
      const key = `clips/${job.userId}/${job.jobId}.mp4`;
      const { url } = await this.deps.store.put(key, outputPath, 'video/mp4');

      await this.state.patch(job.jobId, { status: 'completed', progress: 100, stage: 'completed', url });
      logger.info({ jobId: job.jobId, videoId: job.videoId, selection }, 'clip rendered');
      return { url, selection };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.state.patch(job.jobId, { status: 'failed', stage: 'failed', error: message.slice(0, 300) });
      throw err;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Best-effort dynamic face-tracking crop. The input is already the trimmed
   * section (yt-dlp downloaded only [start, start+duration]), so detection runs
   * from t=0. Probes the source, runs the YuNet Python helper for per-sample
   * face centers, and compiles a per-frame crop-x expression. Returns undefined
   * on ANY failure (disabled, no python/OpenCV/model, no faces) so the render
   * falls back to the static center crop instead of hard-failing.
   */
  private async detectFaceCrop(
    inputPath: string,
    durationSeconds: number,
    jobId: string,
  ): Promise<{ sourceWidth: number; sourceHeight: number; xExpression: string } | undefined> {
    if (!this.config.CLIPS_FACE_TRACK_ENABLED) return undefined;
    try {
      const probe = await probeVideo(inputPath, { ffprobePath: this.config.FFPROBE_BIN });
      const { stdout } = await this.runner(
        this.config.PYTHON_BIN,
        [
          'workers/python/face_track.py',
          '--video',
          inputPath,
          '--model',
          this.config.CLIPS_FACE_MODEL_PATH,
          '--start',
          '0',
          '--duration',
          String(durationSeconds),
          '--fps',
          String(this.config.CLIPS_FACE_TRACK_FPS),
        ],
        // No cwd: script + model paths are relative to the app root (process.cwd()).
        { timeoutMs: this.config.CLIPS_FACE_TRACK_TIMEOUT_MS },
      );
      const parsed = JSON.parse(stdout) as { centers?: FaceCenter[]; sampleFps?: number };
      const centers = parsed.centers ?? [];
      if (centers.length === 0) return undefined;
      const xExpression = buildFaceTrackExpression(centers, {
        sourceWidth: probe.width,
        sourceHeight: probe.height,
        targetWidth: this.config.CLIPS_OUTPUT_WIDTH,
        targetHeight: this.config.CLIPS_OUTPUT_HEIGHT,
        fps: parsed.sampleFps ?? this.config.CLIPS_FACE_TRACK_FPS,
      });
      if (!xExpression) return undefined;
      logger.info({ jobId, samples: centers.length }, 'face-track crop engaged');
      return { sourceWidth: probe.width, sourceHeight: probe.height, xExpression };
    } catch (err) {
      logger.warn({ jobId, error: (err as Error).message }, 'face-track unavailable; using center crop');
      return undefined;
    }
  }
}
