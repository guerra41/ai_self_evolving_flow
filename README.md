# AI Self-Evolving Flow

A minimal command-line experiment for studying self-evolving software. A `MetaAgent` proposes rewrites of `TaskAgent`; after unit tests pass, frozen evaluation tasks score the result.

## Requirements

- Node.js 22.3+ (the sandbox uses Node's permission model)
- pnpm
- Optional: Docker or an OpenAI-compatible API

## Setup

```powershell
corepack enable
pnpm install
Copy-Item .env.example .env
```

Set `OPENAI_API_KEY` in `.env` to enable LLM proposals. Without a key, the CLI runs deterministic no-op generations.

## Commands

```powershell
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
- plus, when relevant: `testError`, `evaluatorFailures`, `rejectedBy` (source screen), `tamperedPaths`

Failed test attempts are rolled back and receive no scoring phase.

## Guardrails

- TDD tests are hand-authored in `tests/task-agent.test.ts`.
- MetaAgent can receive only training prompts, current source, and past scores.
- `eval/tasks.json` and `eval/expected.json` remain outside the MetaAgent input.
- MetaAgent is limited to writing `src/task-agent/TaskAgent.ts`.
- A proposal is first screened statically (`screenSource` in `src/guard.ts`: no imports, `process`, `eval`, network). Rejected code is never written or executed.
- Accepted proposals are written temporarily and the TaskAgent tests (the `vitest run` behind `pnpm test`) run against a throw-away copy of the project with an allowlisted environment, a timeout and capped output, so generated code never runs in the real working tree. A failed test rolls the change back.
- Scoring runs the bundled TaskAgent in a child process with an empty temp working directory, no API keys in its environment, Node's permission model (no writes, no child processes, reads limited to the temp dir), a SIGKILL timeout, a heap limit and capped output.
- After each generation the SHA-256 of `tests/`, `eval/`, `training/`, the harness files in `src/` and the project config is compared with the start of the run. Any change rolls back the TaskAgent, records the generation with `tamperedPaths`, and aborts the run.
- Known limit: Node's permission model does not restrict network access. Run under Docker with `--network none` for full isolation.

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
