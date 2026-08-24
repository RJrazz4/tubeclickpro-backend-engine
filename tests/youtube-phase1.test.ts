import { describe, expect, it } from 'vitest';
import { BACKGROUND_SHED_THRESHOLD, decideQuota } from '../src/youtube/quota-core.js';
import { backfillWindows, chunk, dailyRefreshWindow, lastFinalDate, remainingWindows } from '../src/youtube/sync-core.js';

describe('quota decision core (10k-user shedding rules)', () => {
  const base = { userUsed: 0, userBudget: 1500 };

  it('allows normal user-triggered work inside budget', () => {
    expect(
      decideQuota({ ...base, platformUsed: 5000, platformBudget: 9000, priority: 1 }),
    ).toEqual({ allowed: true });
  });

  it('blocks everything at the platform budget', () => {
    for (const priority of [1, 2, 3] as const) {
      expect(
        decideQuota({ ...base, platformUsed: 9000, platformBudget: 9000, priority }),
      ).toEqual({ allowed: false, reason: 'platform_budget' });
    }
  });

  it('sheds background (P3) work at 80% of budget — user work continues', () => {
    const used = Math.floor(9000 * BACKGROUND_SHED_THRESHOLD);
    expect(decideQuota({ ...base, platformUsed: used, platformBudget: 9000, priority: 3 })).toEqual({
      allowed: false,
      reason: 'background_shed',
    });
    expect(decideQuota({ ...base, platformUsed: used, platformBudget: 9000, priority: 1 })).toEqual({
      allowed: true,
    });
  });

  it('enforces per-user fairness below the platform cap', () => {
    expect(
      decideQuota({ platformUsed: 100, platformBudget: 9000, userUsed: 1500, userBudget: 1500, priority: 1 }),
    ).toEqual({ allowed: false, reason: 'user_fairness' });
  });
});

describe('backfill window math', () => {
  it('90 days / 28-day chunks => 4 windows (28+28+28+6), oldest first, ending yesterday', () => {
    const now = new Date('2026-08-24T12:00:00Z');
    const windows = backfillWindows(now, 90, 28);
    expect(windows).toHaveLength(4);
    expect(windows[0]).toEqual({ start: '2026-05-26', end: '2026-06-22' });
    expect(windows[3]).toEqual({ start: '2026-08-18', end: '2026-08-23' });
    // contiguous, no gaps, no overlaps
    for (let i = 1; i < windows.length; i += 1) {
      const prevEnd = new Date(`${windows[i - 1].end}T00:00:00Z`);
      prevEnd.setUTCDate(prevEnd.getUTCDate() + 1);
      expect(prevEnd.toISOString().slice(0, 10)).toBe(windows[i].start);
    }
    expect(windows.at(-1)!.end).toBe(lastFinalDate(now)); // yesterday, never today
  });

  it('resumes: skips windows fully covered by completedThrough', () => {
    const windows = backfillWindows(new Date('2026-08-24T00:00:00Z'), 90, 28);
    expect(remainingWindows(windows, '2026-06-22')).toHaveLength(3);
    expect(remainingWindows(windows, null)).toHaveLength(4);
    expect(remainingWindows(windows, '2026-08-23')).toHaveLength(0);
  });

  it('daily refresh is a single-day window for yesterday', () => {
    expect(dailyRefreshWindow(new Date('2026-08-24T09:00:00Z'))).toEqual({
      start: '2026-08-23',
      end: '2026-08-23',
    });
  });

  it('chunks upsert batches to a max size', () => {
    expect(chunk(Array.from({ length: 901 }, (_, i) => i), 400)).toHaveLength(3);
    expect(chunk([], 400)).toEqual([]);
  });
});
