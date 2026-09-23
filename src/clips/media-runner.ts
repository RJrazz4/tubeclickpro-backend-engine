import { execFile } from 'node:child_process';

/**
 * Thin, shell-free command runner for yt-dlp / ffmpeg.
 *
 * execFile (NOT exec) means arguments are passed as an argv array — the OS
 * execve receives them directly, so shell metacharacters in any argument are
 * inert. A hard timeout SIGKILLs the process group, bounding runaway encodes.
 */

export interface RunResult {
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  timeoutMs: number;
  maxBufferBytes?: number;
  cwd?: string;
}

export type CommandRunner = (bin: string, args: string[], opts: RunOptions) => Promise<RunResult>;

export const execFileRunner: CommandRunner = (bin, args, opts) =>
  new Promise<RunResult>((resolve, reject) => {
    execFile(
      bin,
      args,
      {
        timeout: opts.timeoutMs,
        maxBuffer: opts.maxBufferBytes ?? 8 * 1024 * 1024,
        killSignal: 'SIGKILL',
        ...(opts.cwd ? { cwd: opts.cwd } : {}),
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stderr: stderr?.toString() ?? '' }));
          return;
        }
        resolve({ stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' });
      },
    );
  });
