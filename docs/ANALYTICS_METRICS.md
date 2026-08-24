# Validated Analytics API Metrics & Dimensions (T‑2A‑01)

Source of truth for every Analytics call the engine makes. Validated against
the official reference on **2026-08-24**; re-validate on any Google API
revision. The runtime guard (`src/youtube/metric-sets.ts` →
`validateReportQuery`) refuses any combo not listed here — BEFORE the quota
ledger spends a single unit.

## The three findings that changed the design

| # | Finding | Consequence |
|---|---|---|
| 1 | **No thumbnail `impressions` / `impressionsCtr` metric exists** in the public API (Studio's CTR card is internal) | Click appetite = **engagement rate** `(likes+comments+shares)/views` (primary) + `cardTeaserClickRate`/`cardClickRate` (video reports) + **hook retention** `engagedViews/views` |
| 2 | **`province` is US-only** (requires `filters=country==US`) | Non-US sub-national geo (e.g. Indian cities) uses the **`city`** dimension (data since 2022-01-01) |
| 3 | **No `hour` dimension exists** | Prime-time heatmaps come from **Pulse velocity curves** (public counter polls in the 48h after publish), not Analytics. Day-of-week comes from `day` reports. |

## Validated metrics

| Metric | Scope | Notes |
|---|---|---|
| `views`, `estimatedMinutesWatched`, `averageViewDuration`, `averageViewPercentage` | channel + video | core |
| `engagedViews` | channel + video | core — views past the opening seconds; hook numerator |
| `audienceWatchRatio` | video | retention strength per video |
| `subscribersGained`, `subscribersLost` | channel + video | core |
| `likes`, `dislikes`, `comments`, `shares` | channel + video | core; ER numerator components |
| `videosAddedToPlaylists` | channel + video | |
| `cardImpressions`, `cardClicks`, `cardClickRate`, `cardTeaserImpressions`, `cardTeaserClicks`, `cardTeaserClickRate` | **video only** | click-behavior signal |

**Validated absence (never request):** `impressions`, `impressionsCtr`,
annotation metrics (deprecated era), any realtime metric.

## Validated dimensions

`day`, `month`, `video`, `country` (ZZ=unknown), `city` (2022+),
`province` (US-only + `country==US` filter), `ageGroup` + `gender`
(**channel reports only**), `insightTrafficSourceType`,
`insightTrafficSourceDetail` (needs a traffic-source filter),
`insightPlaybackLocationType`, `device`, `operatingSystem`,
`subscriberStatus`, `liveOrOnDemand`, `isLive`.

**Validated absence:** `hour` (and any minute-level granularity).

## Recipes in production (Phase 1)

- **channel daily:** views, estimatedMinutesWatched, averageViewDuration,
  averageViewPercentage, subscribersGained, subscribersLost, likes, comments,
  shares × `dimensions=day`
- **video daily:** views, estimatedMinutesWatched, averageViewDuration,
  averageViewPercentage, likes, comments, shares × `dimensions=day,video`
  (top 200 / window)
- geo (country), demo (ageGroup×gender), traffic, device+OS, subscriberStatus

## Ready for the T‑2A‑02 upgrade

`engagedViews`, `audienceWatchRatio`, `cardTeaserImpressions`,
`cardTeaserClickRate`, `cardClickRate` + `city` geo report — all validated in
`PHASE2_ADDITIONAL_METRICS`, awaiting the `202608250001` migration columns.

## Live probe (run once against the live engine after first connect)

`GET /api/youtube/connection` → active, then trigger a sync and watch the
engine logs for `analytics_http_*` — any 400 from Google surfaces here as a
`MetricValidationError` first because the guard runs before the call.
