import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { allowlistedEnv, runBounded } from './isolation.js';

export interface SandboxResult {
  success: boolean;
  output?: unknown;
  error?: string;
}

/**
 * Isolation applied to the child that executes LLM-generated code:
 *  - empty temporary working directory (the repo, tests/ and eval/ are not the cwd)
 *  - allowlisted environment (no API keys)
 *  - Node permission model: no file writes, no child processes, no workers,
 *    reads limited to the temporary directory
 *  - hard timeout with SIGKILL, heap limit, and a cap on captured output
 * Not covered: network access (Node's permission model does not restrict it).
 * Use Docker with --network none for full isolation.
 */
export async function runInSandbox(
  taskJson: unknown,
  timeoutMs: number,
  memoryMb: number,
  entryPoint = 'src/task-agent/TaskAgent.ts',
): Promise<SandboxResult> {
  if (!process.allowedNodeEnvironmentFlags.has('--permission')) {
    return { success: false, error: 'Node permission model unavailable; Node 22.3 or newer is required' };
  }

  const tempDirectory = await mkdtemp(join(tmpdir(), 'ai-evolution-'));
  const bundlePath = join(tempDirectory, 'task-agent.mjs');
  const runnerPath = join(tempDirectory, 'runner.mjs');

  try {
    await build({
      entryPoints: [resolve(entryPoint)],
      outfile: bundlePath,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
    });

    await writeFile(
      runnerPath,
      [
        `import { solveTask } from ${JSON.stringify(pathToFileURL(bundlePath).href)};`,
        'const task = ' + JSON.stringify(taskJson) + ';',
        'process.stdout.write(JSON.stringify(solveTask(task)));',
      ].join('\n'),
    );

    const result = await runBounded(
      process.execPath,
      [
        `--max-old-space-size=${memoryMb}`,
        '--permission',
        `--allow-fs-read=${tempDirectory}`,
        runnerPath,
      ],
      { cwd: tempDirectory, timeoutMs, env: allowlistedEnv() },
    );

    if (result.spawnError) {
      return { success: false, error: result.spawnError };
    }
    if (result.timedOut) {
      return { success: false, error: `Sandbox timed out after ${timeoutMs} ms` };
    }
    if (result.outputExceeded) {
      return { success: false, error: 'Sandbox output exceeded the size cap' };
    }
    if (result.code !== 0) {
      return { success: false, error: result.stderr.trim().slice(0, 500) || `Sandbox exited with code ${result.code}` };
    }

    try {
      return { success: true, output: JSON.parse(result.stdout) };
    } catch {
      return { success: false, error: 'Invalid sandbox output' };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}
