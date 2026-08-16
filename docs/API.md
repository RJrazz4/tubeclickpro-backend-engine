# Initial API Contract

## `POST /api/viral-dna/execute`

Creates a server-tiered asynchronous job.

```json
{
  "videoUrl": "https://www.youtube.com/watch?v=...",
  "channelProfileId": "optional-uuid",
  "outputLanguage": "English"
}
```

Response: HTTP 202

```json
{
  "jobId": "uuid",
  "status": "queued",
  "tier": "premium",
  "queueClass": "vip",
  "delivery": "sse",
  "statusUrl": "/api/viral-dna/status?jobId=...",
  "streamUrl": "/api/viral-dna/stream?jobId=..."
}
```

The request has no `tier` field. Tier comes from Supabase.

## `GET /api/viral-dna/status?jobId=<uuid>`

Returns the owner-scoped job snapshot. This is the primary Free delivery path and a Premium recovery path.

## `GET /api/viral-dna/stream?jobId=<uuid>`

Premium-only SSE stream. Events:

- `snapshot`: current state on connection
- `progress`: queued, processing, retry, completion, or failure update
- heartbeat comment every 15 seconds

A Free user receives HTTP 403 with `PREMIUM_STREAM_REQUIRED`.

## `GET /healthz`

Liveness only. Does not call dependencies.

## `GET /readyz`

Readiness check. Requires Redis `PING` success.

## Authentication

Production requests use:

```text
Authorization: Bearer <Supabase access token>
```

Development-only headers:

```text
x-dev-user-id: local-user
x-dev-tier: free | premium
```
