import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getConfig } from '../../config/env.js';
import type { ProviderAudio, VoiceGenerationRequest, VoiceProvider } from '../contracts.js';
import { VoiceProviderError } from '../errors.js';
import { parseJsonMap, type StringVoiceMap } from '../voice-maps.js';

export class PiperProvider implements VoiceProvider {
  readonly name = 'piper' as const;
  private readonly config = getConfig();
  private readonly voices = parseJsonMap<StringVoiceMap>(
    this.config.PIPER_VOICE_MAP_JSON,
    'PIPER_VOICE_MAP_JSON',
  );

  isConfigured(): boolean {
    return Boolean(this.config.PIPER_BIN && Object.keys(this.voices).length > 0);
  }

  async generate(request: VoiceGenerationRequest): Promise<ProviderAudio> {
    const modelPath = this.voices[request.voiceAlias];
    if (!this.config.PIPER_BIN || !modelPath) {
      throw new VoiceProviderError(this.name, 'NOT_CONFIGURED', 'Piper voice is not configured');
    }

    const directory = await mkdtemp(path.join(tmpdir(), 'tubeclick-piper-'));
    const outputPath = path.join(directory, 'output.wav');
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          this.config.PIPER_BIN,
          [
            '--model',
            modelPath,
            '--output_file',
            outputPath,
            '--length_scale',
            String(1 / request.speed),
          ],
          { shell: false, stdio: ['pipe', 'ignore', 'pipe'] },
        );
        let stderr = '';
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, this.config.VOICE_PROVIDER_TIMEOUT_MS);
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => {
          stderr = (stderr + chunk).slice(-500);
        });
        child.on('error', (error) => {
          clearTimeout(timer);
          reject(
            new VoiceProviderError(this.name, 'PROCESS_START_FAILED', 'Piper could not start', {
              cause: error,
            }),
          );
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (timedOut) {
            reject(new VoiceProviderError(this.name, 'TIMEOUT', 'Piper timed out'));
          } else if (code !== 0) {
            reject(
              new VoiceProviderError(
                this.name,
                'PROCESS_FAILED',
                `Piper failed${stderr ? `: ${stderr}` : ''}`,
              ),
            );
          } else resolve();
        });
        child.stdin.end(request.text);
      });

      const audio = await readFile(outputPath);
      if (audio.length === 0 || audio.length > this.config.VOICE_MAX_AUDIO_BYTES) {
        throw new VoiceProviderError(this.name, 'INVALID_AUDIO', 'Piper returned invalid audio');
      }
      return { provider: this.name, audio, contentType: 'audio/wav' };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
