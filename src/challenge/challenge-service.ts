import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { logger } from '../observability/logger.js';
import {
  buildCalendar,
  dropTopic,
  isValidTimezone,
  localDateIn,
  dropAvailableAtIso,
  milestonesFor,
  type ChallengeRpcState,
} from './challenge-core.js';

/**
 * Module G service. All writes service-role; streak truth lives in the
 * challenge_state RPC. recordDay() is called by the synthesis and publish
 * flows — generating the Daily Action Script IS the check-in.
 */
export class ChallengeService {
  constructor(private readonly sb: SupabaseClient) {}

  async enroll(userId: string, timezone: string): Promise<Record<string, unknown>> {
    if (!isValidTimezone(timezone)) {
      throw new Error('invalid_timezone');
    }
    const { data: existing } = await this.sb
      .from('challenge_enrollments')
      .select('status')
      .eq('user_id', userId)
      .maybeSingle();
    const status = (existing as { status?: string } | null)?.status;
    if (status === 'active') {
      throw new Error('already_enrolled');
    }
    // (Re-)enroll: completed/abandoned runs keep their calendar history; the
    // new run starts a fresh 30-day window from today (local).
    const todayLocal = localDateIn(timezone);
    const { error } = await this.sb.from('challenge_enrollments').upsert(
      {
        user_id: userId,
        timezone,
        start_date: todayLocal,
        status: 'active',
        best_streak: 0,
        completed_at: null,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (error) throw new Error(`enroll_failed: ${error.message}`);
    logger.info({ userId, timezone }, 'challenge enrolled');
    return this.getState(userId);
  }

  async abandon(userId: string): Promise<void> {
    await this.sb
      .from('challenge_enrollments')
      .update({ status: 'abandoned', updated_at: new Date().toISOString() })
      .eq('user_id', userId);
  }

  async getState(userId: string): Promise<Record<string, unknown>> {
    const { data: enrollment } = await this.sb
      .from('challenge_enrollments')
      .select('timezone')
      .eq('user_id', userId)
      .maybeSingle();
    const tz = (enrollment as { timezone?: string } | null)?.timezone;
    if (!tz) return { status: 'not_enrolled' };

    const todayLocal = localDateIn(tz);
    const { data, error } = await this.sb.rpc('challenge_state', {
      p_user_id: userId,
      p_today_local: todayLocal,
    });
    if (error || !data) throw new Error(`challenge_state_failed: ${error?.message}`);
    const state = (Array.isArray(data) ? data[0] : data) as ChallengeRpcState;

    // Daily drop: rotate hunger topics deterministically; only when today's
    // script hasn't been claimed.
    const { data: hungerRows } = await this.sb
      .from('audience_hungers')
      .select('topic')
      .eq('user_id', userId)
      .order('rank', { ascending: true })
      .limit(5);
    const hungers = (hungerRows ?? []) as Array<{ topic: string }>;
    const todayDone = state.calendar.some((c) => c.date === todayLocal && c.action === 'script');
    const drop = dropTopic(hungers, Math.max(1, state.elapsed_days));

    return {
      ...state,
      challenge_length_days: 30,
      today: {
        local_date: todayLocal,
        done: todayDone,
        drop_available_at: dropAvailableAtIso(tz, todayLocal),
        drop_topic: todayDone ? null : drop?.topic ?? null,
      },
      milestones: milestonesFor(state.total_script_days),
      cells: buildCalendar(state),
    };
  }

  /**
   * Record a day-credit. action 'script' = the check-in; 'publish' = the
   * star. No-op when not enrolled. Caller passes the user's timezone-derived
   * local date implicitly via the enrollment (recomputed here, never trusted).
   */
  async recordDay(userId: string, action: 'script' | 'publish', scriptPackageId?: string): Promise<void> {
    const { data: enrollment } = await this.sb
      .from('challenge_enrollments')
      .select('timezone, status')
      .eq('user_id', userId)
      .maybeSingle();
    const row = enrollment as { timezone?: string; status?: string } | null;
    if (!row?.timezone || row.status !== 'active') return;

    const localDate = localDateIn(row.timezone);
    const { error } = await this.sb.from('challenge_days').upsert(
      {
        user_id: userId,
        local_date: localDate,
        action,
        ...(scriptPackageId ? { script_package_id: scriptPackageId } : {}),
      },
      { onConflict: 'user_id,local_date,action' },
    );
    if (error) {
      logger.warn({ userId, action, error: error.message }, 'challenge day record failed');
      return;
    }
    logger.info({ userId, action, localDate }, 'challenge day recorded');

    // Milestone/completion events into the outbox (Phase 3B Telegram consumer).
    void this.emitMilestones(userId).catch(() => undefined);
  }

  private async emitMilestones(userId: string): Promise<void> {
    const { data } = await this.sb
      .from('challenge_enrollments')
      .select('timezone')
      .eq('user_id', userId)
      .maybeSingle();
    const tz = (data as { timezone?: string } | null)?.timezone;
    if (!tz) return;
    const { data: raw } = await this.sb.rpc('challenge_state', {
      p_user_id: userId,
      p_today_local: localDateIn(tz),
    });
    const state = (Array.isArray(raw) ? raw[0] : raw) as ChallengeRpcState;
    for (const m of milestonesFor(state.total_script_days)) {
      if (m.achieved) {
        await this.sb.from('billing_outbox').insert({
          id: randomUUID(),
          event_type: 'challenge.milestone',
          aggregate_id: userId,
          payload: { milestone: m.id, day: m.day, streak: state.streak },
          status: 'pending',
        });
      }
    }
  }
}
