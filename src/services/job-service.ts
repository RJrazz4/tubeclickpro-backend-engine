import crypto from 'node:crypto';
import type { ExecuteRequest, JobState, ViralDnaJobPayload } from '../domain/job.js';
import { TIER_POLICY, type AuthenticatedUser } from '../domain/tier.js';
import type { ViralDnaQueues } from '../queue/queues.js';
import { JOB_NAMES } from '../queue/names.js';
import { JobStore } from './job-store.js';
import { TierRateLimiter } from './tier-rate-limiter.js';
import type { RunRepository } from '../persistence/supabase-run-repository.js';
import { NotFoundError } from '../domain/errors.js';

export class JobService {
  constructor(
    private readonly queues: ViralDnaQueues,
    private readonly store: JobStore,
    private readonly rateLimiter: TierRateLimiter,
    private readonly runs: RunRepository,
  ) {}

  async enqueue(user: AuthenticatedUser, request: ExecuteRequest): Promise<JobState> {
    const jobId = crypto.randomUUID();
    const now = new Date().toISOString();
    const policy = TIER_POLICY[user.tier];

    await this.rateLimiter.reserve(user.id, user.tier, jobId);

    const state: JobState = {
      jobId,
      userId: user.id,
      tier: user.tier,
      queueClass: policy.queueClass,
      delivery: policy.delivery,
      status: 'queued',
      progressPercent: 0,
      stage: user.tier === 'premium' ? 'vip-queued' : 'conveyor-queued',
      createdAt: now,
      updatedAt: now,
    };

    const payload: ViralDnaJobPayload = {
      jobId,
      userId: user.id,
      tier: user.tier,
      videoUrl: request.videoUrl,
      outputLanguage: request.outputLanguage,
      requestedAt: now,
      ...(request.channelProfileId ? { channelProfileId: request.channelProfileId } : {}),
    };

    try {
      await this.store.create(state);
      await this.runs.upsert(state);
      const queue = user.tier === 'premium' ? this.queues.premium : this.queues.free;
      await queue.add(JOB_NAMES[user.tier], payload, { jobId });
      await this.store.publish(state);
      return state;
    } catch (error) {
      await this.rateLimiter.release(user.id, user.tier, jobId);
      throw error;
    }
  }

  async getOwnedJob(user: AuthenticatedUser, jobId: string): Promise<JobState> {
    const state = await this.store.get(jobId);
    if (state.userId !== user.id) throw new NotFoundError('Job not found');
    return state;
  }
}
