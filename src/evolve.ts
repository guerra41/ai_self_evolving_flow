import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unifiedDiff } from './diff.js';
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
  /** Identifies this run in the shared archive. Generated when omitted. */
  runId?: string;
  log?: (message: string) => void;
}

/**
 * One line of outputs/archive.jsonl. Generation 0 is the baseline: the TaskAgent as it
 * was when the run started, tested and scored before any MetaAgent change.
 */
export interface ArchiveRecord {
  runId: string;
  generation: number;
  codeDiff: string;
  testPass: boolean;
  score: number | null;
  /** True when the TaskAgent source after this generation is the one that was kept. */
  accepted: boolean;
  /** Best accepted score so far, after this generation. */
  bestScore: number | null;
  timestamp: string;
  proposal: string;
  testError?: string;
  evaluatorFailures?: string[];
  tamperedPaths?: string[];
  rejectedBy?: string[];
  rollbackReason?: string;
}

export function newRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `${stamp}-${randomBytes(2).toString('hex')}`;
}

/**
 * The evolution loop. Everything is relative to `root` so it can run against a fixture
 * project in tests.
 *
 * Selection: a generation is kept only if it passes the tests AND its score is not lower
 * than the best accepted score so far (the baseline counts). Otherwise the previous best
 * source is restored. Throws (after rolling the TaskAgent back and archiving the
 * generation) when a protected file changed during a generation.
 */
export async function evolve(options: EvolveOptions): Promise<void> {
  const { root, generations, timeoutMs, memoryMb, propose } = options;
  const runId = options.runId ?? newRunId();
  const log = options.log ?? console.log;
  const sourcePath = join(root, 'src', 'task-agent', 'TaskAgent.ts');
  const archivePath = join(root, 'outputs', 'archive.jsonl');

  await mkdir(join(root, 'outputs'), { recursive: true });
  const training = JSON.parse(await readFile(join(root, 'training', 'tasks.json'), 'utf8')) as
    Array<{ prompt: string }>;
  const trainingPrompts = training.map((task) => task.prompt);
  const baseline = await protectedManifest(root);

  const archive = (record: Omit<ArchiveRecord, 'runId' | 'timestamp'>): Promise<void> =>
    appendFile(
      archivePath,
      `${JSON.stringify({ runId, ...record, timestamp: new Date().toISOString() })}\n`,
      'utf8',
    );

  // If any protected file changed since the run started, the generation is recorded as
  // tampered, the TaskAgent is rolled back, and the run stops.
  async function checkTamper(
    generation: number,
    bestSource: string,
    attemptedSource: string,
    proposalText: string,
    bestScore: number | null,
  ): Promise<void> {
    const changed = manifestChanges(baseline, await protectedManifest(root));
    if (changed.length === 0) {
      return;
    }
    await writeFile(sourcePath, bestSource, 'utf8');
    await archive({
      generation,
      codeDiff: unifiedDiff(bestSource, attemptedSource),
      testPass: false,
      score: null,
      accepted: false,
      bestScore,
      proposal: proposalText,
      tamperedPaths: changed,
    });
    throw new Error(
      `Generation ${generation}: protected files changed (${changed.join(', ')}); modification rolled back and run aborted`,
    );
  }

  // Generation 0: the starting TaskAgent must pass its own tests, and its score is the
  // bar every later generation has to meet.
  const startSource = await readFile(sourcePath, 'utf8');
  const baselineTests = await runIsolatedTests(timeoutMs, root);
  await checkTamper(0, startSource, startSource, 'baseline', null);
  if (!baselineTests.passed) {
    throw new Error(`The starting TaskAgent fails its own tests:\n${baselineTests.output}`);
  }
  const baselineEvaluation = await evaluate(timeoutMs, memoryMb, root);
  await checkTamper(0, startSource, startSource, 'baseline', baselineEvaluation.score);

  let bestScore = baselineEvaluation.score;
  const pastScores: number[] = [bestScore];
  await archive({
    generation: 0,
    codeDiff: '--- baseline: starting TaskAgent ---',
    testPass: true,
    score: bestScore,
    accepted: true,
    bestScore,
    proposal: 'baseline',
    evaluatorFailures: baselineEvaluation.failures,
  });
  log(`Baseline: score ${bestScore}/100`);

  for (let generation = 1; generation <= generations; generation += 1) {
    const bestSource = await readFile(sourcePath, 'utf8');
    let proposal: Proposal;
    try {
      proposal = await propose(bestSource, trainingPrompts, pastScores);
    } catch (error) {
      await archive({
        generation,
        codeDiff: '--- MetaAgent proposal failed ---',
        testPass: false,
        score: null,
        accepted: false,
        bestScore,
        proposal: error instanceof Error ? error.message : String(error),
      });
      log(`Generation ${generation}: MetaAgent failed`);
      await checkTamper(generation, bestSource, bestSource, 'MetaAgent proposal failed', bestScore);
      continue;
    }

    // Static screen first: rejected code is never written to disk or executed.
    const violations = screenSource(proposal.source);
    if (violations.length > 0) {
      await archive({
        generation,
        codeDiff: unifiedDiff(bestSource, proposal.source),
        testPass: false,
        score: null,
        accepted: false,
        bestScore,
        proposal: proposal.proposal,
        rejectedBy: violations,
      });
      log(`Generation ${generation}: rejected by source screen (${violations.join(', ')})`);
      await checkTamper(generation, bestSource, proposal.source, proposal.proposal, bestScore);
      continue;
    }

    await writeFile(sourcePath, proposal.source, 'utf8');
    const testResult = await runIsolatedTests(timeoutMs, root);
    await checkTamper(generation, bestSource, proposal.source, proposal.proposal, bestScore);

    if (!testResult.passed) {
      await writeFile(sourcePath, bestSource, 'utf8');
      await archive({
        generation,
        codeDiff: unifiedDiff(bestSource, proposal.source),
        testPass: false,
        score: null,
        accepted: false,
        bestScore,
        proposal: proposal.proposal,
        testError: testResult.output.slice(-4000),
      });
      log(`Generation ${generation}: tests failed; modification rolled back`);
      continue;
    }

    const evaluation = await evaluate(timeoutMs, memoryMb, root);
    await checkTamper(generation, bestSource, proposal.source, proposal.proposal, bestScore);
    pastScores.push(evaluation.score);

    if (evaluation.score < bestScore) {
      await writeFile(sourcePath, bestSource, 'utf8');
      await archive({
        generation,
        codeDiff: unifiedDiff(bestSource, proposal.source),
        testPass: true,
        score: evaluation.score,
        accepted: false,
        bestScore,
        proposal: proposal.proposal,
        evaluatorFailures: evaluation.failures,
        rollbackReason: `score ${evaluation.score} is below the best score ${bestScore}`,
      });
      log(`Generation ${generation}: score ${evaluation.score}/100 is below ${bestScore}; rolled back`);
      continue;
    }

    bestScore = evaluation.score;
    await archive({
      generation,
      codeDiff: unifiedDiff(bestSource, proposal.source),
      testPass: true,
      score: evaluation.score,
      accepted: true,
      bestScore,
      proposal: proposal.proposal,
      evaluatorFailures: evaluation.failures,
    });
    log(`Generation ${generation}: tests passed; score ${evaluation.score}/100; kept`);
  }
}
