import { Redis } from 'ioredis';
import { getConfig } from '../config/env.js';

export function createRedisConnection(): Redis {
  const config = getConfig();
  return new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
}

export function redisKey(...parts: string[]): string {
  return [getConfig().REDIS_KEY_PREFIX, ...parts].join(':');
}
