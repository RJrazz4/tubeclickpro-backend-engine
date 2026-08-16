import { z } from 'zod';

export const transcriptChunkSchema = z.object({
  startSeconds: z.number().min(0),
  durationSeconds: z.number().min(0),
  text: z.string(),
});

export const extractionResultSchema = z.object({
  source: z.literal('agent-reach/yt-dlp'),
  mode: z.enum(['basic', 'deep']),
  video: z.object({
    id: z.string(),
    title: z.string(),
    channel: z.string().nullable(),
    durationSeconds: z.number().nullable(),
    viewCount: z.number().nullable(),
    publishedAt: z.string().nullable(),
    description: z.string().nullable(),
    thumbnailUrl: z.string().nullable(),
  }),
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
