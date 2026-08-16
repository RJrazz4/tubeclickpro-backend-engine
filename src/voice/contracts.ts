import { z } from 'zod';

export const VOICE_ALIASES = [
  'george',
  'brian',
  'daniel',
  'liam',
  'chris',
  'charlie',
  'eric',
  'will',
  'sarah',
  'alice',
  'matilda',
  'jessica',
  'lily',
  'laura',
] as const;

export const voiceAliasSchema = z.enum(VOICE_ALIASES);

export const voiceGenerationRequestSchema = z.object({
  text: z.string().trim().min(1),
  voiceAlias: voiceAliasSchema,
  stability: z.number().min(0).max(1).default(0.5),
  speed: z.number().min(0.7).max(1.2).default(1),
  outputFormat: z.literal('mp3').default('mp3'),
});

export type VoiceAlias = z.infer<typeof voiceAliasSchema>;
export type VoiceGenerationRequest = z.infer<typeof voiceGenerationRequestSchema>;

export type VoiceProviderName =
  | 'elevenlabs'
  | 'fish-audio'
  | 'gpt-sovits'
  | 'piper'
  | 'chattts';

export interface ProviderAudio {
  provider: VoiceProviderName;
  audio: Buffer;
  contentType: string;
}

export interface VoiceGenerationResult {
  provider: VoiceProviderName;
  audio: Buffer;
  contentType: 'audio/mpeg';
  fallbackDepth: number;
}

export interface VoiceProvider {
  readonly name: VoiceProviderName;
  isConfigured(): boolean;
  generate(request: VoiceGenerationRequest): Promise<ProviderAudio>;
}
