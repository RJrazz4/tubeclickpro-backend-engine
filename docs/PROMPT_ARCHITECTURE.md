# Prompt Architecture — the "Ultra High-Value Text" Mandate (Module C spec)

The product's deliverable is TEXT that feels like a premium agency consultant
wrote it. Generic LLM output is a subscription-killer. This spec — locked
now, implemented in Phase 3 — defines how the Crush synthesis guarantees
hyper-specific, data-backed scripts.

---

## 1. The iron rule: no data, no text

**Every generated sentence must be traceable to an evidence card.** The
synthesizer never receives "write a script about X" — it receives a
structured `AudienceGrounding` block and a rubric that scores grounding.
A script that could have been written without the user's data cannot pass
the critic (§4).

## 2. The AudienceGrounding block (strict JSON, token-budgeted ≤ 1,200)

Built deterministically from `audience_profiles` (Phase 2), never model-generated:

```json
{
  "channel": {"title": "...", "niche": "...", "tone_axes": {...}, "banned_phrases": [...]},
  "audience": {
    "primary_geo": {"country": "IN", "share_pct": 71, "states": ["UP", "MH"]},
    "language_directive": "Hinglish — conversational Hindi-English mix, Devanagari-free",
    "demo_pyramid": "18-24 male 46%, 25-34 male 22%, ...",
    "attention_pattern": "avg 6.4 min sessions, 21:00-23:30 local peak, mobile 83%",
    "retention_lessons": ["intros >14s lose 38% (your data)", "strong-end format +22% AVD"]
  },
  "hungers": [
    {"topic": "budget camera comparisons", "score": 0.87,
     "evidence": {"watch_share_pct": 31, "ctr_lift": 1.4, "supply_gap": "0 videos in 90d", "radar": "3 niche outliers <21d"}}
  ],
  "timing": {"best_slots_utc": ["15:30", "16:15"], "why": "IN evening peak"},
  "format_directive": "long-form 8-11 min, cold-open hook, chaptered"
}
```

## 3. Five-block prompt assembly (deterministic, versioned)

| Block | Source | Rule |
|---|---|---|
| 1. Persona ladder | static, versioned | "You are a 10-year YouTube strategist + retention editor for {niche}" — never user-editable, never model-invented |
| 2. AudienceGrounding | DB (deterministic) | Injected VERBATIM as JSON; a post-generation test asserts the model referenced ≥3 hungers/evidence items |
| 3. Structural contract | static | ScriptPackage v1 zod schema: hook (0-10s, 2 variants), 6-8 retention beats, chunk architecture, B-roll cues, title ×5, thumbnail text ×3, description/tags/chapters, voice map |
| 4. Style constraints | Module A profile | Tone axes, banned phrases, language directive (e.g., Hinglish), reading-level band from demo pyramid |
| 5. Negative space | static | "Do NOT: moralize, use filler intros, exceed hook budget, invent statistics not present in the grounding block" |

Prompts are **versioned artifacts in-repo** (`prompts/v1/*.md`) with fixture
tests — a prompt change is a code change (reviewed, diffable, rollback-able),
never a live hot-edit.

## 4. The critic rubric — audience-grounding axis added

Writer↔critic loop (existing) retains the 85/100 gate; the rubric gains:

| Axis | Weight | Scored how |
|---|---|---|
| **Audience grounding** | 25 | Does every section serve a named hunger? Are geo/language/timing directives honored? Scored against the SAME grounding block (deterministic checker + LLM judge) |
| Hook strength (0-10s) | 20 | Cold-open specificity, curiosity gap, no throat-clearing |
| Retention engineering | 20 | Beat cadence, pattern interrupts, open loops per chunk |
| Craft (voice/tone/banned-phrase compliance) | 20 | Style constraints honored; zero banned phrases (hard fail) |
| Packaging (titles/thumbnail/description) | 15 | CTR-oriented, specific, not clickbait-empty |

Deterministic pre-checks run BEFORE the LLM critic (cheap rejects first):
banned-phrase scan, hook length, grounding-reference count, JSON schema.

## 5. Cost & quality guards

- Per-script synthesis cap **$0.12** (existing cost tracker), narrative
  profile cap $0.03 (cached until data drifts >10%).
- Temperature discipline: outline 0.7 → script 0.6 → packaging 0.9
  (divergent where variety pays, grounded where facts matter).
- Few-shot policy: only STATIC gold examples in-repo (never user content —
  no cross-user leakage, ever).
- Every ScriptPackage stores its grounding-block hash — full reproducibility
  and A/B-able prompt versions.

## 6. Why this justifies the subscription

The output cites the creator's OWN numbers back at them: "Your UP/MH 18-24
male audience binges 8-min budget-camera comparisons at 9 PM and you haven't
published one in 90 days — here is that video, engineered beat-by-beat
against your retention curves." No generic tool can say that sentence.
