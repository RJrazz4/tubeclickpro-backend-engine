import cors from '@fastify/cors';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  buildCorsOriginOption,
  isOriginAllowed,
  LOOPBACK_ORIGIN_RE,
  VERCEL_ORIGIN_RE,
} from '../src/config/cors.js';

const STATIC = ['https://tubeclickpro.in', 'https://www.tubeclickpro.in'];

describe('isOriginAllowed', () => {
  it('allows the configured custom domain', () => {
    expect(isOriginAllowed('https://tubeclickpro.in', STATIC)).toBe(true);
    expect(isOriginAllowed('https://www.tubeclickpro.in', STATIC)).toBe(true);
  });

  it('allows Vercel deployment origins (default + preview forms)', () => {
    expect(isOriginAllowed('https://tube-click-pro.vercel.app', STATIC)).toBe(true);
    expect(isOriginAllowed('https://tube-click-pro-git-main-rjrazz4.vercel.app', STATIC)).toBe(true);
    expect(isOriginAllowed('https://tubeclickpro.vercel.app', STATIC)).toBe(true);
  });

  it('allows loopback for local development', () => {
    expect(isOriginAllowed('http://localhost:5173', STATIC)).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:5173', STATIC)).toBe(true);
    expect(isOriginAllowed('https://localhost', STATIC)).toBe(true);
  });

  it('allows non-browser (missing Origin) requests', () => {
    expect(isOriginAllowed(undefined, STATIC)).toBe(true);
  });

  it('rejects unrelated origins', () => {
    expect(isOriginAllowed('https://evil.example.com', STATIC)).toBe(false);
    expect(isOriginAllowed('https://vercel.app.evil.com', STATIC)).toBe(false);
    expect(isOriginAllowed('http://tube-click-pro.vercel.app', STATIC)).toBe(false); // http, not https
  });
});

describe('buildCorsOriginOption (what @fastify/cors receives)', () => {
  const matchesOption = (origin: string): boolean =>
    buildCorsOriginOption(STATIC).some((entry) =>
      typeof entry === 'string' ? entry === origin : entry.test(origin),
    );

  it('includes the static origins and the Vercel/loopback matchers', () => {
    const option = buildCorsOriginOption(STATIC);
    expect(option).toContain('https://tubeclickpro.in');
    expect(option).toContain(VERCEL_ORIGIN_RE);
    expect(option).toContain(LOOPBACK_ORIGIN_RE);
  });

  it('grants the same browser origins isOriginAllowed does', () => {
    const allowed = [
      'https://tubeclickpro.in',
      'https://tube-click-pro.vercel.app',
      'http://localhost:5173',
    ];
    const blocked = ['https://evil.example.com', 'http://tube-click-pro.vercel.app'];
    for (const o of allowed) {
      expect(matchesOption(o)).toBe(true);
      expect(isOriginAllowed(o, STATIC)).toBe(true);
    }
    for (const o of blocked) {
      expect(matchesOption(o)).toBe(false);
      expect(isOriginAllowed(o, STATIC)).toBe(false);
    }
  });
});

describe('@fastify/cors integration (no Redis, via inject)', () => {
  async function preflight(origin: string) {
    const app = Fastify();
    await app.register(cors, {
      origin: buildCorsOriginOption(STATIC),
      credentials: true,
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS', 'PATCH', 'PUT'],
      allowedHeaders: ['Authorization', 'Content-Type'],
    });
    app.get('/healthz', async () => ({ status: 'ok' }));
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/healthz',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    await app.close();
    return res;
  }

  it('reflects the custom domain', async () => {
    const res = await preflight('https://tubeclickpro.in');
    expect(res.headers['access-control-allow-origin']).toBe('https://tubeclickpro.in');
  });

  it('reflects a Vercel origin (previously blocked)', async () => {
    const res = await preflight('https://tube-click-pro.vercel.app');
    expect(res.headers['access-control-allow-origin']).toBe('https://tube-click-pro.vercel.app');
  });

  it('omits allow-origin for an unrelated origin', async () => {
    const res = await preflight('https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
