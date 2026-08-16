# 🧬 VIRAL DNA EXTRACTOR & SCRIPT SYNTHESIZER — Master Technical Architecture

> **Project:** TubeClick Pro — Evolution of the "60% Glitch" Chain-Loop Engine
> **Status:** ARCHITECTURAL MASTERPLAN — Pre-Implementation
> **Author:** Architecture & Engineering Lead
> **Target:** Transform the basic competitor-copying feature (`api/clone-crush.ts`) into a world-class, autonomous viral intelligence and script-generation microservice.

---

## Executive Summary

The existing **Clone-Crush / Glitch Intensity Engine** (`api/clone-crush.ts`, `packages/orchestrator/generator/`) performs structured competitor reverse-engineering: profile extraction, viral competitor ranking, 60%/99% intensity rewrites, thumbnail prompts, and a multi-agent adversarial writer↔critic pipeline (`api/_agenticEngine.ts`).

This architecture **evolves** that engine from a "text-copying" pipeline into the **Viral DNA Extractor & Script Synthesizer** — a fully autonomous, multi-modal, psychologically-informed content intelligence microservice that:

1. Understands a creator's exact niche, tone, and audience fingerprint.
2. Monitors a 15-day rolling viral radar within that niche.
3. Deconstructs the first 0–10 seconds of viral hits with forensic psychological analysis.
4. Generates fresh, high-retention scripts as engineered chunk architectures.
5. Integrates **3 new professional-grade capabilities**: Pacing & AVD Analysis, Emotion & Trigger Mapping, and Voice Resonance Fingerprinting.

This document is the **masterplan only** — no final code is written here. It defines the system design, data flows, module interfaces, testing contracts, and deployment topology.

---

## 1. System Philosophy & Design Principles

### 1.1 Core Principles (Inherited & Extended)

| Principle | Existing Source | Extension for Viral DNA Engine |
|---|---|---|
| **Server-side trust boundary** | `ARCHITECTURE.md` §2 | Every DNA extraction, radar result, and script chunk validated server-side; no client-side quota or credit manipulation |
| **Provider-agnostic orchestration** | `packages/orchestrator/providers/` | DNA analysis models (Gemini, Claude, Llama Vision, audio embedders) selected by cost + quality; no single vendor lock-in |
| **Graceful degradation** | `api/clone-crush.ts` synthetic fallback | If viral radar is offline, engine falls back to **Ghost Memory** (persistent per-user viral index) rather than generic templates |
| **Self-healing adversarial loop** | `runAgenticPipeline()` Writer↔Critic | Extended to **4-phase synthesis**: Extract → Analyze → Deconstruct → Synthesize, with a 5th **Audit Critic** enforcing 85/100 threshold |
| **Type-safety end to end** | Zod schemas across `packages/orchestrator/api/` | Every DNA chunk, radar item, psychological trigger, and pacing metric typed; JSON schemas published in `docs/openapi.yaml` |
| **Cost-aware routing** | `packages/orchestrator/cost/cost-tracker.ts` | Per-call token budget for DNA extraction capped at $0.08; script synthesis capped at $0.12; visual recon at $0.25 per video |

### 1.2 What Changes & What Stays

- **UNSTABLE / REBUILT:** `api/clone-crush.ts` (action `rewrite` and the synthetic competitor matrix) — rebuilt as `api/viral-dna/synthesize.ts`
- **EXTENDED:** `packages/orchestrator/generator/generator-agent.ts` — new `ChunkSynthesisAgent` for micro-hook script architecture
- **EXTENDED:** `packages/orchestrator/ai-gateway.ts` — new `multimodalVideoAnalysis()` and `audioResonanceProfile()` interfaces
- **PRESERVED:** `packages/orchestrator/resilience/` (circuit breaker, fallback executor), `packages/orchestrator/keys/` (key rotation), `packages/orchestrator/observability/`
- **PRESERVED:** All tier-gating (`free` / `premium` / `enterprise`), quota enforcement (`consume_clone_crush_run` RPC), and per-user state isolation (`tc:u:` namespace)

---

## 2. Deep Niche Analyzer (Module A)

### 2.1 Purpose

Before any viral radar or script synthesis can occur, the engine must understand the creator's **channel DNA fingerprint**: niche classification, tonal profile, audience psychographics, banned concepts, and historical success patterns.

### 2.2 Data Sources & Ingestion Pipeline

```
┌─────────────────────────────┐
│  YouTube Channel URL        │
│  (@handle, /channel/ID,     │
│   or custom URL)            │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐     ┌─────────────────────────────┐
│  YouTube Data API v3        │     │  Ghost Relay (Piped)        │
│  (channel snippet + stats)  │──▶  │  (fallback for metadata)    │
│  • subscriberCount          │     │  • description             │
│  • videoCount               │     │  • customUrl               │
│  • brandingSettings         │     └─────────────────────────────┘
│  • snippet.description      │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  TRANSCRIPT EXTRACTOR       │
│  (top 3 recent videos)      │
│  • `api/transcript.ts`      │
│  • multi-relay mesh         │
│  • ghost-reconstructed flag │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐     ┌─────────────────────────────┐
│  AI NICHE ANALYZER          │     │  CHANNEL MEMORY PROFILE    │
│  (Gemini 2.5 Flash default) │──▶  │  (persistent per-user RAG) │
│  • niche taxonomy (15 tags) │     │  • niche fingerprint        │
│  • tone vector (8 axes)     │     │  • banned phrases           │
│  • audience archetype       │     │  • past hook families       │
│  • content category map     │     │  • success signal log       │
└──────────┬──────────────────┘     └──────────┬──────────────────┘
           │                            │
           ▼                            ▼
┌─────────────────────────────────────────────────────────────┐
│  DEEP NICHE PROFILE (structured JSON + embedded vector)     │
│  • `channelProfile.id`                                       │
│  • `niche.tags[]` (weighted 0.0–1.0)                        │
│  • `tone.axes[]` {formal, emotional, analytical, humor...}  │
│  • `audience.archetype` {creator, student, fan, critic...} │
│  • `memory.embedding` (vector 1536d via text-embedding)     │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 Niche Taxonomy (Engineered)

The analyzer does not rely on generic labels like "gaming" or "tech." It produces a **multi-dimensional niche fingerprint**:

| Dimension | Example Values | Weight Range |
|---|---|---|
| `primaryNiche` | `FactChannel`, `ComedyVlog`, `DeepDiveExplainer`, `ReactionContent`, `TutorialMaker`, `DramaAnalysis` | 1.0 |
| `subNicheTags` | `TrueCrime`, `Psychology`, `Finance`, `AI`, `Fitness`, `PopCulture` | 0.3–0.9 |
| `audienceAgeBand` | `13-17`, `18-24`, `25-34`, `35-54` | 0.0–1.0 |
| `contentDepth` | `Surface`, `Mid`, `Deep`, `Academic` | 0.0–1.0 |
| `toneAxes.formal` | `0` (casual) → `10` (documentary) | 0–10 |
| `toneAxes.emotional` | `0` (clinical) → `10` (intense) | 0–10 |
| `toneAxes.humor` | `0` (serious) → `10` (satirical) | 0–10 |

### 2.4 Persistence & Memory Integration

Every analysis writes to the existing `channelMemory` structure (`src/lib/channelMemory.ts`) and a new **vector-enhanced profile table** (`profiles` in Supabase) with a 1536-dimension embedding. On every subsequent synthesis call, the engine loads:

1. The structured fingerprint (fast, structured SQL query).
2. The embedded vector (fast cosine similarity for similarity matching).
3. Historical success notes (per-video retention peaks, hook families that outperformed).

---

## 3. 15-Day Viral Radar (Module B)

### 3.1 Purpose

Identify videos within the **exact niche fingerprint** (from Module A) that went highly viral in the **last 15 days** (rolling window). Unlike the existing `clone-crush` competitor search (which uses open YouTube `search` API queries), the Viral Radar is **niche-strict**: it filters every result through the fingerprint tags from Module A.

### 3.2 Search Architecture

```
┌─────────────────────────────────────────────────────┐
│  VIRAL RADAR ENGINE (scheduled + on-demand)         │
│  `packages/orchestrator/radar/viral-radar.ts`       │
└──────────┬──────────────────────────────────────────┘
           │
    ┌──────┴──────┐
    │             │
    ▼             ▼
┌─────────┐  ┌──────────┐
│ LIVE    │  │ GHOST    │
│ SOURCES │  │ RELAY    │
│         │  │ FALLBACK │
└────┬────┘  └────┬─────┘
     │            │
     ▼            ▼
┌─────────────────────────────────────────────┐
│  NICHE FILTER ENGINE                      │
│  • Keyword overlap with fingerprint tags   │
│  • Channel niche similarity score          │
│  • Audience overlap inference              │
│  • Viral velocity gate (>50k views)        │
└─────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────┐
│  15-DAY ROLLING WINDOW                      │
│  • `publishedAt` within 15 days             │
│  • Recency decay: newer = higher weight     │
│  • Velocity boost: fast-rising = high score │
└─────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────┐
│  RANKED VIRAL RESULTS (3-slot conveyor)     │
│  • Slot 0: Actionable (free tier unlock)    │
│  • Slot 1-2: Teaser tiles (locked)          │
│  • Cursor pagination for more               │
└─────────────────────────────────────────────┘
```

### 3.3 Live Source Mesh (Multi-Node)

The existing `clone-crush` already uses a concurrent node mesh: YouTube Data API → Piped instances (`PIPED_INSTANCES` array) → synthetic ghost fallback. The Viral Radar extends this with:

| Source Layer | Nodes | Data | Viral Gate | Fallback Priority |
|---|---|---|---|---|
| **YouTube Data API v3** (`youtubeApi`) | 3 rotating keys (`YOUTUBE_API_KEY` split) | `search` + `videos` parts | `viewsCount >= 50_000` (configurable) | First attempt |
| **Piped Relay Mesh** (`PIPED_INSTANCES`) | 6 instances (`kavin.rocks`, `private.coffee`, etc.) | Search + video details | Same | Second attempt |
| **Ghost Synthetic Pool** (`VIRAL_POOL`) | 21 pre-seeded high-velocity synthetic videos | Synthetic metadata + real thumbnails (`i.ytimg.com`) | Deterministic, infinite pagination | Final fallback |

### 3.4 Niche-Strict Filtering Algorithm

```typescript
interface ViralRadarFilter {
  fingerprintTags: string[];     // from Module A (weighted)
  fingerprintNiche: string;       // primary niche label
  audienceAgeBand: string;
  minViews: number;              // default 50_000 (configurable via env)
  maxAgeDays: number;            // default 15
}

function scoreVideoForRadar(video: RawVideo, filter: ViralRadarFilter): number {
  // 1. Viral base score (existing velocityForViews logic)
  let score = velocityForViews(video.viewsCount, video.publishedAt);

  // 2. Niche similarity (NEW)
  const nicheOverlap = computeTagOverlap(
    video.tags || extractTagsFromTitle(video.title),
    filter.fingerprintTags
  );
  score *= (0.5 + 0.5 * nicheOverlap); // dampens off-niche viral hits

  // 3. Audience alignment (NEW — inferred from channel metadata)
  if (video.channelProfile) {
    const audienceMatch = audienceOverlapScore(
      video.channelProfile.audienceSignals,
      filter.audienceAgeBand
    );
    score *= (0.6 + 0.4 * audienceMatch);
  }

  // 4. Recency boost (within 15-day window)
  const daysOld = (Date.now() - new Date(video.publishedAt).getTime()) / 86400000;
  const recencyMultiplier = Math.max(0.3, 1 - (daysOld / 15) * 0.7);
  score *= recencyMultiplier;

  return Math.min(100, Math.round(score));
}
```

### 3.5 Radar Output Schema

```json
{
  "radarId": "radar_20260816_14h07m",
  "creatorFingerprint": { /* Module A output */ },
  "windowDays": 15,
  "results": [
    {
      "videoId": "dQw4w9WgXcQ",
      "title": "...",
      "channelName": "...",
      "thumbnailUrl": "https://i.ytimg.com/vi/.../hqdefault.jpg",
      "viewsCount": 12400000,
      "publishedAt": "2026-08-10T09:00:00Z",
      "radarScore": 94.3,
      "nicheOverlap": 0.87,
      "audienceMatch": 0.82,
      "viralVelocityScore": 78,
      "isLocked": false,
      "ghostReconstructed": false,
      "ghostNode": "YT-API"
    }
  ],
  "nextCursor": "base64(cursor_data)",
  "exhausted": false,
  "qualityGate": "50,000+ views • 15-day window • niche-strict"
}
```

---

## 4. 0-10s Hook Deconstruction (Module C)

### 4.1 Purpose

The crucial first 0–10 seconds of a viral video contain the **psychological trigger architecture** that drives retention. This module performs forensic deconstruction of that window, identifying:

- What pattern was used (curiosity gap, shock claim, authority claim, emotional trigger).
- Why it works psychologically (cognitive bias, emotional valence, social proof mechanism).
- How to reverse-engineer it into a fresh, non-copied hook for the user.

### 4.2 Video Ingestion & Frame Sampling

For the selected viral video (`targetVideoId`), the engine performs **multimodal ingestion**:

```
SELECTED VIRAL VIDEO
         │
         ▼
┌────────────────────────────┐
│  TRANSCRIPT EXTRACTION     │
│  (existing multi-relay)    │
│  • first 30s transcript    │
│  • timestamp-aligned       │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│  AUDIO PROFILE (NEW)       │
│  • voice tone analysis      │
│  • pacing / cadence metric  │
│  • emotional valence curve  │
│  • acoustic fingerprint     │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│  VISUAL FRAME EXTRACTION   │
│  (NEW — ladder sampler)    │
│  • 1 frame per second      │
│  • 0-10s window = 11 frames│
│  • thumbnail DNA analysis  │
│  • text overlay detection  │
│  • color / contrast profile │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│  MULTIMODAL AI ANALYSIS    │
│  (Gemini Flash / Claude)   │
│  • transcript + audio +    │
│    visual frames combined  │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│  PSYCHOLOGICAL TRIGGER     │
│  DECONSTRUCTION REPORT     │
└────────────────────────────┘
```

### 4.3 Psychological Trigger Taxonomy

The analysis produces a structured trigger map:

| Trigger Type | Code | Description | Example Pattern | Retention Mechanism |
|---|---|---|---|---|
| **Curiosity Gap** | `CG-01` | Explicit promise of unrevealed information; creates open loop | "In the next 60 seconds, I'll show you the one mistake..." | Zeigarnik effect — incomplete tasks demand closure |
| **Shock / Contrarian** | `SC-02` | Direct contradiction of common belief; triggers defensive attention | "What I'm about to say will get me banned..." | Cognitive dissonance — brain must resolve contradiction |
| **Social Proof / Authority** | `SP-03` | Reference to expert status, data source, or peer validation | "After analyzing 10,000 channels..." | Authority bias — faster acceptance from credible source |
| **Emotional Intensity** | `EI-04` | High-arousal emotion (fear, anger, awe, excitement) | "This is the most terrifying thing I've seen..." | Arousal theory — emotional peaks enhance memory encoding |
| **Pattern Interrupt** | `PI-05` | Visual or auditory break from expected format | Sudden color change, sound effect, jump cut | Orienting reflex — automatic attention capture |
| **Personal Stakes** | `PS-06` | Direct implication for viewer's life / goals | "If you're doing X, you're already losing..." | Self-relevance — information linked to identity processed deeper |

### 4.4 Deconstruction Report Schema

```json
{
  "hookDeconstructionId": "hd_20260816_abc",
  "targetVideoId": "dQw4w9WgXcQ",
  "windowSeconds": { "start": 0, "end": 10 },
  "triggerArchitecture": [
    { "code": "SC-02", "label": "Contrarian Shock", "confidence": 0.94, "timestampStart": 0.5, "timestampEnd": 3.2 }
  ],
  "psychologicalMechanism": {
    "primaryBias": "cognitive_dissonance",
    "secondaryBias": "authority_bias",
    "arousalLevel": 8.2,
    "explanation": "The speaker opens with a direct contradiction of the common belief ('everyone says X, but they're wrong'), which activates defensive attention. The claim is backed by implied data authority ('after 500 tests'), reducing resistance."
  },
  "audioProfile": {
    "paceWordsPerMinute": 168,
    "pitchRangeHz": 120,
    "emotionalValence": -0.4,
    "cadencePattern": "fast-build-pause-reveal"
  },
  "visualProfile": {
    "dominantColor": "#FF2A2A",
    "textOverlayDetected": true,
    "textContent": "STOP SCROLLING",
    "contrastRatio": 8.4,
    "compositionRule": "left-third-rule"
  },
  "reverseEngineeredHook": {
    "freshTitle": "I Tested Every Viral Hook For 30 Days — The Results Are Shocking",
    "freshHookScript": "Stop scrolling. What I'm about to show you about content growth got me banned from three mastermind groups. The third trick changes everything.",
    "psychologicalRationale": "Replaces the original 'banned' claim with a stronger 'three mastermind groups' specificity (authority + shock), adds a numbered progression ('third trick') to build anticipation."
  },
  "antiCloneDisguise": {
    "changedAnalogiesCount": 3,
    "swappedExamplesCount": 2,
    "vocabularyShift": "replaced 'everyone says' with 'most creators assume'; replaced 'banned from groups' with 'removed from circles'"
  }
}
```

---

## 5. Chunk-Based Script Generation (Module D)

### 5.1 Purpose

Traditional script generation produces a continuous body of text. The Viral DNA Synthesizer produces a **chunk architecture** — discrete segments engineered to function as **micro-hooks**, each with its own retention mechanism, preventing viewer drop-off at every transition.

### 5.2 Chunk Architecture Design

Every script is broken into **8 standardized chunk types**, each with a specific retention function:

| Chunk Type | Code | Duration Target | Function | Micro-Hook Mechanism |
|---|---|---|---|---|
| **Hook Bomb** | `CH-HB` | 0–10s | Capture attention; set open loop | Curiosity gap / shock claim / emotional trigger |
| **Promise Lock** | `CH-PL` | 10–25s | Confirm value; establish credibility | Social proof / authority / data reference |
| **Value Block A** | `CH-VA` | 25–45s | Deliver first major point | Concrete example / visual proof / demonstration |
| **Retention Spike A** | `CH-RS1` | 45–50s | Prevent drop-off; reset loop | Pattern interrupt / emotional shift / new question |
| **Value Block B** | `CH-VB` | 50–70s | Deliver second major point | Contrast / comparison / deeper insight |
| **Retention Spike B** | `CH-RS2` | 70–75s | Maintain momentum; build anticipation | Numbered progression / tease of final reveal |
| **Value Block C** | `CH-VC` | 75–95s | Deliver final point; close open loops | Synthesis / contradiction resolution / payoff |
| **CTA Loop Bomb** | `CH-CB` | 95–110s | Convert retention into action | Direct CTA + open loop for next video / subscribe |

### 5.3 Chunk Synthesis Pipeline

```
DEEP NICHE PROFILE (Module A)
         │
         ▼
VIRAL RADAR TOP 3 (Module B)
         │
         ▼
HOOK DECONSTRUCTION REPORTS (Module C)
         │
         ▼
┌──────────────────────────────────────────────────┐
│  CHUNK SYNTHESIS ENGINE                           │
│  `packages/orchestrator/generator/chunk-agent.ts`│
│  • Each chunk is independently generated then     │
│    assembled into a coherent narrative             │
│  • Every chunk passes the Critic Agent (≥85/100) │
│  • Chunk-to-chunk transition smoothness checked   │
└──────────┬───────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────┐
│  SCRIPT OUTPUT (structured JSON)                  │
│  • chunkId, chunkType, durationTarget            │
│  • scriptText (voiceover narration)              │
│  • microHookReason (why this prevents drop-off)  │
│  • visualDirection (B-roll, text overlay, color) │
│  • retentionMechanism (code from Module C)       │
│  • emotionalValence (before → after chunk)       │
└──────────────────────────────────────────────────┘
```

### 5.4 Chunk-Level Critic Audit

Each chunk is evaluated by a dedicated **Micro-Critic Agent** (sub-agent within the adversarial pipeline):

```typescript
interface ChunkAudit {
  chunkId: string;
  score: number; // 0-100
  retentionRisk: 'low' | 'medium' | 'high';
  dropOffPredictionMs: number; // estimated time before viewer exits
  critique: string; // specific fix if < 85
  remediationApplied: boolean;
}
```

The full script is rejected (and rebuilt with remediation notes) if **any single chunk scores below 70**, or if the **average across all chunks is below 85**.

---

## 6. Three Additional Professional Features (Modules E, F, G)

Beyond the 4 core requirements, the architecture introduces **3 advanced capabilities** that position this as the ultimate professional script-generation engine.

---

### 6.1 Module E — Pacing & AVD Architecture Engine

**Purpose:** Analyze the Average View Duration (AVD) patterns of viral videos and engineer scripts whose pacing curves match (or exceed) the top performers in the niche.

**Key Insight:** A video may have 1M views but only 45% AVD. The Viral DNA Synthesizer targets videos with **both** high velocity **and** high retention (AVD > 70%). The engine maps retention curves from transcripts and visual beats.

#### 6.1.1 Data Collection (Pacing Intelligence)

For each viral video in the 15-day radar:

- **Transcript timing analysis:** Map each sentence to its timestamp; compute word density per second.
- **Visual beat detection:** Identify cut points, B-roll transitions, and text overlays via the frame ladder (Module C, visual profile).
- **Retention curve inference:** If YouTube Analytics data is unavailable, infer retention from comment patterns (comments referencing specific timestamps = retention markers) and video duration ratios.

#### 6.1.2 Pacing Profile Schema

```json
{
  "videoId": "...",
  "durationSeconds": 312,
  "avdInferredPercent": 73,
  "retentionCurve": [
    { "second": 0, "retentionEstimate": 100 },
    { "second": 3, "retentionEstimate": 94 },
    { "second": 15, "retentionEstimate": 88 },
    { "second": 45, "retentionEstimate": 82 },
    { "second": 120, "retentionEstimate": 75 },
    { "second": 240, "retentionEstimate": 68 },
    { "second": 312, "retentionEstimate": 62 }
  ],
  "dropOffPoints": [
    { "second": 8, "severity": "high", "cause": "hook promise unfulfilled" },
    { "second": 65, "severity": "medium", "cause": "value block too dense, no spike" }
  ],
  "pacingSignature": {
    "wordsPerMinute": 152,
    "sentenceLengthAvgWords": 14,
    "pauseDurationAvgMs": 320,
    "visualCutIntervalAvgSeconds": 4.2,
    "retentionSpikeIntervalAvgSeconds": 42
  }
}
```

#### 6.1.3 Script Pacing Optimization

The Chunk Synthesis Engine (Module D) uses the pacing profile of the top 3 viral videos as a **target curve**. Each chunk's word count, pause instructions, and visual direction are tuned so that the synthesized script's retention curve **matches or exceeds** the viral reference.

**Example optimization rules (engineered):**

- If reference AVD is 73% and the user's previous videos average 52%, the engine applies a **faster hook build** (`paceWordsPerMinute` +20%), **tighter sentence structures** (`sentenceLengthAvgWords` −4), and **more frequent retention spikes** (interval reduced by 8–10 seconds).
- If the reference has a critical drop-off at 8 seconds, the synthesized hook bomb (`CH-HB`) is engineered to **pay off the promise by second 6**, preventing the same drop-off.

---

### 6.2 Module F — Emotion Mapping & Psychological Trigger Matrix

**Purpose:** Map the emotional valence shifts across a viral video and engineer scripts that reproduce (with variation) the same emotional journey — the core mechanism of viral retention.

**Key Insight:** Viral videos don't maintain a single emotion; they create **emotional arcs** — rapid shifts between curiosity, tension, relief, excitement, and anticipation. The engine maps these arcs and replicates them.

#### 6.2.1 Emotion Taxonomy (Engineered for Viral Content)

| Emotion Code | Label | Trigger Pattern | Chunk Placement | Intensity Scale |
|---|---|---|---|---|
| `E-01` | **Anticipation / Curiosity** | Open loop, unanswered question | `CH-HB`, `CH-RS1`, `CH-RS2` | 4–7 |
| `E-02` | **Surprise / Shock** | Contrarian claim, unexpected data | `CH-HB`, `CH-RS1` | 6–9 |
| `E-03` | **Validation / Relief** | Promise fulfilled, proof delivered | `CH-VA`, `CH-VB`, `CH-VC` | 5–8 |
| `E-04` | **Excitement / Arousal** | High-energy delivery, visual intensity | `CH-RS1`, `CH-RS2`, `CH-CB` | 7–10 |
| `E-05` | **Trust / Authority** | Data reference, expert framing | `CH-PL`, `CH-VA` | 4–6 |
| `E-06` | **Social Connection** | Community reference, shared experience | `CH-PL`, `CH-CB` | 3–6 |

#### 6.2.2 Emotion Arc Design

Every synthesized script defines an **emotion arc** — a sequence of emotional states across the 8 chunks:

```typescript
interface EmotionArc {
  targetArcName: string; // e.g., "Curiosity → Shock → Validation → Excitement → Anticipation"
  chunkEmotions: Array<{
    chunkCode: 'CH-HB' | 'CH-PL' | 'CH-VA' | 'CH-RS1' | 'CH-VB' | 'CH-RS2' | 'CH-VC' | 'CH-CB';
    targetEmotion: 'E-01' | 'E-02' | 'E-03' | 'E-04' | 'E-05' | 'E-06';
    intensity: number; // 1-10
    transitionFromPrevious: 'sharp' | 'gradual'; // emotional shift type
  }>;
  referenceArc: string; // ID of viral video whose arc this replicates
  antiCloneVariation: string; // how the arc is modified (e.g., "swap E-02 and E-05 positions")
}
```

**Design Rule:** No two synthesized scripts share the exact same emotion sequence. The engine applies deterministic variation rules (swap adjacent emotional peaks, replace one `E-04` with `E-06`, shift intensity by ±1) to avoid fingerprint duplication.

---

### 6.3 Module G — Voice Resonance & Acoustic Fingerprint Matching

**Purpose:** Analyze the acoustic profile of viral video narration and generate scripts optimized for the creator's voice (or a selected TTS voice) so that the synthesized audio resonates with the audience's established listening expectations.

**Key Insight:** A creator's audience develops an **acoustic expectation** based on previous successful videos. A script designed for a calm, analytical voice will fail if delivered in a high-energy, rapid-fire cadence — and vice versa.

#### 6.3.1 Acoustic Profile Extraction

For each reference video (Module C audio profile + new audio analysis):

| Metric | Measurement Method | Unit | Purpose |
|---|---|---|---|
| `paceWPM` | Transcript word count / audio duration | words/min | Matches script word density |
| `pitchRangeHz` | Audio frequency analysis (FFT) | Hz range | Determines emotional energy level |
| `pitchStdDev` | Standard deviation of pitch over time | Hz | Variability = excitement; low = calm authority |
| `pauseAvgMs` | Silent segment detection | ms | Controls script pacing instructions |
| `energyAvgDb` | RMS amplitude | dB | Matches delivery intensity |
| `formantProfile` | Vowel resonance analysis | Hz (F1, F2) | Matches speaker gender/age profile |

#### 6.3.2 Voice Resonance Matching

The engine supports three resonance modes:

1. **Creator Voice Match** (`mode: 'creator'`): The synthesized script's word count, sentence structure, and emotional intensity are tuned to match the acoustic profile of the creator's previous top-performing videos (from `channelMemory.pastSuccessNotes` and transcript analysis).

2. **Viral Reference Match** (`mode: 'viral'`): The script is optimized to match the acoustic profile of the top viral reference from the 15-day radar. Useful when the creator wants to experiment with a new delivery style.

3. **Optimal Resonance Synthesis** (`mode: 'optimal'`): The engine combines the creator's stable profile with the viral reference's peak profile, producing a hybrid — maintaining audience familiarity while adding new energy.

#### 6.3.3 Script-to-Voice Optimization

Each chunk in the synthesized script carries a **voice direction** field:

```json
{
  "chunkId": "CH-HB_001",
  "voiceDirection": {
    "targetPaceWPM": 165,
    "targetPitchRange": 180,
    "targetPitchStdDev": 45,
    "pauseInstruction": "0.5s before final clause",
    "energyInstruction": "build intensity through sentence, drop on last word",
    "ttsVoiceHint": {
      "preferredGender": "masculine",
      "preferredAgeRange": "25-34",
      "energyProfile": "high_authority_moderate_emotion"
    }
  }
}
```

This integrates with the existing `api/elevenlabs-tts.ts` endpoint — the TTS call passes the `voiceDirection` parameters as SSML/prosody hints (or selects the closest pre-registered voice from the `public/previews/voices/` library: Aria, Atlas, Blaze, Drift, Echo, Ember, Luna, Nova, Prism, Reef, Sage, Spark, Titan, Veil).

---

## 7. Integrated System Workflow

### 7.1 End-to-End Execution Flow

```
STEP 1: CHANNEL CONNECTION / UPDATE
  User connects YouTube channel or selects existing profile.
  │
  ▼
  Module A — Deep Niche Analyzer
  • Fetches metadata, top 3 transcripts, branding.
  • Produces `channelFingerprint` (tags, tone axes, audience).
  • Writes to `profiles` table + `channelMemory`.
  │
  ▼
STEP 2: VIRAL RADAR SCAN (scheduled hourly + on-demand)
  Module B — 15-Day Viral Radar
  • Searches within niche fingerprint.
  • Ranks by velocity × recency × retention.
  • Produces 3-slot conveyor (1 unlocked + 2 locked).
  • Updates `conveyorQueue` (existing `useCloneCrushStore`).
  │
  ▼
STEP 3: USER SELECTS VIDEO (free tier unlock or Pro direct access)
  Module C — 0-10s Hook Deconstruction
  • Ingests video transcript + audio + visual frames.
  • Identifies psychological trigger architecture.
  • Produces `HookDeconstructionReport`.
  • Stores in `ghost_memory_chunks` (vector index for future queries).
  │
  ▼
STEP 4: SCRIPT SYNTHESIS REQUEST
  Module D — Chunk-Based Script Generation
  • Loads niche fingerprint (Module A).
  • Loads viral radar results (Module B).
  • Loads hook deconstruction reports (Module C — top 2 references).
  • Generates 8-chunk script architecture.
  • Each chunk passes Micro-Critic Agent (≥85/100).
  • Produces structured JSON script.
  │
  ▼
STEP 5: ADVANCED OPTIMIZATION (optional / tier-gated)
  Module E — Pacing & AVD Engine
  • Matches retention curve to top references.
  • Adjusts chunk durations and word densities.
  │
  Module F — Emotion Mapping & Trigger Matrix
  • Defines emotional arc across 8 chunks.
  • Applies anti-clone variation rules.
  │
  Module G — Voice Resonance Matching
  • Matches or synthesizes acoustic profile.
  • Adds voice direction fields to every chunk.
  │
  ▼
STEP 6: OUTPUT PACKAGE (Five-Asset Package + DNA Audit)
  • Script (chunk architecture with retention logic)
  • Title families (3 variants, each with psychological trigger code)
  • Thumbnail prompt (with visual DNA from Module C)
  • SEO tag cluster (niche-aligned, viral-reference derived)
  • Editing guide (chunk-level B-roll, text overlay, sound FX)
  • DNA Audit Trail: which triggers were used, which references influenced the output, anti-clone variation log, emotional arc visualization, pacing comparison chart.
  │
  ▼
STEP 7: POST-GENERATION AUDIT
  The Critic Agent (existing `runAgenticPipeline`) evaluates the full package:
  • Retention open-loop frequency (1 beat every 8–10s).
  • Zero-cliché tolerance.
  • Promise-to-payoff integrity.
  • Chunk-level retention risk (all chunks ≥70, average ≥85).
  • Anti-clone disguise score (changed analogies, examples, vocabulary).
  • Score: 0–100. Below 85 → self-healing loop (max 2 iterations) with remediation notes fed back to the Chunk Agent.
```

---

## 8. Technical Architecture: Module Details

### 8.1 New Module Files

```
api/
  viral-dna/
    synthesize.ts         # Main synthesis endpoint (replaces clone-crush rewrite)
    deconstruct.ts        # Hook deconstruction endpoint (Module C)
    radar.ts              # Viral radar endpoint (Module B — new route)
    pacing.ts             # Pacing & AVD analysis endpoint (Module E)
    emotion-map.ts        # Emotion mapping endpoint (Module F)
    voice-resonance.ts    # Voice resonance profile endpoint (Module G)

packages/orchestrator/
  radar/
    viral-radar.ts        # Module B engine
    niche-filter.ts       # Niche similarity scoring
  dna/
    niche-analyzer.ts     # Module A — deep profile extraction
    hook-deconstructor.ts # Module C — psychological analysis
    chunk-synthesis.ts    # Module D — script architecture engine
    chunk-critic.ts       # Micro-critic for each chunk
  pacing/
    avd-engine.ts         # Module E — retention curve analysis
  emotion/
    emotion-matrix.ts     # Module F — emotional arc mapping
  voice/
    resonance-engine.ts   # Module G — acoustic fingerprinting
```

### 8.2 Database Schema Extensions (Supabase)

```sql
-- Module A: Enhanced channel profile
CREATE TABLE channel_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  youtube_channel_id TEXT,
  fingerprint JSONB NOT NULL DEFAULT '{}',
  embedding VECTOR(1536),
  memory_version INTEGER DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, youtube_channel_id)
);

-- Module B: Viral radar results (rolling window)
CREATE TABLE viral_radar_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  video_id TEXT NOT NULL,
  radar_score FLOAT NOT NULL,
  niche_overlap FLOAT,
  audience_match FLOAT,
  published_at TIMESTAMPTZ,
  ghost_node TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON viral_radar_results(user_id, radar_score DESC);
CREATE INDEX ON viral_radar_results(user_id, published_at DESC);

-- Module C: Hook deconstruction reports
CREATE TABLE hook_deconstructions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  video_id TEXT NOT NULL,
  report JSONB NOT NULL,
  psychological_triggers JSONB,
  audio_profile JSONB,
  visual_profile JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Module D: Synthesized script chunks
CREATE TABLE script_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  synthesis_run_id UUID NOT NULL,
  chunk_code TEXT CHECK (chunk_code IN ('CH-HB','CH-PL','CH-VA','CH-RS1','CH-VB','CH-RS2','CH-VC','CH-CB')),
  chunk_text TEXT NOT NULL,
  voice_direction JSONB,
  emotion_target TEXT,
  micro_hook_mechanism TEXT,
  audit_score INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Module E: Pacing profiles
CREATE TABLE pacing_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  video_id TEXT,
  avd_inferred_percent FLOAT,
  retention_curve JSONB,
  drop_off_points JSONB,
  pacing_signature JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Module F: Emotion arcs
CREATE TABLE emotion_arcs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  synthesis_run_id UUID NOT NULL,
  arc_name TEXT,
  chunk_emotions JSONB,
  reference_video_id TEXT,
  anti_clone_variation TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 9. API Contracts

### 9.1 New Endpoints

| Method | Endpoint | Runtime | Auth | Tier Gate | Purpose |
|---|---|---|---|---|---|
| `POST` | `/api/viral-dna/synthesize` | edge | Bearer JWT | All (free: limited; premium: full) | Main synthesis pipeline |
| `POST` | `/api/viral-dna/deconstruct` | edge | Bearer JWT | Premium | Hook deconstruction for selected video |
| `GET`  | `/api/viral-dna/radar` | edge | Bearer JWT | All (free: 1/day; premium: unlimited) | 15-day viral radar scan |
| `POST` | `/api/viral-dna/pacing` | edge | Bearer JWT | Premium | AVD analysis for reference videos |
| `POST` | `/api/viral-dna/emotion-map` | edge | Bearer JWT | Premium | Emotion arc design |
| `POST` | `/api/viral-dna/voice-resonance` | edge | Bearer JWT | Premium | Voice profile matching |

### 9.2 Response Schema: `/api/viral-dna/synthesize`

```json
{
  "success": true,
  "runId": "syn_20260816_abc",
  "outputLanguage": "English",
  "tier": "premium",
  "model": "google/gemini-2.5-flash",
  "modelsAttempted": ["google/gemini-2.5-flash", "meta-llama/llama-3.3-70b-instruct"],
  "selfHealed": false,
  "synthesis": {
    "originalReferenceTitle": "...",
    "rewrittenTitleFamilies": ["..."],
    "seoTags": ["..."],
    "scriptChunks": [
      {
        "chunkId": "syn_abc_CH-HB_001",
        "chunkCode": "CH-HB",
        "durationTargetSec": 10,
        "scriptText": "...",
        "microHookMechanism": "curiosity_gap_open_loop",
        "psychologicalTriggerCodes": ["CG-01", "SC-02"],
        "voiceDirection": { "targetPaceWPM": 165, ... },
        "emotionTarget": "E-02",
        "visualDirection": "close-up, red lighting, bold text overlay",
        "auditScore": 92,
        "retentionRisk": "low"
      }
      /* 7 more chunks */
    ],
    "fullScriptAssembled": "60–110 second script with chunk markers",
    "thumbnailPrompt": "...",
    "editingGuide": ["..."],
    "dnaAuditTrail": {
      "referenceVideosUsed": ["videoId_1", "videoId_2"],
      "psychologicalTriggersUsed": ["SC-02", "PI-05", "PS-06"],
      "antiCloneDisguise": {
        "changedAnalogiesCount": 5,
        "swappedExamplesCount": 4,
        "vocabularyShiftNotes": ["replaced 'secret' with 'mechanism'; replaced 'everyone' with 'most creators'"]
      },
      "emotionArcUsed": "Curiosity → Shock → Validation → Excitement → Anticipation",
      "pacingTargetAVD": 73,
      "voiceResonanceMode": "creator"
    },
    "glitchIntensity": 99,
    "isStealthDisguised": true
  },
  "servedViaFallback": false,
  "fallbackReason": null
}
```

---

## 10. Testing & Verification Strategy

### 10.1 Unit Tests (Vitest, colocated with modules)

```
packages/orchestrator/dna/
  niche-analyzer.test.ts
  hook-deconstructor.test.ts
  chunk-synthesis.test.ts
  chunk-critic.test.ts
packages/orchestrator/radar/
  viral-radar.test.ts
  niche-filter.test.ts
packages/orchestrator/pacing/
  avd-engine.test.ts
packages/orchestrator/emotion/
  emotion-matrix.test.ts
packages/orchestrator/voice/
  resonance-engine.test.ts
tests/
  viral-dna-synthesis.test.ts
  viral-dna-deconstruct.test.ts
  viral-radar-contract.test.ts
```

### 10.2 Integration & Contract Tests

- **`tests/viral-dna-synthesis.test.ts`:** Full pipeline test: connect profile → radar → deconstruct → synthesize → audit. Assert chunk count = 8, all audit scores ≥70, anti-clone count ≥3.
- **`tests/viral-radar-contract.test.ts`:** Assert `/api/viral-dna/radar` returns exactly 3-slot structure with `nextCursor` and `exhausted` fields matching `docs/openapi.yaml`.
- **`tests/headroom-compatibility.test.ts`:** Ensure new synthesis endpoints work with the Headroom compression layer (`packages/orchestrator/ai-gateway-headroom.ts`) without token loss or pairing breaks.

### 10.3 End-to-End (Playwright)

```
e2e/specs/
  viral-dna-synthesis.spec.ts     # Happy path: connect → synthesize → review output
  viral-radar-navigation.spec.ts  # Free tier: unlock slot 0; lock slot 1-2
  hook-deconstruction-view.spec.ts # Click video → see deconstruction report
  chunk-script-render.spec.ts     # Verify 8 chunks render with retention badges
```

---

## 11. Security, Cost, & Reliability

### 11.1 Security Posture

- **Per-user RLS:** Every new table (`channel_profiles`, `viral_radar_results`, `hook_deconstructions`, `script_chunks`, `pacing_profiles`, `emotion_arcs`) uses `user_id` foreign key with RLS policies.
- **No embedding leaks:** Vector embeddings stored server-side; never transmitted to the client. Only cosine similarity results (video IDs, scores) are returned.
- **Credit guardrails:** Every synthesis, deconstruction, radar scan, and advanced module call debits through `consume_ghost_action()` with server-authoritative rolling-24h windows.
- **Anti-duplicate / fingerprinting protection:** Every output passes through the `AntiCloneDisguise` protocol (changed analogies, examples, vocabulary). No direct transcript copying allowed.
- **Audio privacy:** Voice resonance profiles are computed server-side; no raw audio files are stored in persistent storage beyond temporary processing.

### 11.2 Cost Budget (Per Call, Per Tier)

| Operation | Free Tier | Premium Tier | Black-Ops | Token Cap | Cost Cap |
|---|---|---|---|---|---|
| Deep Niche Analysis (`Module A`) | 1/day | Unlimited | Unlimited | 4,000 | $0.05 |
| Viral Radar Scan (`Module B`) | 1/day | 5/hour | Unlimited | 2,500 | $0.03 |
| Hook Deconstruction (`Module C`) | 🔒 (upsell) | 3/day | Unlimited | 6,000 | $0.08 |
| Chunk Synthesis (`Module D`) | 1/day | 5/hour | Unlimited | 10,000 | $0.12 |
| Pacing Analysis (`Module E`) | 🔒 | 2/day | Unlimited | 3,000 | $0.04 |
| Emotion Mapping (`Module F`) | 🔒 | 3/day | Unlimited | 2,000 | $0.03 |
| Voice Resonance (`Module G`) | 🔒 | 2/day | Unlimited | 3,500 | $0.06 |

---

## 12. Deployment & Rollout Plan (Micro-Phases)

Following the strict vertical-slice and verification-gate model established in `docs/ACTIVE_RUNTIME_SURFACE.md`:

### Phase 1 — Deep Niche Analyzer (Module A)
- Build `packages/orchestrator/dna/niche-analyzer.ts`
- Add `channel_profiles` table + `profiles` enhancement
- Build `api/viral-dna/profile` endpoint
- Update `channelMemory` with fingerprint structure
- Tests + docs
- **Risk:** Low — additive only

### Phase 2 — Viral Radar Engine (Module B)
- Build `packages/orchestrator/radar/viral-radar.ts`
- Add `viral_radar_results` table
- Build `api/viral-dna/radar` endpoint
- Extend `useCloneCrushStore` with radar state (`radarResults`, `radarCursor`)
- Tests + docs
- **Risk:** Low — extends existing competitor search

### Phase 3 — Hook Deconstruction (Module C)
- Build `packages/orchestrator/dna/hook-deconstructor.ts`
- Add `hook_deconstructions` table
- Build `api/viral-dna/deconstruct` endpoint
- Integrate transcript + audio + visual ingestion
- Tests + docs
- **Risk:** Medium — requires multimodal AI calls; graceful fallback essential

### Phase 4 — Chunk Script Synthesizer (Module D)
- Build `packages/orchestrator/dna/chunk-synthesis.ts` + `chunk-critic.ts`
- Add `script_chunks` table
- Build `api/viral-dna/synthesize` endpoint (replaces `clone-crush` rewrite)
- Extend adversarial pipeline (`_agenticEngine.ts`) with chunk-level audit
- Tests + docs
- **Risk:** Medium — core user-facing feature; requires full self-healing

### Phase 5 — Pacing & AVD Engine (Module E)
- Build `packages/orchestrator/pacing/avd-engine.ts`
- Add `pacing_profiles` table
- Build `api/viral-dna/pacing` endpoint
- Integrate retention curve analysis into synthesis
- Tests + docs
- **Risk:** Low — optimization layer, optional for base synthesis

### Phase 6 — Emotion Mapping (Module F)
- Build `packages/orchestrator/emotion/emotion-matrix.ts`
- Add `emotion_arcs` table
- Build `api/viral-dna/emotion-map` endpoint
- Integrate emotional arc design into synthesis
- Tests + docs
- **Risk:** Low — optimization layer

### Phase 7 — Voice Resonance Matching (Module G)
- Build `packages/orchestrator/voice/resonance-engine.ts`
- Build `api/viral-dna/voice-resonance` endpoint
- Integrate with `api/elevenlabs-tts.ts` (SSML hints / voice selection)
- Tests + docs
- **Risk:** Low — enhancement to existing TTS pipeline

### Phase 8 — Integration & Performance Pass
- Full pipeline integration test (Module A → B → C → D → E → F → G)
- P95 latency audit against budgets (§9.2)
- Bundle size audit (`vite build --analyze`)
- Final docs (`docs/openapi.yaml` update + `README.md` appendix)
- **Risk:** Low — integration and optimization only

---

## 13. Key Decisions & Trade-Offs

| Decision | Rationale | Trade-Off |
|---|---|---|
| **Chunk-level architecture instead of continuous script** | Enables precise retention engineering; each segment is auditable and replaceable | More complex output parsing for the user; requires chunk-marker rendering |
| **Niche-strict radar instead of broad viral search** | Higher relevance = higher synthesis quality; avoids off-niche noise | Fewer results; synthetic fallback activates more often in narrow niches |
| **Psychological trigger taxonomy (6 codes)** | Structured analysis enables deterministic variation rules (anti-clone) | Requires manual maintenance; new triggers must be added explicitly |
| **Pacing profile inference instead of direct analytics access** | YouTube Analytics is not available via public API; inference from transcripts/comments is robust | Slight accuracy loss; synthetic profiles supplement where inference is weak |
| **Voice resonance as optional module** | Not all creators want matching; some prefer experimentation | Adds complexity to synthesis endpoint; requires `mode` parameter |

---

## 14. Conclusion — The Masterplan

This architecture transforms the existing **Clone-Crush / Glitch Intensity Engine** from a basic competitor-copying tool into a fully autonomous, psychologically-informed, multi-modal content intelligence platform.

The four core capabilities — **Deep Niche Analysis**, **15-Day Viral Radar**, **0-10s Hook Deconstruction**, and **Chunk-Based Script Synthesis** — are supported by **three professional-grade extensions**: **Pacing & AVD Architecture**, **Emotion & Trigger Mapping**, and **Voice Resonance Fingerprinting**.

Every module integrates with the existing `packages/orchestrator` resilience, cost tracking, and tier enforcement systems. Every endpoint follows the vertical-slice, server-authoritative, graceful-degradation, and self-healing patterns established across the repository.

**This is the masterplan. The code comes next — phase by phase, verified, tested, and deployed.**

---

## Appendix — Related Existing Documents

- `docs/ARCHITECTURE.md` — System principles, tier architecture, data model
- `docs/ACTIVE_RUNTIME_SURFACE.md` — Supported routes, endpoints, packages
- `api/_agenticEngine.ts` — Existing adversarial writer↔critic pipeline (extended by Module D)
- `api/clone-crush.ts` — Existing competitor analysis and rewrite engine (replaced by Module D synthesis endpoint)
- `packages/orchestrator/generator/generator-agent.ts` — Batch concurrency engine (extended by chunk synthesis)
- `packages/orchestrator/ai-gateway.ts` — Provider-agnostic gateway (extended by multimodal interfaces)
- `docs/PHASE3_GHOST_INTELLIGENCE_BLUEPRINT.md` — Related intelligence layer design (inspiration for Module C and G)
- `README.md` — Product vision and deployment guide

---

## 15. High-Scale Data Ingestion & Queue Pipeline (Enterprise Scale — 10K Concurrent)

> **Status:** ADDITION TO MASTERPLAN — Post-approval scalability layer
> **Scope:** Updated ingestion architecture for massive concurrent request handling, with **Agent-Reach (`Panniantong/Agent-Reach`)** as the primary open-source internet access layer, wrapped in a bulletproof distributed pipeline.
> **Constraint:** This layer is designed for **10,000 concurrent user requests** on the `Extract` action without crashing the Vercel Edge frontend or triggering permanent YouTube bans.

---

### 15.1 Architectural Reality Check — Agent-Reach Integration

The open-source repository **`Panniantong/Agent-Reach`** (MIT License, `github.com/Panniantong/Agent-Reach`) provides CLI-based, zero-API-fee access to YouTube (via `yt-dlp`), Twitter, Reddit, GitHub, Bilibili, and other platforms. Its architecture is:

- **Python CLI + library**, designed for individual agent installations.
- **No native server mode** — it executes as a subprocess (`agent-reach doctor`, `yt-dlp --dump-json`, etc.).
- **Multi-backend routing** — automatically switches between available access paths when one fails.
- **No built-in rate-limiting or proxy management** — relies on upstream tool behavior.

**Architectural implication:** Agent-Reach **cannot** be exposed directly to 10,000 concurrent HTTP clients. It must be **wrapped in a containerized worker pool**, consumed through a **distributed job queue**, and protected by **rate-limiting, proxy rotation, and CAPTCHA detection**.

This section defines that wrapper architecture.

---

### 15.2 System Overview — The Queue-Based Ingestion Layer

```
CLIENT (Vercel Edge — React SPA)
  • User clicks "Extract" → POST /api/viral-dna/synthesize
  • Client receives `jobId` immediately (200ms response)
  • Client polls /api/viral-dna/status?jobId=<id> OR uses SSE

EDGE API GATEWAY (`api/viral-dna/synthesize.ts`)
  • Auth + tier check + quota debit (`consume_ghost_action`)
  • Job creation: inserts into Redis queue (BullMQ)
  • Returns `{ jobId, status: 'queued', estimatedDuration: '30-90s' }`

REDIS / BULLMQ QUEUE (`upstash` or self-hosted Redis Cluster)
  Queue: `viral-dna:extract`
  • Max concurrency: 500 workers
  • Retry strategy: exponential backoff (3 retries, 30s delay)
  • Job TTL: 10 minutes

WORKER POOL (Containerized — Kubernetes / Docker Compose / AWS ECS)
  Image: `tube-click-pro/agent-reach-worker:1.5.0`
  • Pulls 1 job from BullMQ queue
  • Executes Agent-Reach CLI (yt-dlp, piped, or synthetic fallback)
  • Applies proxy rotation + rate delay
  • Performs CAPTCHA detection + graceful fallback
  • Pool size: 50–500 pods (auto-scaling based on queue depth)

RESULT STORE (Redis + Supabase hybrid)
  Redis: `job:{jobId}` → { status, resultUrl, timestamp, userId }
  Webhook: POST to user-configured endpoint OR push to SSE channel

FRONTEND DELIVERY
  • Polling: `GET /api/viral-dna/status?jobId=<id>` (every 3s, max 30)
  • SSE (optional, premium tier): `/api/viral-dna/stream`
```

---

### 15.3 Component A — Distributed Job Queue (BullMQ + Redis)

**Choice:** `BullMQ` (TypeScript-native, supports Redis 6+) as production queue; `Upstash` as serverless backup for peak load.

**Configuration (`packages/queue/viral-dna-queue.ts`):**

```typescript
import { Queue, QueueEvents, Worker, Job } from 'bullmq';

export const viralDnaQueue = new Queue('viral-dna:extract', {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 100,
    removeOnFail: 50,
    timeout: 600_000,
  },
});

export const queueEvents = new QueueEvents('viral-dna:extract', {
  connection: { ... },
});

queueEvents.on('completed', (jobId, result) => {
  notifyUser(jobId.toString(), 'completed', result);
});

queueEvents.on('failed', (jobId, err) => {
  console.error(`[queue] Job ${jobId} failed after retries:`, err.message);
  notifyUser(jobId.toString(), 'failed', { error: 'Analysis unavailable — synthetic fallback applied.' });
});
```

**Worker (`packages/queue/worker.ts`):**

```typescript
export const viralDnaWorker = new Worker('viral-dna:extract', async (job: Job) => {
  const { userId, videoId, fingerprint, tier, priority } = job.data;

  await rateLimitPerVideoId(videoId);
  const result = await executeAgentReachCLI({ videoId, fingerprint, tier });

  if (result.status === 'captcha_detected' || result.status === '403_forbidden') {
    return { status: 'synthetic_fallback', data: generateSyntheticCompetitors(...) };
  }

  await storeSynthesisResult(userId, videoId, result.data);
  return { status: 'completed', resultReference: result.id };
}, {
  connection: { ... },
  concurrency: 10,
  limiter: { max: 5, duration: 10000 },
});
```

---

### 15.4 Component B — Agent-Reach Integration Layer (`packages/agent-reach/`)

**Wrapper (`packages/agent-reach/agent-reach-wrapper.ts`):**

```typescript
export interface AgentReachConfig {
  youtubeMethod: 'yt-dlp' | 'piped' | 'agent-reach-default';
  proxyPool: string[];
  requestDelayMs: number;
  maxRetries: number;
  captchaFallbackEnabled: boolean;
}

export async function executeAgentReachCLI(params: {
  videoId: string;
  fingerprint: any;
  tier: 'free' | 'premium' | 'enterprise';
}): Promise<{ status: 'completed' | 'captcha_detected' | '403_forbidden' | 'timeout'; data: any }> {
  const proxy = selectNextProxy(PROXY_POOL);
  const command = buildAgentReachCommand({ ...params, proxyUrl: proxy, timeoutMs: 30000 });
  const { stdout, stderr, exitCode } = await spawnIsolated(command, { timeout: 30000, memoryLimitMB: 512 });
  const parsed = parseAgentReachOutput(stdout, stderr);

  if (detectCaptchaResponse(stderr, stdout)) return { status: 'captcha_detected', data: null };
  if (stdout.includes('403') || stdout.includes('forbidden')) return { status: '403_forbidden', data: null };
  if (parsed.isValidJson()) return { status: 'completed', data: parsed.json };
  return { status: 'timeout', data: parsed.raw };
}
```

**Container image (`docker/agent-reach-worker/Dockerfile`):**

```dockerfile
FROM python:3.11-slim
RUN pip install --no-cache-dir https://github.com/Panniantong/Agent-Reach/archive/main.zip
RUN agent-reach install --env=auto
RUN apt-get update && apt-get install -y ffmpeg curl
RUN pip install --upgrade yt-dlp
COPY packages/agent-reach/ /app/agent-reach/
ENTRYPOINT ["node", "worker-entrypoint.js"]
```

---

### 15.5 Component C — Rate-Limiting & Proxy Rotation Strategy

**Layer 1 — Per-video rate limiter (`packages/agent-reach/rate-limit.ts`):**

```typescript
export class PerVideoRateLimiter {
  private delays: Map<string, number> = new Map();
  async waitForSlot(videoId: string): Promise<void> {
    const lastAccess = this.delays.get(videoId) || 0;
    const minIntervalMs = 5000;
    const elapsed = Date.now() - lastAccess;
    if (elapsed < minIntervalMs) await sleep(minIntervalMs - elapsed);
    this.delays.set(videoId, Date.now());
  }
}
```

**Layer 2 — Proxy rotation pool (`packages/agent-reach/proxy-pool.ts`):**

```typescript
export const PROXY_POOL = [
  { url: 'http://proxy-1.tubeclick-infra.com:8080', weight: 1, region: 'IN' },
  { url: 'http://proxy-2.tubeclick-infra.com:8080', weight: 1, region: 'IN' },
  { url: 'http://proxy-3.tubeclick-infra.com:8080', weight: 2, region: 'US' },
  { url: 'http://proxy-4.tubeclick-infra.com:8080', weight: 2, region: 'EU' },
];
export function selectNextProxy(pool: typeof PROXY_POOL): typeof pool[0] {
  return weightedRoundRobin(pool);
}
```

**Note:** For 10,000 concurrent requests, a pool of 4 proxies is insufficient. The architecture requires **minimum 50 rotating residential proxies** (BrightData, Oxylabs, ProxyMesh) with geographic diversity (IN, US, EU, APAC) and IP warm-up over 24–48 hours.

**Layer 3 — CAPTCHA detection & fallback chain:**

```typescript
export function detectCaptchaResponse(stderr: string, stdout: string): boolean {
  const patterns = [/challenge/i, /captcha/i, /verify/i, /are you a robot/i];
  const combined = (stdout + stderr).toLowerCase();
  return patterns.some(p => p.test(combined));
}

export async function handleCaptchaDetected(videoId: string, fingerprint: any): Promise<any> {
  const synthetic = generateSyntheticCompetitors(fingerprint.niche, 0);
  const pipedResult = await fetchPipedSearch(fingerprint.niche, 3);
  return {
    status: 'partial_ghost_reconstructed',
    message: 'Live extraction temporarily unavailable. Showing reconstructed viral DNA.',
    data: synthesizeFromSyntheticAndPiped(synthetic, pipedResult),
    ghostReconstructed: true,
  };
}
```

---

### 15.6 Component D — Webhook / Polling Delivery System

**Polling endpoint (`GET /api/viral-dna/status?jobId=<uuid>`):**

```json
{
  "jobId": "job_abc",
  "status": "queued" | "processing" | "completed" | "failed",
  "progressPercent": 45,
  "createdAt": "2026-08-16T14:00:00Z",
  "estimatedCompletionAt": "2026-08-16T14:01:15Z"
}
```

**SSE endpoint (`api/viral-dna/stream.ts`):**

```typescript
export const config = { runtime: 'edge', maxDuration: 60 };

export default async function handler(req: Request) {
  const userId = await authenticateUser(req);
  if (!userId) return new Response('Unauthorized', { status: 401 });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const subscriber = redis.duplicate();
      await subscriber.subscribe(`viral-dna:events:${userId}`, (message) => {
        controller.enqueue(encoder.encode(`data: ${message}\n\n`));
      });
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`data: {"event":"heartbeat"}\n\n`));
      }, 15000);
      setTimeout(() => { clearInterval(heartbeat); controller.close(); }, 55000);
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

**Client poll hook (`src/hooks/useViralDnaStatus.ts`):**

```typescript
export function useViralDnaStatus(jobId: string, intervalMs = 3000) {
  const [status, setStatus] = useState('queued');
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const timer = setInterval(async () => {
      const res = await secureClient.get(`/api/viral-dna/status?jobId=${jobId}`);
      const data = await res.json();
      setStatus(data.status);
      setProgress(data.progressPercent || 0);
      if (data.status === 'completed' || data.status === 'failed') clearInterval(timer);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [jobId]);
  return { status, progress };
}
```

---

### 15.7 Component E — Frontend Non-Blocking UX Design

**Critical rule:** When 10,000 users hit `Extract` simultaneously, the Vercel Edge responds to **every request within 200ms** with a `jobId`. No blocking scraping at the edge.

**Updated flow:**

```
1. User clicks "Generate Viral DNA Script"
2. POST /api/viral-dna/synthesize → { jobId, status: 'queued', estimatedDuration: '30-90s' }
3. Client: Show progress overlay (4 stages: Ingestion → Analysis → Generation → Audit)
4. Client: Poll every 3s or connect SSE stream
5. Completed → Show result card; Failed → Show synthetic fallback with ghost-reconstructed badge
```

---

### 15.8 Component F — Scalability Metrics & Monitoring

```typescript
export interface QueueMetrics {
  queueDepth: number;
  activeWorkers: number;
  completedPerMinute: number;
  failedPerMinute: number;
  avgDurationMs: number;
  captchaRatePercent: number;
  proxyUsage: Record<string, number>;
}
```

**Dashboard thresholds:**

| Metric | Warning | Critical | Action |
|---|---|---|---|
| Queue depth | > 500 | > 2,000 | Scale workers |
| Failed rate | > 5% / min | > 15% / min | Investigate proxy/CAPTCHA |
| CAPTCHA rate | > 20% | > 50% | Synthetic fallback |
| Avg duration | > 90s | > 180s | Reduce concurrency |
| Proxy usage (single) | > 30% | > 60% | Rotate pool |

---

### 15.9 Component G — Security & Compliance at Scale

1. **No PII in scraping payloads** — Job payload (`videoId`, `fingerprint`) never contains PII.
2. **IP anonymization** — Workers exit through rotating proxies.
3. **Fingerprint randomization** — Randomized `User-Agent`, varied cookie jar, varied timing.
4. **Audit trail** — Every job records `proxyUsed`, `agentReachMethod`, `durationMs`, `captchaDetected`, `fallbackUsed` in `viral_dna_extraction_logs` (90-day retention).
5. **Per-user concurrent limit** — Max 5 concurrent extractions per user.

---

### 15.10 Component H — Cost Projection at 10K Concurrent Scale

**Assumption:** 10,000 concurrent `Extract` requests, 45s avg processing, 30% synthetic fallback.

| Component | Monthly Cost (30 days) |
|---|---|
| BullMQ / Redis (Upstash) | ~$50 |
| Agent-Reach workers (50 pods, AWS ECS Fargate, 2 vCPU) | ~$2,448 |
| Residential proxy pool (50 rotating proxies) | ~$10,000 |
| YouTube Data API (3 rotating keys) | ~$105 |
| **Total** | **~$12,603 / month** |

**Note:** Architecture supports gradual scaling — 5 pods (~$245/month) scaling based on actual load.

---

### 15.11 Component I — Updated Deployment Topology

```
CLIENT
  │ HTTP (sub-50ms)
  ▼
VERCEL EDGE NETWORK (`api/viral-dna/*` endpoints)
  │ Redis / BullMQ
  ▼
REDIS CLUSTER (Upstash / self-hosted)
  │ Queue pull
  ▼
WORKER POOL (K8s / ECS — 5→500 pods, `agent-reach-worker:1.5.0`)
  │ Agent-Reach CLI + yt-dlp + proxy rotation + CAPTCHA detection
  │ Results
  ▼
SUPABASE DB (persistent) + REDIS RESULT (temporary) + WEBHOOK/SSE (notification)
```

---

## 16. Integration Points — Queue Layer Impact

| Existing Component | Integration | Change |
|---|---|---|
| `api/clone-crush.ts` | Rebuilt as `api/viral-dna/synthesize.ts` + queue worker | Major |
| `packages/orchestrator/ai-gateway.ts` | Extended with `agentReachIntegration()` adapter | Minor |
| `packages/orchestrator/resilience/` | Queue retry uses `FallbackExecutor` pattern | None |
| `packages/orchestrator/cost/` | Queue metrics added to `cost-tracker.ts` | Minor |
| `packages/orchestrator/observability/` | Queue metrics at `/api/v1/metrics` | Minor |
| `api/_agenticEngine.ts` | Chunk synthesis runs in worker process | Medium |
| `src/stores/useCloneCrushStore.ts` | New fields: `activeJobId`, `jobStatus`, `pollInterval` | Minor |
| `src/components/clone-crush/` | Progress overlay + loading state | Medium |

---

## 17. Risk Assessment — Queue & Scale Layer

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Agent-Reach CLI crash/hang | Medium | High | 30s timeout; worker restart; synthetic fallback |
| YouTube bans proxy IPs | High | High | 50+ rotating proxies; geographic diversity; synthetic fallback |
| BullMQ overload (>10K backlog) | Medium | Medium | Auto-scale 5→500 pods; priority queuing; synthetic fallback |
| Redis failure | Low | Critical | Replication; in-memory fallback; graceful degradation |
| User abuse (spam) | Medium | Medium | Per-user max 5 concurrent; tier rate limits; CAPTCHA cool-down |
| Cost overrun | Medium | High | Auto-scale capped at 500; budget alerts; synthetic fallback saves 30% |

---

## 18. Final Note — Enterprise Scale Achievement

This updated masterplan transforms the Viral DNA Synthesizer from a single-request edge function into an **enterprise-grade distributed intelligence platform** capable of handling **10,000 concurrent extraction requests** without crashing the Vercel frontend or triggering permanent YouTube bans.

The integration of **Agent-Reach (`Panniantong/Agent-Reach`)** — wrapped in containerized workers, protected by proxy rotation and CAPTCHA detection, delivered through BullMQ queues and polling/SSE endpoints — ensures the platform remains scalable, resilient, and cost-effective.

**The masterplan is complete and approved for phased implementation.**
