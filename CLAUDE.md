# ai_self_evolving_flow — Project Instructions

## What this project is

A command-line experiment that demonstrates and studies **self-evolving software**, modeled on the HyperAgents architecture (TypeScript). A **MetaAgent** reads evaluation scores and rewrites the **TaskAgent's** source code; the TaskAgent is then re-evaluated. `pnpm evolve` runs the loop (default 5 generations, minimum 3) and records every generation in `outputs/archive.jsonl`.

Stack: Node.js + TypeScript, vitest, an OpenAI-compatible LLM API configured via `.env`, Docker for sandboxing. **No web frontend. No database** (the file system is enough).

Commands: `pnpm evolve` (run the evolution loop), `pnpm test` (unit tests).

## Guardrails (hard rules, never relax them)

These exist so the experiment stays trustworthy. Any agent working in this repo must follow them, including when it would make a generation pass or the loop run faster.

1. **TDD gate**
   - TaskAgent unit tests are hand-written and live in `tests/task-agent.test.ts`.
   - The MetaAgent may modify **only** files under `src/task-agent/`. It must never modify `tests/`, the evaluation harness, or the evaluator (`src/evaluator.ts`).
   - After every MetaAgent modification the system runs `pnpm test`. If tests fail, the change is rolled back and recorded as a failed generation. Only changes that pass tests reach the scoring phase.
2. **Sandboxed execution**
   - LLM-generated code runs in a Docker container (at minimum a separate child process) with a timeout (default 30 s) and a memory limit.
   - Never execute LLM-generated code in the host process.
3. **Frozen evaluation set**
   - `eval/tasks.json` (and `eval/expected.json`) are used only for scoring and are never shown to the MetaAgent.
   - The MetaAgent sees only the training task prompts (`training/tasks.json`) and past scores.
4. **Archival record**
   - Every generation appends one JSON object per line to `outputs/archive.jsonl`: generation number, code diff, test pass/fail, score, timestamp.

## Rules for agents working on the repo

- Do not edit `tests/`, `eval/`, or the evaluator to make a result look better. If a test or evaluation seems wrong, stop and tell the user.
- Do not leak evaluation content into prompts, logs read by the MetaAgent, or the archive's MetaAgent-visible fields.
- Do not add a web UI or a database.
- Keep guardrail settings (timeouts, memory limit, generation count) configurable and documented in `README.md`, which also explains how to run the project and how to add new task domains.
- Changes to the guardrails themselves need an explicit request from the user.
