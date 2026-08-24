import type { Redis } from 'ioredis';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from '../config/env.js';
import { redisKey } from '../infrastructure/redis.js';
import { logger } from '../observability/logger.js';
import {
  backfillWindows,
  chunk,
  dailyRefreshWindow,
  parseIso8601Duration,
  remainingWindows,
  type DateWindow,
} from './sync-core.js';
import {
  CHANNEL_DAILY_V2_METRICS,
  VIDEO_DAILY_V2_METRICS,
} from './metric-sets.js';
import { DATA_API_COSTS, rowsToObjects, YouTubeAnalyticsClient } from './analytics-client.js';
import { CHANNEL_DAILY_METRICS, VIDEO_DAILY_METRICS } from './metric-sets.js';
import { ConnectionRevokedError, type TokenProvider } from './token-provider.js';

/**
 * Module S ingestion engine. All writes are idempotent natural-key upserts,
 * so re-running any window at any time is always safe (10k-user mandate:
 * retries after deploys never duplicate rows).
 *
 * Per-user sync lock (Redis SETNX, 10-min TTL) guarantees one in-flight sync
 * per creator no matter how many workers are alive.
 */

const SYNC_LOCK_TTL_SECONDS = 600;
const CHANNEL_SENTINEL = '~channel';

export type SyncMode = 'full' | 'daily';

export interface SyncOutcome {
  userId: string;
  mode: SyncMode;
  windows: number;
  rowsUpserted: number;
  completedThrough: string;
}

export class SyncService {
  constructor(
    private readonly sb: SupabaseClient,
    private readonly redis: Redis,
    private readonly tokens: TokenProvider,
    private readonly analytics: YouTubeAnalyticsClient,
  ) {}

  private async acquireLock(userId: string): Promise<boolean> {
    const key = redisKey('yt', 'synclock', userId);
    const ok = await this.redis.set(key, '1', 'EX', SYNC_LOCK_TTL_SECONDS, 'NX');
    return ok === 'OK';
  }

  private releaseLock(userId: string): Promise<unknown> {
    return this.redis.del(redisKey('yt', 'synclock', userId));
  }

  async run(userId: string, mode: SyncMode): Promise<SyncOutcome> {
    if (!(await this.acquireLock(userId))) {
      throw new Error('sync_already_running');
    }
    try {
      const config = getConfig();
      const { data: state } = await this.sb
        .from('youtube_sync_state')
        .select('completed_through')
        .eq('user_id', userId)
        .maybeSingle();
      const completedThrough = (state as { completed_through?: string } | null)?.completed_through ?? null;

      const all =
        mode === 'full'
          ? backfillWindows(new Date(), config.YOUTUBE_BACKFILL_DAYS, config.YOUTUBE_SYNC_CHUNK_DAYS)
          : [dailyRefreshWindow(new Date())];
      const windows = mode === 'full' ? remainingWindows(all, completedThrough) : all;

      await this.sb
        .from('youtube_sync_state')
        .upsert(
          { user_id: userId, phase: mode === 'full' ? 'backfilling' : 'daily', updated_at: new Date().toISOString() },
          { onConflict: 'user_id' },
        );

      let rowsUpserted = 0;
      let lastCompleted = completedThrough ?? '';
      rowsUpserted += await this.syncCatalog(userId, mode);
      rowsUpserted += await this.syncCityGeo(userId);
      for (const w of windows) {
        rowsUpserted += await this.syncWindow(userId, w);
        lastCompleted = w.end;
        await this.sb
          .from('youtube_sync_state')
          .update({ completed_through: w.end, updated_at: new Date().toISOString() })
          .eq('user_id', userId);
      }

      await this.sb
        .from('youtube_connections')
        .update({ last_sync_at: new Date().toISOString(), sync_error: null, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
      await this.sb
        .from('youtube_sync_state')
        .update({ phase: 'idle', updated_at: new Date().toISOString() })
        .eq('user_id', userId);

      return { userId, mode, windows: windows.length, rowsUpserted, completedThrough: lastCompleted };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        await this.sb
          .from('youtube_sync_state')
          .update({ phase: 'error', last_error: message.slice(0, 500), updated_at: new Date().toISOString() })
          .eq('user_id', userId);
      } catch {
        // best-effort error bookkeeping
      }
      if (!(err instanceof ConnectionRevokedError)) {
        try {
          await this.sb
            .from('youtube_connections')
            .update({ sync_error: message.slice(0, 500), updated_at: new Date().toISOString() })
            .eq('user_id', userId);
        } catch {
          // best-effort error bookkeeping
        }
      }
      throw err;
    } finally {
      await this.releaseLock(userId).catch(() => undefined);
    }
  }

  /** Fetch every Phase-1 report for one window and upsert derived rows. */
  private async syncWindow(userId: string, w: DateWindow): Promise<number> {
    const accessToken = await this.tokens.getAccessToken(userId);
    const client = this.analytics;
    let upserted = 0;

    // 1. Channel daily (views, watch, subs, engagement, impressions).
    const channelDaily = rowsToObjects(
      await client.fetchReport(accessToken, {
        ids: 'channel==MINE',
        startDate: w.start,
        endDate: w.end,
        metrics: [...CHANNEL_DAILY_V2_METRICS],
        dimensions: ['day'],
        sort: 'day',
      }, { userId }),
    );
    upserted += await this.upsertRows(
      'yt_channel_daily',
      channelDaily.map((r) => ({
        user_id: userId,
        stat_date: String(r.day),
        views: Number(r.views ?? 0),
        estimated_minutes_watched: Number(r.estimatedMinutesWatched ?? 0),
        average_view_duration_seconds: Number(r.averageViewDuration ?? 0),
        average_view_percentage: Number(r.averageViewPercentage ?? 0),
        subscribers_gained: Number(r.subscribersGained ?? 0),
        subscribers_lost: Number(r.subscribersLost ?? 0),
        likes: Number(r.likes ?? 0),
        comments: Number(r.comments ?? 0),
        shares: Number(r.shares ?? 0),
        engaged_views: Number(r.engagedViews ?? 0),
      })),
      ['user_id', 'stat_date'],
    );

    // 2. Video daily (top 200 per window by views).
    const videoDaily = rowsToObjects(
      await client.fetchReport(accessToken, {
        ids: 'channel==MINE',
        startDate: w.start,
        endDate: w.end,
        metrics: [...VIDEO_DAILY_V2_METRICS],
        dimensions: ['day', 'video'],
        sort: '-views',
        maxResults: 200,
      }, { userId }),
    );
    upserted += await this.upsertRows(
      'yt_video_daily',
      videoDaily.map((r) => ({
        user_id: userId,
        video_id: String(r.video),
        stat_date: String(r.day),
        views: Number(r.views ?? 0),
        estimated_minutes_watched: Number(r.estimatedMinutesWatched ?? 0),
        average_view_duration_seconds: Number(r.averageViewDuration ?? 0),
        average_view_percentage: Number(r.averageViewPercentage ?? 0),
        likes: Number(r.likes ?? 0),
        comments: Number(r.comments ?? 0),
        shares: Number(r.shares ?? 0),
        engaged_views: Number(r.engagedViews ?? 0),
        audience_watch_ratio: Number(r.audienceWatchRatio ?? 0),
        card_teaser_impressions: Number(r.cardTeaserImpressions ?? 0),
        card_teaser_click_rate: Number(r.cardTeaserClickRate ?? 0),
      })),
      ['user_id', 'video_id', 'stat_date'],
    );

    // 3. Geography (channel level; video-level geo is a Phase-2 add).
    const geo = rowsToObjects(
      await client.fetchReport(accessToken, {
        ids: 'channel==MINE',
        startDate: w.start,
        endDate: w.end,
        metrics: ['views', 'estimatedMinutesWatched'],
        dimensions: ['day', 'country'],
      }, { userId }),
    );
    upserted += await this.upsertRows(
      'yt_audience_geo',
      geo.map((r) => ({
        user_id: userId,
        video_id: CHANNEL_SENTINEL,
        stat_date: String(r.day),
        country: String(r.country),
        province: '',
        views: Number(r.views ?? 0),
        estimated_minutes_watched: Number(r.estimatedMinutesWatched ?? 0),
      })),
      ['user_id', 'video_id', 'stat_date', 'country', 'province'],
    );

    // 4. Demographics (channel level only per API).
    const demo = rowsToObjects(
      await client.fetchReport(accessToken, {
        ids: 'channel==MINE',
        startDate: w.start,
        endDate: w.end,
        metrics: ['views', 'estimatedMinutesWatched'],
        dimensions: ['day', 'ageGroup', 'gender'],
      }, { userId }),
    );
    upserted += await this.upsertRows(
      'yt_audience_demo',
      demo.map((r) => ({
        user_id: userId,
        stat_date: String(r.day),
        age_group: String(r.ageGroup),
        gender: String(r.gender),
        views: Number(r.views ?? 0),
        estimated_minutes_watched: Number(r.estimatedMinutesWatched ?? 0),
      })),
      ['user_id', 'stat_date', 'age_group', 'gender'],
    );

    // 5. Traffic sources.
    const traffic = rowsToObjects(
      await client.fetchReport(accessToken, {
        ids: 'channel==MINE',
        startDate: w.start,
        endDate: w.end,
        metrics: ['views', 'estimatedMinutesWatched'],
        dimensions: ['day', 'insightTrafficSourceType'],
      }, { userId }),
    );
    upserted += await this.upsertRows(
      'yt_traffic_sources',
      traffic.map((r) => ({
        user_id: userId,
        video_id: CHANNEL_SENTINEL,
        stat_date: String(r.day),
        source: String(r.insightTrafficSourceType),
        views: Number(r.views ?? 0),
        estimated_minutes_watched: Number(r.estimatedMinutesWatched ?? 0),
      })),
      ['user_id', 'video_id', 'stat_date', 'source'],
    );

    // 6. Device/OS.
    const tech = rowsToObjects(
      await client.fetchReport(accessToken, {
        ids: 'channel==MINE',
        startDate: w.start,
        endDate: w.end,
        metrics: ['views', 'estimatedMinutesWatched'],
        dimensions: ['day', 'device', 'operatingSystem'],
      }, { userId }),
    );
    upserted += await this.upsertRows(
      'yt_audience_tech',
      tech.map((r) => ({
        user_id: userId,
        stat_date: String(r.day),
        device: String(r.device),
        operating_system: String(r.operatingSystem),
        views: Number(r.views ?? 0),
        estimated_minutes_watched: Number(r.estimatedMinutesWatched ?? 0),
      })),
      ['user_id', 'stat_date', 'device', 'operating_system'],
    );

    // 7. Subscriber status.
    const subs = rowsToObjects(
      await client.fetchReport(accessToken, {
        ids: 'channel==MINE',
        startDate: w.start,
        endDate: w.end,
        metrics: ['views', 'estimatedMinutesWatched'],
        dimensions: ['day', 'subscriberStatus'],
      }, { userId }),
    );
    upserted += await this.upsertRows(
      'yt_audience_subs',
      subs.map((r) => ({
        user_id: userId,
        stat_date: String(r.day),
        subscriber_status: String(r.subscriberStatus),
        views: Number(r.views ?? 0),
        estimated_minutes_watched: Number(r.estimatedMinutesWatched ?? 0),
      })),
      ['user_id', 'stat_date', 'subscriber_status'],
    );

    // 8. Raw audit JSON with the 30-day TTL (developer-policy compliance).
    await this.sb.from('yt_report_raw').insert({
      user_id: userId,
      report_key: 'window_sync',
      window_start: w.start,
      window_end: w.end,
      payload: { channelDaily, videoDaily: videoDaily.length, geo: geo.length, demo: demo.length, traffic: traffic.length, tech: tech.length, subs: subs.length },
      expires_at: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
    });

    logger.info({ userId, start: w.start, end: w.end, upserted }, 'sync window complete');
    return upserted;
  }

  /**
   * Video catalog (topics + durations). Refreshed on every full-sync and
   * when stale >7d on daily syncs. Cost: ~2 + pages, all quota-ledgered.
   */
  private async syncCatalog(userId: string, mode: SyncMode): Promise<number> {
    const { data: meta } = await this.sb
      .from('yt_videos')
      .select('refreshed_at')
      .eq('user_id', userId)
      .order('refreshed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastRefresh = (meta as { refreshed_at?: string } | null)?.refreshed_at;
    const stale = !lastRefresh || Date.now() - new Date(lastRefresh).getTime() > 7 * 86400 * 1000;
    if (mode === 'daily' && !stale) return 0;

    const accessToken = await this.tokens.getAccessToken(userId);
    const ch = (await this.analytics.dataApi(
      accessToken, 'channels',
      { part: 'contentDetails', mine: 'true' },
      DATA_API_COSTS.channels_list, { userId },
    )) as { items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }> };
    const uploadsId = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsId) return 0;

    const ids: string[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 6; page += 1) {
      const pi = (await this.analytics.dataApi(
        accessToken, 'playlistItems',
        { part: 'contentDetails', playlistId: uploadsId, maxResults: '50', ...(pageToken ? { pageToken } : {}) },
        DATA_API_COSTS.playlistitems_list, { userId },
      )) as { items?: Array<{ contentDetails?: { videoId?: string } }>; nextPageToken?: string };
      for (const it of pi.items ?? []) if (it.contentDetails?.videoId) ids.push(it.contentDetails.videoId);
      if (!pi.nextPageToken) break;
      pageToken = pi.nextPageToken;
    }

    const nowIso = new Date().toISOString();
    let count = 0;
    for (const batch of chunk(ids, 50)) {
      const vr = (await this.analytics.dataApi(
        accessToken, 'videos',
        { part: 'snippet,statistics,contentDetails', id: batch.join(','), maxResults: '50' },
        DATA_API_COSTS.videos_list, { userId },
      )) as {
        items?: Array<{
          id: string;
          snippet?: { title?: string; tags?: string[]; publishedAt?: string; defaultAudioLanguage?: string; defaultLanguage?: string };
          statistics?: { viewCount?: string };
          contentDetails?: { duration?: string };
        }>;
      };
      const rows = (vr.items ?? []).map((v) => ({
        user_id: userId,
        video_id: v.id,
        title: v.snippet?.title ?? '',
        tags: v.snippet?.tags ?? [],
        duration_seconds: parseIso8601Duration(v.contentDetails?.duration ?? ''),
        published_at: v.snippet?.publishedAt ?? null,
        lang: v.snippet?.defaultAudioLanguage ?? v.snippet?.defaultLanguage ?? '',
        views_lifetime: Number(v.statistics?.viewCount ?? 0),
        refreshed_at: nowIso,
      }));
      if (rows.length > 0) await this.upsertRows('yt_videos', rows, ['user_id', 'video_id']);
      count += rows.length;
    }
    logger.info({ userId, videos: count }, 'catalog synced');
    return count;
  }

  /** City-level geo (channel): city dimension carries no country pairing. */
  private async syncCityGeo(userId: string): Promise<number> {
    const accessToken = await this.tokens.getAccessToken(userId);
    const start = new Date(Date.now() - 28 * 86400 * 1000).toISOString().slice(0, 10);
    const end = new Date(Date.now() - 86400 * 1000).toISOString().slice(0, 10);
    const city = rowsToObjects(
      await this.analytics.fetchReport(accessToken, {
        ids: 'channel==MINE',
        startDate: start,
        endDate: end,
        metrics: ['views', 'estimatedMinutesWatched'],
        dimensions: ['day', 'city'],
      }, { userId }),
    );
    return this.upsertRows(
      'yt_audience_geo',
      city
        .filter((r) => String(r.city ?? '') !== '' && String(r.city ?? '') !== 'ZZ')
        .map((r) => ({
          user_id: userId,
          video_id: '~channel',
          stat_date: String(r.day),
          country: '',
          province: '',
          city: String(r.city),
          views: Number(r.views ?? 0),
          estimated_minutes_watched: Number(r.estimatedMinutesWatched ?? 0),
        })),
      ['user_id', 'video_id', 'stat_date', 'country', 'province', 'city'],
    );
  }

  private async upsertRows(
    table: string,
    rows: Array<Record<string, unknown>>,
    onConflict: string[],
  ): Promise<number> {
    if (rows.length === 0) return 0;
    let count = 0;
    for (const batch of chunk(rows, 400)) {
      const { error } = await this.sb.from(table).upsert(batch, {
        onConflict: onConflict.join(','),
        ignoreDuplicates: false,
      });
      if (error) {
        // 42P07/23505 style races are impossible on natural keys; any error
        // here is real and must fail the window for retry.
        throw new Error(`upsert_${table}_failed: ${error.message}`);
      }
      count += batch.length;
    }
    return count;
  }
}
