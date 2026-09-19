import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { extractVideoId } from './sources.js';
import type { TrendRadarService } from './trend-service.js';

/**
 * Registers the zero-cost Trend Radar tools on an existing MCP server so
 * agent pipelines can pull live, keyless YouTube intelligence.
 */
export function registerTrendTools(server: McpServer, service: TrendRadarService): void {
  server.registerTool(
    'trend_radar',
    {
      description:
        'Live, keyless YouTube trend intelligence. Returns trending videos, or ' +
        'topic search results when `topic` is provided. Cached ~10 minutes; zero API cost.',
      inputSchema: {
        topic: z.string().optional(),
        region: z.string().length(2).optional(),
      },
    },
    async ({ topic, region }) => {
      const radar = topic
        ? await service.radar(topic)
        : await service.radar(null);
      void region;
      return { content: [{ type: 'text', text: JSON.stringify(radar) }] };
    },
  );

  server.registerTool(
    'video_intel',
    {
      description:
        'Keyless metadata (title, channel, thumbnail) for a single YouTube video id or URL.',
      inputSchema: { video: z.string().min(1) },
    },
    async ({ video }) => {
      const id = extractVideoId(video);
      if (!id) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'unrecognised video id/url' }) }] };
      }
      const intel = await service.intel(id);
      return { content: [{ type: 'text', text: JSON.stringify(intel ?? { available: false }) }] };
    },
  );
}
