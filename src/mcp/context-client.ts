import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { getConfig } from '../config/env.js';

const toolResultSchema = z.object({
  content: z.array(z.object({ type: z.string() }).passthrough()),
});

export class McpContextClient {
  private client: Client | undefined;
  private transport: StdioClientTransport | undefined;

  async connect(): Promise<void> {
    if (this.client) return;
    const config = getConfig();
    const transport = new StdioClientTransport({
      command: config.MCP_CONTEXT_COMMAND,
      args: config.MCP_CONTEXT_ARGS.split(/\s+/).filter(Boolean),
      env: Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
    });
    const client = new Client({ name: 'tubeclickpro-worker', version: '0.1.0' });
    await client.connect(transport);
    this.transport = transport;
    this.client = client;
  }

  async getExtractedChunks(jobId: string, userId: string): Promise<unknown> {
    await this.connect();
    const config = getConfig();
    const operation = this.client!.callTool({
      name: 'viral_dna_get_chunks',
      arguments: { jobId, userId },
    });
    const response = await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('MCP tool call timed out')), config.MCP_TOOL_TIMEOUT_MS),
      ),
    ]);
    const parsed = toolResultSchema.parse(response);
    const textItem = parsed.content.find(
      (item): item is { type: string; text: string } =>
        item.type === 'text' && typeof item.text === 'string',
    );
    if (!textItem) throw new Error('MCP context tool returned no text content');
    return JSON.parse(textItem.text) as unknown;
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = undefined;
    this.transport = undefined;
  }
}
