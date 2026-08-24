import type { Redis } from 'ioredis';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from '../config/env.js';
import { redisKey } from '../infrastructure/redis.js';
import { logger } from '../observability/logger.js';
import { decideQuota, type QuotaApi, type QuotaSpendRequest } from './quota-core.js';

/**
 * Redis-first quota ledger (the 10k-user mandate).
 *
 * Why Redis: at 10,000 concurrent users the gate must cost O(1) network hops
 * with no row locks — a Postgres CHECK on every YouTube call would serialize
 * the whole platform on one row. Redis INCR is atomic; overspend is bounded
 * by concurrent in-flight requests (single units) and self-corrects because
 * denied spends are rolled back.
 *
 * Durability: every allowed spend is pushed to a Redis stream/list and
 * flushed in batches into `youtube_quota_ledger` (auditable projection) by
 * the worker's ledger-flush job. Losing the last <30s of ledger rows in a
 * Redis crash is acceptable — budgets recover from Redis keyspace rebuild
 * off the DB projection on boot (see rebuildFromDb).
 */
export class QuotaLedger {
  constructor(
    private readonly redis: Redis,
    private readonly budgets: {
      data: number;
      analytics: number;
      userDaily: number;
    },
  ) {}

  private platformKey(api: QuotaApi, day: string): string {
    return redisKey('quota', api, day);
  }

  private userKey(userId: string, day: string): string {
    return redisKey('quota', 'user', userId, day);
  }

  private static today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Atomically reserve `units`. Returns null when denied (with reason).
   * Rollback on denial keeps counters exact under concurrency.
   */
  async trySpend(req: QuotaSpendRequest): Promise<{ ok: true } | { ok: false; reason: string }> {
    const day = QuotaLedger.today();
    const platformKey = this.platformKey(req.api, day);
    const userKey = req.userId ? this.userKey(req.userId, day) : null;

    const platformUsed = await this.redis.incrby(platformKey, req.units);
    let userUsed = 0;
    if (userKey) userUsed = await this.redis.incrby(userKey, req.units);

    const decision = decideQuota({
      platformUsed,
      platformBudget: this.budgets[req.api],
      userUsed,
      userBudget: this.budgets.userDaily,
      priority: req.priority,
    });

    if (decision.allowed) {
      // Expire at 2 days so stale day-buckets vanish naturally.
      void this.redis.expire(platformKey, 172_800).catch(() => undefined);
      if (userKey) void this.redis.expire(userKey, 172_800).catch(() => undefined);
      await this.recordForFlush(req, day);
      return { ok: true };
    }

    // Deny: give the units back.
    void this.redis.incrby(platformKey, -req.units).catch(() => undefined);
    if (userKey) void this.redis.incrby(userKey, -req.units).catch(() => undefined);
    logger.warn({ api: req.api, reason: decision.reason, priority: req.priority, userId: req.userId ?? null }, 'quota denied');
    return { ok: false, reason: decision.reason };
  }

  private async recordForFlush(req: QuotaSpendRequest, day: string): Promise<void> {
    const entry = JSON.stringify({
      day,
      api: req.api,
      user_id: req.userId ?? null,
      units: req.units,
      priority: req.priority,
      endpoint: req.endpoint ?? '',
      created_at: new Date().toISOString(),
    });
    await this.redis.rpush(redisKey('quota', 'flush'), entry);
  }

  /** Drain up to `max` buffered spends (worker ledger-flush job). */
  async drainForFlush(max = 500): Promise<Array<Record<string, unknown>>> {
    const out: Array<Record<string, unknown>> = [];
    for (let i = 0; i < max; i += 1) {
      const raw = await this.redis.lpop(redisKey('quota', 'flush'));
      if (!raw) break;
      try {
        out.push(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        // Corrupt entry — drop it; the ledger is an projection, not truth.
      }
    }
    return out;
  }

  /** Batch-insert drained rows. Called by the worker with the admin client. */
  static async flushToDb(sb: SupabaseClient, rows: Array<Record<string, unknown>>): Promise<number> {
    if (rows.length === 0) return 0;
    const { error } = await sb.from('youtube_quota_ledger').insert(rows);
    if (error) {
      logger.error({ error: error.message }, 'quota ledger flush failed');
      return 0;
    }
    return rows.length;
  }

  /** Boot-time rebuild: re-seed today's Redis counters from the DB ledger. */
  async rebuildFromDb(sb: SupabaseClient): Promise<void> {
    const day = QuotaLedger.today();
    for (const api of ['data', 'analytics'] as const) {
      const { data } = await sb
        .from('youtube_quota_ledger')
        .select('units')
        .eq('day', day)
        .eq('api', api);
      const total = (data ?? []).reduce((sum, r) => sum + (r.units as number), 0);
      if (total > 0) await this.redis.incrby(this.platformKey(api, day), total);
    }
    logger.info({ day }, 'quota counters rebuilt from db');
  }
}

export function createQuotaLedger(redis: Redis): QuotaLedger {
  const config = getConfig();
  return new QuotaLedger(redis, {
    data: config.YOUTUBE_DATA_API_DAILY_UNITS,
    analytics: config.YOUTUBE_ANALYTICS_DAILY_CALLS,
    userDaily: config.YOUTUBE_USER_DAILY_UNITS,
  });
}

export function createSupabaseAdmin(): SupabaseClient {
  const config = getConfig();
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
