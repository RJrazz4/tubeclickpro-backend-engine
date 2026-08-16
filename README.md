# TubeClick Pro Backend Engine

Dedicated heavy-processing microservice for **Clone & Crush AI / Viral DNA Extractor**.

> This repository contains the backend only. No frontend repository was modified.

## What is initialized

- Node.js 22 + TypeScript + Fastify API
- BullMQ + Redis distributed processing
- Separate **Free Conveyor** and **Premium VIP** queues and workers
- Server-authoritative Supabase entitlement lookup
- Free polling: `GET /api/viral-dna/status`
- Premium SSE: `GET /api/viral-dna/stream`
- Python Agent-Reach/yt-dlp extraction worker
- Premium 0–10 second hook context
- Internal MCP client/server bridge for Redis chunks and Supabase channel profiles
- MCP-backed Micro-Critic baseline
- Supabase migration, RLS, Docker topology, and tests

The full masterplan is preserved at [`docs/VIRAL_DNA_EXTRACTOR_ARCHITECTURE.md`](docs/VIRAL_DNA_EXTRACTOR_ARCHITECTURE.md). The exact status and non-claims are in [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md).

## Runtime topology

```text
Frontend trigger
    │
    ▼
Fastify API ── Supabase auth + entitlement
    │
    ├── Free  → Conveyor queue → low-cost Free worker → polling
    │
    └── Pro   → VIP queue      → Premium worker      → Redis Pub/Sub → SSE
                                      │
                                      ├── Python Agent-Reach/yt-dlp worker
                                      └── MCP client → context MCP server
                                                        ├── Redis chunks
                                                        └── Supabase profile
```

## Repository structure

```text
src/
├── api/                    # HTTP route contracts
├── auth/                   # Supabase and development auth
├── config/                 # validated environment configuration
├── domain/                 # tier, job, extraction, and error contracts
├── infrastructure/         # Redis factory and key namespacing
├── mcp/                    # internal MCP context server/client
├── observability/          # structured redacted logging
├── persistence/            # durable Supabase run ledger
├── pipeline/               # physically separate Free/Premium pipelines
├── queue/                  # BullMQ names and queue creation
├── scraper/                # isolated Python subprocess adapter
├── services/               # admission, rate limiting, state, orchestration
├── app.ts                  # Fastify composition root
├── server.ts               # API process
└── worker.ts               # tier-selectable worker process

workers/python/
├── viral_dna_worker.py     # safe metadata/caption extractor
└── requirements.txt        # pinned Agent-Reach capability layer

supabase/migrations/        # database foundation + RLS
docker/                     # API and worker images
docs/                       # masterplan and implementation decisions
tests/                      # tier and pipeline contract tests
```

## Strict tier contract

| | Free | Premium |
|---|---|---|
| Queue | Conveyor | VIP |
| Worker resources | Low concurrency and strict limiter | Dedicated concurrency |
| Extraction | Basic | Deep 0–10s context |
| Micro-Critic | Disabled | MCP-backed |
| Delivery | Polling | SSE |
| Tier source | Supabase | Supabase |

The API does not accept a tier in the execute request.

## Local development

### Requirements

- Node.js 22+
- Redis 7+
- Python 3.10+
- `yt-dlp` for extraction tests

```bash
cp .env.example .env
npm ci
npm run typecheck
npm test
```

Start Redis, then run the processes separately:

```bash
npm run dev
npm run dev:worker
```

Or use the local topology:

```bash
docker compose up --build
```

Development requests use explicit local headers:

```bash
curl -X POST http://localhost:3000/api/viral-dna/execute \
  -H 'content-type: application/json' \
  -H 'x-dev-user-id: local-user' \
  -H 'x-dev-tier: free' \
  -d '{"videoUrl":"https://www.youtube.com/watch?v=VIDEO_ID"}'
```

Development-header authentication is rejected when `NODE_ENV=production`.

## Production configuration

Use deployment secrets, never committed `.env` files:

- `REDIS_URL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AUTH_MODE=supabase`
- tier concurrency and quota variables from `.env.example`

Deploy API, Free worker, and Premium worker as independent services. Set:

```text
WORKER_TIER=free
```

or:

```text
WORKER_TIER=premium
```

This permits independent autoscaling and guarantees that Free backlog cannot consume Premium worker slots.

## Documentation

- [Implementation architecture](docs/IMPLEMENTATION_ARCHITECTURE.md)
- [Tier isolation contract](docs/TIER_ISOLATION.md)
- [MCP integration](docs/MCP_INTEGRATION.md)
- [API contract](docs/API.md)
- [Implementation status](docs/IMPLEMENTATION_STATUS.md)
- [Architecture decisions](docs/DECISIONS.md)
- [Security policy](SECURITY.md)
- [Original masterplan](docs/VIRAL_DNA_EXTRACTOR_ARCHITECTURE.md)

## Responsible use

Use extraction only for content you are authorized to analyze. Respect platform terms, copyright, privacy, rate limits, and applicable law. The initialized worker detects upstream challenge responses and fails safely; it does not implement challenge or CAPTCHA bypass.
