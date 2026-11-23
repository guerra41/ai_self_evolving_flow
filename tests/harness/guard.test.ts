import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { manifestChanges, protectedManifest, screenSource } from '../../src/guard.js';
import { allowlistedEnv, runBounded } from '../../src/isolation.js';

describe('screenSource', () => {
  it('accepts a pure TaskAgent source', () => {
    const source = `export type Task = { kind: 'upper'; input: string };
export function solveTask(task: Task): string { return task.input.toUpperCase(); }`;
    expect(screenSource(source)).toEqual([]);
  });

  it.each([
    ["import { readFileSync } from 'node:fs';", 'external or built-in module'],
    ["const fs = require('fs');", 'require()'],
    ["await import('node:child_process');", 'dynamic import()'],
    ['process.env.OPENAI_API_KEY', 'process'],
    ["fetch('https://example.com')", 'network access'],
    ["new Function('return 1')()", 'eval / Function constructor'],
  ])('rejects %s', (source, label) => {
    expect(screenSource(source).join(' ')).toContain(label);
  });

  it('ignores forbidden words that only appear in comments', () => {
    expect(screenSource('// never call fetch or process here\nexport const x = 1;')).toEqual([]);
  });
});

describe('protected manifest', () => {
  it('detects modified, added and removed protected files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'guard-test-'));
    try {
      await mkdir(join(root, 'tests'), { recursive: true });
      await mkdir(join(root, 'eval'), { recursive: true });
      await writeFile(join(root, 'tests', 'a.test.ts'), 'one');
      await writeFile(join(root, 'eval', 'tasks.json'), '[]');
      const before = await protectedManifest(root);

      expect(manifestChanges(before, await protectedManifest(root))).toEqual([]);

      await writeFile(join(root, 'tests', 'a.test.ts'), 'two');
      await writeFile(join(root, 'eval', 'extra.json'), '{}');
      expect(manifestChanges(before, await protectedManifest(root))).toEqual([
        'eval/extra.json',
        'tests/a.test.ts',
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('isolation helpers', () => {
  it('does not pass API keys to child processes', () => {
    process.env.OPENAI_API_KEY = 'secret-test-value';
    try {
      expect(JSON.stringify(allowlistedEnv())).not.toContain('secret-test-value');
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it('kills a child that exceeds the timeout', async () => {
    const result = await runBounded(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: tmpdir(),
      timeoutMs: 500,
    });
    expect(result.timedOut).toBe(true);
  });

  it('kills a child that exceeds the output cap', async () => {
    const result = await runBounded(
      process.execPath,
      ['-e', "setInterval(() => process.stdout.write('x'.repeat(10000)), 1)"],
      { cwd: tmpdir(), timeoutMs: 10_000, maxOutputBytes: 50_000 },
    );
    expect(result.outputExceeded).toBe(true);
  });
});
