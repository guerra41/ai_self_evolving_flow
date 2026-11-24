import { realpathSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, rmdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evolve, type ArchiveRecord } from '../../src/evolve.js';
import { screenSource } from '../../src/guard.js';
import { createScriptedProposer, SCRIPT } from '../../src/scripted-proposer.js';

// The loop below runs five real generations with isolated vitest processes.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 30_000 });

const REAL_ROOT = resolve(__dirname, '..', '..');

// `pnpm evolve` edits src/task-agent/TaskAgent.ts in place, so these tests use a pinned
// copy of the starting TaskAgent instead of whatever the working tree currently holds.
const SEED_PATH = join(REAL_ROOT, 'tests', 'harness', 'fixtures', 'seed-task-agent.ts.txt');

describe('scripted offline proposer: script', () => {
  it('every patch that should change the seed actually matches it', async () => {
    const seed = await readFile(SEED_PATH, 'utf8');
    // Steps 1, 3 and 5 are fixes; a silent no-op would mean the script drifted from the seed.
    for (const index of [0, 2, 4]) {
      expect(SCRIPT[index].apply(seed)).not.toBe(seed);
    }
  });

  it('the hostile step is caught by the source screen', async () => {
    const seed = await readFile(SEED_PATH, 'utf8');
    expect(screenSource(SCRIPT[1].apply(seed)).length).toBeGreaterThan(0);
  });

  it('the fixing steps pass the source screen', async () => {
    const seed = await readFile(SEED_PATH, 'utf8');
    for (const index of [0, 2, 4]) {
      expect(screenSource(SCRIPT[index].apply(seed))).toEqual([]);
    }
  });

  it('does nothing once the script is finished', async () => {
    const propose = createScriptedProposer();
    let source = await readFile(SEED_PATH, 'utf8');
    for (let i = 0; i < SCRIPT.length; i += 1) {
      source = (await propose(source)).source;
    }
    const after = await propose(source);
    expect(after.source).toBe(source);
    expect(after.proposal).toContain('script finished');
  });
});

describe('scripted offline proposer: full loop on the real seed', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'scripted-run-'));
    await mkdir(join(root, 'tests'), { recursive: true });
    await mkdir(join(root, 'src', 'task-agent'), { recursive: true });
    await cp(join(REAL_ROOT, 'tests', 'task-agent.test.ts'), join(root, 'tests', 'task-agent.test.ts'));
    await cp(SEED_PATH, join(root, 'src', 'task-agent', 'TaskAgent.ts'));
    await cp(join(REAL_ROOT, 'eval'), join(root, 'eval'), { recursive: true });
    await cp(join(REAL_ROOT, 'training'), join(root, 'training'), { recursive: true });
    await cp(join(REAL_ROOT, 'package.json'), join(root, 'package.json'));
    await cp(join(REAL_ROOT, 'tsconfig.json'), join(root, 'tsconfig.json'));
    await symlink(realpathSync.native(join(REAL_ROOT, 'node_modules')), join(root, 'node_modules'), 'junction');
  });

  afterEach(async () => {
    await rmdir(join(root, 'node_modules')).catch(() => undefined);
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
  });

  it('climbs from 63 to 100 while the screen and the test gate each reject one bad step', async () => {
    await evolve({
      root,
      generations: 5,
      timeoutMs: 60_000,
      memoryMb: 256,
      propose: createScriptedProposer(),
      log: () => undefined,
    });

    const lines = (await readFile(join(root, 'outputs', 'archive.jsonl'), 'utf8')).split('\n').filter(Boolean);
    const records = lines.map((line) => JSON.parse(line) as ArchiveRecord);

    expect(records.map((r) => [r.generation, r.score, r.accepted])).toEqual([
      [0, 63, true], // seed: passes the unit tests, fails 3 of 8 frozen tasks
      [1, 75, true], // max_number fixed
      [2, null, false], // forbidden import: rejected before anything runs
      [3, 88, true], // palindrome fixed
      [4, null, false], // broke uppercasing: fails the unit tests
      [5, 100, true], // slugify fixed
    ]);
    expect(records[2].rejectedBy?.length).toBeGreaterThan(0);
    expect(records[4].testError).toBeTruthy();
    expect(records.every((r) => r.runId === records[0].runId)).toBe(true);
    expect(records[5].bestScore).toBe(100);

    // The kept source is the fully fixed one, and the rejected ideas left no trace.
    const finalSource = await readFile(join(root, 'src', 'task-agent', 'TaskAgent.ts'), 'utf8');
    expect(finalSource).toContain('Math.max(...task.input)');
    expect(finalSource).toContain('toUpperCase()');
    expect(finalSource).not.toContain('node:fs');
  });
});
