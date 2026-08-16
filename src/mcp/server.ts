import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getConfig } from '../config/env.js';
import { createRedisConnection } from '../infrastructure/redis.js';
import { JobStore } from '../services/job-store.js';

const config = getConfig();
const redis = createRedisConnection();
const store = new JobStore(redis);
const server = new McpServer({ name: 'tubeclickpro-context', version: '0.1.0' });

server.registerTool(
  'viral_dna_get_chunks',
  {
    description: 'Load owner-scoped extracted video chunks for the Micro-Critic Agent.',
    inputSchema: {
      jobId: z.string().uuid(),
      userId: z.string().min(1),
    },
  },
  async ({ jobId, userId }) => {
    const state = await store.get(jobId);
    if (state.userId !== userId) throw new Error('Job ownership mismatch');
    const context = await store.getContext(jobId);
    return { content: [{ type: 'text', text: JSON.stringify(context) }] };
  },
);

server.registerTool(
  'viral_dna_get_channel_profile',
  {
    description: 'Read one owner-scoped channel profile from Supabase for synthesis context.',
    inputSchema: {
      profileId: z.string().uuid(),
      userId: z.string().min(1),
    },
  },
  async ({ profileId, userId }) => {
    if (config.AUTH_MODE !== 'supabase') {
      return { content: [{ type: 'text', text: JSON.stringify({ available: false }) }] };
    }
    const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase
      .from('channel_profiles')
      .select('id,fingerprint,memory_version,updated_at')
      .eq('id', profileId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(`Channel profile lookup failed: ${error.message}`);
    return { content: [{ type: 'text', text: JSON.stringify({ available: Boolean(data), profile: data }) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);

async function shutdown(): Promise<void> {
  await server.close();
  await redis.quit();
}

process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
