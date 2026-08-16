import type { Redis } from 'ioredis';
import { getConfig } from '../config/env.js';
import { jobStateSchema, type JobEvent, type JobState } from '../domain/job.js';
import { NotFoundError } from '../domain/errors.js';
import { redisKey } from '../infrastructure/redis.js';

export class JobStore {
  constructor(private readonly redis: Redis) {}

  private stateKey(jobId: string): string {
    return redisKey('job', jobId);
  }

  private channel(userId: string, jobId: string): string {
    return redisKey('events', userId, jobId);
  }

  async create(state: JobState): Promise<void> {
    await this.redis.set(
      this.stateKey(state.jobId),
      JSON.stringify(state),
      'EX',
      getConfig().JOB_RESULT_TTL_SECONDS,
    );
  }

  async get(jobId: string): Promise<JobState> {
    const raw = await this.redis.get(this.stateKey(jobId));
    if (!raw) throw new NotFoundError('Job not found or expired');
    return jobStateSchema.parse(JSON.parse(raw));
  }

  async update(jobId: string, patch: Partial<JobState>): Promise<JobState> {
    const current = await this.get(jobId);
    const next = jobStateSchema.parse({
      ...current,
      ...patch,
      jobId: current.jobId,
      userId: current.userId,
      tier: current.tier,
      updatedAt: new Date().toISOString(),
    });
    await this.create(next);
    await this.publish(next);
    return next;
  }

  async publish(state: JobState): Promise<void> {
    const event: JobEvent = {
      jobId: state.jobId,
      status: state.status,
      progressPercent: state.progressPercent,
      stage: state.stage,
      updatedAt: state.updatedAt,
      ...(state.result === undefined ? {} : { result: state.result }),
      ...(state.error === undefined ? {} : { error: state.error }),
    };
    await this.redis.publish(this.channel(state.userId, state.jobId), JSON.stringify(event));
  }

  eventChannel(userId: string, jobId: string): string {
    return this.channel(userId, jobId);
  }

  async storeContext(jobId: string, context: unknown): Promise<void> {
    await this.redis.set(
      redisKey('context', jobId),
      JSON.stringify(context),
      'EX',
      getConfig().JOB_RESULT_TTL_SECONDS,
    );
  }

  async getContext(jobId: string): Promise<unknown> {
    const raw = await this.redis.get(redisKey('context', jobId));
    if (!raw) throw new NotFoundError('MCP job context not found or expired');
    return JSON.parse(raw) as unknown;
  }
}
