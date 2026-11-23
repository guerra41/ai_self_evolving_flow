import { spawn } from 'node:child_process';

export interface BoundedResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputExceeded: boolean;
  spawnError?: string;
}

export interface BoundedOptions {
  cwd: string;
  timeoutMs: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;

/**
 * Environment handed to anything that runs LLM-generated code. Secrets such as
 * OPENAI_API_KEY are deliberately absent: only what a child process needs to start.
 */
export function allowlistedEnv(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'];
  const env: NodeJS.ProcessEnv = { NODE_OPTIONS: '', CI: '1' };
  for (const key of keep) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  return env;
}

/**
 * Runs a command with a hard timeout, a forced kill, and a cap on captured output.
 * It never throws: every failure mode is reported in the result.
 */
export function runBounded(
  command: string,
  args: string[],
  options: BoundedOptions,
): Promise<BoundedResult> {
  const maxOutput = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return new Promise((resolvePromise) => {
    const result: BoundedResult = {
      code: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      outputExceeded: false,
    };

    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ?? allowlistedEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      resolvePromise({ ...result, spawnError: error instanceof Error ? error.message : String(error) });
      return;
    }

    let settled = false;
    const finish = (): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolvePromise(result);
      }
    };

    const timer = setTimeout(() => {
      result.timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);

    const collect = (stream: 'stdout' | 'stderr') => (chunk: string): void => {
      if (result.stdout.length + result.stderr.length >= maxOutput) {
        if (!result.outputExceeded) {
          result.outputExceeded = true;
          child.kill('SIGKILL');
        }
        return;
      }
      result[stream] += chunk;
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));

    child.on('error', (error) => {
      result.spawnError = error.message;
      finish();
    });
    child.on('close', (code) => {
      result.code = code;
      finish();
    });
  });
}
