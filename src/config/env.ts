import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

const booleanFromEnv = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),
    REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
    REDIS_KEY_PREFIX: z.string().min(1).default('tubeclickpro'),
    JOB_RESULT_TTL_SECONDS: z.coerce.number().int().min(300).default(86400),
    AUTH_MODE: z.enum(['supabase', 'development']).default('supabase'),
    SUPABASE_URL: z.string().default(''),
    SUPABASE_ANON_KEY: z.string().default(''),
    SUPABASE_SERVICE_ROLE_KEY: z.string().default(''),
    SUPABASE_SUBSCRIPTIONS_TABLE: z.string().default('subscriptions'),
    WORKER_TIER: z.enum(['free', 'premium', 'all']).default('all'),
    FREE_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(2),
    PREMIUM_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(250).default(10),
    FREE_QUEUE_RATE_MAX: z.coerce.number().int().min(1).default(2),
    FREE_QUEUE_RATE_DURATION_MS: z.coerce.number().int().min(100).default(10000),
    PREMIUM_QUEUE_RATE_MAX: z.coerce.number().int().min(1).default(20),
    PREMIUM_QUEUE_RATE_DURATION_MS: z.coerce.number().int().min(100).default(1000),
    FREE_JOBS_PER_DAY: z.coerce.number().int().min(1).default(1),
    PREMIUM_JOBS_PER_HOUR: z.coerce.number().int().min(1).default(20),
    FREE_MAX_ACTIVE_JOBS: z.coerce.number().int().min(1).default(1),
    PREMIUM_MAX_ACTIVE_JOBS: z.coerce.number().int().min(1).default(5),
    PYTHON_BIN: z.string().default('python3'),
    AGENT_REACH_WORKER_PATH: z.string().default('workers/python/viral_dna_worker.py'),
    SCRAPER_TIMEOUT_MS: z.coerce.number().int().min(5000).max(600000).default(90000),
    MCP_CONTEXT_ENABLED: booleanFromEnv,
    MCP_CONTEXT_COMMAND: z.string().default('node'),
    MCP_CONTEXT_ARGS: z.string().default('dist/mcp/server.js'),
    MCP_TOOL_TIMEOUT_MS: z.coerce.number().int().min(500).max(60000).default(10000),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === 'production' && value.AUTH_MODE === 'development') {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_MODE'],
        message: 'Development authentication is forbidden in production',
      });
    }
    if (value.AUTH_MODE === 'supabase') {
      for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const) {
        if (!value[key]) {
          context.addIssue({ code: 'custom', path: [key], message: `${key} is required in Supabase mode` });
        }
      }
    }
  });

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  cached ??= schema.parse(process.env);
  return cached;
}

export function resetConfigForTests(): void {
  cached = undefined;
}
