import { spawn } from 'node:child_process';
import { getConfig } from '../config/env.js';
import type { ProviderAudio } from './contracts.js';
import { VoiceProviderError } from './errors.js';

function isMp3(contentType: string, audio: Buffer): boolean {
  return (
    contentType === 'audio/mpeg' ||
    contentType === 'audio/mp3' ||
    audio.subarray(0, 3).toString('ascii') === 'ID3' ||
    (audio.length > 1 && audio[0] === 0xff && (audio[1]! & 0xe0) === 0xe0)
  );
}

export class AudioNormalizer {
  async toMp3(input: ProviderAudio): Promise<Buffer> {
    if (isMp3(input.contentType, input.audio)) return input.audio;

    const config = getConfig();
    return await new Promise<Buffer>((resolve, reject) => {
      const child = spawn(
        config.FFMPEG_BIN,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          'pipe:0',
          '-vn',
          '-codec:a',
          'libmp3lame',
          '-b:a',
          '128k',
          '-f',
          'mp3',
          'pipe:1',
        ],
        { shell: false, stdio: ['pipe', 'pipe', 'pipe'] },
      );

      const chunks: Buffer[] = [];
      let total = 0;
      let stderr = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), config.VOICE_PROVIDER_TIMEOUT_MS);

      child.stdout.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > config.VOICE_MAX_AUDIO_BYTES) child.kill('SIGKILL');
        else chunks.push(chunk);
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-500);
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(
          new VoiceProviderError(input.provider, 'FFMPEG_UNAVAILABLE', 'Audio normalizer unavailable', {
            cause: error,
          }),
        );
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const output = Buffer.concat(chunks);
        if (code !== 0 || output.length === 0 || output.length > config.VOICE_MAX_AUDIO_BYTES) {
          reject(
            new VoiceProviderError(
              input.provider,
              'AUDIO_NORMALIZATION_FAILED',
              `Audio normalization failed${stderr ? `: ${stderr}` : ''}`,
            ),
          );
          return;
        }
        resolve(output);
      });
      child.stdin.end(input.audio);
    });
  }
}
