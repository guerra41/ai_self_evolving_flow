# Agent handoff report — session of 2026-11-23

Written for: a reviewing agent that will give feedback on what the previous agent (Claude Code) understood, did, and found. The reviewer has no access to the conversation, so this file is self-contained. Where the previous agent made mistakes, they are stated plainly.

Two repositories were involved:

- `d:\code\github\startupbay` (GitHub `guerra41/startupbay`): an existing Laravel + React SaaS ("StartupBay"). Unrelated to the experiment.
- `d:\code\github\ai_self_evolving_flow`: a small CLI experiment on self-evolving software. This is the project the feedback is most likely about.

## 1. What the user asked, in order, and how it was understood

| # | Request | What was done |
|---|---|---|
| 1 | Create a cross-compatible (Claude Code + GitHub Copilot) agent skill, `req-html-review`, that compiles requirement Markdown into an interactive single-file HTML review (acceptance-criteria progress counter, status badge, localStorage persistence, "Copy Validation Summary", `[!QUESTION]`/`[!EDGE-CASE]`/`[!RISK]` callouts, print rules). Wire it into repo instructions, ignore `.tmp/`, verify with a sample. | Done in `startupbay`. See section 3. |
| 2 | Commit on a new feature branch; push and open a PR into `develop`; test the HTML in a browser; tick the PR test plan; test the print layout by exporting to PDF; merge the PR. | All done. Branch rebased onto `origin/develop` before pushing so the PR contained only the skill. A print-layout bug (empty notes placeholder printed) was found and fixed. PR #3 merged into `develop`. |
| 3 | "Include as a core value of this project that it is meant to validate locally the self-evolving capabilities of multiple agents working together; there are no plans to put it live." | **Misunderstood.** The agent applied this to `startupbay` (the working directory) without asking which repo was meant. It edited `CLAUDE.md`, `.github/copilot-instructions.md` and saved a memory. |
| 4 | "That was only meant for ai_self_evolving_flow; roll back." | Rolled back the two edited files with `git checkout` and deleted the memory. The merged PR was not touched. |
| 5 | "Add it to ai_self_evolving_flow's `CLAUDE.md`" and "I want a memory for it." | Created that repo's `CLAUDE.md` (it did not exist) and a memory entry. |
| 6 | User pasted the real project prompt (a MetaAgent/TaskAgent CLI) and asked the agent to understand the goal. | The agent conceded the earlier wording ("multiple agents working together, no live deploy") did not match the real goal. |
| 7 | "Rewrite it. Skip the no-plans-to-go-live rule." | `CLAUDE.md` and memory rewritten around the actual project goal and guardrails. |
| 8 | "Audit the existing code against the guardrails." | Read-only audit; findings in section 5. Nothing was changed. |
| 9 | "Create an md file with your understanding, a report of files created, and the project file structure." | This file. |

Open decision from the user: whether to fix the audit findings. The agent proposed doing fixes 1 and 2 first (isolation and tamper detection); the user has not answered.

## 2. The project goal (as understood from the pasted prompt)

`ai_self_evolving_flow` is a command-line experiment to demonstrate and study self-evolving software, modeled on HyperAgents (TypeScript). A **MetaAgent** reads evaluation scores and rewrites the **TaskAgent's** source; the TaskAgent is then re-evaluated. `pnpm evolve` runs at least 3 generations (default 5) and records each in `outputs/archive.jsonl`. Stack: Node.js, TypeScript, vitest, an OpenAI-compatible API via `.env`, Docker for sandboxing. No web UI, no database.

Guardrails stated by the user:

1. **TDD gate.** Hand-written tests in `tests/task-agent.test.ts`. The MetaAgent may modify only `src/task-agent/`, never tests, harness or evaluator. After each modification `pnpm test` runs; failure means rollback and a recorded failed generation; only passing changes reach scoring.
2. **Sandbox.** MetaAgent-generated code runs in Docker (at minimum a separate child process) with timeout (about 30 s) and memory limits, never in the host process.
3. **Frozen evaluation set.** `eval/tasks.json` is invisible to the MetaAgent, which sees only training prompts and past scores.
4. **Archive.** JSONL, one object per generation: generation number, code diff, test pass/fail, score, timestamp.

Deliverables: `pnpm evolve`, `pnpm test`, `outputs/archive.jsonl`, and a `README.md` (how to run, add task domains, adjust guardrails).

## 3. Files created or changed by the agent

### In `startupbay` (committed; PR #3 merged into `develop` as `b1c2a7f`, commits `efd17b8`, `fee38de`)

| File | Change |
|---|---|
| `.agents/skills/req-html-review/SKILL.md` | New. Skill frontmatter plus a 4-step workflow: analyze and structure, save source to `docs/requirements/<slug>.md`, compile with the script, present the HTML path and the top 3 blocking questions. |
| `.agents/skills/req-html-review/scripts/render_req.py` | New. Standard-library Python Markdown to HTML renderer (headings, tables, fenced code, bold/italic, nested lists, task lists, callouts). |
| `.agents/skills/req-html-review/assets/template.html` | New. Self-contained HTML/CSS/JS template: sticky bar, status badge, progress counter, localStorage persistence, copy-summary button, print rules. Later patched so the empty notes placeholder is hidden in print. |
| `.github/copilot-instructions.md` | New. One rule telling agents to invoke the skill. |
| `CLAUDE.md` | Appended the same rule. |
| `.gitignore` | Added `.tmp/`. |

Verification performed: rendered samples with the script; opened in Chrome and checked counter/badge, persistence across reload, and copy output (clipboard call stubbed); exported a PDF with headless Chrome and inspected page 1 of a one-page document. Not tested: long documents with tables/code blocks splitting across pages.

### In `ai_self_evolving_flow` (uncommitted; the repo has no commits yet)

| File | Change |
|---|---|
| `CLAUDE.md` | New. Project description, commands, the four guardrails as hard rules, and rules for agents (do not edit tests/eval/evaluator to improve results; do not leak eval content; no web UI or database; guardrail changes need an explicit user request). |
| `docs/agent-handoff-report.md` | New. This file. |

All other files in that repo (`src/`, `tests/`, `eval/`, `training/`, `README.md`, `package.json`, etc.) **existed before** and were **not** written by the agent. The user later confirmed they were created by a different agent, GitHub Copilot.

### Memory files (outside both repos, under `C:\Users\Roberto\.claude\projects\`)

- `d--code-github-ai-self-evolving-flow\memory\project_self_evolving_flow_goal.md` and `MEMORY.md`: created.
- The startupbay memory folder was changed and then restored (a wrong-scope memory was added, then deleted along with its index line).

### Reverted / mistaken work

The "local lab, no plans to go live" core value was wrongly written into `startupbay` `CLAUDE.md` and `.github/copilot-instructions.md`. It was never committed and was rolled back. No trace remains in git.

## 4. Project file structure

### `ai_self_evolving_flow` (excluding `node_modules/`)

```
ai_self_evolving_flow/
├── CLAUDE.md                  # created by the agent
├── README.md                  # pre-existing (Copilot); reviewed afterwards, see section 5
├── .env.example               # OPENAI_* settings, EVOLUTION_GENERATIONS, SANDBOX_TIMEOUT_MS, SANDBOX_MEMORY_MB
├── .gitignore                 # node_modules/, dist/, outputs/, .env
├── package.json               # scripts: evolve (tsx src/cli.ts), test (vitest run)
├── pnpm-lock.yaml
├── tsconfig.json
├── docs/
│   └── agent-handoff-report.md   # this file
├── src/
│   ├── cli.ts                 # evolution loop: proposal, write, pnpm test, rollback or evaluate, archive
│   ├── meta-agent.ts          # LLM call, or deterministic no-op fallback without an API key
│   ├── sandbox.ts             # esbuild bundle + child-process runner (timeout, heap limit)
│   ├── evaluator.ts           # scores TaskAgent on eval/ via the sandbox
│   └── task-agent/
│       ├── TaskAgent.ts       # the code the MetaAgent rewrites (8 task kinds)
│       └── index.ts
├── tests/
│   └── task-agent.test.ts     # 8 happy-path unit tests
├── eval/                      # frozen evaluation set
│   ├── tasks.json
│   └── expected.json
├── training/
│   └── tasks.json             # prompts only; the MetaAgent may see these
└── outputs/
    └── archive.jsonl          # evolution record (gitignored)
```

### `startupbay` (parts relevant to this work)

```
startupbay/
├── CLAUDE.md                          # project rules (language policy, i18n); req-html-review rule appended
├── .gitignore                         # .tmp/ added
├── .agents/skills/
│   ├── grill-with-docs/               # pre-existing
│   └── req-html-review/               # created by the agent
│       ├── SKILL.md
│       ├── assets/template.html
│       └── scripts/render_req.py
└── .github/
    ├── copilot-instructions.md        # created by the agent
    └── workflows/{ci.yml,deploy.yml}  # pre-existing
```

## 5. Audit of `ai_self_evolving_flow` against the guardrails

The agent read all of `src/`, `tests/`, the task JSON files, `.env.example`, the first archive lines, and (afterwards) `README.md`. It did **not** run `pnpm test` or `pnpm evolve`.

README notes: it is accurate about the child-process sandbox being the minimum and Docker being optional, and it documents setup, commands, the archive fields and how to add a task domain. Gaps: it does not say that `pnpm test` runs generated code unsandboxed on the host, it does not describe how to adjust guardrails beyond the `.env` variables, and its code fences are labeled `powers` (a typo for `powershell`).

### What holds up
- Only `src/task-agent/TaskAgent.ts` is ever written by the loop.
- `pnpm test` runs after each proposal; failure restores the previous source and logs `testPass: false`.
- The MetaAgent prompt contains only current source, training prompts and past scores. `eval/` is read only by the evaluator.
- Archive is JSONL with the required fields; generations, timeout and memory are configurable through `.env`; no UI, no database.

### Guardrail breaches
1. **LLM code runs on the host.** The test step (`pnpm test` spawned from `cli.ts`) makes vitest import the modified `TaskAgent.ts` in a host process. Breaks guardrail 2.
2. **The "sandbox" does not isolate.** `sandbox.ts` spawns a child with the repo as working directory and full file and network access, and passes `{...process.env}`, which includes `OPENAI_API_KEY`. Generated code could read `eval/`, overwrite `tests/` or the evaluator, or exfiltrate the key. `--max-old-space-size` limits only the JS heap; stdout is unbounded; the kill uses the default signal. Breaks guardrails 1, 2 and 3 in practice.
3. **No tamper detection.** Nothing verifies `tests/`, `eval/` and the evaluator are unchanged after a generation.

### Why no evolution is observable
4. The seed TaskAgent already scores 100, and without `OPENAI_API_KEY` the MetaAgent fallback returns the same source; the archive shows no-op generations at 100.
5. No selection: any test-passing change is kept even if the score drops. `pastScores` resets and generation numbers restart each run, while the source persists and `archive.jsonl` is appended to, so runs mix.

### Smaller issues
- `codeDiff` is a full before/after dump, not a diff.
- `runTests` has no `error` handler and no timeout; a crash between write and rollback leaves modified source.
- Docker is not used (the spec allows a child process as the minimum, but the stack names Docker).
- The test suite is thin (8 happy-path cases; empty arrays and punctuation untested), so the gate is weak.

### Proposed fix order (not yet approved by the user)
1. Isolate tests and scoring: empty temp working directory, allowlisted environment, forced kill, output cap, ideally Node's permission model or Docker.
2. Hash `tests/`, `eval/` and the evaluator before and after each generation; abort on change.
3. Keep a change only if the score does not drop; give each run its own archive file or run ID.
4. Give the seed TaskAgent real headroom, expand the tests, make `codeDiff` a real diff.

## 6. Questions the reviewing agent might weigh in on

- Is a child process with an allowlisted environment and Node's permission model enough isolation, or should Docker be required?
- Should tamper detection hash files, or should the MetaAgent run with read-only mounts instead?
- Is "keep only if the score does not drop" the right selection rule, or should the archive keep a lineage of variants (as HyperAgents does)?
- Is `CLAUDE.md` in `ai_self_evolving_flow` an accurate and sufficient statement of the guardrails?
- Anything misunderstood in section 1, especially request 3, where the wrong repo was edited before the user corrected it?

## 7. Update: fixes 3 and 4 (branch `feat/selection-run-archives-seed-headroom`)

Implemented after the review above:

- **Selection.** A generation is kept only if tests pass and its score is not below the best kept score (baseline included); otherwise the previous source is restored. `accepted`, `bestScore` and `rollbackReason` are archived.
- **Baseline and run id.** Each run first tests and scores the starting TaskAgent as generation 0 and refuses to start if it fails its own tests. Every record carries a `runId`, so the shared archive no longer mixes runs.
- **Real diff.** `src/diff.ts` produces a unified diff and ignores CRLF versus LF.
- **Seed headroom.** The seed now scores 63/100 (negative maximums, palindromes with punctuation, digits in slugs) while passing all unit tests. `eval/` and the original tests were not touched; six edge-case tests were appended to `tests/task-agent.test.ts`.
- **Bug found by the new tests:** isolated test runs failed on Windows when the project path used a lowercase drive letter (`d:` versus `D:`), because vitest loaded two copies of itself. Fixed by linking dependencies through their canonical path; a regression test covers it.
- **Not done:** the real LLM MetaAgent path has still never run. Without `OPENAI_API_KEY` the offline MetaAgent makes no changes, so a keyless `pnpm evolve` stays at the baseline score. The full suite now takes about 80 seconds because each evolve test runs real isolated vitest processes.

