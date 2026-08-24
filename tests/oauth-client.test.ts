import { describe, expect, it } from 'vitest';
import {
  buildAuthUrl,
  generatePkce,
  grantedScopes,
  hasRequiredScopes,
  exchangeCodeForTokens,
  refreshAccessToken,
  GoogleOAuthError,
} from '../src/youtube/oauth-client.js';

describe('oauth auth url', () => {
  it('requests ONLY the two read-only scopes (scope minimization)', () => {
    const { codeChallenge } = generatePkce();
    const url = new URL(
      buildAuthUrl({
        clientId: 'cid.apps.googleusercontent.com',
        redirectUri: 'https://engine.example.com/api/youtube/callback',
        state: 'state-123',
        codeChallenge,
      }),
    );
    expect(url.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.readonly',
    );
  });

  it('uses PKCE S256, offline access, and prompt=consent', () => {
    const { codeChallenge } = generatePkce();
    const url = new URL(
      buildAuthUrl({
        clientId: 'cid',
        redirectUri: 'https://e/api/youtube/callback',
        state: 's',
        codeChallenge,
      }),
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('include_granted_scopes')).toBe('false');
    expect(url.searchParams.get('state')).toBe('s');
  });

  it('generates a fresh verifier/challenge pair (S256 of the verifier)', async () => {
    const { codeVerifier, codeChallenge } = generatePkce();
    const { createHash } = await import('node:crypto');
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(createHash('sha256').update(codeVerifier).digest('base64url')).toBe(codeChallenge);
  });
});

describe('scope verification', () => {
  it('accepts exactly the required set or supersets', () => {
    const granted = grantedScopes(
      'https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.readonly openid',
    );
    expect(hasRequiredScopes(granted)).toBe(true);
  });

  it('rejects when analytics scope is missing', () => {
    expect(hasRequiredScopes(['https://www.googleapis.com/auth/youtube.readonly'])).toBe(false);
  });
});

describe('token endpoint error mapping (injected requester — no network)', () => {
  const base = {
    clientId: 'cid',
    clientSecret: 'sec',
  };

  it('maps 400 refresh to invalid_grant (user revoked)', async () => {
    await expect(
      refreshAccessToken({
        ...base,
        refreshToken: 'r',
        requester: async () => ({ status: 400, json: { error: 'invalid_grant' } }),
      }),
    ).rejects.toMatchObject({ kind: 'invalid_grant' });
  });

  it('parses a successful refresh without a rotated token', async () => {
    const r = await refreshAccessToken({
      ...base,
      refreshToken: 'r',
      requester: async () => ({
        status: 200,
        json: { access_token: 'at', expires_in: 3600, scope: 'x', token_type: 'Bearer' },
      }),
    });
    expect(r.refresh_token).toBeUndefined();
    expect(r.access_token).toBe('at');
  });

  it('surfaces exchange failures with the status code', async () => {
    await expect(
      exchangeCodeForTokens({
        ...base,
        redirectUri: 'https://e/cb',
        code: 'c',
        codeVerifier: 'v',
        requester: async () => ({ status: 500, json: {} }),
      }),
    ).rejects.toBeInstanceOf(GoogleOAuthError);
  });
});
