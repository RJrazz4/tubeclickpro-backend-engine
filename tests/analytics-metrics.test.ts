import { describe, expect, it } from 'vitest';
import {
  CHANNEL_DAILY_METRICS,
  DIMENSIONS,
  METRICS,
  MetricValidationError,
  PHASE2_ADDITIONAL_METRICS,
  VIDEO_DAILY_METRICS,
  validateReportQuery,
} from '../src/youtube/metric-sets.js';

describe('metric registry integrity', () => {
  it('every recipe metric is registered and correctly scoped', () => {
    const names = new Set(METRICS.map((m) => m.name));
    for (const m of [...CHANNEL_DAILY_METRICS, ...VIDEO_DAILY_METRICS, ...PHASE2_ADDITIONAL_METRICS]) {
      expect(names.has(m), `unregistered recipe metric: ${m}`).toBe(true);
    }
  });

  it('documents the absence of thumbnail impressions and the hour dimension', () => {
    // The public Analytics API has neither — the registry must not invent them.
    expect(METRICS.some((m) => /^impressions(Ctr)?$/i.test(m.name))).toBe(false);
    expect(DIMENSIONS.some((d) => d.name === 'hour')).toBe(false);
  });
});

describe('validateReportQuery guard', () => {
  const channelDaily = {
    ids: 'channel==MINE',
    metrics: [...CHANNEL_DAILY_METRICS] as string[],
    dimensions: ['day'],
  };

  it('accepts every Phase-1 sync recipe', () => {
    expect(() => validateReportQuery(channelDaily)).not.toThrow();
    expect(() =>
      validateReportQuery({ ids: 'channel==MINE', metrics: [...VIDEO_DAILY_METRICS], dimensions: ['day', 'video'] }),
    ).not.toThrow();
    expect(() =>
      validateReportQuery({ ids: 'channel==MINE', metrics: ['views', 'estimatedMinutesWatched'], dimensions: ['day', 'country'] }),
    ).not.toThrow();
    expect(() =>
      validateReportQuery({ ids: 'channel==MINE', metrics: ['views', 'estimatedMinutesWatched'], dimensions: ['day', 'ageGroup', 'gender'] }),
    ).not.toThrow();
    expect(() =>
      validateReportQuery({ ids: 'channel==MINE', metrics: ['views', 'estimatedMinutesWatched'], dimensions: ['day', 'insightTrafficSourceType'] }),
    ).not.toThrow();
    expect(() =>
      validateReportQuery({ ids: 'channel==MINE', metrics: ['views', 'estimatedMinutesWatched'], dimensions: ['day', 'device', 'operatingSystem'] }),
    ).not.toThrow();
    expect(() =>
      validateReportQuery({ ids: 'channel==MINE', metrics: ['views', 'estimatedMinutesWatched'], dimensions: ['day', 'subscriberStatus'] }),
    ).not.toThrow();
  });

  it('rejects unvalidated metrics before any quota is spent', () => {
    expect(() => validateReportQuery({ ids: 'channel==MINE', metrics: ['impressions'] })).toThrow(MetricValidationError);
    expect(() => validateReportQuery({ ids: 'channel==MINE', metrics: ['impressionsCtr'] })).toThrow(MetricValidationError);
  });

  it('rejects card metrics on channel-anchored reports (video-scope rule)', () => {
    expect(() =>
      validateReportQuery({ ids: 'channel==MINE', metrics: ['views', 'cardTeaserClickRate'] }),
    ).toThrow(/requires a video-anchored report/);
    expect(() =>
      validateReportQuery({ ids: 'video==abc', metrics: ['views', 'cardTeaserClickRate'], dimensions: ['day'] }),
    ).not.toThrow();
  });

  it('rejects demographics on video-anchored reports', () => {
    expect(() =>
      validateReportQuery({ ids: 'video==abc', metrics: ['views'], dimensions: ['ageGroup'] }),
    ).toThrow(/channel-report only/);
  });

  it('enforces province US-only constraint', () => {
    expect(() =>
      validateReportQuery({ ids: 'channel==MINE', metrics: ['views'], dimensions: ['province'] }),
    ).toThrow(/requires filter country==US/);
    expect(() =>
      validateReportQuery({
        ids: 'channel==MINE',
        metrics: ['views'],
        dimensions: ['province'],
        filters: 'country==US',
      }),
    ).not.toThrow();
  });

  it('rejects unknown dimensions and unknown ids anchors', () => {
    expect(() => validateReportQuery({ ids: 'channel==MINE', metrics: ['views'], dimensions: ['hour'] })).toThrow(
      /unvalidated dimension: hour/,
    );
    expect(() => validateReportQuery({ ids: 'user==123', metrics: ['views'] })).toThrow(/unsupported ids/);
  });
});
