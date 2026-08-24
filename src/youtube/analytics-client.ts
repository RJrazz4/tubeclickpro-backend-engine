import { z } from 'zod';
import { getConfig } from '../config/env.js';
import { logger } from '../observability/logger.js';
import type { QuotaLedger } from './quota-ledger.js';
import type { QuotaPriority } from './quota-core.js';

/**
 * Thin clients for the official YouTube APIs (OAuth path ONLY — the scraper
 * path never uses these credentials).
 *
 *   Analytics API: https://youtubeanalytics.googleapis.com/v2/reports
 *   Data API v3:   https://www.googleapis.com/youtube/v3/...
 *
 * Every call goes through the quota ledger BEFORE the network. Costs follow
 * Google's published quota model (search.list = 100, everything else = 1).
 */

const analyticsRowSchema = z.object({ columnHeaders: z.array(z.object({ name: z.string(), columnType: z.string(), dataType: z.string() })).optional() }).passthrough();

export interface ReportQuery {
  /** e.g. 'channel==MINE' or 'video==VIDEO_ID' */
  ids: string;
  startDate: string;
  endDate: string;
  metrics: string[];
  dimensions?: string[];
  filters?: string;
  sort?: string;
  maxResults?: number;
}

export interface ReportResult {
  columnHeaders: Array<{ name: string; columnType: string; dataType: string }>;
  rows: Array<Array<string | number>>;
}

export class QuotaExhaustedError extends Error {
  constructor(readonly reason: string) {
    super(`YouTube API quota exhausted: ${reason}`);
    this.name = 'QuotaExhaustedError';
  }
}

export const DATA_API_COSTS = {
  channels_list: 1,
  playlistitems_list: 1,
  videos_list: 1,
  search_list: 100,
} as const;

export class YouTubeAnalyticsClient {
  constructor(private readonly ledger: QuotaLedger) {}

  async fetchReport(
    accessToken: string,
    query: ReportQuery,
    opts: { userId: string; priority?: QuotaPriority },
  ): Promise<ReportResult> {
    // Analytics API quota is call-count based; reserve 1 up front.
    const spend = await this.ledger.trySpend({
      api: 'analytics',
      units: 1,
      priority: opts.priority ?? 2,
      userId: opts.userId,
      endpoint: 'analytics.reports',
    });
    if (!spend.ok) throw new QuotaExhaustedError(spend.reason);

    const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
    url.searchParams.set('ids', query.ids);
    url.searchParams.set('start-date', query.startDate);
    url.searchParams.set('end-date', query.endDate);
    url.searchParams.set('metrics', query.metrics.join(','));
    if (query.dimensions?.length) url.searchParams.set('dimensions', query.dimensions.join(','));
    if (query.filters) url.searchParams.set('filters', query.filters);
    if (query.sort) url.searchParams.set('sort', query.sort);
    if (query.maxResults) url.searchParams.set('maxResults', String(query.maxResults));

    const res = await this.fetchWithTimeout(url, accessToken);
    if (res.status === 401) throw new Error('analytics_unauthorized');
    if (res.status === 403) throw new QuotaExhaustedError('analytics_403_forbidden');
    if (res.status !== 200) {
      throw new Error(`analytics_http_${res.status}: ${JSON.stringify(res.json).slice(0, 200)}`);
    }
    const parsed = analyticsRowSchema.parse(res.json);
    return {
      columnHeaders: (parsed.columnHeaders ?? []) as ReportResult['columnHeaders'],
      rows: (Array.isArray((parsed as Record<string, unknown>).rows) ? (parsed as Record<string, unknown>).rows : []) as ReportResult['rows'],
    };
  }

  /** Data API v3 — cost-aware generic GET. */
  async dataApi(
    accessToken: string,
    path: string,
    params: Record<string, string>,
    cost: number,
    opts: { userId: string; priority?: QuotaPriority },
  ): Promise<Record<string, unknown>> {
    const spend = await this.ledger.trySpend({
      api: 'data',
      units: cost,
      priority: opts.priority ?? 2,
      userId: opts.userId,
      endpoint: `data.${path}`,
    });
    if (!spend.ok) throw new QuotaExhaustedError(spend.reason);

    const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await this.fetchWithTimeout(url, accessToken);
    if (res.status === 401) throw new Error('data_api_unauthorized');
    if (res.status === 403) throw new QuotaExhaustedError('data_api_403_forbidden_or_quota');
    if (res.status !== 200) {
      throw new Error(`data_api_http_${res.status}: ${JSON.stringify(res.json).slice(0, 200)}`);
    }
    return res.json as Record<string, unknown>;
  }

  private async fetchWithTimeout(
    url: URL,
    accessToken: string,
  ): Promise<{ status: number; json: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), getConfig().YOUTUBE_API_TIMEOUT_MS ?? 10_000);
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
      const json = await res.json().catch(() => ({}));
      return { status: res.status, json };
    } catch (err) {
      logger.warn({ host: url.host, error: String(err) }, 'youtube api network error');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Turn Analytics rows into keyed objects using columnHeaders. */
export function rowsToObjects(report: ReportResult): Array<Record<string, string | number>> {
  return report.rows.map((row) => {
    const obj: Record<string, string | number> = {};
    report.columnHeaders.forEach((h, i) => {
      obj[h.name] = row[i] ?? 0;
    });
    return obj;
  });
}
