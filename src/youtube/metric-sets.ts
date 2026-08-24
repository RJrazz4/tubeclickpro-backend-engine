/**
 * VALIDATED Analytics API metric/dimension registry (T‑2A‑01).
 *
 * Source of truth: official docs (developers.google.com/youtube/analytics/
 * metrics + /dimensions), cross-checked 2026-08-24. Every fetchReport call is
 * guarded by validateReportQuery() at runtime — the engine can never send an
 * unvalidated combo, and a Google-side rename surfaces here first.
 *
 * ── Key findings baked into this registry ────────────────────────────────
 *  1. There is NO thumbnail `impressions` / `impressionsCtr` metric in the
 *     public Analytics API. Click appetite is therefore measured with:
 *       engagementRate = (likes + comments + shares) / views   (primary)
 *       cardTeaserClickRate / cardClickRate                    (video reports)
 *       hookRetention    = engagedViews / views                (0-Xs survival)
 *  2. `province` is US-ONLY (requires country==US filter). Non-US
 *     sub-national geography uses the `city` dimension (data since 2022-01-01).
 *  3. There is NO `hour` dimension. Prime-time signals come from Pulse
 *     velocity curves (public counters polled after publish), not Analytics.
 *  4. `audienceWatchRatio` + `engagedViews` are the retention/hook metrics
 *     (better than averageViewPercentage alone).
 */

// ---------------------------------------------------------------------------
// Metric registry
// ---------------------------------------------------------------------------
export type MetricScope = 'channel' | 'video';

export interface MetricDef {
  name: string;
  scope: MetricScope[];              // report anchors it may appear in
  core: boolean;
  note?: string;
}

export const METRICS: readonly MetricDef[] = [
  // views & watch time
  { name: 'views', scope: ['channel', 'video'], core: true },
  { name: 'estimatedMinutesWatched', scope: ['channel', 'video'], core: true },
  { name: 'averageViewDuration', scope: ['channel', 'video'], core: true },
  { name: 'averageViewPercentage', scope: ['channel', 'video'], core: true },
  { name: 'engagedViews', scope: ['channel', 'video'], core: true, note: 'views past the initial seconds — hook survival numerator' },
  { name: 'audienceWatchRatio', scope: ['video'], core: false, note: 'absolute watch ratio — retention strength per video' },
  // subscribers
  { name: 'subscribersGained', scope: ['channel', 'video'], core: true },
  { name: 'subscribersLost', scope: ['channel', 'video'], core: true },
  // engagement (ER proxy numerator components)
  { name: 'likes', scope: ['channel', 'video'], core: true },
  { name: 'dislikes', scope: ['channel', 'video'], core: true },
  { name: 'comments', scope: ['channel', 'video'], core: true },
  { name: 'shares', scope: ['channel', 'video'], core: true },
  { name: 'videosAddedToPlaylists', scope: ['channel', 'video'], core: false },
  // card click signals (video-anchored reports only)
  { name: 'cardImpressions', scope: ['video'], core: false },
  { name: 'cardClicks', scope: ['video'], core: false },
  { name: 'cardClickRate', scope: ['video'], core: false },
  { name: 'cardTeaserImpressions', scope: ['video'], core: false },
  { name: 'cardTeaserClicks', scope: ['video'], core: false },
  { name: 'cardTeaserClickRate', scope: ['video'], core: false },
  // NOT AVAILABLE (documented absence — do not add):
  //   impressions / impressionsCtr (thumbnail), hour dimension, realtime metrics
];

// ---------------------------------------------------------------------------
// Dimension registry
// ---------------------------------------------------------------------------
export interface DimensionDef {
  name: string;
  requiresFilter?: string;           // mandatory filters constraint
  channelReportOnly?: boolean;
  note?: string;
}

export const DIMENSIONS: readonly DimensionDef[] = [
  { name: 'day' },
  { name: 'month' },
  { name: 'video' },
  { name: 'country', note: 'ZZ = unknown country' },
  { name: 'city', note: 'sub-national geo for non-US (e.g. Indian cities); data since 2022-01-01' },
  { name: 'province', requiresFilter: 'country==US', note: 'US states ONLY' },
  { name: 'ageGroup', channelReportOnly: true, note: 'demographics are channel-level only' },
  { name: 'gender', channelReportOnly: true, note: 'demographics are channel-level only' },
  { name: 'insightTrafficSourceType' },
  { name: 'insightTrafficSourceDetail', note: 'requires filters incl. insightTrafficSourceType==YT_SEARCH' },
  { name: 'insightPlaybackLocationType' },
  { name: 'device' },
  { name: 'operatingSystem' },
  { name: 'subscriberStatus' },
  { name: 'liveOrOnDemand' },
  { name: 'isLive' },
];

// ---------------------------------------------------------------------------
// Canonical report recipes used by the sync engine (single source of truth —
// sync-service imports these; the strings must never drift).
// ---------------------------------------------------------------------------
// Phase-1 recipes — these match the CURRENT table columns exactly. The
// Phase-2 upgrade (migration 202608250001) extends ingestion with the
// validated metrics in PHASE2_ADDITIONAL_METRICS below.
export const CHANNEL_DAILY_METRICS = [
  'views',
  'estimatedMinutesWatched',
  'averageViewDuration',
  'averageViewPercentage',
  'subscribersGained',
  'subscribersLost',
  'likes',
  'comments',
  'shares',
] as const;

export const VIDEO_DAILY_METRICS = [
  'views',
  'estimatedMinutesWatched',
  'averageViewDuration',
  'averageViewPercentage',
  'likes',
  'comments',
  'shares',
] as const;

/** Validated and ready for the T‑2A‑02 ingestion upgrade. */
export const PHASE2_ADDITIONAL_METRICS = [
  'engagedViews',
  'audienceWatchRatio',
  'cardTeaserImpressions',
  'cardTeaserClickRate',
  'cardClickRate',
] as const;

// ---------------------------------------------------------------------------
// Validation guard — called by YouTubeAnalyticsClient.fetchReport BEFORE the
// quota ledger spends anything. Fail fast, fail loud, spend nothing.
// ---------------------------------------------------------------------------
export class MetricValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetricValidationError';
  }
}

const metricIndex = new Map(METRICS.map((m) => [m.name, m]));
const dimensionIndex = new Map(DIMENSIONS.map((d) => [d.name, d]));

export interface ReportQueryLike {
  ids: string;          // 'channel==MINE' | 'video==ID'
  metrics: string[];
  dimensions?: string[];
  filters?: string;
}

export function validateReportQuery(q: ReportQueryLike): void {
  if (!q.ids.startsWith('channel==') && !q.ids.startsWith('video==')) {
    throw new MetricValidationError(`unsupported ids anchor: ${q.ids}`);
  }
  const videoAnchored = q.ids.startsWith('video==');

  for (const m of q.metrics) {
    const def = metricIndex.get(m);
    if (!def) throw new MetricValidationError(`unvalidated metric: ${m}`);
    if (def.scope.includes('video') && !def.scope.includes('channel') && !videoAnchored) {
      throw new MetricValidationError(`metric ${m} requires a video-anchored report`);
    }
  }

  for (const d of q.dimensions ?? []) {
    const def = dimensionIndex.get(d);
    if (!def) throw new MetricValidationError(`unvalidated dimension: ${d}`);
    if (def.channelReportOnly && videoAnchored) {
      throw new MetricValidationError(`dimension ${d} is channel-report only`);
    }
    if (def.requiresFilter && !(q.filters ?? '').includes(def.requiresFilter.split('==')[0] + '==')) {
      throw new MetricValidationError(`dimension ${d} requires filter ${def.requiresFilter}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Derived formulas the Audience Engine computes from ingested rows (2A):
// documented here so DB code and docs can never disagree.
// ---------------------------------------------------------------------------
export const DERIVED = {
  engagementRate: '(likes + comments + shares) / views',
  hookRetention: 'engagedViews / views',
  clickAppetite: 'engagementRate primary; cardTeaserClickRate secondary (video)',
  primeTimeSource: 'Pulse velocity curves (public counter polls post-publish) — Analytics has no hour dimension',
} as const;
