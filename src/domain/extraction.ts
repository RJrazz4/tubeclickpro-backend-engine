import { z } from 'zod';

export const transcriptChunkSchema = z.object({
  startSeconds: z.number().min(0),
  durationSeconds: z.number().min(0),
  text: z.string(),
});

export const channelDetailsSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  customUrl: z.string().nullable(),
  subscriberCount: z.number().nullable(),
  videoCount: z.number().nullable(),
  viewCount: z.number().nullable(),
  thumbnailUrl: z.string().nullable(),
});

export const extractionResultSchema = z.object({
  source: z.enum(['agent-reach/yt-dlp', 'youtube-data-api']),
  mode: z.enum(['basic', 'deep']),
  video: z.object({
    id: z.string(),
    title: z.string(),
    channelId: z.string().nullable(),
    channel: z.string().nullable(),
    durationSeconds: z.number().nullable(),
    viewCount: z.number().nullable(),
    publishedAt: z.string().nullable(),
    description: z.string().nullable(),
    thumbnailUrl: z.string().nullable(),
  }),
  channelDetails: channelDetailsSchema.nullable(),
  transcript: z.array(transcriptChunkSchema),
  hookWindow: z.array(transcriptChunkSchema),
  warnings: z.array(z.string()),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export interface PipelineResult {
  tier: 'free' | 'premium';
  delivery: 'polling' | 'sse';
  extraction: ExtractionResult;
  hookAnalysis: Record<string, unknown> | null;
  criticAudit: Record<string, unknown> | null;
}
