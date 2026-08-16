import type { Redis } from 'ioredis';
import { getConfig } from '../config/env.js';
import { RateLimitError } from '../domain/errors.js';
import { redisKey } from '../infrastructure/redis.js';

export class VoiceRateLimiter {
  constructor(private readonly redis: Redis) {}

  async consume(userId: string): Promise<void> {
    const config = getConfig();
    const windowMs = 3_600_000;
    const bucket = Math.floor(Date.now() / windowMs);
    const key = redisKey('voice', 'rate', userId, String(bucket));
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.pexpire(key, windowMs);
    if (count > config.VOICE_GENERATIONS_PER_HOUR) {
      await this.redis.decr(key);
      const ttl = await this.redis.pttl(key);
      throw new RateLimitError(Math.max(1, Math.ceil(ttl / 1000)));
    }
  }
}
