import type { Redis } from 'ioredis';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from '../config/env.js';
import { redisKey } from '../infrastructure/redis.js';
import { logger } from '../observability/logger.js';
import {
  backfillWindows,
  chunk,
  dailyRefreshWindow,
  remainingWindows,
  type DateWindow,
} from './sync-core.js';
import { rowsToObjects, YouTubeAnalyticsClient } from './analytics-client.js';
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
        metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments,shares'
          .split(','),
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
        impressions: 0, // filled by the impressions pass (Phase 2) — metric family validated at implementation
      })),
      ['user_id', 'stat_date'],
    );

    // 2. Video daily (top 200 per window by views).
    const videoDaily = rowsToObjects(
      await client.fetchReport(accessToken, {
        ids: 'channel==MINE',
        startDate: w.start,
        endDate: w.end,
        metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares'.split(','),
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
        impressions: 0,
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
