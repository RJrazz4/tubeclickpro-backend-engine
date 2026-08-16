import type { IncomingHttpHeaders } from 'node:http';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from '../config/env.js';
import { ForbiddenError, UnauthorizedError } from '../domain/errors.js';
import { tierSchema, type AuthenticatedUser } from '../domain/tier.js';

export interface AuthService {
  authenticate(headers: IncomingHttpHeaders): Promise<AuthenticatedUser>;
}

function bearerToken(headers: IncomingHttpHeaders): string {
  const authorization = headers.authorization;
  if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedError();
  const token = authorization.slice('Bearer '.length).trim();
  if (!token) throw new UnauthorizedError();
  return token;
}

export class SupabaseAuthService implements AuthService {
  private readonly authClient: SupabaseClient;
  private readonly adminClient: SupabaseClient;

  constructor() {
    const config = getConfig();
    this.authClient = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.adminClient = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async authenticate(headers: IncomingHttpHeaders): Promise<AuthenticatedUser> {
    const token = bearerToken(headers);
    const { data, error } = await this.authClient.auth.getUser(token);
    if (error || !data.user) throw new UnauthorizedError('Invalid or expired Supabase session');

    const config = getConfig();
    if (config.SUPABASE_TIER_SOURCE === 'rpc') {
      const { data: entitlement, error: entitlementError } = await this.adminClient.rpc(
        config.SUPABASE_TIER_RPC,
        { p_user_id: data.user.id },
      );
      if (entitlementError) {
        throw new ForbiddenError('Unable to verify subscription entitlement', 'ENTITLEMENT_LOOKUP_FAILED');
      }
      const tier =
        entitlement && typeof entitlement === 'object' && 'tier' in entitlement
          ? String(entitlement.tier)
          : 'free';
      return {
        id: data.user.id,
        tier: ['pro', 'premium', 'premium_monthly', 'enterprise'].includes(tier)
          ? 'premium'
          : 'free',
        entitlementExpiresAt: null,
      };
    }

    const { data: subscription, error: subscriptionError } = await this.adminClient
      .from(config.SUPABASE_SUBSCRIPTIONS_TABLE)
      .select('plan,status,current_period_end')
      .eq('user_id', data.user.id)
      .eq('status', 'active')
      .gt('current_period_end', new Date().toISOString())
      .maybeSingle();
    if (subscriptionError) {
      throw new ForbiddenError('Unable to verify subscription entitlement', 'ENTITLEMENT_LOOKUP_FAILED');
    }
    const premiumPlans = new Set(['premium', 'premium_monthly', 'pro', 'enterprise']);
    const premium = typeof subscription?.plan === 'string' && premiumPlans.has(subscription.plan);
    return {
      id: data.user.id,
      tier: premium ? 'premium' : 'free',
      entitlementExpiresAt:
        premium && typeof subscription.current_period_end === 'string'
          ? subscription.current_period_end
          : null,
    };
  }
}

export class DevelopmentAuthService implements AuthService {
  async authenticate(headers: IncomingHttpHeaders): Promise<AuthenticatedUser> {
    const config = getConfig();
    if (config.NODE_ENV === 'production') {
      throw new UnauthorizedError('Development authentication is disabled');
    }
    const rawUserId = headers['x-dev-user-id'];
    const rawTier = headers['x-dev-tier'];
    const userId = Array.isArray(rawUserId) ? rawUserId[0] : rawUserId;
    const tierValue = Array.isArray(rawTier) ? rawTier[0] : rawTier;
    if (!userId) throw new UnauthorizedError('x-dev-user-id is required in development mode');
    return {
      id: userId,
      tier: tierSchema.parse(tierValue ?? 'free'),
      entitlementExpiresAt: null,
    };
  }
}

export function createAuthService(): AuthService {
  return getConfig().AUTH_MODE === 'supabase'
    ? new SupabaseAuthService()
    : new DevelopmentAuthService();
}
