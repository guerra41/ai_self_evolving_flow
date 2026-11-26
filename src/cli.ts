import 'dotenv/config';
import { evolve } from './evolve.js';
import { generateProposal } from './proposer.js';
import { createScriptedProposer } from './scripted-proposer.js';

const usingLlm = Boolean(process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL);
console.log(
  usingLlm
    ? `Proposer: LLM through an OpenAI-compatible API (${process.env.OPENAI_BASE_URL ?? 'api.openai.com'}, model ${process.env.OPENAI_MODEL ?? 'gpt-4o-mini'})`
    : 'Proposer: scripted offline demo (set OPENAI_BASE_URL for a local model, or OPENAI_API_KEY for a hosted one, in .env)',
);

evolve({
  root: process.cwd(),
  generations: Number(process.env.EVOLUTION_GENERATIONS ?? 5),
  timeoutMs: Number(process.env.SANDBOX_TIMEOUT_MS ?? 30_000),
  memoryMb: Number(process.env.SANDBOX_MEMORY_MB ?? 256),
  propose: usingLlm ? generateProposal : createScriptedProposer(),
}).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
