import 'dotenv/config';
import { evolve } from './evolve.js';
import { generateProposal } from './meta-agent.js';

evolve({
  root: process.cwd(),
  generations: Number(process.env.EVOLUTION_GENERATIONS ?? 5),
  timeoutMs: Number(process.env.SANDBOX_TIMEOUT_MS ?? 30_000),
  memoryMb: Number(process.env.SANDBOX_MEMORY_MB ?? 256),
  propose: generateProposal,
}).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
