# Provisioning the Clip Render Worker (Zero-Cost Viral Shorts Clipper)

The clipper code is live but gated (`CLIPS_ENABLED=false`). This runbook flips it on.
The worker needs `ffmpeg` + `yt-dlp`, which Render's native Node runtime can't install —
so it runs as a **Docker** service built from the repo `Dockerfile`.

## Architecture recap
- **Web service** (existing, native Node): `POST /api/clips` validates + enqueues to BullMQ. Needs `CLIPS_ENABLED=true` to open the route gate. Does **not** need ffmpeg.
- **Clip worker service** (new, Docker): runs `node dist/clip-worker.js`, consumes the `clip-render` queue, runs yt-dlp/ffmpeg, uploads to Supabase Storage.
- Both **must share the same `REDIS_URL` and `REDIS_KEY_PREFIX`** or the worker listens on a different queue.

## Step 1 — Supabase Storage bucket
Create a **public** bucket named `clips` (or set `CLIPS_STORAGE_BUCKET` to your name).
Rendered clips are written to `clips/<userId>/<jobId>.mp4` and served from the bucket's public URL.

## Step 2 — Create the clip worker service
**Option A (Blueprint):** Render → New → Blueprint → select this repo. It reads `render.yaml`
and creates `tubeclickpro-clip-worker` (Docker, `./Dockerfile`). Fill the `sync: false`
secrets in the dashboard.

**Option B (Manual):** Render → New → **Background Worker**
- Runtime: **Docker**
- Dockerfile path: `./Dockerfile`
- Build command: (none — the Dockerfile builds)
- Start command: (none — image CMD is `node dist/clip-worker.js`)

## Step 3 — Environment variables (clip worker)
| Key | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `AUTH_MODE` | `supabase` | |
| `REDIS_URL` | *(same as web)* | **must match** |
| `REDIS_KEY_PREFIX` | `tubeclickpro` | **must match** |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | *(same as web)* | storage upload |
| `CLIPS_ENABLED` | `true` | starts the worker |
| `CLIPS_STORAGE_BUCKET` | `clips` | |
| `CLIPS_WORKER_CONCURRENCY` | `1` | 1 on 512MB |
| `FFMPEG_BIN` / `CLIPS_YTDLP_BIN` | `ffmpeg` / `yt-dlp` | baked into the image |

## Step 4 — Open the route on the web service
On the **existing web service**, set `CLIPS_ENABLED=true` (and ensure `CLIPS_STORAGE_BUCKET`
matches). No ffmpeg needed there — it only enqueues.

## Step 5 — Verify end to end
```bash
# 1. route is open (was 503 before Step 4)
curl -X POST https://<engine>/api/clips \
  -H "Authorization: Bearer <SUPABASE_JWT>" -H 'Content-Type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=VIDEO_ID","durationSeconds":30}'
# → 202 {jobId, status:"queued", ...}

# 2. poll status
curl https://<engine>/api/clips/<jobId> -H "Authorization: Bearer <JWT>"
# → {status:"processing"|"completed", progress, url}
```
Worker logs to watch: `clip render worker started (dedicated)`, then `clip rendered`.

## Local image smoke test (optional, before deploying)
```bash
docker build -t clip-worker .
docker run --rm clip-worker ffmpeg -version | head -1
docker run --rm clip-worker yt-dlp --version
```
The Dockerfile already runs both as build-time smoke tests, so a successful `docker build`
proves the binaries work.

## Caveats (honest)
- **Render free background workers:** if Render requires a paid plan for workers, use the
  Starter plan for this one service, or run the same image on any free Docker host that can
  reach the shared Redis. The web service stays free.
- **Throughput:** `CLIPS_WORKER_CONCURRENCY=1` on 512MB. Scale by adding worker instances,
  never by raising per-box concurrency (ffmpeg is CPU/RAM heavy).
- **YouTube ToS:** downloading via yt-dlp is subject to YouTube's terms — gate to
  user-owned/fair-use content and keep the `CLIPS_ENABLED` kill-switch handy.
- The Dockerfile/`render.yaml` are **not build-tested in the dev sandbox** (no Docker/network
  there); the application pipeline itself is unit + integration tested (`tests/clips-core.test.ts`,
  `tests/clip-worker-service.test.ts`).
