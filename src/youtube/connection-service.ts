import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from '../config/env.js';
import { redisKey } from '../infrastructure/redis.js';
import { logger } from '../observability/logger.js';
import { encryptSecret, decryptSecret } from './crypto.js';
import {
  buildAuthUrl,
  exchangeCodeForTokens,
  generatePkce,
  grantedScopes,
  hasRequiredScopes,
  revokeToken,
  GoogleOAuthError,
} from './oauth-client.js';
import { DATA_API_COSTS, type YouTubeAnalyticsClient } from './analytics-client.js';

/**
 * Module O orchestration: begin → consent → callback → vault → full-sync.
 * The "Connect YouTube" trust mandate lives at the routes layer (button copy
 * is frontend; consent-screen naming is Google Cloud setup).
 */

const STATE_TTL_MINUTES = 10;

export interface BeginConnectResult {
  authUrl: string;
}

export interface ConnectionStatus {
  connected: boolean;
  status?: 'active' | 'expired' | 'revoked' | 'error' | undefined;
  channelId?: string | undefined;
  channelTitle?: string | undefined;
  channelHandle?: string | undefined;
  lastSyncAt?: string | null | undefined;
  syncError?: string | null | undefined;
  scopesGranted?: string[] | undefined;
}

export class ConnectionService {
  constructor(
    private readonly sb: SupabaseClient,
    private readonly redis: Redis,
    private readonly analytics: YouTubeAnalyticsClient,
    private readonly onConnected: (userId: string) => Promise<void>,
  ) {}

  async beginConnect(userId: string, redirectTo = '/'): Promise<BeginConnectResult> {
    const config = getConfig();
    const state = randomUUID();
    const { codeVerifier, codeChallenge } = generatePkce();

    await this.sb.from('youtube_oauth_state').insert({
      state,
      user_id: userId,
      code_verifier: codeVerifier,
      redirect_to: redirectTo.slice(0, 200),
      expires_at: new Date(Date.now() + STATE_TTL_MINUTES * 60 * 1000).toISOString(),
    });

    const authUrl = buildAuthUrl({
      clientId: config.GOOGLE_OAUTH_CLIENT_ID,
      redirectUri: config.GOOGLE_OAUTH_REDIRECT_URL,
      state,
      codeChallenge,
    });
    return { authUrl };
  }

  /**
   * Complete the OAuth handshake. The state row IS the auth proof (Google
   * redirects carry no JWT) — single-use, 10-minute TTL, bound to the user.
   */
  async completeConnect(state: string, code: string): Promise<{ userId: string; redirectTo: string }> {
    const config = getConfig();

    // Single-use consume: delete returns the row only once.
    const { data: stateRow, error: stateErr } = await this.sb
      .from('youtube_oauth_state')
      .delete()
      .eq('state', state)
      .gt('expires_at', new Date().toISOString())
      .select('user_id, code_verifier, redirect_to')
      .maybeSingle();

    if (stateErr || !stateRow) {
      throw new GoogleOAuthError('oauth state invalid or expired', 'exchange_failed');
    }
    const userId = (stateRow as { user_id: string }).user_id;
    const codeVerifier = (stateRow as { code_verifier: string }).code_verifier;
    const redirectTo = (stateRow as { redirect_to: string }).redirect_to ?? '/';

    const tokens = await exchangeCodeForTokens({
      clientId: config.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri: config.GOOGLE_OAUTH_REDIRECT_URL,
      code,
      codeVerifier,
    });

    if (!tokens.refresh_token) {
      // prompt=consent should prevent this; if Google still withholds one,
      // we cannot maintain access — fail loudly and let the user retry.
      throw new GoogleOAuthError('Google did not return a refresh token', 'exchange_failed');
    }

    const granted = grantedScopes(tokens.scope);
    if (!hasRequiredScopes(granted)) {
      throw new GoogleOAuthError('required scopes not granted', 'exchange_failed');
    }

    // Verify the connected channel via the Data API (cost 1, priority 1).
    const channel = await this.analytics.dataApi(
      tokens.access_token,
      'channels',
      { part: 'snippet,statistics,contentDetails', mine: 'true' },
      DATA_API_COSTS.channels_list,
      { userId, priority: 1 },
    );
    const items = (channel.items ?? []) as Array<Record<string, unknown>>;
    const first = items[0] as { id: string; snippet?: { title?: string; customUrl?: string } } | undefined;
    if (!first?.id) {
      throw new GoogleOAuthError('no YouTube channel on this Google account', 'exchange_failed');
    }

    await this.sb.from('youtube_connections').upsert(
      {
        user_id: userId,
        channel_id: first.id,
        channel_title: first.snippet?.title ?? null,
        channel_handle: first.snippet?.customUrl ?? null,
        scopes_granted: granted,
        refresh_enc: encryptSecret(tokens.refresh_token, config.YOUTUBE_TOKEN_MASTER_KEY),
        status: 'active',
        sync_error: null,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    await this.sb.from('youtube_sync_state').upsert(
      { user_id: userId, phase: 'idle', windows_done: [], updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );

    logger.info({ userId, channelId: first.id }, 'youtube connected');

    // Fire the 90-day backfill (queue add is non-fatal if the queue is down).
    try {
      await this.onConnected(userId);
    } catch (err) {
      logger.warn({ userId, error: String(err) }, 'failed to enqueue initial sync');
    }
    return { userId, redirectTo };
  }

  async getStatus(userId: string): Promise<ConnectionStatus> {
    const { data } = await this.sb
      .from('youtube_connections')
      .select('channel_id, channel_title, channel_handle, status, last_sync_at, sync_error, scopes_granted')
      .eq('user_id', userId)
      .maybeSingle();
    if (!data) return { connected: false };
    const row = data as Record<string, unknown>;
    return {
      connected: true,
      status: row.status as ConnectionStatus['status'],
      channelId: row.channel_id as string,
      channelTitle: row.channel_title as string | undefined,
      channelHandle: row.channel_handle as string | undefined,
      lastSyncAt: (row.last_sync_at as string | null) ?? null,
      syncError: (row.sync_error as string | null) ?? null,
      scopesGranted: row.scopes_granted as string[],
    };
  }

  /** Revoke at Google, purge the vault row and hot caches. */
  async disconnect(userId: string): Promise<void> {
    const config = getConfig();
    const { data } = await this.sb
      .from('youtube_connections')
      .select('refresh_enc')
      .eq('user_id', userId)
      .maybeSingle();
    if (data) {
      try {
        const refresh = decryptSecret(
          Buffer.from((data as { refresh_enc: Uint8Array }).refresh_enc as Uint8Array),
          config.YOUTUBE_TOKEN_MASTER_KEY,
        );
        await revokeToken(refresh);
      } catch (err) {
        // Even if Google-side revoke fails, the local purge below removes all
        // access. Log and continue — disconnect must always succeed locally.
        logger.warn({ userId, error: String(err) }, 'google revoke failed during disconnect');
      }
    }
    await this.sb.from('youtube_connections').delete().eq('user_id', userId);
    try {
      await this.sb.from('youtube_sync_state').delete().eq('user_id', userId);
    } catch {
      // state row may not exist; disconnect must still succeed
    }
    await this.redis.del(redisKey('yt', 'tok', userId));
    logger.info({ userId }, 'youtube disconnected');
  }
}
