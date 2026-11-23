import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

export interface SandboxResult {
  success: boolean;
  output?: unknown;
  error?: string;
}

export async function runInSandbox(
  taskJson: unknown,
  timeoutMs: number,
  memoryMb: number,
): Promise<SandboxResult> {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'ai-evolution-'));
  const bundlePath = join(tempDirectory, 'task-agent.js');
  const runnerPath = join(tempDirectory, 'runner.js');

  try {
    await build({
      entryPoints: [resolve('src/task-agent/TaskAgent.ts')],
      outfile: bundlePath,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node18',
    });

    await writeFile(
      runnerPath,
      [
        `import { solveTask } from ${JSON.stringify(pathToFileURL(bundlePath).href)};`,
        'const task = ' + JSON.stringify(taskJson) + ';',
        'process.stdout.write(JSON.stringify(solveTask(task)));',
      ].join('\n'),
    );

    return await runChildProcess(runnerPath, timeoutMs, memoryMb);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function runChildProcess(
  runnerPath: string,
  timeoutMs: number,
  memoryMb: number,
): Promise<SandboxResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${memoryMb}`, runnerPath],
      { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_OPTIONS: '' } },
    );

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (stderr += chunk));

    child.on('error', (error) => {
      clearTimeout(timer);
      resolvePromise({ success: false, error: error.message });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolvePromise({
          success: false,
          error: stderr.trim() || `Sandbox exited with code ${code}`,
        });
        return;
      }

      try {
        resolvePromise({ success: true, output: JSON.parse(stdout) });
      } catch (error) {
        resolvePromise({
          success: false,
          error: error instanceof Error ? error.message : 'Invalid sandbox output',
        });
      }
    });
  });
}
