import crypto from 'node:crypto';
import type { Redis } from 'ioredis';
import { getConfig } from '../config/env.js';
import { AppError, ForbiddenError } from '../domain/errors.js';
import type { AuthenticatedUser } from '../domain/tier.js';
import { redisKey } from '../infrastructure/redis.js';
import type { VoiceGenerationRequest, VoiceGenerationResult } from './contracts.js';
import { VoiceRateLimiter } from './voice-rate-limiter.js';
import { VoiceRouter } from './voice-router.js';

interface CachedVoiceResult {
  requestHash: string;
  provider: VoiceGenerationResult['provider'];
  fallbackDepth: number;
  audioBase64: string;
}

function requestHash(request: VoiceGenerationRequest): string {
  return crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex');
}

export class VoiceGenerationService {
  constructor(
    private readonly redis: Redis,
    private readonly router: VoiceRouter,
    private readonly rateLimiter: VoiceRateLimiter,
  ) {}

  async generate(
    user: AuthenticatedUser,
    request: VoiceGenerationRequest,
    idempotencyKey: string,
  ): Promise<VoiceGenerationResult> {
    if (user.tier !== 'premium') {
      throw new ForbiddenError(
        'TubeClick Neural Voice requires an active Premium plan',
        'NEURAL_VOICE_PREMIUM_REQUIRED',
      );
    }

    const config = getConfig();
    if (request.text.length > config.VOICE_MAX_CHARACTERS) {
      throw new AppError(
        `Voice text exceeds ${config.VOICE_MAX_CHARACTERS} characters`,
        400,
        'VOICE_TEXT_TOO_LONG',
      );
    }

    const hash = requestHash(request);
    const resultKey = redisKey('voice', 'result', user.id, idempotencyKey);
    const lockKey = redisKey('voice', 'lock', user.id, idempotencyKey);
    const cachedRaw = await this.redis.get(resultKey);
    if (cachedRaw) return this.parseCached(cachedRaw, hash);

    const lock = await this.redis.set(lockKey, hash, 'EX', 600, 'NX');
    if (lock !== 'OK') {
      const existingHash = await this.redis.get(lockKey);
      if (existingHash && existingHash !== hash) {
        throw new AppError('Idempotency key was reused with a different request', 409, 'IDEMPOTENCY_CONFLICT');
      }
      const completed = await this.redis.get(resultKey);
      if (completed) return this.parseCached(completed, hash);
      throw new AppError('Voice generation is already in progress', 409, 'VOICE_GENERATION_IN_PROGRESS');
    }

    try {
      await this.rateLimiter.consume(user.id);
      const result = await this.router.generate(request);
      if (result.audio.length <= config.VOICE_IDEMPOTENCY_CACHE_MAX_BYTES) {
        const cached: CachedVoiceResult = {
          requestHash: hash,
          provider: result.provider,
          fallbackDepth: result.fallbackDepth,
          audioBase64: result.audio.toString('base64'),
        };
        await this.redis.set(
          resultKey,
          JSON.stringify(cached),
          'EX',
          config.VOICE_IDEMPOTENCY_TTL_SECONDS,
        );
      }
      return result;
    } finally {
      await this.redis.del(lockKey);
    }
  }

  private parseCached(raw: string, expectedHash: string): VoiceGenerationResult {
    let cached: CachedVoiceResult;
    try {
      cached = JSON.parse(raw) as CachedVoiceResult;
    } catch {
      throw new AppError('Cached voice result is invalid', 503, 'VOICE_CACHE_INVALID');
    }
    if (cached.requestHash !== expectedHash) {
      throw new AppError('Idempotency key was reused with a different request', 409, 'IDEMPOTENCY_CONFLICT');
    }
    return {
      provider: cached.provider,
      fallbackDepth: cached.fallbackDepth,
      contentType: 'audio/mpeg',
      audio: Buffer.from(cached.audioBase64, 'base64'),
    };
  }
}
