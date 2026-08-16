import type { PipelineResult } from '../domain/extraction.js';
import type { ViralDnaJobPayload } from '../domain/job.js';
import { AgentReachRunner } from '../scraper/agent-reach-runner.js';
import { JobStore } from '../services/job-store.js';
import { MicroCritic } from './micro-critic.js';

type ExtractionRunner = Pick<AgentReachRunner, 'extract'>;
type ContextStore = Pick<JobStore, 'storeContext'>;
type Critic = Pick<MicroCritic, 'audit'>;

export class PremiumPipeline {
  constructor(
    private readonly scraper: ExtractionRunner,
    private readonly store: ContextStore,
    private readonly critic: Critic,
  ) {}

  async run(
    payload: ViralDnaJobPayload,
    progress: (percent: number, stage: string) => Promise<void>,
  ): Promise<PipelineResult> {
    await progress(10, 'vip-deep-scrape');
    const extraction = await this.scraper.extract({ videoUrl: payload.videoUrl, mode: 'deep' });
    await progress(55, 'vip-hook-context');

    await this.store.storeContext(payload.jobId, {
      jobId: payload.jobId,
      userId: payload.userId,
      extraction,
      requestedLanguage: payload.outputLanguage,
    });

    const hookText = extraction.hookWindow.map((chunk) => chunk.text).join(' ').trim();
    const hookAnalysis = {
      windowSeconds: { start: 0, end: 10 },
      transcriptAvailable: hookText.length > 0,
      triggerCandidates: [
        ...(hookText.includes('?') ? ['CG-01'] : []),
        ...(/\b(stop|wait|wrong|never)\b/i.test(hookText) ? ['PI-05'] : []),
        ...(/\b(you|your)\b/i.test(hookText) ? ['PS-06'] : []),
      ],
    };

    await progress(72, 'vip-mcp-micro-critic');
    const criticAudit = await this.critic.audit(payload.jobId, payload.userId);
    await progress(92, 'vip-packaging');

    return {
      tier: 'premium',
      delivery: 'sse',
      extraction,
      hookAnalysis,
      criticAudit,
    };
  }
}
