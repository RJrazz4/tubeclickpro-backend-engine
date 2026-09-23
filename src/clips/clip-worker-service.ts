import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Redis } from 'ioredis';
import { getConfig, type AppConfig } from '../config/env.js';
import { logger } from '../observability/logger.js';
import { ClipStateStore } from './clip-state.js';
import { buildAss, type CaptionCue } from './ass-builder.js';
import { parseVtt } from './vtt.js';
import { ffmpegVerticalBurnArgs, ytdlpCaptionArgs, ytdlpSectionArgs } from './media-args.js';
import { execFileRunner, type CommandRunner } from './media-runner.js';
import type { ClipStore } from './clip-store.js';
import type { ClipJob } from './clip-queue.js';

/**
 * Renders one clip: captions → segment download → ASS → single-pass vertical
 * burn-in → upload. All temp files live in a per-job mkdtemp dir that is wiped
 * in `finally`. Heavy work is delegated to child processes (see media-runner).
 */

export interface ClipWorkerDeps {
  redis: Redis;
  store: ClipStore;
  config?: AppConfig;
  runner?: CommandRunner;
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

  constructor(private readonly deps: ClipWorkerDeps) {
    this.state = new ClipStateStore(deps.redis);
    this.config = deps.config ?? getConfig();
    this.runner = deps.runner ?? execFileRunner;
  }

  async render(job: ClipJob, onProgress?: (percent: number, stage: string) => void): Promise<{ url: string }> {
    const report = (progress: number, stage: string): void => {
      onProgress?.(progress, stage);
      void this.state.patch(job.jobId, { status: 'processing', progress, stage });
    };

    const workDir = await mkdtemp(join(tmpdir(), 'clip-'));
    try {
      // 1 — captions (free: YouTube auto-subs; no media yet)
      report(10, 'captions');
      await this.runner(
        this.config.CLIPS_YTDLP_BIN,
        ytdlpCaptionArgs(job.videoId, join(workDir, 'cap.%(ext)s')),
        { timeoutMs: this.config.CLIPS_YTDLP_TIMEOUT_MS, cwd: workDir },
      );
      const vttPath = await findByExt(workDir, ['.vtt']);
      let cues: CaptionCue[] = [];
      if (vttPath) {
        const vtt = await readFile(vttPath, 'utf8');
        // The section download starts at 0, so shift caption times by the window start.
        cues = parseVtt(vtt, job.startSeconds);
      }

      // 2 — download ONLY the requested section
      report(35, 'download');
      await this.runner(
        this.config.CLIPS_YTDLP_BIN,
        ytdlpSectionArgs(job.videoId, job.startSeconds, job.durationSeconds, join(workDir, 'src.%(ext)s')),
        { timeoutMs: this.config.CLIPS_YTDLP_TIMEOUT_MS, cwd: workDir },
      );
      const inputPath = await findByExt(workDir, VIDEO_EXTS);
      if (!inputPath) throw new Error('clip_source_missing: section download produced no media');

      // 3 — build ASS captions
      report(55, 'captions-render');
      const ass = buildAss(cues, {
        style: job.captionStyle,
        playResX: this.config.CLIPS_OUTPUT_WIDTH,
        playResY: this.config.CLIPS_OUTPUT_HEIGHT,
      });
      const assPath = join(workDir, 'captions.ass');
      await writeFile(assPath, ass, 'utf8');

      // 4 — single-pass vertical burn-in
      report(70, 'encode');
      const outputPath = join(workDir, 'out.mp4');
      await this.runner(
        this.config.FFMPEG_BIN,
        ffmpegVerticalBurnArgs(inputPath, assPath, outputPath, {
          width: this.config.CLIPS_OUTPUT_WIDTH,
          height: this.config.CLIPS_OUTPUT_HEIGHT,
          durationSeconds: job.durationSeconds,
        }),
        { timeoutMs: this.config.CLIPS_FFMPEG_TIMEOUT_MS, cwd: workDir },
      );

      // 5 — publish
      report(90, 'upload');
      const key = `clips/${job.userId}/${job.jobId}.mp4`;
      const { url } = await this.deps.store.put(key, outputPath, 'video/mp4');

      await this.state.patch(job.jobId, { status: 'completed', progress: 100, stage: 'completed', url });
      logger.info({ jobId: job.jobId, videoId: job.videoId }, 'clip rendered');
      return { url };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.state.patch(job.jobId, { status: 'failed', stage: 'failed', error: message.slice(0, 300) });
      throw err;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
