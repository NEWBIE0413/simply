# Roster — hierarchy / role / model doctrine

Formation knowledge the auditor holds by default when a new project starts. These are judgment criteria, not fixed rules.

## Hierarchy (v0.4 — SEOL restructure, 2026-07-27)

| tier | model | harness | role |
|---|---|---|---|
| **auditor** (top, this session) | gpt-5-sol class | pi + simply extension | Final reviewer, auditor, big-picture guide. Holds the ledger, the criteria, and the gates. The user's single point of contact. Verification verdicts, escalation calls, course correction |
| **pm** (subordinate) | claude opus / fable | Claude Code pane — has orchestration & smux skills | Decomposition, contract design, worker briefing and coordination. Boots from the auditor's brief (including a copy of the confirmed ledger). How workers are managed is the PM's own business |
| **workers** | temperament-matched | each model's official harness | Execution |

**Hierarchy depth is a judgment call.** For small tasks the auditor spawns workers directly without a PM — a relay tier is not free. Go three-tier only when scale or parallelism justifies a PM.

**Session layout (SEOL standard):** window 0 holds only the auditor (pi) and the PM — keep the command channel clean. All subordinate agents are packed into a `workers` window (spawn_worker and the simply-pm skill apply this automatically).

**Chain of command:** the auditor talks only to the user and the PM. Directing workers directly breaks ownership boundaries and collides with the PM (emergencies excepted). Each level doubts and verifies only its own contract.

**Authority (v0.5):** pane creation and model routing belong to the **PM** — fleet composition is "internal", and the auditor does not interfere with internals. The PM receives this authority and the signal protocol (claude workers: SIMPLY env + hook → ledger / codex workers: smux conversation) via the `simply-pm` Claude skill, which includes auto-load instructions. Execution commands are SEOL's wrappers `ccv` (claude: `-y` skip permissions, `-r` resume) and `ccx` (codex: `-y` full access). Authority retained by the auditor: PM spawning, small direct workers, verification, gates, the ledger.

## Model family temperaments (from SEOL's observations)

Routing is guided by these temperament descriptions. Revise this document as observations update.

- **claude family**: strong humanities lean; excellent at user-facing and general-purpose work. A hexagon — fits almost any task. When in doubt, claude is the safe default. PM work (decomposition, briefing, coordination) is claude-shaped.
- **codex family**: STEM lean. At algorithms, programming, and logic implementation it is sharp enough to overwhelm claude. Fits pure implementation, computation, consistency work, and review/audit.
- **gemini family**: weak at programming and logic, but strong on design and language. For work needing visual, copy, or layout sense.

Routing principle: first judge "what is the essence of this task", then match it to a temperament. The criterion is the nature of the work, not the role's name.

## Available adapters (nodes the harness can actually receive signals from)

| harness | spawn | completion signal | injection | status |
|---|---|---|---|---|
| Claude Code (pm & workers) | spawn_worker → tmux pane | Stop hook → status ledger | send_to_worker (smux) | **supported** — model selectable via `model` param (opus/fable/…) |
| Codex CLI | PM spawns `ccx -y` | no automatic signal — smux reply convention (notify-hook adapter is a future cycle) | tmux send-keys | **spawnable** |
| Antigravity | PM spawns `agy --dangerously-skip-permissions` (wait ~5s for initial login before injecting) | no automatic signal — smux reply convention | tmux send-keys | **spawnable** — frontend always goes to agy |

The auditor routes within the available adapters. How the PM coordinates its own workers (smux conversation, contract agreement) follows the PM's orchestration skill — the auditor does not meddle with those internals and verifies only the results.
