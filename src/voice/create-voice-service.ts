import type { Redis } from 'ioredis';
import { VoiceGenerationService } from './voice-generation-service.js';
import { VoiceRateLimiter } from './voice-rate-limiter.js';
import { createVoiceRouter } from './voice-router.js';

export function createVoiceGenerationService(redis: Redis): VoiceGenerationService {
  return new VoiceGenerationService(redis, createVoiceRouter(), new VoiceRateLimiter(redis));
}
