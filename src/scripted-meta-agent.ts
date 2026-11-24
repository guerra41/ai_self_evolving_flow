import type { MetaResult } from './meta-agent.js';

/**
 * A key-free stand-in for the LLM MetaAgent, used when OPENAI_API_KEY is not set.
 *
 * It is NOT a learning agent. It replays a fixed script of source patches so the whole
 * loop (baseline, selection, source screen, test gate, rollback) can be seen working
 * without network access. It never reads eval/; the script was written by hand against
 * the known weaknesses of the seed TaskAgent, so it says nothing about how well a real
 * MetaAgent would do.
 *
 * Two steps are deliberately bad, to show the guardrails firing:
 *  - step 2 adds a forbidden import  -> rejected by the source screen
 *  - step 4 breaks uppercasing       -> fails the unit tests and is rolled back
 */
interface Step {
  description: string;
  apply: (source: string) => string;
}

function replaceOnce(source: string, from: string, to: string): string {
  return source.includes(from) ? source.replace(from, to) : source;
}

export const SCRIPT: Step[] = [
  {
    description: 'handle all-negative arrays in max_number',
    apply: (source) => replaceOnce(
      source,
      'task.input.reduce((max, value) => (value > max ? value : max), 0)',
      'task.input.length ? Math.max(...task.input) : 0',
    ),
  },
  {
    description: 'read a file from disk (a forbidden idea, to exercise the source screen)',
    apply: (source) => `import { readFileSync } from 'node:fs';\n${source}`,
  },
  {
    description: 'ignore punctuation when checking palindromes',
    apply: (source) => replaceOnce(source, ".replace(/\\s+/g, '')", ".replace(/[^a-z0-9]/g, '')"),
  },
  {
    description: 'switch uppercasing to lowercasing (a mistake, to exercise the test gate)',
    apply: (source) => replaceOnce(source, 'task.input.toUpperCase()', 'task.input.toLowerCase()'),
  },
  {
    description: 'keep digits in slugs',
    apply: (source) => replaceOnce(source, ".replace(/[^a-z]+/g, '-')", ".replace(/[^a-z0-9]+/g, '-')"),
  },
];

/** Returns a proposer that walks the script one step per call; later calls change nothing. */
export function createScriptedProposer(): (currentSource: string) => Promise<MetaResult> {
  let step = 0;
  return async (currentSource) => {
    const current = SCRIPT[step];
    step += 1;
    if (!current) {
      return { source: currentSource, proposal: 'scripted offline MetaAgent (demo): script finished, no change' };
    }
    return {
      source: current.apply(currentSource),
      proposal: `scripted offline MetaAgent (demo), step ${step}: ${current.description}`,
    };
  };
}
