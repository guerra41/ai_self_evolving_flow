import 'dotenv/config';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { evaluate } from './evaluator.js';
import { generateProposal } from './meta-agent.js';
import { manifestChanges, protectedManifest, screenSource } from './guard.js';
import { runIsolatedTests } from './test-runner.js';

const sourcePath = 'src/task-agent/TaskAgent.ts';
const archivePath = 'outputs/archive.jsonl';
const generations = Number(process.env.EVOLUTION_GENERATIONS ?? 5);
const timeoutMs = Number(process.env.SANDBOX_TIMEOUT_MS ?? 30_000);
const memoryMb = Number(process.env.SANDBOX_MEMORY_MB ?? 256);

interface ArchiveRecord {
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

function createDiff(before: string, after: string): string {
  if (before === after) {
    return '--- no source change ---';
  }
  return `--- before\n${before}\n+++ after\n${after}`;
}

async function main(): Promise<void> {
  await mkdir('outputs', { recursive: true });
  const training = JSON.parse(await readFile('training/tasks.json', 'utf8')) as
    Array<{ prompt: string }>;
  const trainingPrompts = training.map((task) => task.prompt);
  const pastScores: number[] = [];
  const baseline = await protectedManifest();

  // Returns the protected files that changed since the run started. If any did, the
  // generation is recorded as tampered, the TaskAgent is rolled back, and the run stops.
  async function checkTamper(
    generation: number,
    before: string,
    proposalSource: string,
    proposalText: string,
  ): Promise<void> {
    const changed = manifestChanges(baseline, await protectedManifest());
    if (changed.length === 0) {
      return;
    }
    await writeFile(sourcePath, before, 'utf8');
    const record: ArchiveRecord = {
      generation,
      codeDiff: createDiff(before, proposalSource),
      testPass: false,
      score: null,
      timestamp: new Date().toISOString(),
      proposal: proposalText,
      tamperedPaths: changed,
    };
    await appendFile(archivePath, `${JSON.stringify(record)}
`, 'utf8');
    throw new Error(
      `Generation ${generation}: protected files changed (${changed.join(', ')}); modification rolled back and run aborted`,
    );
  }

  for (let generation = 1; generation <= generations; generation += 1) {
    const before = await readFile(sourcePath, 'utf8');
    let proposal;
    try {
      proposal = await generateProposal(before, trainingPrompts, pastScores);
    } catch (error) {
      const record: ArchiveRecord = {
        generation,
        codeDiff: '--- MetaAgent proposal failed ---',
        testPass: false,
        score: null,
        timestamp: new Date().toISOString(),
        proposal: error instanceof Error ? error.message : String(error),
      };
      await appendFile(archivePath, `${JSON.stringify(record)}\n`, 'utf8');
      console.error(`Generation ${generation}: MetaAgent failed`);
      continue;
    }

    // Static screen first: rejected code is never written to disk or executed.
    const violations = screenSource(proposal.source);
    if (violations.length > 0) {
      const record: ArchiveRecord = {
        generation,
        codeDiff: createDiff(before, proposal.source),
        testPass: false,
        score: null,
        timestamp: new Date().toISOString(),
        proposal: proposal.proposal,
        rejectedBy: violations,
      };
      await appendFile(archivePath, `${JSON.stringify(record)}
`, 'utf8');
      console.log(`Generation ${generation}: rejected by source screen (${violations.join(', ')})`);
      continue;
    }

    await writeFile(sourcePath, proposal.source, 'utf8');
    const testResult = await runIsolatedTests(timeoutMs);
    await checkTamper(generation, before, proposal.source, proposal.proposal);

    if (!testResult.passed) {
      await writeFile(sourcePath, before, 'utf8');
      const record: ArchiveRecord = {
        generation,
        codeDiff: createDiff(before, proposal.source),
        testPass: false,
        score: null,
        timestamp: new Date().toISOString(),
        proposal: proposal.proposal,
        testError: testResult.output.slice(-4000),
      };
      await appendFile(archivePath, `${JSON.stringify(record)}\n`, 'utf8');
      console.log(`Generation ${generation}: tests failed; modification rolled back`);
      continue;
    }

    const evaluation = await evaluate(timeoutMs, memoryMb);
    await checkTamper(generation, before, proposal.source, proposal.proposal);
    pastScores.push(evaluation.score);
    const record: ArchiveRecord = {
      generation,
      codeDiff: createDiff(before, proposal.source),
      testPass: true,
      score: evaluation.score,
      timestamp: new Date().toISOString(),
      proposal: proposal.proposal,
      evaluatorFailures: evaluation.failures,
    };
    await appendFile(archivePath, `${JSON.stringify(record)}\n`, 'utf8');
    console.log(
      `Generation ${generation}: tests passed; score ${evaluation.score}/100`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
