# Architecture Decision Record

## ADR-001 — Dedicated backend repository

Heavy extraction, queueing, Python workers, and MCP live here. No heavy processing is added to the frontend repository.

## ADR-002 — Physical tier queue separation

Free and Premium use distinct queues and worker deployments. A single priority number cannot guarantee Premium latency during a large Free backlog.

## ADR-003 — Server-authoritative entitlement

The browser cannot select a tier. Supabase authentication and active subscription data are the authority.

## ADR-004 — MCP as an internal context bus

The initial MCP transport is local stdio. It bridges Redis chunks and Supabase profile context to internal agents without exposing a public general-purpose tool endpoint.

## ADR-005 — Safe Agent-Reach adaptation

Agent-Reach is not treated as a server framework. The worker pins the reviewed project commit and invokes its selected YouTube backend in an isolated Python subprocess. It uses no shell, downloads no media, and does not bypass challenges.

## ADR-006 — Redis hot state, Supabase durable state

Redis owns transient queue/progress/event state. Supabase owns subscription authority and durable run records. No local filesystem state is authoritative.

## ADR-007 — Honest scalability claims

The architecture is horizontally scalable, but production capacity is established by load tests and dependency quotas—not by a theoretical worker count.
