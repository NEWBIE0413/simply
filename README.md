# simply

A personal multi-agent orchestration harness for tmux. A [pi](https://github.com/badlogic/pi-mono)-based **auditor** holds the work ledger and the verification gates; a Claude Code **PM** owns the worker fleet; **workers** run in their own official harnesses, routed by model temperament. Worker completion travels through a file-based status ledger, not through conversation.

This repo is both a working tool and a reference for how I (SEOL) work. It runs on my machine daily, and the paths and wrapper commands in it are mine — see [Porting](#porting) if you want to run it yourself.

## Two rules

**1. Outcome-first development, intent-first prompting.** These sound contradictory and aren't — they are two sides of one rule. The definition of done lives in a work ledger: observable criteria, each with a shell check where exit 0 means pass, executed by code. The brief a worker receives carries only intent — the contract and its success criteria, never line-by-line instructions. The model owns the path; the ledger owns the destination.

**2. Judgment to the model; loops, observation, and gates to code.** Discipline is not enforced by prompt. Every rule that matters is a mechanism:

- An agent cannot mark a criterion "pass". Only the `verify` tool can, by running the check command. Self-reports are distrusted by design.
- An agent cannot declare completion. The settle gate re-engages it until every criterion passes **and** a QA package has been presented to the user.
- An agent cannot busy-poll the status ledger. The harness blocks `while`/`sleep` bash loops that touch it at the tool-call level — a one-shot `cat`/`tail` is allowed.

System-prompt additions stay minimal: one line per *observed* baseline failure, nothing preemptive. Several guards in `extension/simply.ts` carry comments tracing them to the specific live failure that motivated them (an auditor running a 900-second polling loop; a PM's turn-end noise being read as completion; early verification inflating failure counts into false escalations).

## Hierarchy

| tier | model | harness | owns |
|---|---|---|---|
| **auditor** | gpt-5-sol class | pi + `extension/simply.ts` | the ledger, criteria, verification, gates, escalation. Talks only to the user and the PM |
| **pm** | claude opus / fable | Claude Code pane + `simply-pm` skill | decomposition, contract design, worker briefing, pane creation, model routing |
| **workers** | matched by temperament | each model's official harness | execution |

Hierarchy depth is a judgment call. For small tasks the auditor spawns workers directly — a relay tier is not free. The PM tier exists only when scale or parallelism justifies it.

Routing is guided by temperament descriptions, not fixed role→model mappings. Mine, from my own use: claude is the all-round safe default and the natural PM; codex is sharply stronger at algorithms and pure logic; gemini is weak at logic but strong at design and language, so frontend work always goes to it (via Antigravity). These are personal observations, published as-is — revise them against your own.

## The no-answer protocol

Workers never report status in conversation. A Claude Code worker's Stop hook appends `{"node": ..., "event": "stopped"}` to the project's `.simply/status.jsonl`; the extension watches the file and injects only the delta into the auditor's context. PM-type nodes are treated differently: a PM stops at the end of every turn while waiting on delegates, so its `stopped` events are noise — a PM signals contract completion by explicitly appending `ready_for_verify`. Conversation is reserved for contract agreement and escalation.

Two consequences, both from live runs:

- Criterion failures while subcontractors are still in flight don't count toward the failure limit.
- The same criterion failing twice escalates to the user instead of triggering a blind retry.

## Repo layout

- `LEDGER.md` — this project's own work ledger (the single source of truth for "what done means")
- `roster.md` — hierarchy / role / model doctrine, injected into the auditor's system prompt every turn
- `extension/simply.ts` — the pi extension: ledger residency, status-ledger watch, `set_criteria` / `spawn_worker` / `send_to_worker` / `verify` / `request_qa` tools, settle gate
- `hooks/` — Claude Code worker Stop hook → status ledger
- `skills/simply-pm/` — Claude Code skill that grants the PM its fleet authority and signal protocol
- `bin/simply` — launcher (`simply <project-dir>`, inside tmux)
- `docs/pi-reference.md` — pi 0.82.1 harness-engineering reference (docs + extracted source, ground truth for the extension)
- `docs/improvement-loops.md` — V2 design note for self-improvement loops (rail freeze, holdout, Pareto gate)

`vendor/pi-src/` (pi TypeScript extracted from source maps) is used as ground truth locally and is not part of the repo.

## Running it

```bash
# inside a tmux session
bin/simply ~/path/to/project
```

The auditor starts in the current pane. State a goal; it interviews you to pin the outcome down, writes it to the project's `.simply/LEDGER.md`, registers machine-checkable criteria with `set_criteria`, spawns and briefs workers (or a PM, if scale warrants), detects completion through the status ledger, loops through `verify`, and ends by presenting a QA package mapped criterion-by-criterion to how you can check it — never by declaring itself done. All per-project state lives under that project's `.simply/`.

Layout convention: window 0 holds only the auditor and the PM (the command channel); all workers are packed into a `workers` window, tiled. Worker panes stay human-watchable — you can look at and intervene in any of them at any time.

## Installing

Recommended method: paste this repo's URL into the coding agent you already use and say "install this and summarize how to use it." The Porting section below lists every personal hardcoding it will need to adapt — it is written for that agent as much as for you. Intent-first prompting applies to installation too.

Manual method: clone, put `bin/simply` on your PATH, and walk the Porting list yourself.

## Porting

Built for one machine. To run it on yours:

- `SIMPLY_HOME` defaults to `~/realmyworld/simply`; export it if the repo lives elsewhere.
- `hooks/worker-settings.json` and `skills/simply-pm/SKILL.md` contain absolute paths to this repo — adjust them.
- `ccv` / `ccx` / `agy` referenced in the PM skill are my local wrappers for `claude` (`-y` skip permissions, `-r` resume), `codex` (`-y` full access), and the Antigravity CLI. Substitute your own invocations.
- The `simply-pm` skill must be discoverable by the spawned PM (e.g. symlink `skills/simply-pm` into `~/.claude/skills/`).
- Requires: tmux, [pi](https://github.com/badlogic/pi-mono) (`@earendil-works/pi-coding-agent`), Claude Code, and optionally Codex CLI / Antigravity for the non-claude workers.

## Status

V1, after live three-tier end-to-end runs. Deliberately deferred to V2:

- parallel worker graphs (concurrent contracts)
- automatic stop-signal adapters for Codex CLI and Antigravity — spawn and inject already work; only the stop signal is missing, so those workers coordinate via tmux message-back conventions for now
- per-tier signal routing (a `parent` field on nodes, so PM-owned worker events reach the PM instead of only the auditor)
- the self-improvement rail (`docs/improvement-loops.md`): regime classification, rail freeze, holdout checks, Pareto gate

## Why pi at the top

pi keeps its core minimal and deliberately leaves subagents, plan mode, and background tasks out of it — which is exactly the space this harness occupies (see `docs/pi-reference.md`). Economics, too: workers run in their own subscription harnesses. Also, a twenty-line system prompt at the top of the stack is just cool.

## License

MIT
