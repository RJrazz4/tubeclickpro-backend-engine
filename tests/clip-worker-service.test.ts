// The real ClipWorkerService pipeline, driven with a stub command runner and an
// in-memory Redis/store. This exercises the actual orchestration code path
// (captions → section download → ASS → ffmpeg → upload → state → cleanup)
// without requiring ffmpeg/yt-dlp to be installed.
//
// The config-dependent modules are imported DYNAMICALLY in beforeAll, after
// AUTH_MODE is set, because src/observability/logger.ts reads config at import
// time and static imports are hoisted above the process.env assignment.
process.env.AUTH_MODE = 'development';
process.env.NODE_ENV = 'test';

import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getConfig, resetConfigForTests } from '../src/config/env.js';
import type { ClipJob } from '../src/clips/clip-queue.js';
import type { CommandRunner } from '../src/clips/media-runner.js';

let ClipWorkerService: typeof import('../src/clips/clip-worker-service.js').ClipWorkerService;
let ClipStateStore: typeof import('../src/clips/clip-state.js').ClipStateStore;
let InMemoryClipStore: typeof import('../src/clips/clip-store.js').InMemoryClipStore;

const VTT = ['WEBVTT', '', '00:00:00.000 --> 00:00:02.000', 'Hello world', '', '00:00:02.000 --> 00:00:04.000', 'Second line'].join('\n');

function fakeRedis() {
  const map = new Map<string, string>();
  return {
    get: async (k: string) => map.get(k) ?? null,
    set: async (k: string, v: string) => {
      map.set(k, v);
      return 'OK';
    },
  } as never;
}

const JOB: ClipJob = {
  kind: 'render',
  jobId: 'clip:integration1',
  userId: 'user-1',
  tier: 'free',
  videoId: 'aaaaaaaaaaa',
  startSeconds: 0,
  durationSeconds: 30,
  captionStyle: 'karaoke',
  autoSelect: false,
};

beforeAll(async () => {
  resetConfigForTests();
  ({ ClipWorkerService } = await import('../src/clips/clip-worker-service.js'));
  ({ ClipStateStore } = await import('../src/clips/clip-state.js'));
  ({ InMemoryClipStore } = await import('../src/clips/clip-store.js'));
});

describe('ClipWorkerService.render', () => {
  it('runs the full pipeline, uploads, marks completed, and wipes the temp dir', async () => {
    const redis = fakeRedis();
    const store = new InMemoryClipStore();
    const states = new ClipStateStore(redis);
    await states.init(JOB.jobId, JOB.userId);

    let workDir = '';
    const runner: CommandRunner = async (bin, args, opts) => {
      workDir = opts.cwd ?? workDir;
      if (bin.includes('yt-dlp')) {
        if (args.includes('--skip-download')) await writeFile(join(workDir, 'cap.en.vtt'), VTT, 'utf8');
        else await writeFile(join(workDir, 'src.mp4'), Buffer.from('fake-source-bytes'));
        return { stdout: '', stderr: '' };
      }
      if (bin.includes('ffmpeg')) {
        const out = args[args.length - 1];
        if (!out) throw new Error('no output arg');
        await writeFile(out, Buffer.from('fake-rendered-clip'));
        return { stdout: '', stderr: '' };
      }
      throw new Error(`unexpected binary: ${bin}`);
    };

    const service = new ClipWorkerService({ redis, store, runner });
    const result = await service.render(JOB);

    expect(result.url).toBe(`https://clip.local/clips/user-1/${JOB.jobId}.mp4`);
    expect(store.objects.size).toBe(1);
    const stored = store.objects.get(`clips/user-1/${JOB.jobId}.mp4`);
    expect(stored?.contentType).toBe('video/mp4');
    expect(stored?.bytes.toString()).toBe('fake-rendered-clip');

    const state = await states.get(JOB.jobId);
    expect(state?.status).toBe('completed');
    expect(state?.progress).toBe(100);
    expect(state?.url).toBe(result.url);

    // temp working directory is removed in finally
    await expect(stat(workDir)).rejects.toThrow();
  });

  it('marks the job failed and rethrows when ffmpeg errors', async () => {
    const redis = fakeRedis();
    const store = new InMemoryClipStore();
    const states = new ClipStateStore(redis);
    await states.init(JOB.jobId, JOB.userId);

    const runner: CommandRunner = async (bin, args, opts) => {
      const dir = opts.cwd ?? '';
      if (bin.includes('yt-dlp')) {
        if (args.includes('--skip-download')) await writeFile(join(dir, 'cap.en.vtt'), VTT, 'utf8');
        else await writeFile(join(dir, 'src.mp4'), Buffer.from('x'));
        return { stdout: '', stderr: '' };
      }
      throw new Error('ffmpeg: encoder exploded');
    };

    const service = new ClipWorkerService({ redis, store, runner });
    await expect(service.render(JOB)).rejects.toThrow(/encoder exploded/);

    const state = await states.get(JOB.jobId);
    expect(state?.status).toBe('failed');
    expect(state?.error).toContain('encoder exploded');
    expect(store.objects.size).toBe(0);
  });

  it('auto-selects the window and downloads exactly that section', async () => {
    const redis = fakeRedis();
    const store = new InMemoryClipStore();
    const states = new ClipStateStore(redis);
    const autoJob: ClipJob = { ...JOB, jobId: 'clip:auto1', autoSelect: true };
    await states.init(autoJob.jobId, autoJob.userId);

    let sectionArg = '';
    const runner: CommandRunner = async (bin, args, opts) => {
      const dir = opts.cwd ?? '';
      if (bin.includes('yt-dlp')) {
        if (args.includes('--skip-download')) await writeFile(join(dir, 'cap.en.vtt'), VTT, 'utf8');
        else {
          const i = args.indexOf('--download-sections');
          sectionArg = args[i + 1] ?? '';
          await writeFile(join(dir, 'src.mp4'), Buffer.from('x'));
        }
        return { stdout: '', stderr: '' };
      }
      const out = args[args.length - 1];
      if (out) await writeFile(out, Buffer.from('clip'));
      return { stdout: '', stderr: '' };
    };

    // Stub selector: pretend the viral peak starts at 2s.
    const selector = {
      select: async () => ({ startSeconds: 2, durationSeconds: 30, reason: 'stub peak', peakType: 'spike' }),
    } as unknown as import('../src/clips/moment-selector.js').MomentSelector;

    // Pin to the v1 single-pass path: this asserts MomentSelector window
    // selection, which pipeline v2 replaces with the parallel text agents.
    const service = new ClipWorkerService({ redis, store, runner, selector, config: { ...getConfig(), CLIPS_PIPELINE_V2: false } });
    const result = await service.render(autoJob);

    expect(sectionArg).toBe('*2-32');
    expect(result.selection).toMatchObject({ startSeconds: 2, peakType: 'spike' });
    const state = await states.get(autoJob.jobId);
    expect(state?.status).toBe('completed');
    expect(state?.selection?.startSeconds).toBe(2);
  });
});
