import type { Redis } from 'ioredis';
import { getConfig } from '../config/env.js';
import { RateLimitError } from '../domain/errors.js';
import type { UserTier } from '../domain/tier.js';
import { redisKey } from '../infrastructure/redis.js';

const reserveScript = `
local activeKey = KEYS[1]
local rateKey = KEYS[2]
local now = tonumber(ARGV[1])
local activeTtl = tonumber(ARGV[2])
local maxActive = tonumber(ARGV[3])
local rateLimit = tonumber(ARGV[4])
local windowMs = tonumber(ARGV[5])
local jobId = ARGV[6]
redis.call('ZREMRANGEBYSCORE', activeKey, '-inf', now - activeTtl)
if redis.call('ZCARD', activeKey) >= maxActive then
  return {0, activeTtl}
end
local count = redis.call('INCR', rateKey)
if count == 1 then redis.call('PEXPIRE', rateKey, windowMs) end
if count > rateLimit then
  redis.call('DECR', rateKey)
  return {0, redis.call('PTTL', rateKey)}
end
redis.call('ZADD', activeKey, now, jobId)
redis.call('PEXPIRE', activeKey, activeTtl)
return {1, 0}
`;

export class TierRateLimiter {
  constructor(private readonly redis: Redis) {}

  async reserve(userId: string, tier: UserTier, jobId: string): Promise<void> {
    const config = getConfig();
    const now = Date.now();
    const windowMs = tier === 'free' ? 86_400_000 : 3_600_000;
    const rateLimit = tier === 'free' ? config.FREE_JOBS_PER_DAY : config.PREMIUM_JOBS_PER_HOUR;
    const maxActive = tier === 'free' ? config.FREE_MAX_ACTIVE_JOBS : config.PREMIUM_MAX_ACTIVE_JOBS;
    const activeTtl = Math.max(config.SCRAPER_TIMEOUT_MS * 5, 900_000);
    const bucket = Math.floor(now / windowMs).toString();
    const result = (await this.redis.eval(
      reserveScript,
      2,
      redisKey('active', tier, userId),
      redisKey('rate', tier, userId, bucket),
      now,
      activeTtl,
      maxActive,
      rateLimit,
      windowMs,
      jobId,
    )) as [number, number];

    if (Number(result[0]) !== 1) {
      throw new RateLimitError(Math.max(1, Math.ceil(Number(result[1]) / 1000)));
    }
  }

  async release(userId: string, tier: UserTier, jobId: string): Promise<void> {
    await this.redis.zrem(redisKey('active', tier, userId), jobId);
  }
}
