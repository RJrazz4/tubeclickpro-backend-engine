import { z } from 'zod';

/**
 * ScriptPackage v1 — the deliverable contract (docs/PROMPT_ARCHITECTURE.md §3).
 * Every stage's LLM output must validate against these shapes; the critic's
 * deterministic pre-checks run on the same object.
 */

export const hookSchema = z.object({
  text: z.string().min(10),
  seconds: z.number().int().min(3).max(10),
  variants: z.array(z.string().min(10)).length(2),
});

export const beatSchema = z.object({
  title: z.string().min(3),
  purpose: z.string().min(5),
  seconds: z.number().int().min(10).max(600),
});

export const sectionSchema = z.object({
  heading: z.string().min(3),
  voiceover: z.string().min(80),
  b_roll_cues: z.array(z.string()).default([]),
  on_screen_text: z.string().optional(),
});

export const voiceMapEntrySchema = z.object({
  line: z.string().min(5),
  voice_alias: z.string().default('narrator'),
  emphasis: z.string().optional(),
});

export const packageSchema = z.object({
  hunger_topic: z.string().min(2),
  language_directive: z.string().min(3),
  hook: hookSchema,
  beats: z.array(beatSchema).min(6).max(8),
  sections: z.array(sectionSchema).min(3),
  title_variants: z.array(z.string().min(8)).length(5),
  thumbnail_texts: z.array(z.string().min(2).max(40)).length(3),
  description: z.string().min(80),
  tags: z.array(z.string().min(2)).min(5).max(20),
  chapters: z.array(z.object({ label: z.string().min(2), at_second: z.number().int().min(0) })).min(3),
  voice_map: z.array(voiceMapEntrySchema).default([]),
  posting_window: z.object({ note: z.string().min(3) }),
  audience_evidence: z.object({
    grounding_references: z.array(z.string()).min(3),
    evidence_numbers: z.array(z.string()).min(3),
  }),
});

export type ScriptPackage = z.infer<typeof packageSchema>;

/** Free-tier skeleton (the daily-habit teaser). */
export const outlineSkeletonSchema = z.object({
  hunger_topic: z.string().min(2),
  hook_angle: z.string().min(20),
  beats: z.array(beatSchema).min(6).max(8),
  why_it_works: z.array(z.string()).min(3),
});
export type OutlineSkeleton = z.infer<typeof outlineSkeletonSchema>;

export const CRITIC_SCORES_SCHEMA = z.object({
  scores: z.object({
    audience_grounding: z.number().min(0).max(100),
    hook_strength: z.number().min(0).max(100),
    retention_engineering: z.number().min(0).max(100),
    craft: z.number().min(0).max(100),
    packaging: z.number().min(0).max(100),
  }),
  verdict: z.enum(['pass', 'repair']),
  fixes: z.array(z.string()).default([]),
});
export type CriticScores = z.infer<typeof CRITIC_SCORES_SCHEMA>;

export const CRITIC_WEIGHTS = {
  audience_grounding: 0.25,
  hook_strength: 0.2,
  retention_engineering: 0.2,
  craft: 0.2,
  packaging: 0.15,
} as const;

export function weightedTotal(scores: CriticScores['scores']): number {
  return Math.round(
    CRITIC_WEIGHTS.audience_grounding * scores.audience_grounding +
      CRITIC_WEIGHTS.hook_strength * scores.hook_strength +
      CRITIC_WEIGHTS.retention_engineering * scores.retention_engineering +
      CRITIC_WEIGHTS.craft * scores.craft +
      CRITIC_WEIGHTS.packaging * scores.packaging,
  );
}

/** Default banned phrases; merged with the channel's own list at runtime. */
export const DEFAULT_BANNED_PHRASES = [
  'in this video, we will',
  'before we start, don\'t forget to',
  'hey guys, welcome back',
  'let\'s dive right in',
  'without further ado',
  'smash that like button',
  'in today\'s video',
];
