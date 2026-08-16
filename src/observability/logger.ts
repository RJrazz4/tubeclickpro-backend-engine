import pino from 'pino';
import { getConfig } from '../config/env.js';

export const logger = pino({
  level: getConfig().LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'authorization',
      '*.token',
      '*.access_token',
      '*.SUPABASE_SERVICE_ROLE_KEY',
      '*.REDIS_URL',
    ],
    censor: '[REDACTED]',
  },
  base: { service: 'tubeclickpro-backend-engine' },
});
