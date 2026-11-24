import { cp, mkdir, mkdtemp, rm, rmdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { allowlistedEnv, runBounded } from './isolation.js';

export interface TestRunResult {
  passed: boolean;
  output: string;
}

/**
 * Runs the hand-written TaskAgent tests (the equivalent of `pnpm test`, whose script is
 * `vitest run`) against a throw-away copy of the project, so a modified TaskAgent never
 * executes in the real working tree:
 *  - the copy holds only tests/task-agent.test.ts and src/task-agent/ (no eval/, no harness)
 *  - allowlisted environment (no API keys), hard timeout with SIGKILL, capped output
 * The real tests/ and eval/ are protected separately by the tamper check in guard.ts.
 */
export async function runIsolatedTests(
  timeoutMs: number,
  root = process.cwd(),
): Promise<TestRunResult> {
  const copy = await mkdtemp(join(tmpdir(), 'ai-evolution-tests-'));

  try {
    await mkdir(join(copy, 'tests'), { recursive: true });
    await mkdir(join(copy, 'src'), { recursive: true });
    await cp(join(root, 'tests', 'task-agent.test.ts'), join(copy, 'tests', 'task-agent.test.ts'));
    await cp(join(root, 'src', 'task-agent'), join(copy, 'src', 'task-agent'), { recursive: true });
    await cp(join(root, 'package.json'), join(copy, 'package.json'));
    await cp(join(root, 'tsconfig.json'), join(copy, 'tsconfig.json'));
    await symlink(resolve(root, 'node_modules'), join(copy, 'node_modules'), 'junction');

    const result = await runBounded(
      process.execPath,
      [join('node_modules', 'vitest', 'vitest.mjs'), 'run'],
      { cwd: copy, timeoutMs, env: allowlistedEnv() },
    );

    const output = `${result.stdout}\n${result.stderr}`.trim().slice(-4000);
    if (result.spawnError) {
      return { passed: false, output: `Could not start tests: ${result.spawnError}` };
    }
    if (result.timedOut) {
      return { passed: false, output: `Tests timed out after ${timeoutMs} ms\n${output}` };
    }
    if (result.outputExceeded) {
      return { passed: false, output: `Tests exceeded the output cap\n${output}` };
    }
    return { passed: result.code === 0, output };
  } finally {
    // Remove the node_modules link itself (non-recursive) so cleanup can never follow it
    // into the real dependencies.
    await rmdir(join(copy, 'node_modules')).catch(() => undefined);
    // Cleanup problems (for example a file still being released) must not change the result.
    await rm(copy, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
  }
}
