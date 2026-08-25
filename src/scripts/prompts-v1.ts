/**
 * PROMPT ARTIFACTS v1 — versioned in-repo (a prompt change is a code change:
 * reviewed, diffable, rollback-able; hash-pinned in CI via these exports).
 *
 * Five-block assembly per docs/PROMPT_ARCHITECTURE.md §3:
 *   1 persona ladder · 2 AudienceGrounding (verbatim JSON) ·
 *   3 structural contract · 4 style constraints · 5 negative space
 */

import type { AudienceGrounding } from '../audience/context-provider.js';
import type { ChatMessage } from '../llm/types.js';

export const PROMPT_VERSION = 'v1';

const PERSONA = `You are a principal YouTube strategist and retention editor with 10 years launching channels past 100K subs. You write like a premium agency consultant delivering a $2,000 content package: specific, evidence-driven, zero filler. You have shipped thousands of scripts and know exactly why viewers stay or leave in the first 10 seconds.`;

const NEGATIVE_SPACE = `HARD BANS — violating any of these fails the review:
- NO filler intros ("in this video we will", "hey guys welcome back", "without further ado"), NO begging for engagement
- NEVER invent statistics, quotes, or numbers that are not in the AUDIENCE GROUNDING block
- NO moralizing, NO throat-clearing, NO "let's dive in" transitions
- The hook must deliver a concrete promise + curiosity gap within its second budget
- Do not describe the script; WRITE it (full voiceover lines, spoken register)`;

const JSON_ONLY = `Return STRICT JSON only — no markdown fences, no commentary, no keys beyond the contract.`;

export interface StageInput {
  grounding: AudienceGrounding;
  groundingJson: string;
  bannedPhrases: string[];
}

function groundingBlock(input: StageInput): string {
  return [
    `AUDIENCE GROUNDING (the creator's real analytics — every claim you make must trace here):`,
    input.groundingJson,
    '',
    `The chosen HUNGER is "${input.grounding.hunger.topic}" (score ${input.grounding.hunger.score}).`,
    `You MUST reference at least 3 distinct grounding facts in audience_evidence.grounding_references and echo the raw numbers in evidence_numbers.`,
  ].join('\n');
}

function styleBlock(input: StageInput): string {
  return [
    `STYLE: ${input.grounding.audience.language_directive}.`,
    input.grounding.audience.demo_pyramid ? `Primary viewer: ${input.grounding.audience.demo_pyramid}.` : '',
    input.grounding.audience.retention_lessons.length
      ? `RETENTION LESSONS (from their real data): ${input.grounding.audience.retention_lessons.join(' | ')}`
      : '',
    input.bannedPhrases.length ? `BANNED PHRASES (creator-specific, hard fail): ${input.bannedPhrases.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Stage 1 — OUTLINE (free-tier deliverable + premium step 1)
// ---------------------------------------------------------------------------
export function outlineMessages(input: StageInput): ChatMessage[] {
  return [
    { role: 'system', content: `${PERSONA}\n\n${NEGATIVE_SPACE}\n\n${JSON_ONLY}` },
    {
      role: 'user',
      content: [
        groundingBlock(input),
        '',
        styleBlock(input),
        '',
        'TASK: Design the outline for ONE video that serves this hunger.',
        'Contract (JSON): {"hunger_topic": string, "hook_angle": string (the concrete promise, 1-2 sentences, spoken register), "beats": [{"title","purpose","seconds"}] exactly 6-8 beats covering hook..payoff..CTA, "why_it_works": [>=3 strings each citing a grounding number]}.',
        `Format directive: ${input.grounding.format_directive}.`,
      ].join('\n'),
    },
  ];
}

// ---------------------------------------------------------------------------
// Stage 2 — FULL SCRIPT (premium)
// ---------------------------------------------------------------------------
export function scriptMessages(input: StageInput, outline: unknown): ChatMessage[] {
  return [
    { role: 'system', content: `${PERSONA}\n\n${NEGATIVE_SPACE}\n\n${JSON_ONLY}` },
    {
      role: 'user',
      content: [
        groundingBlock(input),
        '',
        styleBlock(input),
        '',
        'APPROVED OUTLINE (yours to expand, do not contradict it):',
        JSON.stringify(outline),
        '',
        'TASK: Write the full script. Contract (JSON):',
        '{"hunger_topic","language_directive","hook":{"text","seconds"<=10,"variants"[2]},',
        '"beats":[same as outline],"sections":[{"heading","voiceover" (>=120 words each, spoken register, concrete),"b_roll_cues"[>=1],"on_screen_text"?}],',
        '"chapters":[{"label","at_second"}], "voice_map":[{"line" (a standout line to perform),"voice_alias":"narrator","emphasis"?}],',
        '"audience_evidence":{"grounding_references"[>=3],"evidence_numbers"[>=3]}}.',
        `Format directive: ${input.grounding.format_directive}. Sections must map 1:1 to beats.`,
      ].join('\n'),
    },
  ];
}

// ---------------------------------------------------------------------------
// Stage 3 — PACKAGING (premium)
// ---------------------------------------------------------------------------
export function packagingMessages(input: StageInput, script: unknown): ChatMessage[] {
  return [
    { role: 'system', content: `${PERSONA}\n\n${JSON_ONLY}` },
    {
      role: 'user',
      content: [
        groundingBlock(input),
        '',
        styleBlock(input),
        '',
        'SCRIPT (package it):',
        JSON.stringify(script).slice(0, 12_000),
        '',
        'TASK: Packaging. Contract (JSON): {"title_variants": [EXACTLY 5, <=70 chars, curiosity+specific, no clickbait-emptiness], "thumbnail_texts": [EXACTLY 3, <=5 words, high-contrast], "description": (>=120 words, first 2 lines carry the hook + the strongest grounding number, timestamps appended), "tags": [5-20], "posting_window": {"note"}, } merge into the script object.',
      ].join('\n'),
    },
  ];
}

// ---------------------------------------------------------------------------
// REPAIR pass (after critic fixes)
// ---------------------------------------------------------------------------
export function repairMessages(input: StageInput, pkg: unknown, scores: unknown, fixes: string[]): ChatMessage[] {
  return [
    { role: 'system', content: `${PERSONA}\n\n${NEGATIVE_SPACE}\n\n${JSON_ONLY}` },
    {
      role: 'user',
      content: [
        groundingBlock(input),
        '',
        styleBlock(input),
        '',
        'CURRENT PACKAGE:',
        JSON.stringify(pkg).slice(0, 12_000),
        '',
        'CRITIC SCORES:',
        JSON.stringify(scores),
        '',
        `CRITIC FIXES (address every one, keep everything else): ${fixes.join(' | ')}`,
        'Return the FULL corrected package JSON (same contract).',
      ].join('\n'),
    },
  ];
}

// ---------------------------------------------------------------------------
// CRITIC — LLM judge (deterministic pre-checks run before this, in code)
// ---------------------------------------------------------------------------
export function criticMessages(input: StageInput, pkg: unknown): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `You are the Audit Critic for a premium content agency. You are ruthless, numerical, and never generous. Score 0-100 per axis. ${JSON_ONLY}`,
    },
    {
      role: 'user',
      content: [
        groundingBlock(input),
        '',
        styleBlock(input),
        '',
        'PACKAGE TO AUDIT:',
        JSON.stringify(pkg).slice(0, 12_000),
        '',
        'RUBRIC (score each 0-100, be harsh):',
        'audience_grounding: does EVERY section demonstrably serve the chosen hunger? are geo/language/demo/timing directives honored? are >=3 grounding facts cited?',
        'hook_strength: concrete promise + curiosity gap inside the second budget? no throat-clearing?',
        'retention_engineering: beat cadence, open loops, pattern interrupts per chunk?',
        'craft: voice consistency, spoken register, zero banned phrases, reading level fits the demo pyramid?',
        'packaging: titles specific and clickable without emptiness? thumbnail text <=5 words?',
        '',
        'Contract (JSON): {"scores":{"audience_grounding","hook_strength","retention_engineering","craft","packaging"}, "verdict":"pass"|"repair" (pass only if weighted total >= 85), "fixes":[specific, actionable strings]}.',
      ].join('\n'),
    },
  ];
}

// ---------------------------------------------------------------------------
// T‑2C — AUDIENCE BRIEF (cached narrative; deterministic inputs only)
// ---------------------------------------------------------------------------
export function briefMessages(
  rollups: Record<string, unknown>,
  hungers: Array<Record<string, unknown>>,
): ChatMessage[] {
  const hungerLines = hungers
    .slice(0, 5)
    .map((h) => `- ${h.topic} (score ${h.score}): ${JSON.stringify(h.evidence)}`)
    .join('\n');
  return [
    {
      role: 'system',
      content: `You are a principal YouTube strategist writing a private brief for a paying creator. Blunt, numerical, zero fluff. Every number must come from the data provided — invent nothing. ${JSON_ONLY}`,
    },
    {
      role: 'user',
      content: [
        'CHANNEL ROLLUPS (their real analytics, 28-day window):',
        JSON.stringify(rollups),
        '',
        'HUNGER CARDS (ranked, with evidence):',
        hungerLines,
        '',
        'TASK: Write the Audience Brief. Contract (JSON):',
        '{"headline": one killer sentence, "who": who actually watches (demo pyramid + device), "where_when": geography + viewing pattern, "what_they_want": [3-6 strings citing hunger evidence], "retention_truth": the single hardest retention lesson with its number, "next_3_videos": EXACTLY 3 {"title_idea" (ready to produce), "why" (ties to a hunger card number), "hunger_topic"}}',
        'Tone: like a $2,000/hour consultant who respects the creator enough to be direct.',
      ].join('\n'),
    },
  ];
}
