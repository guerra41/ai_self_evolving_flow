import type { AttemptSummary } from './evolve.js';

export interface ProposalResult {
  source: string;
  proposal: string;
}

export const SYSTEM_PROMPT =
  'You improve src/task-agent/TaskAgent.ts only. Return exactly one fenced typescript code block containing the complete file. ' +
  'Do not mention evaluation data or tests. Preserve the exported Task type and solveTask function. ' +
  'pastScores are scores out of 100 on hidden checks; your goal is to raise the score. ' +
  'previousAttempts lists your earlier tries in this run: outcome, the score it got, the kind of change ' +
  '(none, formatting_only or code), the diff, and how many times that exact change was tried. ' +
  'Never repeat a change that did not raise the score. Changes that only touch whitespace, formatting or comments ' +
  'cannot raise it. Instead, find real mistakes in the logic and fix the behavior.';

export async function generateProposal(
  currentSource: string,
  trainingPrompts: string[],
  pastScores: number[],
  previousAttempts: AttemptSummary[] = [],
): Promise<ProposalResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL;
  // A hosted API needs a key. A local server (Ollama, LM Studio, llama.cpp) sets
  // OPENAI_BASE_URL and needs no key, so no Authorization header is sent.
  if (!apiKey && !baseUrl) {
    throw new Error(
      'Neither OPENAI_API_KEY nor OPENAI_BASE_URL is set; use the scripted offline proposer instead',
    );
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  // Local models can take minutes per reply on a CPU, so the limit is configurable.
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 600_000);

  const response = await fetch(`${baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: JSON.stringify({
            trainingPrompts,
            pastScores,
            previousAttempts,
            currentSource,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI-compatible API returned ${response.status}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content ?? '';
  const match = content.match(/```(?:typescript|ts)?\s*\n([\s\S]*?)\n```/i);
  if (!match) {
    throw new Error('The proposer response did not contain a TypeScript code block');
  }

  return { source: match[1], proposal: 'OpenAI-compatible proposer proposed a source rewrite' };
}
