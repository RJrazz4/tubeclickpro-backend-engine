import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

/**
 * Hand-rolled Google OAuth 2.0 client (authorization-code + PKCE).
 * Deliberately no SDK: the entire surface is three endpoints, and keeping it
 * in-repo keeps the security audit small.
 *
 * Scope MINIMIZATION is a product decision (faster verification, calmer
 * creators): read-only analytics + read-only YouTube. No upload, no manage.
 */

export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/youtube.readonly',
] as const;

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

export const REQUIRED_SCOPES: readonly string[] = YOUTUBE_SCOPES;

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

export function generatePkce(): PkcePair {
  const codeVerifier = randomBytes(48).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export interface AuthUrlInput {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  /** prompt=consent guarantees a refresh_token on first connect. */
  prompt?: 'consent' | 'select_account';
  loginHint?: string;
}

export function buildAuthUrl(input: AuthUrlInput): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', YOUTUBE_SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline'); // refresh token
  url.searchParams.set('include_granted_scopes', 'false');
  url.searchParams.set('prompt', input.prompt ?? 'consent');
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (input.loginHint) url.searchParams.set('login_hint', input.loginHint);
  return url.toString();
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().min(1),
  token_type: z.literal('Bearer'),
});

export type GoogleTokenResponse = z.infer<typeof tokenResponseSchema>;

export class GoogleOAuthError extends Error {
  constructor(
    message: string,
    readonly kind: 'invalid_grant' | 'exchange_failed' | 'revoke_failed' | 'network',
  ) {
    super(message);
    this.name = 'GoogleOAuthError';
  }
}

export function grantedScopes(scopeString: string): string[] {
  return scopeString.split(' ').filter(Boolean);
}

export function hasRequiredScopes(granted: string[]): boolean {
  const set = new Set(granted);
  return REQUIRED_SCOPES.every((s) => set.has(s));
}

export interface TokenRequester {
  (url: string, body: URLSearchParams, timeoutMs: number): Promise<{ status: number; json: unknown }>;
}

/** Injectable fetch so unit tests never touch the network. */
export const defaultRequester: TokenRequester = async (url, body, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  } finally {
    clearTimeout(timer);
  }
};

export interface ExchangeCodeInput {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
  timeoutMs?: number;
  requester?: TokenRequester;
}

export async function exchangeCodeForTokens(input: ExchangeCodeInput): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'authorization_code',
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: input.redirectUri,
  });
  const requester = input.requester ?? defaultRequester;
  let res: { status: number; json: unknown };
  try {
    res = await requester(GOOGLE_TOKEN_ENDPOINT, body, input.timeoutMs ?? 10_000);
  } catch {
    throw new GoogleOAuthError('network error during code exchange', 'network');
  }
  if (res.status !== 200) {
    throw new GoogleOAuthError(
      `token exchange failed (${res.status}): ${JSON.stringify(res.json).slice(0, 200)}`,
      'exchange_failed',
    );
  }
  return tokenResponseSchema.parse(res.json);
}

export interface RefreshInput {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  timeoutMs?: number;
  requester?: TokenRequester;
}

export async function refreshAccessToken(input: RefreshInput): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
  });
  const requester = input.requester ?? defaultRequester;
  let res: { status: number; json: unknown };
  try {
    res = await requester(GOOGLE_TOKEN_ENDPOINT, body, input.timeoutMs ?? 10_000);
  } catch {
    throw new GoogleOAuthError('network error during refresh', 'network');
  }
  if (res.status === 400 || res.status === 401) {
    // invalid_grant: user revoked at Google, or token expired — unrecoverable
    // here; the caller must mark the connection revoked.
    throw new GoogleOAuthError('refresh token rejected (invalid_grant)', 'invalid_grant');
  }
  if (res.status !== 200) {
    throw new GoogleOAuthError(`refresh failed (${res.status})`, 'exchange_failed');
  }
  return tokenResponseSchema.parse(res.json);
}

export async function revokeToken(
  token: string,
  timeoutMs = 10_000,
  requester: TokenRequester = defaultRequester,
): Promise<boolean> {
  const body = new URLSearchParams({ token });
  try {
    const res = await requester(GOOGLE_REVOKE_ENDPOINT, body, timeoutMs);
    return res.status === 200;
  } catch {
    throw new GoogleOAuthError('network error during revoke', 'network');
  }
}
