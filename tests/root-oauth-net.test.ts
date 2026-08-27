import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registerRoutes } from '../src/api/routes.js';

/** The root handler runs without auth (like /healthz); stub deps. */
function build() {
  const app = Fastify();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerRoutes(app, {} as any);
  return app;
}

describe('root OAuth safety net (Google redirect misconfiguration)', () => {
  it('forwards ?code&state to the real callback with query preserved', async () => {
    const app = build();
    const res = await app.inject({ method: 'GET', url: '/?code=4%2F0AbCd&state=abc-123&scope=youtube' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/api/youtube/callback?code=4%2F0AbCd&state=abc-123&scope=youtube');
  });

  it('forwards ?error (user denied consent) instead of 404', async () => {
    const app = build();
    const res = await app.inject({ method: 'GET', url: '/?error=access_denied' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/api/youtube/callback?error=access_denied');
  });

  it('serves ALB health JSON on plain GET /', async () => {
    const app = build();
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', service: 'tubeclickpro-backend-engine' });
  });

  it('keeps /healthz intact', async () => {
    const app = build();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
  });
});
