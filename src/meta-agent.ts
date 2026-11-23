import { readFile } from 'node:fs/promises';

export interface MetaResult {
  source: string;
  proposal: string;
}

export async function generateProposal(
  currentSource: string,
  trainingPrompts: string[],
  pastScores: number[],
): Promise<MetaResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return deterministicProposal(currentSource, pastScores);
  }

  const response = await fetch(`${process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You improve src/task-agent/TaskAgent.ts only. Return exactly one fenced typescript code block containing the complete file. Do not mention evaluation data or tests. Preserve the exported Task type and solveTask function.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            trainingPrompts,
            pastScores,
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
    throw new Error('MetaAgent response did not contain a TypeScript code block');
  }

  return { source: match[1], proposal: 'OpenAI-compatible MetaAgent proposed a source rewrite' };
}

async function deterministicProposal(
  currentSource: string,
  pastScores: number[],
): Promise<MetaResult> {
  const source = await readFile('src/task-agent/TaskAgent.ts', 'utf8');
  if (currentSource !== source) {
    throw new Error('Unexpected source snapshot mismatch');
  }

  const proposals = [
    'MetaAgent retained the implementation and recorded a no-op generation',
    'MetaAgent requested a normalization hardening pass',
  ];
  const score = pastScores.at(-1) ?? 0;
  return {
    source,
    proposal: proposals[score >= 100 ? 0 : 1],
  };
}
