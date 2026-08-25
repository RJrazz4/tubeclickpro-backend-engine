import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getConfig } from '../config/env.js';
import { OpenRouterRouter } from '../llm/router.js';
import { CostGuard } from '../llm/cost-guard.js';
import { logger } from '../observability/logger.js';
import { briefMessages, PROMPT_VERSION } from '../scripts/prompts-v1.js';

/**
 * T‑2C — the Audience Brief: the LLM narrative layer on top of deterministic
 * rollups. Cached in audience_profiles.narrative and regenerated ONLY when
 * the rollups hash drifts (the RPC already nulls narrative on drift; this
 * service double-checks and stores the hash it was built on). Cap $0.03.
 */

export const BRIEF_MAX_COST_USD = 0.03;

export const briefSchema = z.object({
  headline: z.string().min(10),
  who: z.string().min(20),
  where_when: z.string().min(20),
  what_they_want: z.array(z.string()).min(3).max(6),
  retention_truth: z.string().min(20),
  next_3_videos: z
    .array(z.object({ title_idea: z.string().min(8), why: z.string().min(15), hunger_topic: z.string().min(2) }))
    .length(3),
});
export type AudienceBrief = z.infer<typeof briefSchema>;

export interface StoredNarrative {
  built_on_hash: string;
  generated_at: string;
  model: string;
  prompt_version: string;
  brief: AudienceBrief;
}

export class BriefService {
  constructor(
    private readonly sb: SupabaseClient,
    private readonly router: OpenRouterRouter,
  ) {}

  async getOrGenerate(userId: string): Promise<{ brief: AudienceBrief; cached: boolean; rollupsHash: string }> {
    const { data: profileRow } = await this.sb
      .from('audience_profiles')
      .select('freshness, rollups, rollups_hash, narrative')
      .eq('user_id', userId)
      .maybeSingle();
    const profile = profileRow as
      | { freshness: string; rollups: Record<string, unknown>; rollups_hash: string; narrative: StoredNarrative | null }
      | null;
    if (!profile || profile.freshness === 'empty') {
      throw new Error('brief_unavailable_no_profile');
    }

    // Cache contract: narrative survives only while the rollups hash matches.
    if (profile.narrative?.built_on_hash === profile.rollups_hash) {
      return { brief: profile.narrative.brief, cached: true, rollupsHash: profile.rollups_hash };
    }

    const { data: hungerRows } = await this.sb
      .from('audience_hungers')
      .select('topic, score, evidence, rank')
      .eq('user_id', userId)
      .order('rank', { ascending: true });
    const hungers = (hungerRows ?? []) as Array<Record<string, unknown>>;

    const config = getConfig();
    const model = config.OPENROUTER_MODEL_PREMIUM;
    const guard = new CostGuard({ capUsd: BRIEF_MAX_COST_USD });

    let raw = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await this.router.complete(
        briefMessages(profile.rollups, hungers),
        model,
        { temperature: 0.5, max_tokens: 2048 },
      );
      guard.record(result.model, result.usage.promptTokens, result.usage.completionTokens);
      raw = result.content;
      try {
        const cleaned = raw.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
        const first = cleaned.indexOf('{');
        const last = cleaned.lastIndexOf('}');
        const brief = briefSchema.parse(JSON.parse(cleaned.slice(first, last + 1)));
        const narrative: StoredNarrative = {
          built_on_hash: profile.rollups_hash,
          generated_at: new Date().toISOString(),
          model: result.model,
          prompt_version: PROMPT_VERSION,
          brief,
        };
        await this.sb
          .from('audience_profiles')
          .update({ narrative })
          .eq('user_id', userId);
        logger.info({ userId, cost: guard.spent }, 'audience brief generated');
        return { brief, cached: false, rollupsHash: profile.rollups_hash };
      } catch (err) {
        if (err instanceof z.ZodError && attempt === 1) {
          throw new Error(`brief_json_invalid: ${err.issues[0]?.path.join('.') ?? ''}`);
        }
        // retry once
      }
    }
    throw new Error('brief_json_invalid');
  }
}
