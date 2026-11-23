import 'dotenv/config';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { evaluate } from './evaluator.js';
import { generateProposal } from './meta-agent.js';

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
}

async function runTests(): Promise<{ passed: boolean; output: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn('pnpm', ['test'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let output = '';
    child.stdout.on('data', (chunk: string) => (output += chunk));
    child.stderr.on('data', (chunk: string) => (output += chunk));
    child.on('close', (code) => resolvePromise({
      passed: code === 0,
      output,
    }));
  });
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

    await writeFile(sourcePath, proposal.source, 'utf8');
    const testResult = await runTests();

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
