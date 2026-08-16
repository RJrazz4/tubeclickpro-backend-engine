import { z } from 'zod';

export const tierSchema = z.enum(['free', 'premium']);
export type UserTier = z.infer<typeof tierSchema>;

export interface AuthenticatedUser {
  id: string;
  tier: UserTier;
  entitlementExpiresAt: string | null;
}

export const TIER_POLICY = {
  free: {
    delivery: 'polling',
    queueClass: 'conveyor',
    deepHookAnalysis: false,
    microCritic: false,
  },
  premium: {
    delivery: 'sse',
    queueClass: 'vip',
    deepHookAnalysis: true,
    microCritic: true,
  },
} as const satisfies Record<UserTier, Record<string, unknown>>;
