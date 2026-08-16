import { describe, expect, it } from 'vitest';
import { MicroCritic } from '../src/pipeline/micro-critic.js';

describe('MCP-backed Micro-Critic', () => {
  it('reads extracted chunks through the MCP context contract', async () => {
    const critic = new MicroCritic({
      async getExtractedChunks() {
        return {
          extraction: {
            hookWindow: [{ text: 'Stop. You are making 3 mistakes, but what is the worst one?' }],
          },
        };
      },
    });
    const audit = await critic.audit('78212ed1-e56b-4ec0-a409-b47d519fe955', 'user-1');
    expect(audit.mode).toBe('mcp-direct-context');
    expect(audit.score).toBeGreaterThanOrEqual(85);
    expect(audit.signals).toMatchObject({
      question: true,
      numericSpecificity: true,
      directAddress: true,
      patternInterrupt: true,
    });
  });
});
