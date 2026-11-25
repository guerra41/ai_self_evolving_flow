import { access, cp, mkdir, mkdtemp, readFile, rm, rmdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evolve, type ArchiveRecord, type ProposeFn } from '../../src/evolve.js';
import { runIsolatedTests } from '../../src/test-runner.js';

// Each generation runs a real isolated vitest process (about 2 s), so multi-generation
// tests need more than the 5 s default.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 30_000 });

const GOOD_SOURCE = `export type Task = { kind: 'upper'; input: string };
export function solveTask(task: Task): string {
  return task.input.toUpperCase();
}
`;

// Passes the fixture's unit test ('abc' -> 'ABC') but fails the frozen eval ('frozen').
const WEAK_SOURCE = `export type Task = { kind: 'upper'; input: string };
export function solveTask(task: Task): string {
  return task.input === 'abc' ? 'ABC' : task.input;
}
`;

const BROKEN_SOURCE = GOOD_SOURCE.replace('toUpperCase', 'toLowerCase');

const FIXTURE_TEST = `import { expect, it } from 'vitest';
import { solveTask } from '../src/task-agent/TaskAgent.js';
it('uppercases', () => {
  expect(solveTask({ kind: 'upper', input: 'abc' })).toBe('ABC');
});
`;

const REAL_ROOT = resolve(__dirname, '..', '..');

let root = '';

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

async function readArchive(): Promise<ArchiveRecord[]> {
  const text = await readFile(join(root, 'outputs', 'archive.jsonl'), 'utf8').catch(() => '');
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as ArchiveRecord);
}

async function generationRecords(): Promise<ArchiveRecord[]> {
  return (await readArchive()).filter((record) => record.generation > 0);
}

async function generationOne(): Promise<ArchiveRecord> {
  const [record] = await generationRecords();
  return record;
}

function options(propose: ProposeFn, generations = 1) {
  return { root, generations, timeoutMs: 60_000, memoryMb: 128, propose, log: () => undefined };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'evolve-fixture-'));
  await mkdir(join(root, 'tests'), { recursive: true });
  await mkdir(join(root, 'src', 'task-agent'), { recursive: true });
  await mkdir(join(root, 'eval'), { recursive: true });
  await mkdir(join(root, 'training'), { recursive: true });
  await writeFile(join(root, 'tests', 'task-agent.test.ts'), FIXTURE_TEST);
  await writeFile(join(root, 'src', 'task-agent', 'TaskAgent.ts'), GOOD_SOURCE);
  await writeFile(join(root, 'eval', 'tasks.json'), JSON.stringify([{ kind: 'upper', input: 'frozen' }]));
  await writeFile(join(root, 'eval', 'expected.json'), JSON.stringify(['FROZEN']));
  await writeFile(join(root, 'training', 'tasks.json'), JSON.stringify([{ prompt: 'Uppercase text.' }]));
  await cp(join(REAL_ROOT, 'package.json'), join(root, 'package.json'));
  await cp(join(REAL_ROOT, 'tsconfig.json'), join(root, 'tsconfig.json'));
  await symlink(join(REAL_ROOT, 'node_modules'), join(root, 'node_modules'), 'junction');
});

afterEach(async () => {
  // Drop the link first so recursive cleanup can never follow it into real dependencies.
  await rmdir(join(root, 'node_modules')).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
});

describe('runIsolatedTests', () => {
  it('passes for a correct TaskAgent', async () => {
    const result = await runIsolatedTests(60_000, root);
    expect(result.output).toContain('1 passed');
    expect(result.passed).toBe(true);
  });

  it('fails for a TaskAgent that breaks the tests', async () => {
    await writeFile(join(root, 'src', 'task-agent', 'TaskAgent.ts'), BROKEN_SOURCE);
    const result = await runIsolatedTests(60_000, root);
    expect(result.passed).toBe(false);
    expect(result.output).toMatch(/expected|failed/i);
  });

  it('runs in a copy: the fixture is untouched and real dependencies survive', async () => {
    await runIsolatedTests(60_000, root);
    expect(await readFile(join(root, 'src', 'task-agent', 'TaskAgent.ts'), 'utf8')).toBe(GOOD_SOURCE);
    expect(await exists(join(root, 'outputs'))).toBe(false);
    expect(await exists(join(REAL_ROOT, 'node_modules', 'vitest', 'package.json'))).toBe(true);
  });

  it.skipIf(process.platform !== 'win32')(
    'works when the project path uses a lowercase drive letter',
    async () => {
      // Regression: vitest loaded two copies of itself when dependencies were reached via
      // d:\... but resolved as D:\..., and failed with "failed to find the current suite".
      const lower = `${REAL_ROOT[0].toLowerCase()}${REAL_ROOT.slice(1)}`;
      await rmdir(join(root, 'node_modules'));
      await symlink(join(lower, 'node_modules'), join(root, 'node_modules'), 'junction');
      const result = await runIsolatedTests(60_000, root);
      expect(result.output).not.toContain('current suite');
      expect(result.passed).toBe(true);
    },
  );

  it('does not run an infinite loop forever', async () => {
    await writeFile(
      join(root, 'src', 'task-agent', 'TaskAgent.ts'),
      `${GOOD_SOURCE}\nfor (;;) {}\n`,
    );
    const result = await runIsolatedTests(3_000, root);
    expect(result.passed).toBe(false);
    expect(result.output).toContain('timed out');
  });
});

describe('evolve', () => {
  it('records a passing generation with its score, but does not keep a no-change proposal', async () => {
    await evolve(options(async (source) => ({ source, proposal: 'no change' })));
    const record = await generationOne();
    expect(record).toMatchObject({ generation: 1, testPass: true, score: 100, accepted: false });
  });

  it('archives a baseline as generation 0 before any proposal', async () => {
    await evolve(options(async (source) => ({ source, proposal: 'no change' })));
    const [baseline] = await readArchive();
    expect(baseline).toMatchObject({ generation: 0, testPass: true, score: 100, accepted: true, proposal: 'baseline' });
  });

  it('refuses to start when the starting TaskAgent fails its own tests', async () => {
    await writeFile(join(root, 'src', 'task-agent', 'TaskAgent.ts'), BROKEN_SOURCE);
    await expect(evolve(options(async (source) => ({ source, proposal: 'x' })))).rejects.toThrow(
      /starting TaskAgent fails its own tests/,
    );
  });

  it('rolls back a proposal that fails the tests and skips scoring', async () => {
    await evolve(options(async () => ({ source: BROKEN_SOURCE, proposal: 'breaks uppercase' })));
    const record = await generationOne();
    expect(record).toMatchObject({ generation: 1, testPass: false, score: null });
    expect(record.testError).toBeTruthy();
    expect(await readFile(join(root, 'src', 'task-agent', 'TaskAgent.ts'), 'utf8')).toBe(GOOD_SOURCE);
  });

  it('rejects a proposal that fails the source screen without writing it', async () => {
    const hostile = `import { readFileSync } from 'node:fs';\n${GOOD_SOURCE}`;
    await evolve(options(async () => ({ source: hostile, proposal: 'reads files' })));
    const record = await generationOne();
    expect(record.testPass).toBe(false);
    expect(record.rejectedBy?.length).toBeGreaterThan(0);
    expect(await readFile(join(root, 'src', 'task-agent', 'TaskAgent.ts'), 'utf8')).toBe(GOOD_SOURCE);
  });

  it('records a failed proposer call and keeps going', async () => {
    let calls = 0;
    await evolve(options(async (source) => {
      calls += 1;
      if (calls === 1) {
        throw new Error('API returned 500');
      }
      return { source, proposal: 'ok' };
    }, 2));
    const records = await generationRecords();
    expect(records.map((r) => r.testPass)).toEqual([false, true]);
    expect(records[0].proposal).toContain('API returned 500');
  });

  it('aborts, rolls back and archives tampering when a protected file changes', async () => {
    const testPath = join(root, 'tests', 'task-agent.test.ts');
    await expect(
      evolve(options(async () => {
        // Simulates generated code escaping its sandbox and weakening the tests.
        await writeFile(testPath, FIXTURE_TEST.replace("'ABC'", "'abc'"));
        return { source: BROKEN_SOURCE, proposal: 'edits the tests' };
      }, 3)),
    ).rejects.toThrow(/protected files changed \(tests\/task-agent\.test\.ts\)/);

    const records = await generationRecords();
    expect(records).toHaveLength(1); // generations 2 and 3 never ran
    expect(records[0].tamperedPaths).toEqual(['tests/task-agent.test.ts']);
    expect(records[0].testPass).toBe(false);
    expect(await readFile(join(root, 'src', 'task-agent', 'TaskAgent.ts'), 'utf8')).toBe(GOOD_SOURCE);
  });

  it('aborts when eval/ is modified during a generation', async () => {
    await expect(
      evolve(options(async (source) => {
        await writeFile(join(root, 'eval', 'expected.json'), JSON.stringify(['anything']));
        return { source, proposal: 'edits the answers' };
      })),
    ).rejects.toThrow(/eval\/expected\.json/);
  });

  it('rolls back a proposal that passes the tests but lowers the score', async () => {
    await evolve(options(async () => ({ source: WEAK_SOURCE, proposal: 'special-cases the unit test' })));
    const record = await generationOne();
    expect(record).toMatchObject({ testPass: true, score: 0, accepted: false, bestScore: 100 });
    expect(record.rollbackReason).toContain('below the best score');
    expect(await readFile(join(root, 'src', 'task-agent', 'TaskAgent.ts'), 'utf8')).toBe(GOOD_SOURCE);
  });

  it('keeps a proposal that improves on the baseline', async () => {
    await writeFile(join(root, 'src', 'task-agent', 'TaskAgent.ts'), WEAK_SOURCE);
    await evolve(options(async () => ({ source: GOOD_SOURCE, proposal: 'real fix' })));
    const [baseline] = await readArchive();
    const record = await generationOne();
    expect(baseline.score).toBe(0);
    expect(record).toMatchObject({ score: 100, accepted: true, bestScore: 100 });
    expect(record.codeDiff).toContain('-  return task.input === ');
    expect(record.codeDiff).toContain('+  return task.input.toUpperCase();');
    expect(await readFile(join(root, 'src', 'task-agent', 'TaskAgent.ts'), 'utf8')).toBe(GOOD_SOURCE);
  });

  it('rolls back a proposal that only ties the best score', async () => {
    await evolve(options(async (source) => ({ source: `${source}// tie
`, proposal: 'comment only' })));
    const record = await generationOne();
    expect(record).toMatchObject({ testPass: true, score: 100, accepted: false, bestScore: 100 });
    expect(record.rollbackReason).toContain('does not improve');
    expect(await readFile(join(root, 'src', 'task-agent', 'TaskAgent.ts'), 'utf8')).toBe(GOOD_SOURCE);
  });

  it('compares each generation with the best kept so far, not the previous attempt', async () => {
    let calls = 0;
    await evolve(options(async () => {
      calls += 1;
      // Generation 1 regresses (rolled back); generation 2 matches the baseline again.
      return { source: calls === 1 ? WEAK_SOURCE : `${GOOD_SOURCE}// second
`, proposal: `try ${calls}` };
    }, 2));
    const records = await generationRecords();
    // Generation 2 only ties the baseline, so it is not kept either.
    expect(records.map((r) => r.accepted)).toEqual([false, false]);
    expect(records.map((r) => r.bestScore)).toEqual([100, 100]);
  });

  it('tags every record with the run id, and different runs get different ids', async () => {
    await evolve({ ...options(async (source) => ({ source, proposal: 'a' })), runId: 'run-one' });
    await evolve({ ...options(async (source) => ({ source, proposal: 'b' })), runId: 'run-two' });
    const ids = (await readArchive()).map((r) => r.runId);
    expect(new Set(ids)).toEqual(new Set(['run-one', 'run-two']));
    expect(ids.filter((id) => id === 'run-one')).toHaveLength(2); // baseline + generation 1
  });

  it('generates a run id when none is given', async () => {
    await evolve(options(async (source) => ({ source, proposal: 'a' })));
    expect((await readArchive())[0].runId).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{4}$/);
  });
});
