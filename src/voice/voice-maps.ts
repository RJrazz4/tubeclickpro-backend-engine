import type { VoiceAlias } from './contracts.js';
import { VoiceConfigurationError } from './errors.js';

export type StringVoiceMap = Partial<Record<VoiceAlias, string>>;

export interface GptSovitsVoice {
  refAudioPath: string;
  promptText?: string;
  promptLang?: string;
  textLang?: string;
}
export type GptSovitsVoiceMap = Partial<Record<VoiceAlias, GptSovitsVoice>>;

export function parseJsonMap<T>(raw: string, label: string): T {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('expected a JSON object');
    }
    return parsed as T;
  } catch (error) {
    throw new VoiceConfigurationError(
      `${label} must be a valid JSON object: ${error instanceof Error ? error.message : 'invalid JSON'}`,
    );
  }
}

export function configuredUrl(value: string, label: string): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
    return url;
  } catch {
    throw new VoiceConfigurationError(`${label} must be an HTTP(S) URL`);
  }
}
