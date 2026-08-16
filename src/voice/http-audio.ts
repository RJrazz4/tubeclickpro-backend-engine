import { getConfig } from '../config/env.js';
import type { VoiceProviderName } from './contracts.js';
import { VoiceProviderError } from './errors.js';

export async function fetchProviderAudio(options: {
  provider: VoiceProviderName;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}): Promise<{ audio: Buffer; contentType: string }> {
  const config = getConfig();
  let response: Response;
  try {
    response = await fetch(options.url, {
      method: 'POST',
      headers: options.headers,
      body: JSON.stringify(options.body),
      signal: AbortSignal.timeout(config.VOICE_PROVIDER_TIMEOUT_MS),
    });
  } catch (error) {
    throw new VoiceProviderError(options.provider, 'NETWORK_OR_TIMEOUT', 'Provider request failed', {
      cause: error,
    });
  }

  if (!response.ok) {
    const code =
      response.status === 429
        ? 'RATE_LIMITED'
        : response.status === 401 || response.status === 403
          ? 'AUTH_REJECTED'
          : response.status >= 500
            ? 'UPSTREAM_UNAVAILABLE'
            : `UPSTREAM_HTTP_${response.status}`;
    throw new VoiceProviderError(options.provider, code, 'Provider rejected voice generation');
  }

  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > config.VOICE_MAX_AUDIO_BYTES) {
    throw new VoiceProviderError(options.provider, 'AUDIO_TOO_LARGE', 'Provider audio exceeded size limit');
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length === 0 || audio.length > config.VOICE_MAX_AUDIO_BYTES) {
    throw new VoiceProviderError(options.provider, 'INVALID_AUDIO', 'Provider returned invalid audio');
  }

  return {
    audio,
    contentType: (response.headers.get('content-type') || 'application/octet-stream')
      .split(';')[0]!
      .trim()
      .toLowerCase(),
  };
}
