# AI Self-Evolving Flow

A minimal command-line experiment for studying self-evolving software. A `Proposer` (a thin wrapper that asks an LLM for a new version of the code; called the "MetaAgent" in the original brief) proposes rewrites of `TaskAgent`; after unit tests pass, frozen evaluation tasks score the result.

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

To enable LLM proposals, pick one in `.env`:

- **Local model with Ollama (free, nothing leaves your machine, no key):** install Ollama, run `ollama pull qwen2.5-coder:14b` (use `qwen2.5-coder:7b` or `3b` if your GPU has little VRAM), then set `OPENAI_BASE_URL=http://localhost:11434/v1` and `OPENAI_MODEL=qwen2.5-coder:14b`. Local models can take minutes per reply; `LLM_TIMEOUT_MS` (default 10 minutes) controls how long to wait.
- **Hosted API (paid):** set `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`).

With neither a base URL nor a key, the CLI runs a **scripted offline proposer** (`src/scripted-proposer.ts`): a fixed list of five source patches that lets you watch the whole loop work with no network. It is a demo, not a learning agent: the script was written by hand against the seed's known weaknesses and never reads `eval/`. Two steps are deliberately bad so the guardrails fire (a forbidden import is rejected by the source screen; a change that breaks uppercasing fails the unit tests and is rolled back).

Expected keyless output from a fresh checkout: baseline 63, then 75, rejected, 88, rolled back, 100.

`pnpm evolve` edits `src/task-agent/TaskAgent.ts` in place and keeps accepted changes. To run the demo again from the seed, reset it: `git checkout -- src/task-agent/TaskAgent.ts`.

## Commands

```powershell
pnpm test
pnpm evolve
```

`pnpm evolve` runs five generations by default. Override this with `EVOLUTION_GENERATIONS=3 pnpm evolve`.

## Generated archive

Each attempt is appended to `outputs/archive.jsonl` as one JSON object. The file is shared by all runs; `runId` tells them apart. Generation `0` is the baseline: the starting TaskAgent, tested and scored before any change. Fields:

- `runId`
- `generation`
- `codeDiff` (a unified diff; line-ending differences are ignored)
- `testPass`
- `score`
- `accepted` (whether the source after this generation is the one that was kept)
- `bestScore` (best kept score so far)
- `timestamp`
- `proposal`
- plus, when relevant: `testError`, `evaluatorFailures`, `rejectedBy` (source screen), `tamperedPaths`, `rollbackReason`

Failed test attempts are rolled back and receive no scoring phase.

## Selection

A generation is kept only if it passes the tests and its score is strictly higher than the best kept score so far (the baseline counts). A lower score or a tie restores the previous source and is recorded with `accepted: false` and a `rollbackReason`, so whitespace-only or no-op rewrites are never counted as progress. If the starting TaskAgent fails its own tests, the run refuses to start.

## The starting TaskAgent

The seed is deliberately imperfect so there is something to improve. It passes every unit test but scores 63/100 on the frozen evaluation set: `max_number` ignores negative arrays, `palindrome` does not strip punctuation, and `slugify` drops digits. The proposer is never told this; it sees only the training prompts and past scores.

## Guardrails

- TDD tests are hand-authored in `tests/task-agent.test.ts`.
- Proposer can receive only training prompts, current source, and past scores.
- `eval/tasks.json` and `eval/expected.json` remain outside the proposer input.
- Proposer is limited to writing `src/task-agent/TaskAgent.ts`.
- A proposal is first screened statically (`screenSource` in `src/guard.ts`: no imports, `process`, `eval`, network). Rejected code is never written or executed.
- Accepted proposals are written temporarily and the TaskAgent tests (the `vitest run` behind `pnpm test`) run against a throw-away copy of the project with an allowlisted environment, a timeout and capped output, so generated code never runs in the real working tree. A failed test rolls the change back.
- Scoring runs the bundled TaskAgent in a child process with an empty temp working directory, no API keys in its environment, Node's permission model (no writes, no child processes, reads limited to the temp dir), a SIGKILL timeout, a heap limit and capped output.
- After each generation the SHA-256 of `tests/`, `eval/`, `training/`, the harness files in `src/` and the project config is compared with the start of the run. Any change rolls back the TaskAgent, records the generation with `tamperedPaths`, and aborts the run.
- Known limit: Node's permission model does not restrict network access. Run under Docker with `--network none` for full isolation.

## Configuration

The `.env` file supports:

- `OPENAI_API_KEY` (hosted APIs only; not needed for a local server)
- `OPENAI_BASE_URL` (set it to use a local server such as Ollama)
- `OPENAI_MODEL`
- `LLM_TIMEOUT_MS`
- `EVOLUTION_GENERATIONS`
- `SANDBOX_TIMEOUT_MS`
- `SANDBOX_MEMORY_MB`

## Adding a task domain

1. Add hand-crafted unit cases to `tests/task-agent.test.ts`.
2. Add visible prompts to `training/tasks.json`.
3. Extend the `Task` union and `solveTask` switch in `src/task-agent/TaskAgent.ts`.
4. Add frozen scoring inputs to `eval/tasks.json` and expected values to `eval/expected.json`.
5. Run `pnpm test`.
