import { z } from 'zod';
import { McpContextClient } from '../mcp/context-client.js';

const contextSchema = z.object({
  extraction: z.object({
    hookWindow: z.array(z.object({ text: z.string() })),
  }),
});

type ContextReader = Pick<McpContextClient, 'getExtractedChunks'>;

export class MicroCritic {
  constructor(private readonly mcp: ContextReader) {}

  async audit(jobId: string, userId: string): Promise<Record<string, unknown>> {
    const context = contextSchema.parse(await this.mcp.getExtractedChunks(jobId, userId));
    const hookText = context.extraction.hookWindow.map((chunk) => chunk.text).join(' ').trim();
    const words = hookText ? hookText.split(/\s+/).length : 0;
    const signals = {
      question: /\?/.test(hookText),
      numericSpecificity: /\b\d+[\d,.]*\b/.test(hookText),
      directAddress: /\b(you|your)\b/i.test(hookText),
      patternInterrupt: /\b(stop|wait|but|actually|wrong|never)\b/i.test(hookText),
    };
    const score = Math.min(
      100,
      35 +
        Math.min(words, 25) +
        (signals.question ? 10 : 0) +
        (signals.numericSpecificity ? 10 : 0) +
        (signals.directAddress ? 10 : 0) +
        (signals.patternInterrupt ? 10 : 0),
    );

    return {
      mode: 'mcp-direct-context',
      windowSeconds: { start: 0, end: 10 },
      score,
      retentionRisk: score >= 85 ? 'low' : score >= 70 ? 'medium' : 'high',
      wordCount: words,
      signals,
      extractedHookText: hookText,
      nextStep:
        'The deterministic audit is the safe baseline; an allowlisted model adapter will replace scoring in the next vertical slice.',
    };
  }
}
