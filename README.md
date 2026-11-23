# AI Self-Evolving Flow

A minimal command-line experiment for studying self-evolving software. A `MetaAgent` proposes rewrites of `TaskAgent`; after unit tests pass, frozen evaluation tasks score the result.

## Requirements

- Node.js 18+
- pnpm
- Optional: Docker or an OpenAI-compatible API

## Setup

```powers
corepack enable
pnpm install
Copy-Item .env.example .env
```

Set `OPENAI_API_KEY` in `.env` to enable LLM proposals. Without a key, the CLI runs deterministic no-op generations.

## Commands

```powers
pnpm test
pnpm evolve
```

`pnpm evolve` runs five generations by default. Override this with `EVOLUTION_GENERATIONS=3 pnpm evolve`.

## Generated archive

Each attempt is appended to `outputs/archive.jsonl` as one JSON object containing:

- `generation`
- `codeDiff`
- `testPass`
- `score`
- `timestamp`
- `proposal`

Failed test attempts are rolled back and receive no scoring phase.

## Guardrails

- TDD tests are hand-authored in `tests/task-agent.test.ts`.
- MetaAgent can receive only training prompts, current source, and past scores.
- `eval/tasks.json` and `eval/expected.json` remain outside the MetaAgent input.
- MetaAgent is limited to writing `src/task-agent/TaskAgent.ts`.
- Every proposal is written temporarily, then `pnpm test` runs. A failed test rolls it back.
- Evaluation executes the bundled TaskAgent in a separate child process with timeout and memory limits. This is the minimum sandbox isolation. A Docker runner can be added for stronger OS/container isolation.

## Configuration

The `.env` file supports:

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `EVOLUTION_GENERATIONS`
- `SANDBOX_TIMEOUT_MS`
- `SANDBOX_MEMORY_MB`

## Adding a task domain

1. Add hand-crafted unit cases to `tests/task-agent.test.ts`.
2. Add visible prompts to `training/tasks.json`.
3. Extend the `Task` union and `solveTask` switch in `src/task-agent/TaskAgent.ts`.
4. Add frozen scoring inputs to `eval/tasks.json` and expected values to `eval/expected.json`.
5. Run `pnpm test`.
