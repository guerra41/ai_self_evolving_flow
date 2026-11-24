import 'dotenv/config';
import { evolve } from './evolve.js';
import { generateProposal } from './proposer.js';
import { createScriptedProposer } from './scripted-proposer.js';

const usingLlm = Boolean(process.env.OPENAI_API_KEY);
console.log(
  usingLlm
    ? 'Proposer: LLM through an OpenAI-compatible API'
    : 'Proposer: scripted offline demo (set OPENAI_API_KEY in .env to use an LLM)',
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
