import type { PipelineResult } from '../domain/extraction.js';
import type { ViralDnaJobPayload } from '../domain/job.js';
import { AgentReachRunner } from '../scraper/agent-reach-runner.js';

type ExtractionRunner = Pick<AgentReachRunner, 'extract'>;

export class FreePipeline {
  constructor(private readonly scraper: ExtractionRunner) {}

  async run(
    payload: ViralDnaJobPayload,
    progress: (percent: number, stage: string) => Promise<void>,
  ): Promise<PipelineResult> {
    await progress(15, 'conveyor-basic-scrape');
    const extraction = await this.scraper.extract({ videoUrl: payload.videoUrl, mode: 'basic' });
    await progress(85, 'conveyor-packaging');
    return {
      tier: 'free',
      delivery: 'polling',
      extraction,
      hookAnalysis: null,
      criticAudit: null,
    };
  }
}
