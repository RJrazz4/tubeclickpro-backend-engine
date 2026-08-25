import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Redis } from 'ioredis';
import { getConfig } from '../config/env.js';
import { ContextProvider, type GroundingBundle } from '../audience/context-provider.js';
import { OpenRouterRouter } from '../llm/router.js';
import { CostGuard } from '../llm/cost-guard.js';
import { logger } from '../observability/logger.js';
import {
  outlineSkeletonSchema,
  packageSchema,
  type OutlineSkeleton,
  type ScriptPackage,
} from './contracts.js';
import { criticMessages, outlineMessages, packagingMessages, PROMPT_VERSION, repairMessages, scriptMessages } from './prompts-v1.js';
import { criticVerdict, parseCritic, preCheckPackage } from './critic.js';
import { ChallengeService } from '../challenge/challenge-service.js';

/**
 * Crush synthesis orchestrator (T‑2B‑02/03).
 *
 *   free    → Stage 1 outline on the free model (1/day habit loop)
 *   premium → outline → script → packaging on the Claude-class model,
 *             deterministic pre-checks, then the LLM Audit Critic with a
 *             ≤2-repair loop against the 85/100 gate. Cost cap enforced
 *             across ALL calls via CostGuard.
 */

export type SynthesisResult =
  | { status: 'draft'; scriptId: string; kind: 'outline' | 'package'; total?: number; costUsd: number }
  | { status: 'rejected'; scriptId: string; reason: string; costUsd: number };

export class SynthesisService {
  constructor(
    private readonly sb: SupabaseClient,
    private readonly router: OpenRouterRouter,
    private readonly redis: Redis,
    private readonly challenge?: ChallengeService,
  ) {}

  private async completeJson<T>(
    messages: Parameters<OpenRouterRouter['complete']>[0],
    model: string,
    guard: CostGuard,
    schema: z.ZodType<T>,
    temperature: number,
  ): Promise<{ value: T; costUsd: number }> {
    let lastRaw = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const extra = attempt === 0
        ? { temperature, max_tokens: 4096 }
        : { temperature: 0, max_tokens: 4096 };
      const result = await this.router.complete(
        attempt === 0 ? messages : [...messages, { role: 'user', content: 'Your previous output was invalid JSON. Return the corrected JSON only.' }],
        model,
        extra,
      );
      guard.record(result.model, result.usage.promptTokens, result.usage.completionTokens);
      lastRaw = result.content;
      const cleaned = lastRaw.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
      const first = cleaned.indexOf('{');
      const last = cleaned.lastIndexOf('}');
      try {
        return { value: schema.parse(JSON.parse(cleaned.slice(first, last + 1))), costUsd: guard.spent };
      } catch {
        // retry once on malformed output
      }
    }
    throw new Error(`llm_json_invalid: ${lastRaw.slice(0, 160)}`);
  }

  async generate(input: { userId: string; tier: 'free' | 'premium'; hungerTopic?: string }): Promise<SynthesisResult> {
    const config = getConfig();
    const provider = new ContextProvider(this.sb);

    let bundle: GroundingBundle;
    try {
      bundle = await provider.build(input.userId, input.hungerTopic);
    } catch (err) {
      throw new Error(`grounding_unavailable: ${(err as Error).message}`);
    }

    const groundingJson = JSON.stringify(bundle.grounding);
    const stageInput = {
      grounding: bundle.grounding,
      groundingJson,
      bannedPhrases: bundle.grounding.channel.banned_phrases,
    };

    const model = input.tier === 'premium' ? config.OPENROUTER_MODEL_PREMIUM : config.OPENROUTER_MODEL_FREE;
    const capUsd = input.tier === 'premium' ? config.SCRIPT_SYNTHESIS_MAX_COST_USD : 0.02;
    const guard = new CostGuard({ capUsd });

    const insertRow = async (body: Record<string, unknown>): Promise<string> => {
      const { data, error } = await this.sb
        .from('script_packages')
        .insert({
          user_id: input.userId,
          tier: input.tier,
          grounding_hash: bundle.hash,
          prompt_version: PROMPT_VERSION,
          ...body,
        })
        .select('id')
        .single();
      if (error || !data) throw new Error(`script_store_failed: ${error?.message}`);
      return (data as { id: string }).id;
    };

    try {
      // ---- Stage 1: outline (free deliverable / premium scaffold) ----
      const outline = await this.completeJson(
        outlineMessages(stageInput), model, guard, outlineSkeletonSchema, 0.7,
      );

      if (input.tier === 'free') {
        const scriptId = await insertRow({
          kind: 'outline', status: 'draft', package: outline.value,
          critic: null, cost_usd: guard.spent, hunger_topic: outline.value.hunger_topic,
        });
        logger.info({ userId: input.userId, scriptId }, 'free outline generated');
        // The Daily Action Script IS the challenge check-in.
        await this.challenge?.recordDay(input.userId, 'script', scriptId);
        return { status: 'draft', scriptId, kind: 'outline', costUsd: guard.spent };
      }

      // ---- Stage 2: full script (premium) ----
      const script = await this.completeJson(
        scriptMessages(stageInput, outline.value), model, guard, z.record(z.string(), z.unknown()), 0.6,
      );

      // ---- Stage 3: packaging (merged into the script object) ----
      const packaged = await this.completeJson(
        packagingMessages(stageInput, script.value), model, guard, z.record(z.string(), z.unknown()), 0.9,
      );

      // ---- Pre-checks (cheap) → LLM critic (≤2 repairs) ----
      let current: unknown = { ...script.value, ...packaged.value };
      let lastScores: ReturnType<typeof parseCritic> | null = null;
      let total = 0;
      let repairsDone = 0;

      for (let round = 0; round < 3; round += 1) {
        const pre = preCheckPackage(current, bundle.grounding, stageInput.bannedPhrases);
        if (!pre.ok) {
          if (repairsDone >= 2) {
            const scriptId = await insertRow({
              kind: 'package', status: 'rejected', package: current,
              critic: { pre_check_failures: pre.failures }, cost_usd: guard.spent,
              hunger_topic: bundle.grounding.hunger.topic,
            });
            return { status: 'rejected', scriptId, reason: `pre_check: ${pre.failures[0]?.check ?? 'unknown'}`, costUsd: guard.spent };
          }
          current = (await this.completeJson(
            repairMessages(stageInput, current, { pre_check: pre.failures }, pre.failures.map((f) => `${f.check}: ${f.detail}`)),
            model, guard, z.record(z.string(), z.unknown()), 0.4,
          )).value;
          repairsDone += 1;
          continue;
        }

        const judged = await this.completeJson(
          criticMessages(stageInput, current), model, guard,
          z.custom<ReturnType<typeof parseCritic>>(), 0.2,
        );
        lastScores = judged.value as ReturnType<typeof parseCritic>;
        total = criticVerdict(lastScores).total;

        if (criticVerdict(lastScores).pass) {
          const finalPkg = pre.value;
          const scriptId = await insertRow({
            kind: 'package', status: 'draft', package: finalPkg,
            critic: { ...lastScores, weighted_total: total },
            cost_usd: guard.spent, hunger_topic: finalPkg.hunger_topic,
          });
          logger.info({ userId: input.userId, scriptId, total, cost: guard.spent }, 'script package approved by critic');
          await this.challenge?.recordDay(input.userId, 'script', scriptId);
          return { status: 'draft', scriptId, kind: 'package', total, costUsd: guard.spent };
        }

        if (repairsDone >= 2) break;
        current = (await this.completeJson(
          repairMessages(stageInput, current, lastScores.scores, lastScores.fixes),
          model, guard, z.record(z.string(), z.unknown()), 0.4,
        )).value;
        repairsDone += 1;
      }

      const scriptId = await insertRow({
        kind: 'package', status: 'rejected', package: current,
        critic: lastScores ? { ...lastScores, weighted_total: total } : null,
        cost_usd: guard.spent, hunger_topic: bundle.grounding.hunger.topic,
      });
      return { status: 'rejected', scriptId, reason: `critic_threshold: total ${total} < 85 after ${repairsDone} repairs`, costUsd: guard.spent };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ userId: input.userId, error: message }, 'synthesis aborted');
      const scriptId = await insertRow({
        kind: input.tier === 'free' ? 'outline' : 'package', status: 'rejected',
        package: null, critic: { error: message.slice(0, 300) }, cost_usd: guard.spent,
        hunger_topic: bundle.grounding.hunger.topic,
      }).catch(() => '00000000-0000-0000-0000-000000000000');
      return { status: 'rejected', scriptId, reason: message.slice(0, 200), costUsd: guard.spent };
    }
  }
}
