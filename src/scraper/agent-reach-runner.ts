import { spawn } from 'node:child_process';
import { getConfig } from '../config/env.js';
import { extractionResultSchema, type ExtractionResult } from '../domain/extraction.js';
import { ScraperProviderError } from './errors.js';

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export interface AgentReachRequest {
  videoUrl: string;
  mode: 'basic' | 'deep';
}

export class AgentReachRunner {
  async extract(request: AgentReachRequest): Promise<ExtractionResult> {
    const config = getConfig();
    return await new Promise<ExtractionResult>((resolve, reject) => {
      const child = spawn(config.PYTHON_BIN, [config.AGENT_REACH_WORKER_PATH], {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH ?? '',
          PYTHONUNBUFFERED: '1',
          HOME: process.env.HOME ?? '/tmp',
        },
      });

      let stdout = '';
      let stderr = '';
      let outputBytes = 0;
      let settled = false;
      const finish = (error?: Error, result?: ExtractionResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else if (result) resolve(result);
        else
          reject(
            new ScraperProviderError(
              'agent-reach',
              'PRIMARY_EMPTY_RESULT',
              'Agent-Reach worker exited without a result',
            ),
          );
      };

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(
          new ScraperProviderError('agent-reach', 'PRIMARY_TIMEOUT', 'Agent-Reach worker timed out'),
        );
      }, config.SCRAPER_TIMEOUT_MS);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > MAX_OUTPUT_BYTES) {
          child.kill('SIGKILL');
          finish(
            new ScraperProviderError(
              'agent-reach',
              'PRIMARY_OUTPUT_LIMIT',
              'Agent-Reach worker output exceeded the size limit',
            ),
          );
          return;
        }
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-4000);
      });
      child.on('error', (error) =>
        finish(
          new ScraperProviderError(
            'agent-reach',
            'PRIMARY_SPAWN_ERROR',
            'Agent-Reach worker could not be started',
            { cause: error },
          ),
        ),
      );
      child.on('close', (code) => {
        if (settled) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          finish(
            new ScraperProviderError(
              'agent-reach',
              'PRIMARY_INVALID_JSON',
              `Agent-Reach worker returned invalid JSON (exit ${code ?? 'unknown'})`,
            ),
          );
          return;
        }
        if (code !== 0) {
          const workerError = parsed as { error?: { code?: string; message?: string } };
          const message = workerError.error?.message ?? (stderr || 'Agent-Reach extraction failed');
          finish(
            new ScraperProviderError(
              'agent-reach',
              workerError.error?.code ?? 'PRIMARY_EXTRACTION_FAILED',
              message,
            ),
          );
          return;
        }
        try {
          finish(undefined, extractionResultSchema.parse(parsed));
        } catch (error) {
          finish(
            new ScraperProviderError(
              'agent-reach',
              'PRIMARY_SCHEMA_MISMATCH',
              'Agent-Reach returned an invalid extraction contract',
              { cause: error },
            ),
          );
        }
      });

      child.stdin.end(JSON.stringify(request));
    });
  }
}
