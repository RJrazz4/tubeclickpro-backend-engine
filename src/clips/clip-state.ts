import type { Redis } from 'ioredis';
import { redisKey } from '../infrastructure/redis.js';

/**
 * Redis-backed clip job state (the status surface GET /api/clips/:id reads).
 * JSON blob per job with a 24h TTL. Decoupled from BullMQ so the API can read
 * progress without touching queue internals.
 */

export type ClipStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface ClipSelection {
  startSeconds: number;
  durationSeconds: number;
  reason: string;
  peakType: string;
}

export interface ClipState {
  jobId: string;
  userId: string;
  status: ClipStatus;
  progress: number;
  stage?: string;
  url?: string;
  error?: string;
  selection?: ClipSelection;
  createdAt: string;
  updatedAt: string;
}

const TTL_SECONDS = 86_400;

export class ClipStateStore {
  constructor(private readonly redis: Redis) {}

  private key(jobId: string): string {
    return redisKey('clips', 'state', jobId);
  }

  async init(jobId: string, userId: string): Promise<ClipState> {
    const now = new Date().toISOString();
    const state: ClipState = { jobId, userId, status: 'queued', progress: 0, stage: 'queued', createdAt: now, updatedAt: now };
    await this.redis.set(this.key(jobId), JSON.stringify(state), 'EX', TTL_SECONDS);
    return state;
  }

  async get(jobId: string): Promise<ClipState | null> {
    const raw = await this.redis.get(this.key(jobId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ClipState;
    } catch {
      return null;
    }
  }

  async patch(jobId: string, patch: Partial<Omit<ClipState, 'jobId' | 'createdAt'>>): Promise<ClipState | null> {
    const current = await this.get(jobId);
    if (!current) return null;
    const next: ClipState = { ...current, ...patch, updatedAt: new Date().toISOString() };
    await this.redis.set(this.key(jobId), JSON.stringify(next), 'EX', TTL_SECONDS);
    return next;
  }
}
