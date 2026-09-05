/**
 * CORS origin matching shared by the Fastify app and its tests.
 *
 * The production deployment is split across two hosts:
 *   - frontend on Vercel  (default `*.vercel.app` domain, or the custom
 *     domain `tubeclickpro.in` when wired up)
 *   - backend  on Render  (this service)
 *
 * The original allowlist only contained the custom domain, so any browser
 * running from the Vercel default domain was silently blocked by CORS and the
 * frontend could never reach the backend ("not connecting"). This module
 * whitelists the custom domain, any configured origins, the Vercel deployment
 * domain(s), and loopback for local development.
 *
 * `@fastify/cors` accepts an array of `string | RegExp`; when the request
 * `Origin` matches (exact string or RegExp test) it echoes that origin in
 * `Access-Control-Allow-Origin`, which is what we need with
 * `credentials: true`.
 */

/** Matches any `https://<project>.vercel.app` (incl. preview `-git-<sha>`) origin. */
export const VERCEL_ORIGIN_RE = /^https:\/\/[a-z0-9][a-z0-9.-]*\.vercel\.app$/i;

/** Matches `http(s)://localhost[:port]` and `http(s)://127.0.0.1[:port]`. */
export const LOOPBACK_ORIGIN_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/i;

/**
 * Decide whether a request `Origin` should be granted CORS access.
 * Mirrors the behaviour of {@link buildCorsOriginOption} for browser origins.
 */
export function isOriginAllowed(
  origin: string | undefined,
  staticOrigins: readonly string[],
): boolean {
  // Non-browser clients (curl, server-to-server) carry no Origin header.
  if (!origin) return true;
  if (staticOrigins.includes(origin)) return true;
  if (VERCEL_ORIGIN_RE.test(origin)) return true;
  if (LOOPBACK_ORIGIN_RE.test(origin)) return true;
  return false;
}

/**
 * Build the `origin` option for `@fastify/cors`: the static origins plus the
 * Vercel and loopback matchers.
 */
export function buildCorsOriginOption(
  staticOrigins: readonly string[],
): (string | RegExp)[] {
  return [...staticOrigins, VERCEL_ORIGIN_RE, LOOPBACK_ORIGIN_RE];
}
