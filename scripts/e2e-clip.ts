// Local end-to-end driver for the clipper using REAL ffmpeg + yt-dlp.
// Usage: npx tsx scripts/e2e-clip.ts [videoId] [durationSeconds]
process.env.AUTH_MODE = 'development';
process.env.NODE_ENV = 'test';

import { copyFile, mkdir } from 'node:fs/promises';
import { ClipWorkerService } from '../src/clips/clip-worker-service.js';
import { ClipStateStore } from '../src/clips/clip-state.js';
import { execFileRunner } from '../src/clips/media-runner.js';
import type { ClipStore } from '../src/clips/clip-store.js';
import type { ClipJob } from '../src/clips/clip-queue.js';

class LocalStore implements ClipStore {
  constructor(private readonly dir: string) {}
  async put(key: string, filePath: string, contentType: string): Promise<{ url: string }> {
    await mkdir(this.dir, { recursive: true });
    const dest = `${this.dir}/${key.replace(/\//g, '_')}`;
    await copyFile(filePath, dest);
    return { url: `file://${dest}` };
  }
}

function fakeRedis() {
  const m = new Map<string, string>();
  return {
    get: async (k: string) => m.get(k) ?? null,
    set: async (k: string, v: string) => {
      m.set(k, v);
      return 'OK';
    },
  } as never;
}

const videoId = process.argv[2] ?? 'dQw4w9WgXcQ';
const durationSeconds = Number(process.argv[3] ?? 30);

const redis = fakeRedis();
const store = new LocalStore('/tmp/clipout');
const states = new ClipStateStore(redis);
const jobId = `clip:e2e:${Date.now()}`;
await states.init(jobId, 'e2e-user');

const job: ClipJob = {
  kind: 'render',
  jobId,
  userId: 'e2e-user',
  tier: 'premium',
  videoId,
  startSeconds: 0,
  durationSeconds,
  captionStyle: 'karaoke',
  autoSelect: true,
};

const service = new ClipWorkerService({ redis, store, runner: execFileRunner });
const t0 = Date.now();
console.log(`rendering clip for ${videoId} (autoSelect, ${durationSeconds}s)...`);
const result = await service.render(job, (p, s) => console.log(`  [${String(p).padStart(3)}%] ${s}`));
const ms = Date.now() - t0;
console.log('RESULT', JSON.stringify(result, null, 2));
console.log('STATE', JSON.stringify(await states.get(jobId)));
console.log(`elapsed_ms=${ms}`);
