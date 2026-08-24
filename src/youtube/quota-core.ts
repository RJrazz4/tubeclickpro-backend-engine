/**
 * Quota decision core — PURE, no I/O. Unit-tested; the Redis ledger and the
 * DB flush projection both build on it.
 *
 * Priorities:
 *   1 = user-triggered (connect, on-demand sync)  — never shed first
 *   2 = scheduled syncs (daily refresh)
 *   3 = radar/background scans                     — shed at 80% of budget
 */
export type QuotaPriority = 1 | 2 | 3;

export interface QuotaSnapshot {
  platformUsed: number;
  platformBudget: number;
  userUsed: number;
  userBudget: number;
  priority: QuotaPriority;
}

export type QuotaDecision =
  | { allowed: true }
  | { allowed: false; reason: 'platform_budget' | 'user_fairness' | 'background_shed' };

/** Fraction of the platform budget at which background (P3) work is shed. */
export const BACKGROUND_SHED_THRESHOLD = 0.8;

export function decideQuota(snapshot: QuotaSnapshot): QuotaDecision {
  if (snapshot.platformUsed >= snapshot.platformBudget) {
    return { allowed: false, reason: 'platform_budget' };
  }
  if (
    snapshot.priority === 3 &&
    snapshot.platformUsed >= Math.floor(snapshot.platformBudget * BACKGROUND_SHED_THRESHOLD)
  ) {
    return { allowed: false, reason: 'background_shed' };
  }
  if (snapshot.userUsed >= snapshot.userBudget) {
    return { allowed: false, reason: 'user_fairness' };
  }
  return { allowed: true };
}

export type QuotaApi = 'data' | 'analytics';

export interface QuotaSpendRequest {
  api: QuotaApi;
  /** Units for the Data API (search.list=100, videos.list=1...); call count for Analytics. */
  units: number;
  priority: QuotaPriority;
  userId?: string | null;
  endpoint?: string;
}

export interface QuotaCheck extends QuotaSpendRequest {
  platformUsed: number;
  userUsed: number;
}
