# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# TubeClick Pro — Clip Render Worker image
# Bundles ffmpeg + yt-dlp (which Render's native Node runtime cannot install)
# and runs the dedicated clip-render worker (dist/clip-worker.js).
# Node 22 to match .nvmrc / engines.
# ─────────────────────────────────────────────────────────────────────────────

# ---- build stage -------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
# Drop devDependencies so the runtime layer only ships production modules.
RUN npm prune --omit=dev

# ---- runtime stage -----------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PIP_NO_CACHE_DIR=1

# ffmpeg/ffprobe (encode + probe) + ca-certificates (TLS) + curl (fetch yt-dlp)
# + python3/pip (the optional YuNet face-tracking helper).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl python3 python3-pip \
 && rm -rf /var/lib/apt/lists/*

# yt-dlp standalone Linux binary (no Python needed). Pin via --build-arg
# YTDLP_VERSION=YYYY.MM.DD for reproducibility; defaults to the latest release.
ARG YTDLP_VERSION=latest
RUN set -eux; \
    if [ "$YTDLP_VERSION" = "latest" ]; then \
      URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"; \
    else \
      URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_linux"; \
    fi; \
    curl -fsSL "$URL" -o /usr/local/bin/yt-dlp; \
    chmod a+rx /usr/local/bin/yt-dlp; \
    # build-time smoke tests: fail the image if either binary can't run
    ffmpeg -hide_banner -version | head -1; \
    yt-dlp --version

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/workers ./workers
COPY --from=build /app/package*.json ./

# Face-tracking deps: OpenCV (headless) + the free YuNet ONNX face model (~230KB).
# Optional at runtime — the worker falls back to a static center crop if the
# helper, OpenCV, or the model is unavailable, so a render never hard-fails.
RUN pip3 install --no-cache-dir --break-system-packages opencv-python-headless numpy \
 && mkdir -p /app/workers/python/models \
 && curl -fsSL "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx" \
      -o /app/workers/python/models/face_detection_yunet_2023mar.onnx \
 && python3 -c "import cv2; assert cv2.FaceDetectorYN; print('cv2', cv2.__version__, 'YuNet OK')"

# Run as a non-root user; temp media goes to /tmp (world-writable).
RUN useradd -m -u 1001 clipper && chown -R clipper:clipper /app
USER clipper

CMD ["node", "dist/clip-worker.js"]
