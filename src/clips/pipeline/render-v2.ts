/**
 * Pipeline v2 orchestrator — the multi-agent deterministic flow:
 *
 *   transcript (JSON3, free) → parallel text agents (Story ∥ Retention)
 *     → download chosen section → fast preprocess (scenes/silence/energy)
 *     → Audio agent → EditPlan JSON → fast cut engine (trim+concat)
 *     → face-track + burned captions → export.
 *
 * Heavy per-frame work (face detection) runs only on the short, already-cut
 * media — never on the full video — which is the whole point of the overhaul.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppConfig } from '../../config/env.js';
import { logger } from '../../observability/logger.js';
import type { OpenRouterRouter } from '../../llm/router.js';
import { buildAss, type CaptionCue } from '../ass-builder.js';
import { parseCaptions } from '../captions.js';
import type { ClipJob } from '../clip-queue.js';
import type { ClipStore } from '../clip-store.js';
import { ffmpegVerticalBurnArgs, ytdlpCaptionArgs, ytdlpSectionArgs } from '../media-args.js';
import type { CommandRunner } from '../media-runner.js';
import { runAudioAgent, runRetentionAgent, runStoryAgent } from './agents.js';
import { buildCutConcatArgs, needsConcat } from './cut-engine.js';
import { buildEditPlan } from './edit-plan.js';
import { runPreprocess } from './preprocess.js';
import type { AgentSignals } from './types.js';

const VIDEO_EXTS = ['.mp4', '.webm', '.mkv', '.mov'];

async function findByExt(dir: string, exts: string[]): Promise<string | null> {
  const files = await readdir(dir);
  const hit = files.find((f) => exts.some((e) => f.toLowerCase().endsWith(e)));
  return hit ? join(dir, hit) : null;
}

function shiftCues(cues: CaptionCue[], by: number, spanEnd: number): CaptionCue[] {
  return cues
    .filter((c) => c.end > by && c.start < by + spanEnd)
    .map((c) => ({
      start: Math.max(0, c.start - by),
      end: Math.max(0, c.end - by),
      text: c.text,
      ...(c.words ? { words: c.words.map((w) => ({ start: Math.max(0, w.start - by), end: Math.max(0, w.end - by), text: w.text })) } : {}),
    }));
}

export interface FaceCrop {
  sourceWidth: number;
  sourceHeight: number;
  xExpression: string;
}

export interface RenderV2Ctx {
  job: ClipJob;
  workDir: string;
  runner: CommandRunner;
  config: AppConfig;
  store: ClipStore;
  router: OpenRouterRouter | null;
  report: (percent: number, stage: string) => void;
  /** Reuses the worker's face-tracking helper (YuNet → crop-x expression). */
  detectFaceCrop: (mediaPath: string, durationSeconds: number) => Promise<FaceCrop | undefined>;
}

export async function renderClipV2(ctx: RenderV2Ctx): Promise<{ url: string; selection: { startSeconds: number; durationSeconds: number; reason: string; peakType: string } }> {
  const { job, workDir, runner, config, report } = ctx;
  const target = job.durationSeconds;
  const minDuration = Math.min(5, target);

  // 2 — ONE TRANSCRIPT (JSON3 first; zero CPU). Best-effort: no track → empty.
  report(8, 'transcript');
  try {
    await runner(config.CLIPS_YTDLP_BIN, ytdlpCaptionArgs(job.videoId, join(workDir, 'cap.%(ext)s')), {
      timeoutMs: config.CLIPS_YTDLP_TIMEOUT_MS,
      cwd: workDir,
    });
  } catch (err) {
    logger.warn({ jobId: job.jobId, error: (err as Error).message }, 'v2 caption fetch incomplete; continuing');
  }
  const capPath = await findByExt(workDir, ['.json3', '.vtt']);
  let fullCues: CaptionCue[] = [];
  if (capPath) {
    const raw = await readFile(capPath, 'utf8');
    fullCues = parseCaptions(raw, capPath.toLowerCase().endsWith('.json3') ? 'json3' : 'vtt');
  }

  // 3 — PARALLEL AI (text only): Story ∥ Retention choose the window.
  report(22, 'agents');
  const agentDeps = { router: ctx.router, model: config.OPENROUTER_MODEL_FREE, minDuration };
  const [story, retention] = await Promise.all([
    runStoryAgent(fullCues, target, agentDeps),
    runRetentionAgent(fullCues, target, agentDeps),
  ]);
  const useRetention = Number.isFinite(retention.startSeconds) && retention.endSeconds > retention.startSeconds;
  const A = Math.max(0, useRetention ? retention.startSeconds : story.startSeconds);
  const B = Math.max(A + minDuration, useRetention ? retention.endSeconds : story.endSeconds);
  const sectionDuration = B - A;

  // 4 — download ONLY the chosen section (bandwidth/CPU stays bounded).
  report(38, 'download');
  await runner(config.CLIPS_YTDLP_BIN, ytdlpSectionArgs(job.videoId, A, sectionDuration, join(workDir, 'src.%(ext)s')), {
    timeoutMs: config.CLIPS_YTDLP_TIMEOUT_MS,
    cwd: workDir,
  });
  const sectionPath = await findByExt(workDir, VIDEO_EXTS);
  if (!sectionPath) throw new Error('clip_source_missing: v2 section download produced no media');

  // 1 — FAST PREPROCESS on the short section (scenes, silence, energy, wav).
  report(52, 'preprocess');
  const pre = await runPreprocess(sectionPath, join(workDir, 'audio.wav'), {
    ffmpegBin: config.FFMPEG_BIN,
    ffprobeBin: config.FFPROBE_BIN,
    runner,
    timeoutMs: config.CLIPS_FFMPEG_TIMEOUT_MS,
    sceneThreshold: config.CLIPS_SCENE_THRESHOLD,
    silenceDb: config.CLIPS_SILENCE_DB,
    silenceMinSeconds: config.CLIPS_SILENCE_MIN_MS / 1000,
  });

  // 3b — Audio agent (deterministic) + 4 — EDIT PLAN JSON.
  report(64, 'plan');
  const minCut = config.CLIPS_SILENCE_MIN_MS / 1000;
  const audio = runAudioAgent(pre.silences, pre.energy, { start: 0, end: sectionDuration }, { minCutSeconds: minCut });
  const signals: AgentSignals = {
    story: { ...story, startSeconds: 0, endSeconds: sectionDuration },
    retention: { ...retention, startSeconds: 0, endSeconds: sectionDuration },
    audio,
  };
  const plan = buildEditPlan(signals, shiftCues(fullCues, A, sectionDuration), {
    targetDuration: sectionDuration,
    minDuration,
    captionStyle: job.captionStyle,
    silence: { minCutSeconds: minCut, minKeepSeconds: 0.35, maxSegments: 12 },
    faceTrack: config.CLIPS_FACE_TRACK_ENABLED,
  });

  // 5 — FAST CUT ENGINE: trim+concat the kept segments (skipped when nothing is cut).
  report(74, 'cut');
  let cutMedia = sectionPath;
  if (needsConcat(plan.segments, pre.duration || sectionDuration)) {
    const joined = join(workDir, 'joined.mp4');
    await runner(config.FFMPEG_BIN, buildCutConcatArgs(sectionPath, plan.segments, joined), {
      timeoutMs: config.CLIPS_FFMPEG_TIMEOUT_MS,
      cwd: workDir,
    });
    cutMedia = joined;
  }

  // Face-track only on the short, already-cut media.
  report(84, 'face-track');
  const dynamicCrop = plan.faceTrack ? await ctx.detectFaceCrop(cutMedia, plan.outputDuration) : undefined;

  // Captions (already rebased to the output timeline) + premium hook.
  report(90, 'captions');
  const ass = buildAss(plan.captions, {
    style: plan.captionStyle,
    playResX: config.CLIPS_OUTPUT_WIDTH,
    playResY: config.CLIPS_OUTPUT_HEIGHT,
    ...(plan.hookText ? { hookText: plan.hookText, hookDurationSeconds: Math.min(4, Math.max(1, Math.round(plan.outputDuration / 3))) } : {}),
  });
  const assPath = join(workDir, 'captions.ass');
  await writeFile(assPath, ass, 'utf8');

  report(93, 'encode');
  const outputPath = join(workDir, 'out.mp4');
  await runner(
    config.FFMPEG_BIN,
    ffmpegVerticalBurnArgs(cutMedia, assPath, outputPath, {
      width: config.CLIPS_OUTPUT_WIDTH,
      height: config.CLIPS_OUTPUT_HEIGHT,
      durationSeconds: plan.outputDuration,
      ...(dynamicCrop ? { dynamicCrop } : {}),
    }),
    { timeoutMs: config.CLIPS_FFMPEG_TIMEOUT_MS, cwd: workDir },
  );

  report(97, 'upload');
  const key = `clips/${job.userId}/${job.jobId}.mp4`;
  const { url } = await ctx.store.put(key, outputPath, 'video/mp4');
  logger.info({ jobId: job.jobId, segments: plan.segments.length, outputDuration: plan.outputDuration }, 'v2 clip rendered');
  return {
    url,
    selection: { startSeconds: A, durationSeconds: sectionDuration, reason: plan.reason, peakType: retention.peakType },
  };
}
