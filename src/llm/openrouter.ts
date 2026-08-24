import { RouterHttpError } from './errors.js';
import type { OpenRouterTransport, TransportRequest } from './types.js';

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface RawChoice {
  message?: { content?: string | null };
}
interface RawResponse {
  model?: string;
  choices?: RawChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

/** Production transport: plain fetch against OpenRouter with a hard timeout. */
export function openRouterTransport(): OpenRouterTransport {
  return async (req: TransportRequest) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    try {
      const res = await fetch(OPENROUTER_CHAT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${req.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://tubeclickpro.in',
          'X-Title': 'TubeClick Pro Backend Engine',
        },
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          ...(req.extra ?? {}),
        }),
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => ({}))) as RawResponse;
      if (!res.ok) {
        throw new RouterHttpError(res.status, json.error?.message ?? 'unknown error');
      }
      const content = json.choices?.[0]?.message?.content ?? '';
      return {
        model: json.model ?? req.model,
        content,
        usage: {
          promptTokens: json.usage?.prompt_tokens ?? 0,
          completionTokens: json.usage?.completion_tokens ?? 0,
        },
      };
    } catch (err) {
      if (err instanceof RouterHttpError) throw err;
      // abort/network
      throw new RouterHttpError(0, err instanceof Error ? err.message : 'network error');
    } finally {
      clearTimeout(timer);
    }
  };
}
