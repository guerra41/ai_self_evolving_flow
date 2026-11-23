import { readFile } from 'node:fs/promises';
import { runInSandbox } from './sandbox.js';

export interface EvaluationResult {
  score: number;
  passed: number;
  total: number;
  failures: string[];
}

export async function evaluate(
  timeoutMs: number,
  memoryMb: number,
): Promise<EvaluationResult> {
  const tasks = JSON.parse(await readFile('eval/tasks.json', 'utf8')) as Array<unknown>;
  const expected = JSON.parse(await readFile('eval/expected.json', 'utf8')) as unknown[];
  let passed = 0;
  const failures: string[] = [];

  for (let index = 0; index < tasks.length; index += 1) {
    const result = await runInSandbox(tasks[index], timeoutMs, memoryMb);
    if (result.success && Object.is(result.output, expected[index])) {
      passed += 1;
    } else {
      failures.push(`task ${index + 1}: ${result.error ?? 'incorrect result'}`);
    }
  }

  return {
    score: Math.round((passed / tasks.length) * 100),
    passed,
    total: tasks.length,
    failures,
  };
}
