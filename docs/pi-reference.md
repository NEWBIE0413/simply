# pi harness-engineering reference

> Target: `@earendil-works/pi-coding-agent` **0.82.1** (as installed 2026-07-27)
> Basis: all 32 official docs bundled with the package + original TypeScript extracted from source maps (`~/cld/pi-src/`, 176 files) + 81 examples/extensions.
> Purpose: ground truth for building loop/graph engineering on top of the simplepowers philosophy (outcome-driven development).

---

## 0. pi's design philosophy — where it meets ours

pi is a "minimal terminal coding harness". It keeps the core small and **deliberately excludes MCP, subagents, permission popups, plan mode, todo, and background bash from the core**. Official position: "There's many ways to do this. Spawn pi instances via tmux, or build your own with extensions."

→ The loop/graph harness we build lands exactly in the space pi intentionally left empty. Four extension surfaces: **extensions (TS code) / skills (markdown) / prompt templates (markdown) / packages (distribution bundles)**.

## 1. The prompt stack (source: `core/system-prompt.ts`)

The default system prompt is **~20 lines**: a one-sentence role + an Available-tools list (one snippet line per tool) + Guidelines (2 lines by default: "Be concise", "Show file paths clearly") + a pointer to pi's docs. Unlike Claude Code's huge preset, there is almost no built-in workflow guidance to preserve.

Assembly order (`buildSystemPrompt`):

```
1. base prompt   (or fully replaced by SYSTEM.md / --system-prompt)
2. + APPEND_SYSTEM.md / --append-system-prompt
3. + <project_context> — AGENTS.md/CLAUDE.md files (wrapped in <project_instructions path=...>)
4. + <available_skills> XML (only when the read tool exists)
5. + Current working directory
```

File locations:
| file | global | project |
|---|---|---|
| system prompt replacement | `~/.pi/agent/SYSTEM.md` | `.pi/SYSTEM.md` |
| system prompt append | `~/.pi/agent/APPEND_SYSTEM.md` | `.pi/APPEND_SYSTEM.md` |
| context (doctrine) | `~/.pi/agent/AGENTS.md` | `AGENTS.md`/`CLAUDE.md` from cwd up to parents |

Per-turn intervention: the `before_agent_start` event can rewrite `systemPrompt` in a chain; the `context` event can rewrite the message array right before every LLM call.

**Layer-placement judgment (mapping to our philosophy):** meta principles → APPEND_SYSTEM.md (but only after an observed baseline failure, one line each). Project doctrine → AGENTS.md. Role modules → skills. Execution-surface control → `--tools`/`-xt`/extensions. Loops & graphs → extensions + RPC/SDK.

## 2. Resource layers

### Skills (Agent Skills standard implementation, lenient)
- Load paths: global `~/.pi/agent/skills/`, `~/.agents/skills/` / project (after trust) `.pi/skills/`, `.agents/skills/` (cwd→repo root) / packages / the settings `skills` array / `--skill <path>`
- **Putting `~/.claude/skills` in the settings `skills` array shares Claude Code skills** (currently only simplepowers is linked, via symlink)
- Frontmatter: `name` (required), `description` (required — not loaded without it, max 1024), `allowed-tools` (experimental), `disable-model-invocation` (true hides it from the system prompt → `/skill:name` only)
- Discovery: only name+description go into the system prompt as XML → on a match, the model loads the body with `read` (not always — `/skill:name` can force it; `enableSkillCommands: true` by default)
- Name collisions: first discovered wins (with a warning)

### Prompt templates
- `~/.pi/agent/prompts/*.md`, `.pi/prompts/*.md` (non-recursive), expanded via `/name`
- Arguments: `$1` `$2`, `$@`/`$ARGUMENTS`, `${1:-default}`, `${@:N:L}` slicing, frontmatter `description`/`argument-hint`

### Packages
- `pi install npm:@foo/bar@1.0.0 | git:github.com/u/r@v1 | <local path>` (`-l` for project scope, recorded in `.pi/settings.json` and auto-installed)
- The package.json `pi` key declares extensions/skills/prompts/themes; conventional directories are also recognized
- Core packages (`pi-ai`, `pi-agent-core`, `pi-coding-agent`, `pi-tui`, `typebox`) must be peerDependencies `"*"`
- Object-form settings entries filter resources (globs, `!`, `+`, `-`); toggle via the `pi config` TUI

### Settings (`~/.pi/agent/settings.json` ← `.pi/settings.json` deep-merged, project wins per key)
Harness-relevant keys: `defaultProvider`/`defaultModel`/`defaultThinkingLevel`, `thinkingBudgets`, `compaction.{enabled,reserveTokens(16384),keepRecentTokens(20000)}`, `retry.{enabled,maxRetries(3),...}`, `steeringMode`/`followUpMode` (`one-at-a-time`|`all`), `defaultProjectTrust`, `sessionDir`, `enabledModels`, `packages`/`extensions`/`skills`/`prompts`/`themes` arrays, `enableSkillCommands`, `npmCommand`, `shellCommandPrefix`.

### Project trust — the biggest headless trap
- Interactive: asks at startup when project-local resources exist → `~/.pi/agent/trust.json`
- **`-p`/`--mode json`/`--mode rpc` never ask.** With no stored decision, `defaultProjectTrust` applies: `ask` (default) and `never` **silently ignore project resources** (extensions, skills, settings not loaded); only `always` trusts. Per-run override: `--approve`/`-a`, `--no-approve`/`-na`
- AGENTS.md/CLAUDE.md context files always load regardless of trust
- An orchestrator must pass `-a` or pre-seed trust.json

## 3. The extension system (the body of the harness)

### Skeleton
```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: ExtensionAPI) { /* pi.on(...), pi.registerTool(...) */ }
```
- TS loaded uncompiled via jiti. Locations: `~/.pi/agent/extensions/*.ts|*/index.ts`, `.pi/extensions/` (after trust), `-e <path>`, settings/packages
- Async factories are awaited before `session_start`. **Never start background resources in the factory** (invocations without a session exist) — start in `session_start`, clean up in an idempotent `session_shutdown`
- Event handlers chain in load order. Use `CONFIG_DIR_NAME` instead of hardcoding `.pi`, `getAgentDir()` instead of `~/.pi/agent`

### Event catalog (focused on what can intervene)

**Blockable/transformable:**
| event | intervention |
|---|---|
| `input` | `{action:"transform",text}` chain / `{action:"handled"}` swallow. `event.source: "interactive"\|"rpc"\|"extension"` — guard against reprocessing self-injected messages |
| `before_agent_start` | `{message:{customType,content,display}}` persistent context injection + `{systemPrompt}` per-turn rewrite (chained) |
| `context` | right before every LLM call, replace the deep-copied `messages` by returning them |
| `tool_call` | `{block:true, reason}` blocks. `event.input` mutable in place (no revalidation). Handler error = block (fail-safe) |
| `tool_result` | partial-patch `{content?,details?,isError?,usage?}` middleware chain |
| `message_end` | replace the message with the same role |
| `user_bash` | replace the `!` command backend / substitute the result |
| `before_provider_headers` / `before_provider_request` | mutate headers in place / replace the payload |
| `session_before_switch/fork/compact/tree` | `{cancel:true}` or substitute the result (compaction summary etc.) |
| `project_trust` | must return `{trusted:"yes"\|"no"\|"undecided", remember?}`, first yes/no wins |
| `resources_discover` | add dynamic resource roots via `{skillPaths?,promptPaths?,themePaths?}` |

**Observe-only:** `session_start/shutdown/info_changed`, `agent_start`, `agent_end` (messages, retry still possible), **`agent_settled` (the real completion signal)**, `turn_start/end`, `message_start/update`, `tool_execution_start/update/end`, `session_compact/tree`, `model_select`, `thinking_level_select`, `after_provider_response`.

### Key ExtensionAPI methods
- `pi.on(event, handler)` / `pi.registerTool(def)` (runtime registration takes effect immediately) / `pi.registerCommand(name,{handler(args, cmdCtx)})` / `pi.registerShortcut` / `pi.registerFlag`
- **`pi.sendUserMessage(content, {deliverAs})`** — injects a genuine user message; starts a turn if idle. During streaming, `deliverAs:"steer"|"followUp"` is required (throws otherwise)
- `pi.sendMessage({customType,content,display,details},{deliverAs:"steer"|"followUp"|"nextTurn",triggerTurn})` — custom message (included in LLM context)
- `pi.appendEntry(customType, data)` — persisted to the session, excluded from LLM context (durable extension state)
- `pi.setActiveTools(names)` / `getActiveTools()` / `getAllTools()` — per-stage tool gating (plan-mode pattern); append-only changes preserve cache via deferred tool loading
- `pi.exec(cmd,args,{signal,timeout})`, `pi.events` (inter-extension bus), `pi.registerProvider/unregisterProvider`, `pi.setModel/setThinkingLevel`, `pi.setSessionName`, `pi.setLabel(entryId,label)`

### ExtensionContext vs CommandContext
- All handlers: `ctx.ui` (select/confirm/input/editor/notify + TUI widgets), `ctx.mode` (`"tui"|"rpc"|"json"|"print"`), `ctx.hasUI`, `ctx.cwd`, `ctx.sessionManager` (reads: getEntries/getBranch/buildContextEntries/getLeafId), `ctx.model`, `ctx.signal`, `ctx.isIdle()`, `ctx.abort()`, `ctx.compact()`, `ctx.getContextUsage()`, `ctx.getSystemPrompt()`
- **Command-handler only** (deadlock risk if called from event handlers): `ctx.waitForIdle()`, `ctx.newSession({parentSession?,setup?,withSession?})`, `ctx.fork(entryId,{position:"before"|"at"})`, `ctx.switchSession(path)`, `ctx.navigateTree(id,{summarize,label})`, `ctx.reload()` (return immediately after calling), `ctx.getSystemPromptOptions()`
- **Stale-object trap:** after newSession/fork/switchSession/reload, captured `pi`/`ctx`/`sessionManager` throw. Use only the fresh ctx from `withSession`; capture plain data only

### Custom tools
```typescript
pi.registerTool({
  name, label, description,
  promptSnippet: "one line for the Available-tools list",  // omitted = not listed
  promptGuidelines: ["bullets that name the tool"],         // appended flat to Guidelines
  parameters: Type.Object({ action: StringEnum(["a","b"] as const) }),  // enums MUST be StringEnum
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // errors: throw (isError set automatically). Stream via onUpdate.
    return { content:[{type:"text",text:"..."}], details:{}, terminate:true /* if every tool in the batch terminates, the follow-up LLM call is skipped */ };
  },
  renderCall?, renderResult?,
});
```
- File-mutating tools must use `withFileMutationQueue(absPath, fn)` (races with parallel tool execution and built-in edit/write)
- Truncate output within 50KB/2000 lines (`truncateHead/Tail`); full output goes to a temp file
- Built-ins can be overridden (register the same name) — match the result/`details` shape exactly
- Normalize a leading `@` on path arguments (some models add it)
- `defineTool()` is the typed-details helper. Structured output = a `terminate:true` tool

### Custom compaction
- `session_before_compact` → `{cancel}` / `{compaction:{summary,firstKeptEntryId,tokensBefore,usage?}}` / undefined (default fallback)
- Helpers: `convertToLlm`, `serializeConversation`, `complete` (pi-ai/compat) — the custom-compaction.ts pattern of summarizing everything with a cheap model
- Auto-trigger: `contextTokens > contextWindow - reserveTokens`. The cut point never lands inside a tool result. Summary format: Goal/Constraints/Progress/Key Decisions/Next Steps/Critical Context + read/modified files (cumulative)

## 4. Programmatic control (the orchestrator surface)

### Mode spectrum
| mode | use |
|---|---|
| `pi -p "..."` | one-shot. stdin pipe merged, `@file` attachments, `--tools` for read-only |
| `pi --mode json "..."` | one-shot + full event JSONL output (first line is the session header). No stdin channel |
| `pi --mode rpc` | resident process, bidirectional JSONL control over stdin/stdout |
| SDK (in-process) | `createAgentSession()` — maximum control |

### RPC protocol essentials
- **Framing: `\n` only. Never Node `readline`** (missplits U+2028/2029) — manual buffer split
- Commands (all with optional `id` correlation): `prompt` (during streaming, `streamingBehavior:"steer"|"followUp"` required), `steer`, `follow_up`, `abort`, `new_session{parentSession?}`, `get_state`, `get_messages`, `set_model`, `set_thinking_level`, `compact{customInstructions?}`, `set_auto_compaction/retry`, **`bash{command}`** (orchestrator shell — output joins LLM context at the next `prompt`), `get_session_stats` (tokens/cost/contextUsage), `switch_session`, `fork{entryId}`, `clone`, **`get_entries{since?}`** (durable cursor — entry ids are stable, incremental tracking survives restarts), `get_tree`, `get_last_assistant_text`, `get_commands`
- Events: `agent_start/end`, **`agent_settled` (the completion criterion)**, `turn_start/end`, `message_start/update/end`, `tool_execution_start/update/end` (update's partialResult is cumulative), `queue_update`, `compaction_start/end`, `auto_retry_start/end`, `extension_error`
- Extension UI dialogs use the `extension_ui_request/response` sub-protocol — **a dialog without a timeout blocks forever**: an unattended harness must answer them or the extension must set timeouts
- The `prompt` response means accepted (not finished). Failures flow as events

### SDK essentials
```typescript
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
const { session } = await createAgentSession({ sessionManager: SessionManager.inMemory(), modelRuntime: await ModelRuntime.create() });
session.subscribe(ev => ...);          // AgentSessionEvent — same union as RPC
await session.prompt("...");           // resolves after the whole accepted run (retries included)
```
- Options: `cwd`, `agentDir`, `model`, `thinkingLevel`, `tools` (allowlist — custom/extension tools must be listed too), `customTools` (defineTool), `excludeTools`, `noTools:"all"|"builtin"`, `resourceLoader`, `sessionManager`, `settingsManager`
- `DefaultResourceLoader` override hooks: `systemPromptOverride`, `skillsOverride`, `promptsOverride`, `agentsFilesOverride` (inject virtual AGENTS.md), `extensionFactories` (inline extensions), `eventBus`
- Session-replacement layer: `createAgentSessionRuntime()` → `runtime.newSession()/switchSession()/fork(entryId,{position})/importFromJsonl()` — **after replacement, `runtime.session` is a new object: re-subscribe + `bindExtensions` required**
- `session.agent.state.messages/tools` are assignable (context injection/restore), `session.agent.waitForIdle()`
- Helpers: `runPrintMode(runtime,...)`, `runRpcMode(runtime)` (expose RPC from your own process), `InteractiveMode`
- `SettingsManager.inMemory()`/`applyOverrides()`; writes are async — `flush()` needed

### Sessions = durable state
- JSONL append-only **tree** (`id`/`parentId`, leaf is the current position), v3. Location: `~/.pi/agent/sessions/--<cwd>--/<ts>_<uuid>.jsonl`
- Entry types: `session` (header, fork lineage via `parentSession`), `message`, `model_change`, `thinking_level_change`, `compaction` (retainedTail checkpoint), `branch_summary`, `custom` (excluded from LLM context), `custom_message` (included), `label`, `session_info`
- Compaction is lossy only for LLM context — the file keeps full history. Model/thinking selections survive resume
- `SessionManager` statics: `create/open/continueRecent/inMemory/forkFrom/list/listAll`; tree: `branch(entryId)`, `branchWithSummary`, `createBranchedSession`
- The bash tool receives `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, `PI_REASONING_LEVEL` — an agent can be aware of its own session

### Subagents / parallelism (nothing built in — this is what we build)
- Official example `examples/extensions/subagent/index.ts`: spawns `pi --mode json -p --no-session [--model M] [--tools ...] [--append-system-prompt f] "Task:..."` child processes, parses the JSON stream, single/parallel (MAX 8, concurrency 4)/chain (`{previous}` substitution), SIGTERM→5s→SIGKILL, agent definitions as markdown in `~/.pi/agent/agents`/`.pi/agents`
- Choices: (a) N RPC subprocesses (process isolation, language-agnostic) (b) N SDK in-process sessions (c) one-shot `-p`/`json` workers
- In-agent parallelism: sibling tool calls run concurrently (preflight is sequential) — result events interleave by completion order

## 5. Models / auth / environment

- Credential priority: `--api-key` > `auth.json` (including OAuth subscriptions: Claude Pro/Max, ChatGPT, Copilot, …) > env var > models.json custom
- `~/.pi/agent/models.json` for custom providers/models (4 API shapes), `!command`/`$ENV` value resolution, `thinkingLevelMap`
- Model notation: `provider/id:thinking` (e.g. `anthropic/claude-opus-4-5:high`)
- **`PI_CODING_AGENT_DIR`** — overrides the whole config directory (the key to isolated harness profiles), `PI_CODING_AGENT_SESSION_DIR`, `PI_OFFLINE`, `PI_CACHE_RETENTION=long`
- No sandbox (by design) — isolation is the OS/container's job. Trust is a loading guard, not an execution restriction

## 6. Traps that bear directly on harness design

1. **Completion is `agent_settled`** — `agent_end` may still be followed by retry/overflow-compaction/queued work
2. **Headless trust silently ignores** — `-a` or seeded trust.json is mandatory
3. RPC parsing: manual `\n` split (no readline)
4. prompt/sendUserMessage during streaming require `streamingBehavior`/`deliverAs` (error/throw otherwise)
5. Steering injection timing: after the current assistant turn's tool calls finish, before the next LLM call
6. RPC `bash` output only joins context at the next `prompt`
7. Stale objects after session replacement (subscriptions, ctx, sessionManager) — re-subscribe/re-bind, fresh ctx from `withSession` only
8. Command-only methods called from event handlers risk deadlock
9. Extension UI dialogs without timeouts block forever in unattended modes
10. `get_messages` (current context) vs `get_entries` (full history + abandoned branches)
11. No background resources in the factory
12. Tool errors via throw (return values don't set isError); output truncated at 50KB/2000 lines
13. File-mutating custom tools need `withFileMutationQueue`
14. Use `StringEnum` (Type.Union literals are incompatible with the Google API)
15. `contextUsage` is null right after compaction; `SettingsManager` writes need flush
16. Never hardcode `.pi`/`~/.pi/agent` — `CONFIG_DIR_NAME`/`getAgentDir()`

## 7. simplepowers → loop/graph mapping (design direction)

**Loop engineering** — success criteria as exit conditions:
- Extension approach: run verification (tests/commands) on `agent_settled` → if unmet, re-engage via `pi.sendUserMessage(failure info)` (the git-merge-and-resolve pattern). Exit via a `terminate:true` structured-output tool or criteria passing
- Orchestrator approach: RPC `prompt` → await `agent_settled` → verify via `bash` → next `prompt` with the failure output (verification joins context at the protocol level)

**Graph engineering** — an outcome decomposed into a DAG of sub-outcomes:
- Node = a pi instance (RPC subprocess or SDK session), each with its own loop
- Edge = the orchestration skill's rules (contract first, convey intent, read-only orchestrator)
- State = session JSONL (observe via the `get_entries since` cursor, lineage via `fork`/`parentSession`; the session file is the node's resumable state)
- Isolation = `PI_CODING_AGENT_DIR` profiles / containers

**Verification caveat:** this document is based on official docs + original source, but has not yet been execution-verified. Confirm each mechanism with a minimal experiment (a single RPC round-trip etc.) the first time you use it, and amend this document where reality disagrees.
