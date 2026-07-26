# Improvement loops (autoresearch rail) — V2 design note

> SEOL input (2026-07-27): loop engineering must be "a workflow that contains loops", not "an agent workflow".
> When the agent judges that improvement/autoresearch is needed, it loads a skill and builds the environment
> itself; if a change is a real improvement it passes, otherwise it rolls back. When the verification area is
> uncertain, the agent constructs the rail itself through reasonable inference and loops inside it.

## Core risk: when the rail's builder runs on the rail, Goodhart arrives

If the measurer and the optimizer share one context, optimization pressure will find the proxy's gaps
(not out of malice — it is the nature of optimization). Autoresearch works in research settings because
the metric is fixed externally. The moment the agent draws the rail itself, the rail joins the search
space — preventing that is this entire design.

## The 4-regime classification of rails (the agent's first judgment before entering a loop, recorded in the rail declaration)

| regime | situation | handling |
|---|---|---|
| A | a clear machine metric exists (benchmark, tests, numbers) | automatic loop |
| B | a human can judge (visual, aesthetic, UX) | delegate visual judgment to the user at checkpoints (QA checkpoints) |
| C | data verification needed but the metric is uncertain | **self-constructed rail** — under the discipline below |
| D | no reasonable proxy can be justified against the ledger's outcome | loop forbidden, escalate |

In C, if you cannot justify in prose "how the proxy connects to the ledger's outcome", it isn't C — it's D.

## Regime C discipline — a rail for the rail

1. **Rail freeze**: the rail (metric, direction, verdict command) is declared before the loop starts and
   cannot be modified inside the loop. You don't swap the ruler mid-measurement. If the rail proves wrong
   → stop the loop → revise outside the loop → restart.
2. **Measurer/optimizer separation**: rail construction is a separate stage (ideally a separate
   fresh-context agent); the optimizer only receives the rail and runs. A context full of its own
   decision justifications will bend the rail generously.
3. **Holdout**: the rail-construction stage registers a secondary verification in the rail declaration
   that is never exposed to the optimizer; the harness (code) runs it at acceptance time. If the optimizer
   sees the exam in advance, you get proxy overfitting.
   (Perfect secrecy is impossible locally — bash exists. Fresh context + non-injection + harness-run
   acceptance gets a practical level, and this limitation is acknowledged.)
4. **Invariant floor (regression floor)**: all existing ledger criteria are invariants. The improvement
   verdict is a Pareto gate — metric improves AND every existing criterion still passes. Break one and
   it auto-rolls back.
5. **Budget and exits**: per-loop attempt/token budgets. Repeated failure in the same direction escalates
   (inherited from the existing loop doctrine).

## Implementation sketch (V2 cycle)

- **skill**: `improve` — the procedure module the agent loads when it judges an improvement loop is needed
  (regime classification → rail construction/declaration → loop). The documentation layer of
  "a workflow that contains loops".
- **harness tools** (verdicts belong to code):
  - `rail_declare {metric_cmd, direction, baseline, holdout_cmds, budget}` — freeze. Recorded in
    .simply/rail.json; later modification attempts are rejected by the harness
  - `attempt_begin` — git snapshot (commit/worktree)
  - `attempt_judge` — run metric + invariants (existing criteria) → keep if improved, else git rollback.
    Verdict and reasoning recorded in the status ledger
- **graph integration**: a loop node is a first-class node type in the graph — (rail, optimizer, judge,
  budget). The rail is the loop node's ledger. The hourglass applies recursively: rail approval/revision
  happens only outside the loop (above it).
