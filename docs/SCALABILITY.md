# Scalability Architecture — the 10,000-Concurrent-User Mandate

How the engine stays fast and never crashes when 10,000 creators hit the
dashboard at once. Every pattern below is either already implemented in
Phase O‑1 or is an explicit rule for later phases.

---

## 1. The three load surfaces

| Surface | What kills naive builds | Our posture |
|---|---|---|
| **Dashboard reads** | 10k users × page polls hammering Postgres row locks | Cache-first reads (Redis), owner-read RLS queries are index-only, heavy joins precomputed into `audience_profiles` (Phase 2) |
| **Google API calls** | 10k users × sync jobs = instant quota death | Redis-first quota ledger with priority shedding (implemented) + per-user fairness |
| **Sync/worker stampedes** | 10k backfills started at once | Per-user locks, queue rate limits, jittered nightly sweep (implemented) |

## 2. Database (Supabase) — pooling & access discipline

- **The API talks to Supabase over PostgREST (HTTPS)** — Supavisor pools those
  connections server-side; the API holds **zero open Postgres sockets**.
  Scaling the API = scaling stateless Render dynos, nothing else.
- **Workers use the service-role REST client too** — no direct `pg` pool to
  exhaust; concurrency is bounded by `YOUTUBE_SYNC_CONCURRENCY` (default 5
  per worker dyno), not by connection slots.
- **If a future component needs direct SQL** (bulk rollups in Phase 2), it
  MUST connect via the Supavisor **transaction pooler (port 6543)** with
  `prepared_statements=false`, and hold a pool ≤ 10 per dyno. Session mode
  (5432) is reserved for migrations only.
- **Writes are idempotent natural-key upserts** in ≤400-row batches — a retried
  or duplicated job can never double-count (verified by test + SQL check).
- **No hot rows.** No table has a row every request updates: quota counters
  live in Redis; sync state is per-user; the ledger is append-only with
  batched inserts (30‑min flush job).

## 3. Quota ledger — the pattern (implemented)

`trySpend()` = one Redis `INCRBY` (atomic, O(1), no locks) + pure decision:

```
platform_budget   → hard stop for everyone
background_shed   → P3 (radar/background) stops at 80% so user-triggered
                    work (P1) keeps flowing to 100%
user_fairness     → per-user daily cap stops one creator eating the pool
```

Denied spends roll back the INCR, so counters stay exact under concurrency;
overspend is bounded by in-flight single-unit requests. Durability: spends
buffer in Redis and flush in batches to `youtube_quota_ledger`; on boot the
counters rebuild from the DB (`rebuildFromDb`). Losing Redis loses ≤30 min of
ledger rows, never correctness.

## 4. Queues & workers

- **BullMQ per concern**: existing `viral-dna-extract-free/premium` queues
  untouched; new `youtube-sync` queue with queue-level rate limits,
  `attempts: 3` + exponential backoff, and `jobId` dedupe (`full-sync:<uid>`
  can never double-enqueue).
- **Per-user sync lock** (Redis `SET NX EX 600`): one in-flight sync per
  creator regardless of worker count.
- **Nightly sweep jitter**: per-user daily jobs get a 0–30 min random delay —
  10k connections spread smoothly instead of a 01:15 thundering herd.
- **Repeatables** use BullMQ 6 job schedulers (`upsertJobScheduler`), which
  are cluster-safe to register from every worker dyno.

## 5. API layer

- Fastify is stateless; every deployment unit (API, workers, MCP) is
  independently scalable on Render (horizontal dynos).
- Route-level guards are O(1) Redis ops (sync rate limit = `INCR` + `EXPIRE`
  fixed window; no DB round-trip).
- Auth = Supabase JWT verify + tier RPC (existing); entitlements are
  server-authoritative and cached upstream of any Google call.

## 6. Failure posture

- Google 5xx/timeout → BullMQ backoff; jobs re-run idempotently.
- `invalid_grant` → connection marked `revoked`, queued jobs cancelled, user
  shown a re-connect card. No crash loops.
- Redis outage → API `/readyz` goes 503 (Render stops routing), no
  half-broken behavior.
- Supabase outage → writes fail closed; queued jobs retry; nothing lost.

## 7. Load-test gates (before "10k-ready" is claimed)

| Scenario | Target |
|---|---|
| 10k virtual users, `GET /api/youtube/connection` (cached) | p95 < 150 ms, 0 errors, 15 min soak |
| 1k connects in 1 h | no quota exhaustion, backfills complete < 20 min each |
| 10k-connection nightly sweep | spread ≤ 45 min, Data API units < budget |
| Chaos: kill a worker mid-backfill | resume from `completed_through`, zero duplicates |
