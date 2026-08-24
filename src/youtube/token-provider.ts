import type { Redis } from 'ioredis';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from '../config/env.js';
import { redisKey } from '../infrastructure/redis.js';
import { logger } from '../observability/logger.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import { refreshAccessToken } from './oauth-client.js';

/**
 * Hot access-token provider.
 *   1. Redis cache (55-min TTL) — the DB is never touched on the hot path.
 *   2. On miss: decrypt refresh token from the vault, refresh, cache.
 *   3. If Google returns a NEW refresh token (rotation), re-encrypt + persist.
 *   4. invalid_grant => connection marked 'revoked', typed error raised; the
 *      caller must cancel queued jobs and surface a re-connect card — never
 *      a crash loop.
 */

export class ConnectionRevokedError extends Error {
  constructor(readonly userId: string) {
    super('YouTube connection revoked or expired — user must re-connect');
    this.name = 'ConnectionRevokedError';
  }
}

const ACCESS_TTL_SECONDS = 55 * 60; // Google tokens live 60 min; renew early.

export interface VaultRow {
  user_id: string;
  status: string;
  refresh_enc: Uint8Array | ArrayBuffer; // bytea
}

export class TokenProvider {
  constructor(
    private readonly redis: Redis,
    private readonly sb: SupabaseClient,
  ) {}

  private cacheKey(userId: string): string {
    return redisKey('yt', 'tok', userId);
  }

  async getAccessToken(userId: string): Promise<string> {
    const cached = await this.redis.get(this.cacheKey(userId));
    if (cached) return cached;

    const { data, error } = await this.sb
      .from('youtube_connections')
      .select('user_id, status, refresh_enc')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) throw new ConnectionRevokedError(userId);
    if ((data as VaultRow).status !== 'active') throw new ConnectionRevokedError(userId);

    const config = getConfig();
    const refreshToken = decryptSecret(Buffer.from((data as VaultRow).refresh_enc as Uint8Array), config.YOUTUBE_TOKEN_MASTER_KEY);

    const refreshed = await refreshAccessToken({
      clientId: config.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET,
      refreshToken,
    });

    // Google occasionally rotates refresh tokens — persist when it does.
    if (refreshed.refresh_token && refreshed.refresh_token !== refreshToken) {
      await this.sb
        .from('youtube_connections')
        .update({
          refresh_enc: encryptSecret(refreshed.refresh_token, config.YOUTUBE_TOKEN_MASTER_KEY),
          refresh_rotated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
      logger.info({ userId }, 'refresh token rotated');
    }

    await this.redis.set(this.cacheKey(userId), refreshed.access_token, 'EX', ACCESS_TTL_SECONDS);
    return refreshed.access_token;
  }

  /** On revoke/disconnect: drop cache and mark the vault row. */
  async invalidate(userId: string, status: 'revoked' | 'expired' | 'error' = 'revoked'): Promise<void> {
    await this.redis.del(this.cacheKey(userId));
    await this.sb
      .from('youtube_connections')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
  }

  dropCache(userId: string): Promise<number> {
    return this.redis.del(this.cacheKey(userId));
  }
}
