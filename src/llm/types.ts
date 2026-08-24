/** LLM gateway contracts (ported from tubeclick-ai-manager-bot, engine-flavored). */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface CompletionResult {
  model: string;
  content: string;
  usage: CompletionUsage;
  keyId: string;
}

export type KeyHealth = 'active' | 'exhausted' | 'rate_limited' | 'cooling_down';

export interface KeyState {
  id: string;
  key: string;
  health: KeyHealth;
  cooldownUntil: number | null;
  calls: number;
  errors: number;
  lastUsedAt: number;
}

export type PublicKeyState = Omit<KeyState, 'key'>;

export interface TransportRequest {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  timeoutMs: number;
  /** Optional extra body fields (temperature, max_tokens, response_format). */
  extra?: Record<string, unknown>;
}

export type OpenRouterTransport = (req: TransportRequest) => Promise<Omit<CompletionResult, 'keyId'>>;
