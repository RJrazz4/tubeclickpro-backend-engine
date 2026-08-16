import { z } from 'zod';
import { tierSchema } from './tier.js';

export const youtubeUrlSchema = z
  .string()
  .url()
  .max(512)
  .refine((value) => {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === 'https:' &&
      (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com'))
    );
  }, 'Only HTTPS YouTube URLs are accepted');

export const executeRequestSchema = z.object({
  videoUrl: youtubeUrlSchema,
  channelProfileId: z.string().uuid().optional(),
  outputLanguage: z.string().trim().min(2).max(40).default('English'),
});

export type ExecuteRequest = z.infer<typeof executeRequestSchema>;

export const jobPayloadSchema = z.object({
  jobId: z.string().uuid(),
  userId: z.string().min(1),
  tier: tierSchema,
  videoUrl: youtubeUrlSchema,
  channelProfileId: z.string().uuid().optional(),
  outputLanguage: z.string().min(2).max(40),
  requestedAt: z.string().datetime(),
});

export type ViralDnaJobPayload = z.infer<typeof jobPayloadSchema>;

export const jobStateSchema = z.object({
  jobId: z.string().uuid(),
  userId: z.string().min(1),
  tier: tierSchema,
  queueClass: z.enum(['conveyor', 'vip']),
  delivery: z.enum(['polling', 'sse']),
  status: z.enum(['queued', 'processing', 'completed', 'failed']),
  progressPercent: z.number().int().min(0).max(100),
  stage: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});

export type JobState = z.infer<typeof jobStateSchema>;

export type JobEvent = Pick<
  JobState,
  'jobId' | 'status' | 'progressPercent' | 'stage' | 'updatedAt' | 'result' | 'error'
>;
