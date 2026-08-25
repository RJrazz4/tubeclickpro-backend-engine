import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import type { AuthService } from '../auth/auth-service.js';
import { AppError, ForbiddenError } from '../domain/errors.js';
import { createSupabaseAdmin } from '../youtube/quota-ledger.js';
import { checkDailyQuota, enqueueGeneration, scriptModuleEnabled } from '../scripts/script-queue.js';
import { PublishService } from '../scripts/publish-service.js';
import { buildYoutubeSyncDeps } from '../youtube/sync-queue.js';
import { createVoiceGenerationService } from '../voice/create-voice-service.js';

/**
 * Crush synthesis API.
 *
 *   POST /api/scripts/generate  {hungerTopic?}   free: 1 outline/day · premium: 20 packages/day
 *   GET  /api/scripts                           own scripts, newest first
 *   GET  /api/scripts/:id                       own script by id
 *
 * Tier semantics (locked decision): free = outline skeleton teaser,
 * premium = full ScriptPackage through the 85/100 critic gate.
 */

const generateSchema = z.object({ hungerTopic: z.string().min(2).max(80).optional() });

export interface ScriptRouteDependencies {
  auth: AuthService;
  redis: Redis;
}

export async function registerScriptRoutes(
  app: FastifyInstance,
  dependencies: ScriptRouteDependencies,
): Promise<void> {
  const sb = createSupabaseAdmin();
  const ytDeps = buildYoutubeSyncDeps(dependencies.redis);
  const publish = new PublishService(
    sb, dependencies.redis, createVoiceGenerationService(dependencies.redis),
    ytDeps.tokens, ytDeps.analytics,
  );

  app.post('/api/scripts/generate', async (request, reply) => {
    if (!scriptModuleEnabled()) {
      throw new AppError('Script synthesis is not configured (no OPENROUTER_API_KEYS)', 503, 'SCRIPTS_MODULE_DISABLED');
    }
    const user = await dependencies.auth.authenticate(request.headers);
    const input = generateSchema.parse(request.body ?? {});

    // Reject users with no profile BEFORE burning quota (fast 409).
    const { data: profile } = await sb
      .from('audience_profiles')
      .select('freshness')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!profile || (profile as { freshness: string }).freshness === 'empty') {
      throw new AppError('Connect YouTube and let the first sync finish before generating scripts', 409, 'NO_PROFILE');
    }

    const quota = await checkDailyQuota(dependencies.redis, user.id, user.tier);
    if (!quota.allowed) {
      throw new AppError(
        `Daily ${user.tier} generation limit reached (${quota.limit}/day)`,
        429,
        'SCRIPT_QUOTA_REACHED',
        { retryAfterSeconds: 86_400 },
      );
    }

    const { jobId } = await enqueueGeneration(dependencies.redis, {
      kind: 'generate',
      userId: user.id,
      tier: user.tier,
      ...(input.hungerTopic !== undefined ? { hungerTopic: input.hungerTopic } : {}),
    });
    return reply.code(202).send({
      status: 'queued',
      jobId,
      tier: user.tier,
      deliverable: user.tier === 'premium' ? 'full ScriptPackage (critic-gated)' : 'outline skeleton',
      quota: { used: quota.used, limit: quota.limit },
    });
  });

  app.get('/api/scripts', async (request) => {
    const user = await dependencies.auth.authenticate(request.headers);
    const { data, error } = await sb
      .from('script_packages')
      .select('id, kind, status, hunger_topic, tier, critic, cost_usd, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw new AppError('Lookup failed', 500, 'SCRIPTS_LOOKUP_FAILED');
    return { scripts: data ?? [] };
  });

  app.get<{ Params: { id: string } }>('/api/scripts/:id', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers);
    const { data, error } = await sb
      .from('script_packages')
      .select('*')
      .eq('id', request.params.id)
      .maybeSingle();
    if (error || !data) throw new AppError('Not found', 404, 'NOT_FOUND');
    if ((data as { user_id: string }).user_id !== user.id) {
      throw new ForbiddenError('Not your script');
    }
    return data;
  });

  const publishSchema = z.object({ videoUrl: z.string().min(11).max(300) });

  // Module P: manual paste — link the published video to its script.
  app.post<{ Params: { id: string } }>('/api/scripts/:id/publish', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers);
    const input = publishSchema.parse(request.body ?? {});
    const outcome = await publish.recordPublish(user, { scriptId: request.params.id, videoUrl: input.videoUrl });
    return reply.code(201).send(outcome);
  });

  app.get<{ Params: { id: string } }>('/api/scripts/:id/outcome', async (request) => {
    const user = await dependencies.auth.authenticate(request.headers);
    return publish.getOutcome(user, request.params.id);
  });

  // Module P: one-click Voice Studio handoff (premium-gated inside the service).
  const voiceoverSchema = z.object({ voiceAlias: z.enum([
    'george','brian','daniel','liam','chris','charlie','eric','will',
    'sarah','alice','matilda','jessica','lily','laura',
  ]).optional() });

  app.post<{ Params: { id: string } }>('/api/scripts/:id/voiceover', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers);
    const input = voiceoverSchema.parse(request.body ?? {});
    const result = await publish.generateVoiceover(user, request.params.id, input.voiceAlias);
    return reply
      .code(200)
      .header('Content-Type', result.contentType)
      .header('Content-Length', String(result.audio.length))
      .header('X-Voice-Provider', result.provider)
      .header('X-Script-Characters', String(result.characters))
      .send(result.audio);
  });
}
