import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * AudienceContextProvider — builds the AudienceGrounding block.
 *
 * IRON RULE (docs/PROMPT_ARCHITECTURE.md §1): every generated sentence must
 * trace to an evidence card. This provider is the ONLY bridge between the
 * deterministic Audience Engine and the LLM. Same DB state ⇒ byte-identical
 * JSON ⇒ identical grounding hash. Never model-generated.
 */

export interface GroundingHunger {
  topic: string;
  score: number;
  evidence: Record<string, unknown>;
}

export interface AudienceGrounding {
  channel: {
    title: string | null;
    niche: string | null;
    tone: string | null;
    banned_phrases: string[];
    source: 'channel_profiles' | 'pending';
  };
  audience: {
    primary_geo: { country: string | null; share_pct: number | null };
    language_directive: string;
    demo_pyramid: string | null;
    retention_lessons: string[];
  };
  hunger: GroundingHunger;
  co_hungers: Array<Pick<GroundingHunger, 'topic' | 'score'>>;
  format_directive: string;
  timing: { note: string };
}

export interface GroundingBundle {
  grounding: AudienceGrounding;
  hash: string;
  charLength: number;
}

/** Soft token estimate (~4 chars/token) for the ≤1,200-token budget. */
export const MAX_GROUNDING_CHARS = 4_800;

const LANGUAGE_DIRECTIVES: Record<string, string> = {
  IN: 'Hinglish — conversational Hindi-English mix (Roman script), culturally local examples, no Sanskritized formality',
  US: 'American English — direct, high-energy, cultural references calibrated to 18-34',
  GB: 'British English — dry wit allowed, metric units',
  AE: 'English with Gulf-context examples; light Hindi/Urdu phrases acceptable',
  PK: 'English with Urdu phrases; cricket and local-price contexts',
  BD: 'English with Bangla phrases where natural',
};

export function languageDirective(country: string | null): string {
  return (country && LANGUAGE_DIRECTIVES[country]) ?? 'Clear international English';
}

/** Retention lessons derived deterministically from the rollups. */
export function retentionLessons(rollups: Record<string, unknown>): string[] {
  const lessons: string[] = [];
  const retention = Array.isArray(rollups.retention_top20)
    ? (rollups.retention_top20 as Array<Record<string, unknown>>)
    : [];
  if (retention.length > 0) {
    const weak = retention.filter((r) => r.class === 'weak_hook').length;
    const strong = retention.filter((r) => r.class === 'strong_end').length;
    if (weak > retention.length / 3) {
      lessons.push(`${weak}/${retention.length} of your top videos lose viewers in the opening seconds — cold-open, no throat-clearing`);
    }
    if (strong > retention.length / 3) {
      lessons.push(`${strong}/${retention.length} hold to the end — your audience rewards payoff structure, keep open loops per chunk`);
    }
    const sag = retention.filter((r) => r.class === 'mid_sag').length;
    if (sag > retention.length / 3) {
      lessons.push(`${sag}/${retention.length} sag mid-video — cut any section without new information`);
    }
  }
  const format = rollups.format_split as Record<string, unknown> | undefined;
  if (format && typeof format.shorts_videos === 'number' && typeof format.long_videos === 'number') {
    const total = format.shorts_videos + format.long_videos;
    if (total > 0 && format.shorts_videos / total > 0.6) {
      lessons.push('Your catalog is Shorts-heavy; long-form is under-explored where watch time lives');
    }
  }
  return lessons;
}

export function formatDirective(rollups: Record<string, unknown>): string {
  const geo = rollups.top_country;
  const demo = Array.isArray(rollups.demo_pyramid)
    ? (rollups.demo_pyramid as Array<Record<string, unknown>>)[0]
    : undefined;
  const mobile = (rollups.tech as Record<string, unknown> | undefined)?.mobile_share_pct;
  const parts = ['8-11 minute long-form with chaptered retention beats'];
  if (typeof mobile === 'number' && mobile >= 60) parts.push('mobile-first pacing (short sentences, on-screen text cues)');
  if (demo) parts.push(`aimed at ${demo.age_group} ${demo.gender === 'female' ? 'women' : 'men'}`);
  if (geo) parts.push(`(${geo}-primary audience)`);
  return parts.join(', ');
}

export function demoPyramidLabel(rollups: Record<string, unknown>): string | null {
  const demo = Array.isArray(rollups.demo_pyramid)
    ? (rollups.demo_pyramid as Array<Record<string, unknown>>).slice(0, 3)
    : [];
  if (demo.length === 0) return null;
  return demo
    .map((d) => `${d.age_group} ${d.gender === 'female' ? '♀' : '♂'} ${d.view_share_pct}%`)
    .join(' · ');
}

export class ContextProvider {
  constructor(private readonly sb: SupabaseClient) {}

  async build(userId: string, hungerTopic?: string): Promise<GroundingBundle> {
    const { data: profileRow } = await this.sb
      .from('audience_profiles')
      .select('freshness, rollups')
      .eq('user_id', userId)
      .maybeSingle();
    const profile = profileRow as { freshness?: string; rollups?: Record<string, unknown> } | null;
    if (!profile || profile.freshness === 'empty') {
      throw new Error('grounding_unavailable_no_profile');
    }
    const rollups = profile.rollups ?? {};

    const { data: hungerRows } = await this.sb
      .from('audience_hungers')
      .select('topic, score, evidence, rank')
      .eq('user_id', userId)
      .order('rank', { ascending: true });
    const hungers = (hungerRows ?? []) as Array<Record<string, unknown>>;
    if (hungers.length === 0) throw new Error('grounding_unavailable_no_hungers');

    const chosen = (hungerTopic ? hungers.find((h) => h.topic === hungerTopic) : undefined) ?? hungers[0];
    if (!chosen) throw new Error('grounding_unavailable_no_hungers');
    if (hungerTopic && chosen.topic !== hungerTopic) {
      throw new Error('grounding_unknown_topic');
    }

    // Module A public DNA (channel_profiles) — optional until Module A wiring.
    const { data: dnaRow } = await this.sb
      .from('channel_profiles')
      .select('fingerprint')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    const dna = (dnaRow as { fingerprint?: Record<string, unknown> } | null)?.fingerprint ?? null;

    const geo = Array.isArray(rollups.geo) ? (rollups.geo as Array<Record<string, unknown>>)[0] : undefined;

    const grounding: AudienceGrounding = {
      channel: {
        title: (dna?.channel_title as string) ?? null,
        niche: (dna?.niche as string) ?? null,
        tone: (dna?.tone as string) ?? null,
        banned_phrases: Array.isArray(dna?.banned_phrases) ? (dna.banned_phrases as string[]) : [],
        source: dna ? 'channel_profiles' : 'pending',
      },
      audience: {
        primary_geo: {
          country: (rollups.top_country as string) ?? null,
          share_pct: typeof geo?.watch_share_pct === 'number' ? geo.watch_share_pct : null,
        },
        language_directive: languageDirective(rollups.top_country as string | null),
        demo_pyramid: demoPyramidLabel(rollups),
        retention_lessons: retentionLessons(rollups),
      },
      hunger: {
        topic: chosen.topic as string,
        score: Number(chosen.score),
        evidence: (chosen.evidence as Record<string, unknown>) ?? {},
      },
      co_hungers: hungers.slice(1, 4).map((h) => ({
        topic: h.topic as string,
        score: Number(h.score),
      })),
      format_directive: formatDirective(rollups),
      timing: {
        note: 'Best slots derive from Pulse velocity curves (Phase P); today: use day-of-week strength in rollups.day_of_week',
      },
    };

    const canonical = JSON.stringify(grounding);
    if (canonical.length > MAX_GROUNDING_CHARS) {
      // Deterministic trim: drop co_hungers before ever truncating evidence.
      grounding.co_hungers = grounding.co_hungers.slice(0, 1);
    }
    const canonicalFinal = JSON.stringify(grounding);
    return {
      grounding,
      hash: createHash('sha256').update(canonicalFinal).digest('hex').slice(0, 16),
      charLength: canonicalFinal.length,
    };
  }
}
