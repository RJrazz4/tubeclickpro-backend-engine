# Free and Premium Isolation Contract

Tier separation is a backend security boundary, not a frontend styling decision.

| Capability | Free — Conveyor Belt | Premium — VIP |
|---|---|---|
| Queue | Dedicated Free queue | Dedicated Premium queue |
| Worker deployment | Low concurrency | Dedicated higher concurrency |
| User allowance | `FREE_JOBS_PER_DAY` | `PREMIUM_JOBS_PER_HOUR` |
| Simultaneous jobs | `FREE_MAX_ACTIVE_JOBS` | `PREMIUM_MAX_ACTIVE_JOBS` |
| Extraction mode | Basic metadata/captions | Deep 0–10s hook context |
| Micro-Critic | Never invoked | MCP-backed invocation |
| Delivery | Polling | SSE, with polling fallback |
| Client-selected tier | Rejected/ignored | Rejected/ignored |

## Entitlement authority

In production, the API validates the Supabase bearer token and queries the active subscription. An active `premium` or `premium_monthly` subscription with a future `current_period_end` resolves to Premium; everything else resolves to Free.

`x-dev-user-id` and `x-dev-tier` exist only when `AUTH_MODE=development`. Configuration validation forbids development authentication in production.

## Enforcement layers

1. Authentication derives the user ID.
2. Subscription lookup derives the tier.
3. Admission control reserves the user's rate and active-job slot atomically in Redis.
4. Job payload receives a server-created tier snapshot.
5. The API chooses the tier-specific queue.
6. Dedicated workers can consume only their tier queue.
7. The pipeline exposes only tier-appropriate fields.
8. SSE rechecks the current entitlement and the original job tier.

## Failure behavior

- Queue-enqueue failure releases the admission reservation.
- Final completion or final failure releases the active-job slot.
- Worker crashes cannot hold a slot permanently; active reservations age out.
- Failed attempts are marked `retry-scheduled`; users do not receive a terminal failure until attempts are exhausted.
