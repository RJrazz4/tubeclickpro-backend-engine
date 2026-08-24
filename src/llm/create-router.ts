import { getConfig } from '../config/env.js';
import { openRouterTransport } from './openrouter.js';
import { OpenRouterRouter } from './router.js';
import type { OpenRouterTransport } from './types.js';

/** Build the shared router from env. Returns null when no keys are set
 *  (synthesis routes then 503, like the YouTube module). */
export function createOpenRouterRouter(transport: OpenRouterTransport = openRouterTransport()): OpenRouterRouter | null {
  const config = getConfig();
  if (config.OPENROUTER_API_KEYS.length === 0) return null;
  return new OpenRouterRouter(config.OPENROUTER_API_KEYS, transport, {
    model: config.OPENROUTER_MODEL_PREMIUM,
    timeoutMs: config.OPENROUTER_TIMEOUT_MS,
  });
}

export function llmModuleEnabled(): boolean {
  return getConfig().OPENROUTER_API_KEYS.length > 0;
}
