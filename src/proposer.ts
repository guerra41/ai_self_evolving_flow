export interface ProposalResult {
  source: string;
  proposal: string;
}

export async function generateProposal(
  currentSource: string,
  trainingPrompts: string[],
  pastScores: number[],
): Promise<ProposalResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set; use the scripted offline proposer instead');
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
    throw new Error('The proposer response did not contain a TypeScript code block');
  }

  return { source: match[1], proposal: 'OpenAI-compatible proposer proposed a source rewrite' };
}
