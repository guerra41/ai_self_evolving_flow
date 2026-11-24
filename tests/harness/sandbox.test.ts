import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runBounded } from '../../src/isolation.js';
import { runInSandbox } from '../../src/sandbox.js';

// A hostile "TaskAgent" that tries each escape and reports which ones worked.
// The target paths are embedded as literals: the sandbox child gets no inherited
// environment, so reading them from process.env would fail for the wrong reason
// and make every attempt look "blocked".
function hostileSource(secretPath: string, victimPath: string): string {
  return `
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const attempt = (name, fn) => { try { fn(); return name + ':ALLOWED'; } catch { return name + ':blocked'; } };
export function solveTask() {
  return [
    attempt('read-outside-file', () => { if (readFileSync(${JSON.stringify(secretPath)}, 'utf8') !== 'frozen-eval') throw new Error('wrong content'); }),
    attempt('write-outside-file', () => writeFileSync(${JSON.stringify(victimPath)}, 'tampered')),
    attempt('spawn-process', () => execSync('node -v')),
    'api-key:' + (process.env.OPENAI_API_KEY ? 'LEAKED' : 'absent'),
  ].join(',');
}
`;
}

describe('sandbox isolation against a hostile TaskAgent', () => {
  let dir = '';
  let entry = '';
  let secretPath = '';
  let victimPath = '';

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sandbox-attack-'));
    secretPath = join(dir, 'secret-eval.txt');
    victimPath = join(dir, 'victim-tests.txt');
    entry = join(dir, 'hostile.mjs');
    await writeFile(secretPath, 'frozen-eval');
    await writeFile(victimPath, 'original');
    await writeFile(entry, hostileSource(secretPath, victimPath));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('control: the same code succeeds without the sandbox', async () => {
    // Proves the attacks are real, so "blocked" below is meaningful.
    const runner = join(dir, 'control.mjs');
    await writeFile(
      runner,
      `import { solveTask } from ${JSON.stringify(pathToFileURL(entry).href)};\nprocess.stdout.write(solveTask());`,
    );
    process.env.OPENAI_API_KEY = 'secret-test-value';
    try {
      const result = await runBounded(process.execPath, [runner], {
        cwd: dir,
        timeoutMs: 10_000,
        env: process.env, // deliberately unfiltered
      });
      expect(result.code).toBe(0);
      expect(result.stdout).toBe(
        'read-outside-file:ALLOWED,write-outside-file:ALLOWED,spawn-process:ALLOWED,api-key:LEAKED',
      );
    } finally {
      delete process.env.OPENAI_API_KEY;
      await writeFile(victimPath, 'original');
    }
  });

  it('blocks reads, writes, process spawning and key access inside the sandbox', async () => {
    process.env.OPENAI_API_KEY = 'secret-test-value';
    try {
      const result = await runInSandbox({}, 10_000, 128, entry);
      expect(result.error).toBeUndefined();
      expect(result.success).toBe(true);
      expect(result.output).toBe(
        'read-outside-file:blocked,write-outside-file:blocked,spawn-process:blocked,api-key:absent',
      );
      // The file on disk is the real proof that the write did not happen.
      expect(await readFile(victimPath, 'utf8')).toBe('original');
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it('kills code that never finishes', async () => {
    const loop = join(dir, 'loop.mjs');
    await writeFile(loop, 'export function solveTask() { for (;;) {} }');
    const result = await runInSandbox({}, 700, 128, loop);
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  });
});
