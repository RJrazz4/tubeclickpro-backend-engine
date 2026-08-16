FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv git ca-certificates ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv
COPY workers/python/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY workers ./workers
RUN chown -R node:node /app
USER node
CMD ["node", "dist/worker.js"]
