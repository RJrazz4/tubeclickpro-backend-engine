/**
 * Pipeline v2 contracts. The "brain" (text-only agents) emits signals; the
 * deterministic planner merges them into an EditPlan; the "hands" (FFmpeg cut
 * engine) execute it. Keeping the EditPlan as a strict, serialisable contract is
 * what makes the pipeline deterministic and testable.
 */
import type { CaptionCue } from '../ass-builder.js';
import type { CaptionStyle } from '../clip-input.js';

/** A scene-change mark (seconds + ffmpeg scene score). */
export interface SceneMark {
  t: number;
  score: number;
}

/** A detected silence interval (seconds, source-relative). */
export interface SilenceInterval {
  start: number;
  end: number;
}

/** A coarse loudness sample (seconds + RMS dB). */
export interface EnergyPoint {
  t: number;
  rms: number;
}

/** Stage 1 output: cheap analysis of the (short) candidate media. */
export interface PreprocessResult {
  duration: number;
  scenes: SceneMark[];
  silences: SilenceInterval[];
  energy: EnergyPoint[];
}

export type SignalSource = 'llm' | 'heuristic';

/** Story Agent: the single most compelling self-contained moment + a hook. */
export interface StorySignal {
  startSeconds: number;
  endSeconds: number;
  hookText: string;
  reason: string;
  source: SignalSource;
}

/** Retention Agent: where attention peaks / drops, for tight in/out points. */
export interface RetentionSignal {
  startSeconds: number;
  endSeconds: number;
  peakType: string;
  score: number;
  reason: string;
  source: SignalSource;
}

/** Audio Agent: which silences/dead-air to cut and where the energy is. */
export interface AudioSignal {
  cutSilences: SilenceInterval[];
  reason: string;
  source: SignalSource;
}

export interface AgentSignals {
  story: StorySignal;
  retention: RetentionSignal;
  audio: AudioSignal;
}

/** A kept span of the source (silences removed), source-relative seconds. */
export interface EditSegment {
  start: number;
  end: number;
}

/** Stage 4 output — the deterministic instruction set for the cut engine. */
export interface EditPlan {
  /** Chosen window in the SOURCE timeline. */
  startSeconds: number;
  endSeconds: number;
  /** Kept segments (source-relative, ordered, silences removed). */
  segments: EditSegment[];
  /** Total output duration after cuts. */
  outputDuration: number;
  /** Captions rebased to the OUTPUT (post-cut) timeline. */
  captions: CaptionCue[];
  /** Engage the dynamic face-tracking crop in the cut engine. */
  faceTrack: boolean;
  /** Premium top-center hook overlay (optional). */
  hookText?: string;
  captionStyle: CaptionStyle;
  reason: string;
}
