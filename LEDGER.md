# Ledger — simply (SEOL's harness)

> This document is the single source of truth for "what done means" for this project.
> Revisions happen only through SEOL's input. Status: **confirmed** (v0.1)
> Revision history: v0 2026-07-27 draft → v0.1 2026-07-27 SEOL confirmation + default formation doctrine added, QA shape & location fixed → v0.2 2026-07-27 PM model changed to gpt-5-sol (pi's claude bills as extra usage) → v0.3 2026-07-27 improvement-loop (autoresearch rail) design added as V2-deferred → v0.4 2026-07-27 hierarchy restructure: the pi node moves from PM to auditor (final reviewer & guide), PM becomes a claude (opus/fable) subordinate — resolving the codex-PM doctrine tension → v0.5 2026-07-27 authority codified: pane creation & model routing are PM-owned, injected via the `simply-pm` Claude skill (including ccv/ccx usage and the signal protocol) → v0.6 2026-07-27 frontend is always agy (Antigravity CLI, --dangerously-skip-permissions, ~5s initial login) — the "Antigravity pane impossible" assumption dropped

## The finished outcome (observable behavior)

When SEOL starts `simply` in tmux, an **auditor** (final reviewer, big-picture guide) comes up on pi. Then:

1. When SEOL states a goal, the auditor runs an interview that concretizes the outcome, and records the confirmed outcome as a **work ledger** (outcome + per-criterion verification method).
2. The auditor judges hierarchy **holding the roster doctrine as default knowledge**: when scale justifies it, it spawns a PM (claude opus/fable, Claude Code pane) and delegates with the confirmed ledger; the PM decomposes, briefs, and coordinates workers using the orchestration & smux skills. Small tasks: the auditor spawns workers directly. The auditor converses only with the user and the PM. Derivative work needing context is handled by forking its own session, then discarding the fork.
3. Worker completion and status are detected without conversation: a per-harness adapter (Claude Code: Stop hook) writes to a shared status ledger, and harness code watches it, injecting only decision-relevant deltas into the PM. Conversation is reserved for contract agreement and escalation.
4. Each node loops while mechanically verifying its own criteria. Only the verify gate can write "pass" to the ledger. Two identical failures escalate instead of a blind retry.
5. When all ledger criteria pass, the PM presents a **QA package in the PM pane terminal** (criterion → check command/URL mapping) instead of declaring completion. Completion declared before QA is rejected by the harness.
6. QA feedback lands as a revision of the work ledger, followed by wrap-up or loop resumption.

## Default formation doctrine (roster)

Knowledge the PM holds by default at the start of a new project. Details in `roster.md`.

- Default formation example: **pm** (gpt-5-sol class, on pi — pi's claude bills as extra usage, so codex for subscription economics; when a peak matters, spot-switch to claude/fable via `/model`) / **backend** (gpt-5-sol class, Codex CLI) / **frontend** (gemini 3.1 pro, Antigravity)
- Routing principle: not a fixed role→model mapping but **guidance via model-family temperament descriptions** — claude (all-round hexagon, humanities lean, user-facing), codex (STEM lean, overwhelmingly sharp at algorithms/logic), gemini (weak logic, strong design/language). The PM matches temperament to the nature of the task.

## User & environment

SEOL alone, local Mac (darwin), tmux always. Project lives at `~/realmyworld/simply`. Workers run in their official harnesses for subscription economics (pi's Claude OAuth bills as extra usage).

## Constraints

- Judgment to the model; loops, observation, and gates to code. Discipline is not enforced through prompts.
- Prompt layers are minimal guidance: APPEND_SYSTEM.md only for observed baseline failures, one line each.
- Inherit existing assets: the simplepowers skill, smux (reduced to an injection-only channel), and the doctrine of the orchestration/prompt skills.
- Worker panes stay human-watchable — SEOL must be able to observe and intervene at any time.

## V1 success criteria (acceptance — each mechanically checkable)

1. **E2E demo**: on one real toy task, "interview → work ledger creation → worker spawn+brief → ledger completion detection → verification loop → QA package" completes with no human intervention outside the QA gate.
2. **Ledger residency**: the work ledger is present in the PM's context every turn — even after forced compaction.
3. **No-answer detection**: worker completion reaches the PM via the status ledger, without a worker reply message.
4. **Loop gate**: unmet criteria trigger automatic re-engagement, and two identical failures escalate to SEOL.
5. **QA gate**: if the PM tries to declare completion without presenting a QA package, the harness rejects it.
6. **Roster built-in**: on a new project, the auditor proposes a formation per the roster doctrine without extra explanation.
7. **Three-tier E2E** (added v0.4): one real task completes with the auditor → PM (claude, coordinating workers via the orchestration skill) → worker structure — the auditor never talks to workers directly, and the verification & QA gates operate only at the auditor tier.

## Deliberately deferred (out of V1)

Parallel worker graphs (concurrent contracts), fork-edge automation, twin mutual-distrust verification, **Codex CLI / Antigravity automatic signal adapters** (spawn & inject already work as of v0.5–0.6 via ccx/agy — only the Stop/notify-style automatic stop signal remains; until then, coordination uses the smux reply convention). **Per-tier signal routing** (observed in the three-tier live run: a PM-owned worker's stop signal goes only to the auditor, not the PM — direction: a `parent` field on nodes, with the watcher injecting PM-owned worker events into the PM pane via smux). **Improvement loops (autoresearch rail — regime classification, rail freeze, holdout, Pareto gate, an `improve` skill)** go to the V2 cycle per the design in `docs/improvement-loops.md` (v0.3 revision, 2026-07-27 SEOL input).
