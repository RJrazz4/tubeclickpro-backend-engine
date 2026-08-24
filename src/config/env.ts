import dotenv from 'dotenv';
import { z } from 'zod';
import { parseCommaSeparatedKeys } from '../infrastructure/api-key-pool.js';

dotenv.config({ quiet: true });

const booleanFromEnv = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const apiKeyPoolFromEnv = z
  .string()
  .default('')
  .transform(parseCommaSeparatedKeys);

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
    SUPABASE_TIER_SOURCE: z.enum(['rpc', 'subscriptions']).default('rpc'),
    SUPABASE_TIER_RPC: z.string().default('get_ghost_tier_for'),
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
    YOUTUBE_API_KEY: apiKeyPoolFromEnv,
    YOUTUBE_API_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),

    // Neural voice router
    VOICE_MAX_CHARACTERS: z.coerce.number().int().min(100).max(20000).default(5000),
    VOICE_GENERATIONS_PER_HOUR: z.coerce.number().int().min(1).max(1000).default(20),
    VOICE_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(5000).max(180000).default(60000),
    VOICE_IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().min(300).max(86400).default(3600),
    VOICE_MAX_AUDIO_BYTES: z.coerce.number().int().min(1048576).max(104857600).default(52428800),
    VOICE_IDEMPOTENCY_CACHE_MAX_BYTES: z.coerce.number().int().min(1048576).max(52428800).default(10485760),
    FFMPEG_BIN: z.string().default('ffmpeg'),
    ELEVENLABS_API_KEY: apiKeyPoolFromEnv,
    ELEVENLABS_BASE_URL: z.string().url().default('https://api.elevenlabs.io'),
    ELEVENLABS_MODEL_ID: z.string().default('eleven_multilingual_v2'),
    ELEVENLABS_VOICE_MAP_JSON: z.string().default('{}'),
    FISH_AUDIO_API_KEY: z.string().default(''),
    FISH_AUDIO_BASE_URL: z.string().url().default('https://api.fish.audio'),
    FISH_AUDIO_MODEL_ID: z.string().default('s2.1-pro'),
    FISH_AUDIO_VOICE_MAP_JSON: z.string().default('{}'),
    GPT_SOVITS_URL: z.string().default(''),
    GPT_SOVITS_API_KEY: z.string().default(''),
    GPT_SOVITS_VOICE_MAP_JSON: z.string().default('{}'),
    PIPER_BIN: z.string().default(''),
    PIPER_VOICE_MAP_JSON: z.string().default('{}'),
    CHATTTS_URL: z.string().default(''),
    CHATTTS_API_KEY: z.string().default(''),
    CHATTTS_VOICE_MAP_JSON: z.string().default('{}'),

    // YouTube Signal Link (Module O). Empty = module disabled (routes 503).
    GOOGLE_OAUTH_CLIENT_ID: z.string().default(''),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().default(''),
    // Exact-match redirect: https://<engine-host>/api/youtube/callback
    GOOGLE_OAUTH_REDIRECT_URL: z.string().default(''),
    // App-held master key for AES-256-GCM token encryption. Required when the
    // module is enabled; any length >= 16 chars (key = SHA-256 of the secret).
    YOUTUBE_TOKEN_MASTER_KEY: z.string().default(''),
    YOUTUBE_CONNECT_SUCCESS_URL: z.string().default('https://tubeclickpro.in/settings?youtube=connected'),
    YOUTUBE_CONNECT_ERROR_URL: z.string().default('https://tubeclickpro.in/settings?youtube=error'),
    // Backfill depth on connect (days) and per-request chunk size.
    YOUTUBE_BACKFILL_DAYS: z.coerce.number().int().min(7).max(365).default(90),
    YOUTUBE_SYNC_CHUNK_DAYS: z.coerce.number().int().min(7).max(28).default(28),
    // Platform-wide API budgets (the ledger sheds priority-3 first).
    YOUTUBE_DATA_API_DAILY_UNITS: z.coerce.number().int().min(100).default(9000),
    YOUTUBE_ANALYTICS_DAILY_CALLS: z.coerce.number().int().min(100).default(5000),
    // Per-user daily fairness cap (units, data API weighting).
    YOUTUBE_USER_DAILY_UNITS: z.coerce.number().int().min(50).default(1500),
    YOUTUBE_SYNC_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),

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
    if (value.GOOGLE_OAUTH_CLIENT_ID && value.YOUTUBE_TOKEN_MASTER_KEY.length < 16) {
      context.addIssue({
        code: 'custom',
        path: ['YOUTUBE_TOKEN_MASTER_KEY'],
        message: 'Master key must be at least 16 characters when the YouTube module is enabled',
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
