/**
 * simply — SEOL's harness auditor extension (V1)
 *
 * Principle: judgment to the model; loops, observation, and gates to code.
 *  - Keep the work ledger (.simply/LEDGER.md) resident in the system prompt every turn
 *  - Detect worker completion by watching the status ledger; inject only deltas (no-answer protocol)
 *  - Only the verify tool can write "pass" (self-reports are distrusted)
 *  - After all criteria pass, the settle gate re-engages until a QA package has been presented
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SIMPLY_HOME = process.env.SIMPLY_HOME ?? path.join(os.homedir(), "realmyworld", "simply");

interface Criterion {
	id: string;
	desc: string;
	check: string; // shell command; exit 0 = pass
	status: "pending" | "pass" | "fail";
	fails: number;
	lastError?: string;
}

interface NodeInfo {
	pane: string;
	role: string;
	harness: string;
	brief: string;
}

function simplyDir(cwd: string): string {
	return path.join(cwd, ".simply");
}

function readJson<T>(file: string, fallback: T): T {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8")) as T;
	} catch {
		return fallback;
	}
}

function writeJson(file: string, data: unknown): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function appendStatus(cwd: string, event: Record<string, unknown>): void {
	const file = path.join(simplyDir(cwd), "status.jsonl");
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
}

function sanitizeName(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 32);
}

/** Last event per node (status ledger replay) */
function lastEvents(statusPath: string): Record<string, string> {
	const out: Record<string, string> = {};
	try {
		for (const line of fs.readFileSync(statusPath, "utf8").split("\n").filter(Boolean)) {
			try {
				const e = JSON.parse(line);
				if (e.node) out[e.node] = e.event;
			} catch {}
		}
	} catch {}
	return out;
}

/** Nodes whose contract is not yet finished — pm-type nodes count as finished only on an explicit
 *  ready_for_verify. The Stop hook fires on "turn end", not "work done" (a defect observed live),
 *  so a delegating-and-waiting pm's stopped must be treated as still in progress. */
function inFlightNodes(cwd: string, nodes: Record<string, NodeInfo>, statusPath: string): string[] {
	const last = lastEvents(statusPath);
	return Object.entries(nodes)
		.filter(([name, info]) => {
			const ev = last[name];
			if (!ev) return false; // a node with no record is unjudgeable — don't block on it
			const isPm = info.role.toLowerCase().startsWith("pm");
			return isPm ? ev !== "ready_for_verify" : ev !== "stopped";
		})
		.map(([name]) => name);
}

export default function simply(pi: ExtensionAPI) {
	let watcher: fs.FSWatcher | undefined;
	let statusOffset = 0;
	let qaRequested = false;
	// Fingerprint that keeps the settle gate from re-engaging on the same state forever — state must change first
	let lastNudgeFingerprint = "";

	const criteriaFile = (cwd: string) => path.join(simplyDir(cwd), "criteria.json");
	const nodesFile = (cwd: string) => path.join(simplyDir(cwd), "nodes.json");
	const statusFile = (cwd: string) => path.join(simplyDir(cwd), "status.jsonl");
	const ledgerFile = (cwd: string) => path.join(simplyDir(cwd), "LEDGER.md");

	// ── 1. Work ledger + roster residency ─────────────────────────────────
	// Attached to the system prompt: the session doesn't grow, and compaction can't touch it.
	pi.on("before_agent_start", async (event, ctx) => {
		const parts: string[] = [];
		// In a live E2E the PM was observed bash-polling right after spawning — this line traces to that observation
		parts.push(
			`<simply_protocol>Worker completion and status changes are detected by the harness via the status ledger and injected automatically — a leaf worker's completion signal is stopped, a pm-type node's is ready_for_verify (a pm's stopped is turn-end noise and is not injected). Do not wait by repeatedly polling the ledger or worker outputs with bash — it duplicates the injection and burns tokens. After spawning or sending, do the next thing or end your turn.</simply_protocol>`,
		);
		const rosterPath = path.join(SIMPLY_HOME, "roster.md");
		if (fs.existsSync(rosterPath)) {
			parts.push(`<roster>\n${fs.readFileSync(rosterPath, "utf8")}\n</roster>`);
		}
		const lp = ledgerFile(ctx.cwd);
		if (fs.existsSync(lp)) {
			parts.push(
				`<work_ledger note="The single source of truth for what done means in this project. All judgment is measured against this ledger. Revisions only through user input.">\n${fs.readFileSync(lp, "utf8")}\n</work_ledger>`,
			);
		} else {
			parts.push(
				`<simply note="No work ledger yet. When a goal is given, interview to concretize the outcome (the observable finished state) and its success criteria, record them in .simply/LEDGER.md, and register the machine-checkable ones via set_criteria.">simplepowers: outcome interview → the path is yours → loop until criteria pass → done only after QA.</simply>`,
			);
		}
		return { systemPrompt: `${event.systemPrompt}\n\n${parts.join("\n\n")}` };
	});

	// ── 2. Status ledger watch → inject only deltas ───────────────────────
	pi.on("session_start", async (_event, ctx) => {
		const file = statusFile(ctx.cwd);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		if (!fs.existsSync(file)) fs.writeFileSync(file, "");
		statusOffset = fs.statSync(file).size;
		watcher?.close();
		watcher = fs.watch(path.dirname(file), (_type, name) => {
			if (name !== "status.jsonl") return;
			try {
				const size = fs.statSync(file).size;
				if (size <= statusOffset) return;
				const fd = fs.openSync(file, "r");
				const buf = Buffer.alloc(size - statusOffset);
				fs.readSync(fd, buf, 0, buf.length, statusOffset);
				fs.closeSync(fd);
				statusOffset = size;
				for (const line of buf.toString("utf8").split("\n").filter(Boolean)) {
					let ev: Record<string, unknown>;
					try {
						ev = JSON.parse(line);
					} catch {
						continue;
					}
					// Don't echo our own records (spawned, qa_requested, escalation) — inject only worker-originated events
					if (ev.event === "spawned" || ev.node === "auditor") continue;
					// A pm-type node's stopped is turn end, not completion (it may be delegating and waiting — observed live).
					// A pm's completion is recognized only via an explicit ready_for_verify signal.
					const nodeInfo = readJson<Record<string, NodeInfo>>(nodesFile(ctx.cwd), {})[String(ev.node)];
					const isPmNode = nodeInfo?.role?.toLowerCase().startsWith("pm") ?? false;
					if (isPmNode && ev.event === "stopped") continue;
					const cue =
						ev.event === "ready_for_verify"
							? "This is a contract-fulfilled signal — verify it and decide what's next."
							: "Verify this node's criteria and decide the next action.";
					pi.sendMessage(
						{
							customType: "simply-status",
							content: `[simply] worker '${ev.node}' → ${ev.event}${ev.detail ? ` (${ev.detail})` : ""}. ${cue}`,
							display: true,
						},
						{ deliverAs: "steer", triggerTurn: true },
					);
				}
			} catch {
				// Never throw from a watch callback — the next event retries
			}
		});
	});

	pi.on("session_shutdown", async () => {
		watcher?.close();
		watcher = undefined;
	});

	// User input resets the gate fingerprint — once a human has intervened, the gate re-earns the right to
	pi.on("input", async () => {
		lastNudgeFingerprint = "";
		return { action: "continue" as const };
	});

	// The no-polling rule enforced at the execution surface — one prompt line wasn't enough: a codex
	// auditor was observed live running a 900-second polling loop. Discipline is a gate, not a prompt.
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash") return;
		const cmd = String((event.input as { command?: string })?.command ?? "");
		if (/status\.jsonl/.test(cmd) && /\b(while|until|sleep)\b/.test(cmd)) {
			return {
				block: true,
				reason:
					"Polling loops over the status ledger are forbidden — worker events (leaf: stopped, pm-type: ready_for_verify) are injected automatically by the harness. A one-shot cat/tail is allowed. If there is something to wait for, just end your turn.",
			};
		}
	});

	// ── 3. Tools ───────────────────────────────────────────────────────────
	pi.registerTool({
		name: "set_criteria",
		label: "Set Criteria",
		description:
			"Register the work ledger's success criteria in machine-checkable form. check is a shell command; exit 0 = pass. Criteria change only when the ledger is revised.",
		parameters: Type.Object({
			criteria: Type.Array(
				Type.Object({
					id: Type.String({ description: "short kebab-case id" }),
					desc: Type.String({ description: "criterion description (the ledger's sentence)" }),
					check: Type.String({ description: "shell verification command, exit 0 = pass" }),
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const existing = readJson<Criterion[]>(criteriaFile(ctx.cwd), []);
			const merged: Criterion[] = params.criteria.map((c) => {
				const prev = existing.find((e) => e.id === c.id && e.check === c.check);
				return prev ?? { ...c, status: "pending", fails: 0 };
			});
			writeJson(criteriaFile(ctx.cwd), merged);
			lastNudgeFingerprint = "";
			return {
				content: [{ type: "text", text: `${merged.length} criteria registered: ${merged.map((c) => c.id).join(", ")}` }],
				details: {},
			};
		},
	});

	pi.registerTool({
		name: "spawn_worker",
		label: "Spawn Worker",
		description:
			"Create a worker agent in a tmux pane and deliver its brief. The brief carries intent, contract, and success criteria — no line-by-line implementation instructions. V1 available harness: claude (Claude Code).",
		parameters: Type.Object({
			name: Type.String({ description: "worker name (kebab-case)" }),
			role: Type.String({ description: "role (e.g. pm, backend, frontend, qa)" }),
			harness: StringEnum(["claude"] as const),
			brief: Type.String({ description: "full brief — intent, contract, this node's success criteria. For a pm role, include a copy of the confirmed ledger and the scope of its coordination authority" }),
			model: Type.Optional(Type.String({ description: "claude --model value (e.g. opus, fable). Decided by roster temperament matching — pm is usually opus/fable" })),
			workdir: Type.Optional(Type.String({ description: "worker working directory (default: current project)" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const name = sanitizeName(params.name);
			const cwd = params.workdir ? path.resolve(ctx.cwd, params.workdir) : ctx.cwd;
			const briefPath = path.join(simplyDir(ctx.cwd), "briefs", `${name}.md`);
			fs.mkdirSync(path.dirname(briefPath), { recursive: true });
			fs.writeFileSync(briefPath, params.brief);

			const settings = path.join(SIMPLY_HOME, "hooks", "worker-settings.json");
			const status = statusFile(ctx.cwd);
			const modelFlag = params.model ? ` --model ${params.model.replace(/[^a-zA-Z0-9._-]/g, "")}` : "";
			// Assembled as one tmux shell-command line — the paths are values we control, so simple quoting suffices
			const skillHint =
				params.role === "pm" ? " Load the simply-pm skill first — your fleet authority and signal protocol are there." : "";
			const cmd = `SIMPLY_NODE='${name}' SIMPLY_STATUS_FILE='${status}' claude${modelFlag} --settings '${settings}' 'You are worker ${name} (${params.role}).${skillHint} Read the brief at ${briefPath} and carry it out. If anything is ambiguous, do not guess — leave a question in the brief file and stop.'`;
			// SEOL layout convention: window 0 is the auditor+pm command channel; subordinates go to the workers window
			const isPmRole = params.role.toLowerCase().startsWith("pm");
			let spawn: Awaited<ReturnType<typeof pi.exec>>;
			if (isPmRole) {
				spawn = await pi.exec("tmux", ["split-window", "-d", "-P", "-F", "#{pane_id}", "-c", cwd, cmd]);
			} else {
				const check = await pi.exec("bash", ["-lc", "tmux list-windows -F '#{window_name}' | grep -qx workers; echo rc=$?"]);
				const exists = check.stdout.includes("rc=0");
				spawn = exists
					? await pi.exec("tmux", ["split-window", "-d", "-P", "-F", "#{pane_id}", "-t", "workers", "-c", cwd, cmd])
					: await pi.exec("tmux", ["new-window", "-d", "-P", "-F", "#{pane_id}", "-n", "workers", "-c", cwd, cmd]);
			}
			if (spawn.code !== 0) {
				throw new Error(`tmux worker spawn failed: ${spawn.stderr.trim() || "check that this is running inside a tmux session"}`);
			}
			const pane = spawn.stdout.trim();
			await pi.exec("tmux", ["select-pane", "-t", pane, "-T", name]);
			if (!isPmRole) {
				await pi.exec("tmux", ["select-layout", "-t", "workers", "tiled"]);
			}

			const nodes = readJson<Record<string, NodeInfo>>(nodesFile(ctx.cwd), {});
			nodes[name] = { pane, role: params.role, harness: params.harness, brief: briefPath };
			writeJson(nodesFile(ctx.cwd), nodes);
			appendStatus(ctx.cwd, { node: name, event: "spawned", detail: `${params.role} @ ${pane}` });

			return {
				content: [
					{
						type: "text",
						text: `Worker '${name}' (${params.role}) created — pane ${pane}. Completion is detected via the status ledger. Don't wait for a reply; do the next thing.`,
					},
				],
				details: { pane, brief: briefPath },
			};
		},
	});

	pi.registerTool({
		name: "send_to_worker",
		label: "Send to Worker",
		description:
			"Inject a message into a running worker pane. Only for genuinely necessary conversation — contract agreement, course correction (never for status checks; status arrives via the ledger).",
		parameters: Type.Object({
			name: Type.String(),
			message: Type.String({ description: "one paragraph. Newlines are replaced with spaces" }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const nodes = readJson<Record<string, NodeInfo>>(nodesFile(ctx.cwd), {});
			const node = nodes[sanitizeName(params.name)];
			if (!node) throw new Error(`No worker '${params.name}'. Registered: ${Object.keys(nodes).join(", ") || "(none)"}`);
			const text = `[simply from:pm] ${params.message.replace(/\s*\n\s*/g, " ")}`;
			const typeRes = await pi.exec("tmux", ["send-keys", "-t", node.pane, "-l", "--", text]);
			if (typeRes.code !== 0) throw new Error(`Injection failed: ${typeRes.stderr.trim()}`);
			await new Promise((r) => setTimeout(r, 400));
			await pi.exec("tmux", ["send-keys", "-t", node.pane, "Enter"]);
			return { content: [{ type: "text", text: `Delivered to '${params.name}'.` }], details: {} };
		},
	});

	pi.registerTool({
		name: "verify",
		label: "Verify",
		description:
			"Run the check commands of registered success criteria and record pass/fail. Only this tool can write pass — never mark a criterion passed from a worker's self-report or an impression of the code.",
		parameters: Type.Object({
			ids: Type.Optional(Type.Array(Type.String(), { description: "omit for all" })),
		}),
		async execute(_id, params, signal, onUpdate, ctx) {
			const all = readJson<Criterion[]>(criteriaFile(ctx.cwd), []);
			if (all.length === 0) throw new Error("No criteria registered. set_criteria first.");
			const targets = params.ids?.length ? all.filter((c) => params.ids?.includes(c.id)) : all;
			// A failure while subcontractors are in flight is not an attempt failure — record the status
			// but don't count it. (In the live three-tier run, one early verify + one post-completion
			// verify produced a false escalation. The more precise rule is "was there a new work event
			// between the failures" — upgrade to that when the need is actually observed.)
			const anyInFlight =
				inFlightNodes(ctx.cwd, readJson<Record<string, NodeInfo>>(nodesFile(ctx.cwd), {}), statusFile(ctx.cwd)).length >
				0;
			const lines: string[] = [];
			for (const c of targets) {
				onUpdate?.({ content: [{ type: "text", text: `checking ${c.id}...` }], details: {} });
				const res = await pi.exec("bash", ["-lc", c.check], { signal, timeout: 180_000 });
				if (res.code === 0) {
					c.status = "pass";
					c.lastError = undefined;
					lines.push(`✅ ${c.id} — pass`);
				} else {
					c.status = "fail";
					if (!anyInFlight) c.fails += 1;
					c.lastError = (res.stderr || res.stdout).slice(-800);
					lines.push(
						`❌ ${c.id} — fail${anyInFlight ? " (subcontract in flight — not counted as an attempt)" : ` #${c.fails}`}\n${c.lastError}`,
					);
				}
			}
			writeJson(criteriaFile(ctx.cwd), all);
			lastNudgeFingerprint = ""; // state changed, so the gate may intervene again
			const escalated = all.filter((c) => c.status === "fail" && c.fails >= 2);
			if (escalated.length > 0) {
				appendStatus(ctx.cwd, { node: "auditor", event: "escalation", detail: escalated.map((c) => c.id).join(",") });
				lines.push(
					`\n⚠️ Same criterion failed 2+ times: ${escalated.map((c) => c.id).join(", ")} — no blind retries. Summarize what was learned and escalate to the user.`,
				);
			}
			return { content: [{ type: "text", text: lines.join("\n") }], details: { criteria: all } };
		},
	});

	pi.registerTool({
		name: "request_qa",
		label: "Request QA",
		description:
			"Present a QA package to the user instead of declaring completion. Map each criterion to a way the user can check it directly. Completion exists only after user QA.",
		parameters: Type.Object({
			items: Type.Array(
				Type.Object({
					criterion: Type.String({ description: "criterion description" }),
					how: Type.String({ description: "how the user checks it — a command, a URL, something to look at" }),
				}),
			),
			notes: Type.Optional(Type.String({ description: "known limitations / open items" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const crit = readJson<Criterion[]>(criteriaFile(ctx.cwd), []);
			const auto = crit.map((c) => `  ${c.status === "pass" ? "✅" : c.status === "fail" ? "❌" : "⏳"} ${c.id}: ${c.desc}`);
			const manual = params.items.map((i, n) => `  ${n + 1}. ${i.criterion}\n     → check: ${i.how}`);
			const pkg = [
				"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
				" QA package — user confirmation requested before completion",
				"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
				"Machine verification results:",
				...auto,
				"",
				"Please check directly:",
				...manual,
				...(params.notes ? ["", `Notes: ${params.notes}`] : []),
				"",
				"Your feedback leads to a ledger revision (fix loop) or wrap-up.",
				"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
			].join("\n");
			qaRequested = true;
			appendStatus(ctx.cwd, { node: "auditor", event: "qa_requested" });
			return { content: [{ type: "text", text: pkg }], details: { qaRequested: true } };
		},
	});

	// ── 4. Settle gate — physically preventing "stopped because the process felt sufficient" ──
	pi.on("agent_settled", async (_event, ctx) => {
		// print/json one-shot modes have no interaction to receive QA, and injecting during teardown makes stale ctx
		if (ctx.mode !== "tui" && ctx.mode !== "rpc") return;
		const crit = readJson<Criterion[]>(criteriaFile(ctx.cwd), []);
		if (crit.length === 0) return;
		const failing = crit.filter((c) => c.status === "fail");
		const pending = crit.filter((c) => c.status === "pending");
		const escalated = failing.filter((c) => c.fails >= 2);
		const fingerprint = JSON.stringify({ s: crit.map((c) => [c.id, c.status, c.fails]), qa: qaRequested });
		if (fingerprint === lastNudgeFingerprint) return; // never intervene twice on the same state

		if (escalated.length > 0) return; // verify already announced the escalation — the user's turn
		// Stay silent while subcontractors are in flight — delegating-and-waiting is the correct state,
		// and nudging causes early verifies that inflate fails into false escalations (a defect observed
		// live in the three-tier run). The watcher wakes us on the completion signal.
		const inFlight = inFlightNodes(
			ctx.cwd,
			readJson<Record<string, NodeInfo>>(nodesFile(ctx.cwd), {}),
			statusFile(ctx.cwd),
		);
		if (inFlight.length > 0) return;
		try {
			if (failing.length > 0 || pending.length > 0) {
				lastNudgeFingerprint = fingerprint;
				pi.sendUserMessage(
					`[simply gate] Stopped with unmet criteria: ${[...failing, ...pending].map((c) => `${c.id}(${c.status})`).join(", ")}. Continue the work against the ledger and re-verify. If you judge it unreachable, report to the user with your reasoning.`,
				);
				return;
			}
			if (!qaRequested) {
				lastNudgeFingerprint = fingerprint;
				pi.sendUserMessage(
					`[simply gate] All criteria pass. Do not declare completion — present a QA package via request_qa. Completion exists only after user QA.`,
				);
			}
		} catch {
			// If injection is impossible (teardown race etc.), pass silently — the next settle retries
		}
	});
}
