import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { evaluate } from './evaluator.js';
import { manifestChanges, protectedManifest, screenSource } from './guard.js';
import { runIsolatedTests } from './test-runner.js';

export interface Proposal {
  source: string;
  proposal: string;
}

export type ProposeFn = (
  currentSource: string,
  trainingPrompts: string[],
  pastScores: number[],
) => Promise<Proposal>;

export interface EvolveOptions {
  root: string;
  generations: number;
  timeoutMs: number;
  memoryMb: number;
  propose: ProposeFn;
  log?: (message: string) => void;
}

export interface ArchiveRecord {
  generation: number;
  codeDiff: string;
  testPass: boolean;
  score: number | null;
  timestamp: string;
  proposal: string;
  testError?: string;
  evaluatorFailures?: string[];
  tamperedPaths?: string[];
  rejectedBy?: string[];
}

export function createDiff(before: string, after: string): string {
  if (before === after) {
    return '--- no source change ---';
  }
  return `--- before\n${before}\n+++ after\n${after}`;
}

/**
 * The evolution loop. Everything is relative to `root` so it can run against a fixture
 * project in tests. Throws (after rolling the TaskAgent back and archiving the generation)
 * when a protected file changed during a generation.
 */
export async function evolve(options: EvolveOptions): Promise<void> {
  const { root, generations, timeoutMs, memoryMb, propose } = options;
  const log = options.log ?? console.log;
  const sourcePath = join(root, 'src', 'task-agent', 'TaskAgent.ts');
  const archivePath = join(root, 'outputs', 'archive.jsonl');

  await mkdir(join(root, 'outputs'), { recursive: true });
  const training = JSON.parse(await readFile(join(root, 'training', 'tasks.json'), 'utf8')) as
    Array<{ prompt: string }>;
  const trainingPrompts = training.map((task) => task.prompt);
  const pastScores: number[] = [];
  const baseline = await protectedManifest(root);

  const archive = (record: ArchiveRecord): Promise<void> =>
    appendFile(archivePath, `${JSON.stringify(record)}\n`, 'utf8');

  // If any protected file changed since the run started, the generation is recorded as
  // tampered, the TaskAgent is rolled back, and the run stops.
  async function checkTamper(
    generation: number,
    before: string,
    proposalSource: string,
    proposalText: string,
  ): Promise<void> {
    const changed = manifestChanges(baseline, await protectedManifest(root));
    if (changed.length === 0) {
      return;
    }
    await writeFile(sourcePath, before, 'utf8');
    await archive({
      generation,
      codeDiff: createDiff(before, proposalSource),
      testPass: false,
      score: null,
      timestamp: new Date().toISOString(),
      proposal: proposalText,
      tamperedPaths: changed,
    });
    throw new Error(
      `Generation ${generation}: protected files changed (${changed.join(', ')}); modification rolled back and run aborted`,
    );
  }

  for (let generation = 1; generation <= generations; generation += 1) {
    const before = await readFile(sourcePath, 'utf8');
    let proposal: Proposal;
    try {
      proposal = await propose(before, trainingPrompts, pastScores);
    } catch (error) {
      await archive({
        generation,
        codeDiff: '--- MetaAgent proposal failed ---',
        testPass: false,
        score: null,
        timestamp: new Date().toISOString(),
        proposal: error instanceof Error ? error.message : String(error),
      });
      log(`Generation ${generation}: MetaAgent failed`);
      await checkTamper(generation, before, before, 'MetaAgent proposal failed');
      continue;
    }

    // Static screen first: rejected code is never written to disk or executed.
    const violations = screenSource(proposal.source);
    if (violations.length > 0) {
      await archive({
        generation,
        codeDiff: createDiff(before, proposal.source),
        testPass: false,
        score: null,
        timestamp: new Date().toISOString(),
        proposal: proposal.proposal,
        rejectedBy: violations,
      });
      log(`Generation ${generation}: rejected by source screen (${violations.join(', ')})`);
      await checkTamper(generation, before, proposal.source, proposal.proposal);
      continue;
    }

    await writeFile(sourcePath, proposal.source, 'utf8');
    const testResult = await runIsolatedTests(timeoutMs, root);
    await checkTamper(generation, before, proposal.source, proposal.proposal);

    if (!testResult.passed) {
      await writeFile(sourcePath, before, 'utf8');
      await archive({
        generation,
        codeDiff: createDiff(before, proposal.source),
        testPass: false,
        score: null,
        timestamp: new Date().toISOString(),
        proposal: proposal.proposal,
        testError: testResult.output.slice(-4000),
      });
      log(`Generation ${generation}: tests failed; modification rolled back`);
      continue;
    }

    const evaluation = await evaluate(timeoutMs, memoryMb, root);
    await checkTamper(generation, before, proposal.source, proposal.proposal);
    pastScores.push(evaluation.score);
    await archive({
      generation,
      codeDiff: createDiff(before, proposal.source),
      testPass: true,
      score: evaluation.score,
      timestamp: new Date().toISOString(),
      proposal: proposal.proposal,
      evaluatorFailures: evaluation.failures,
    });
    log(`Generation ${generation}: tests passed; score ${evaluation.score}/100`);
  }
}
