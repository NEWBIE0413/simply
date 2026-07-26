/**
 * simply — SEOL 하네스 PM extension (V1)
 *
 * 원칙: 판단은 모델에, 루프·관측·게이트는 코드에.
 *  - 작업 원장(.simply/LEDGER.md)을 매 턴 시스템 프롬프트에 상주시킨다
 *  - 워커 완료는 status ledger watch로 감지해 델타만 PM에 주입한다 (무답변 프로토콜)
 *  - "pass"는 verify 도구만 쓸 수 있다 (자기 보고 불신)
 *  - 전 기준 통과 후 QA 패키지 제시 없이는 완료로 정착하지 못하게 settle 게이트가 재투입한다
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

/** 노드별 마지막 이벤트 (status ledger 재생) */
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

/** 아직 계약이 끝나지 않은 노드들 — pm형 노드는 명시적 ready_for_verify가 있어야 종료로 본다.
 *  Stop hook은 "작업 완료"가 아니라 "턴 종료"에 발화하므로(라이브에서 관측된 결함),
 *  위임하고 대기하는 pm의 stopped는 진행 중으로 취급해야 한다. */
function inFlightNodes(cwd: string, nodes: Record<string, NodeInfo>, statusPath: string): string[] {
	const last = lastEvents(statusPath);
	return Object.entries(nodes)
		.filter(([name, info]) => {
			const ev = last[name];
			if (!ev) return false; // 기록 없는 노드는 판단 불가 — 막지 않는다
			const isPm = info.role.toLowerCase().startsWith("pm");
			return isPm ? ev !== "ready_for_verify" : ev !== "stopped";
		})
		.map(([name]) => name);
}

export default function simply(pi: ExtensionAPI) {
	let watcher: fs.FSWatcher | undefined;
	let statusOffset = 0;
	let qaRequested = false;
	// settle 게이트가 같은 상태로 무한 재투입하는 것을 막는 지문 — 상태가 변해야 다시 개입한다
	let lastNudgeFingerprint = "";

	const criteriaFile = (cwd: string) => path.join(simplyDir(cwd), "criteria.json");
	const nodesFile = (cwd: string) => path.join(simplyDir(cwd), "nodes.json");
	const statusFile = (cwd: string) => path.join(simplyDir(cwd), "status.jsonl");
	const ledgerFile = (cwd: string) => path.join(simplyDir(cwd), "LEDGER.md");

	// ── 1. 작업 원장 + roster 상주 ──────────────────────────────────────────
	// 시스템 프롬프트에 붙이는 이유: 세션이 자라지 않고, 컴팩션의 영향도 받지 않는다.
	pi.on("before_agent_start", async (event, ctx) => {
		const parts: string[] = [];
		// 라이브 E2E에서 PM이 스폰 직후 bash 폴링 루프로 워커를 기다리는 baseline 실패를 관측 — 그 관측에 근거한 한 줄
		parts.push(
			`<simply_protocol>워커의 완료·상태 변화는 하네스가 status ledger를 감지해 자동으로 주입해준다 — leaf 워커는 stopped, pm형 노드는 ready_for_verify가 완료 신호다(pm의 stopped는 턴 종료 노이즈라 주입되지 않는다). 반복 bash로 ledger나 워커 산출물을 폴링하며 기다리지 마라 — 주입과 중복되고 토큰만 태운다. 스폰이나 전달 후에는 다음 할 일을 하거나 턴을 끝내면 된다.</simply_protocol>`,
		);
		const rosterPath = path.join(SIMPLY_HOME, "roster.md");
		if (fs.existsSync(rosterPath)) {
			parts.push(`<roster>\n${fs.readFileSync(rosterPath, "utf8")}\n</roster>`);
		}
		const lp = ledgerFile(ctx.cwd);
		if (fs.existsSync(lp)) {
			parts.push(
				`<work_ledger note="이 프로젝트의 '완료가 무엇인가'에 대한 단일 진실. 모든 판단은 이 원장 기준. 개정은 사용자 입력으로만.">\n${fs.readFileSync(lp, "utf8")}\n</work_ledger>`,
			);
		} else {
			parts.push(
				`<simply note="아직 작업 원장이 없다. 목표가 주어지면 결과(관찰 가능한 완성 모습)와 성공 기준을 인터뷰로 구체화해 .simply/LEDGER.md 에 기록하고, 기계 검증 가능한 기준은 set_criteria 로 등록하라.">simplepowers: 결과 인터뷰 → 경로는 스스로 → 기준 통과까지 루프 → QA 후 완료.</simply>`,
			);
		}
		return { systemPrompt: `${event.systemPrompt}\n\n${parts.join("\n\n")}` };
	});

	// ── 2. status ledger watch → 델타만 PM에 주입 ─────────────────────────
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
					// 자기 기록(스폰, qa_requested, escalation)은 되돌려주지 않는다 — 워커 발신 이벤트만 델타로 주입
					if (ev.event === "spawned" || ev.node === "auditor") continue;
					// pm형 노드의 stopped는 완료가 아니라 턴 종료다(위임 후 대기 중일 수 있음 — 라이브에서 관측).
					// pm의 완료는 명시적 ready_for_verify 신호로만 인정한다.
					const nodeInfo = readJson<Record<string, NodeInfo>>(nodesFile(ctx.cwd), {})[String(ev.node)];
					const isPmNode = nodeInfo?.role?.toLowerCase().startsWith("pm") ?? false;
					if (isPmNode && ev.event === "stopped") continue;
					const cue =
						ev.event === "ready_for_verify"
							? "계약 완수 신호다 — verify로 검증하고 다음을 결정하라."
							: "해당 노드의 기준을 verify로 검증하고 다음 행동을 결정하라.";
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
				// watch 콜백에서 던지면 안 된다 — 다음 이벤트에서 재시도된다
			}
		});
	});

	pi.on("session_shutdown", async () => {
		watcher?.close();
		watcher = undefined;
	});

	// 유저 입력이 오면 게이트 지문을 리셋 — 사람이 개입했으면 다시 개입할 자격이 생긴다
	pi.on("input", async () => {
		lastNudgeFingerprint = "";
		return { action: "continue" as const };
	});

	// 폴링 금지의 실행면 강제 — 프롬프트 한 줄로는 codex auditor가 900초 폴링을 돌리는 것이
	// 라이브에서 관측됐다. 규율은 프롬프트가 아니라 게이트로 막는다.
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash") return;
		const cmd = String((event.input as { command?: string })?.command ?? "");
		if (/status\.jsonl/.test(cmd) && /\b(while|until|sleep)\b/.test(cmd)) {
			return {
				block: true,
				reason:
					"status ledger 폴링 루프는 금지다 — 워커 이벤트(leaf: stopped, pm형: ready_for_verify)는 하네스가 자동 주입한다. 한 번 읽는 cat/tail은 허용. 기다릴 일이 있으면 그냥 턴을 끝내라.",
			};
		}
	});

	// ── 3. 도구들 ──────────────────────────────────────────────────────────
	pi.registerTool({
		name: "set_criteria",
		label: "Set Criteria",
		description:
			"작업 원장의 성공 기준을 기계 검증 가능한 형태로 등록한다. check는 shell 명령이고 exit 0이 pass다. 기준은 원장 개정 시에만 바뀐다.",
		parameters: Type.Object({
			criteria: Type.Array(
				Type.Object({
					id: Type.String({ description: "짧은 kebab-case id" }),
					desc: Type.String({ description: "기준 설명 (원장의 문장)" }),
					check: Type.String({ description: "shell 검증 명령, exit 0 = pass" }),
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
				content: [{ type: "text", text: `기준 ${merged.length}개 등록됨: ${merged.map((c) => c.id).join(", ")}` }],
				details: {},
			};
		},
	});

	pi.registerTool({
		name: "spawn_worker",
		label: "Spawn Worker",
		description:
			"tmux pane에 워커 에이전트를 생성하고 브리프를 전달한다. 브리프에는 의도·계약·성공 기준을 담고, 줄 단위 구현 지시는 하지 않는다. V1 가용 하네스: claude(Claude Code).",
		parameters: Type.Object({
			name: Type.String({ description: "워커 이름 (kebab-case)" }),
			role: Type.String({ description: "역할 (예: pm, backend, frontend, qa)" }),
			harness: StringEnum(["claude"] as const),
			brief: Type.String({ description: "브리프 전문 — 의도, 계약, 이 노드의 성공 기준. pm 역할이면 확정 원장 사본과 조율 권한 범위를 포함하라" }),
			model: Type.Optional(Type.String({ description: "claude --model 값 (예: opus, fable). roster 성향 매칭으로 결정 — pm은 보통 opus/fable" })),
			workdir: Type.Optional(Type.String({ description: "워커 작업 디렉터리 (기본: 현재 프로젝트)" })),
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
			// tmux shell-command 한 줄로 조립 — 경로들은 우리가 통제하는 값이라 단순 인용으로 충분
			const skillHint =
				params.role === "pm" ? " 먼저 simply-pm 스킬을 로드하세요 — 함대 운영 완장과 신호 규약이 거기 있습니다." : "";
			const cmd = `SIMPLY_NODE='${name}' SIMPLY_STATUS_FILE='${status}' claude${modelFlag} --settings '${settings}' '당신은 워커 ${name}(${params.role})입니다.${skillHint} ${briefPath} 의 브리프를 읽고 그대로 수행하세요. 모호하면 추측하지 말고 브리프 파일에 질문을 남기고 멈추세요.'`;
			// SEOL 레이아웃 관례: window 0은 auditor+pm 지휘 채널, 하위 에이전트는 workers window로 몰아넣는다
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
				throw new Error(`tmux 워커 스폰 실패: ${spawn.stderr.trim() || "tmux 세션 안에서 실행 중인지 확인"}`);
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
						text: `워커 '${name}'(${params.role}) 생성됨 — pane ${pane}. 완료는 status ledger로 감지된다. 답변을 기다리지 말고 다음 일을 하라.`,
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
			"실행 중인 워커 pane에 메시지를 주입한다. 계약 합의·방향 수정 등 꼭 필요한 대화에만 쓴다 (상태 확인 용도 금지 — 상태는 ledger로 온다).",
		parameters: Type.Object({
			name: Type.String(),
			message: Type.String({ description: "한 문단. 개행은 공백으로 치환된다" }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const nodes = readJson<Record<string, NodeInfo>>(nodesFile(ctx.cwd), {});
			const node = nodes[sanitizeName(params.name)];
			if (!node) throw new Error(`워커 '${params.name}' 없음. 등록된: ${Object.keys(nodes).join(", ") || "(없음)"}`);
			const text = `[simply from:pm] ${params.message.replace(/\s*\n\s*/g, " ")}`;
			const typeRes = await pi.exec("tmux", ["send-keys", "-t", node.pane, "-l", "--", text]);
			if (typeRes.code !== 0) throw new Error(`주입 실패: ${typeRes.stderr.trim()}`);
			await new Promise((r) => setTimeout(r, 400));
			await pi.exec("tmux", ["send-keys", "-t", node.pane, "Enter"]);
			return { content: [{ type: "text", text: `'${params.name}'에게 전달됨.` }], details: {} };
		},
	});

	pi.registerTool({
		name: "verify",
		label: "Verify",
		description:
			"등록된 성공 기준의 check 명령을 실행해 pass/fail을 기록한다. pass는 이 도구만 쓸 수 있다 — 워커의 자기 보고나 코드 인상으로 기준을 통과 처리하지 마라.",
		parameters: Type.Object({
			ids: Type.Optional(Type.Array(Type.String(), { description: "생략 시 전체" })),
		}),
		async execute(_id, params, signal, onUpdate, ctx) {
			const all = readJson<Criterion[]>(criteriaFile(ctx.cwd), []);
			if (all.length === 0) throw new Error("등록된 기준이 없다. set_criteria 먼저.");
			const targets = params.ids?.length ? all.filter((c) => params.ids?.includes(c.id)) : all;
			// 하청이 진행 중일 때의 실패는 '시도 실패'가 아니다 — 상태만 기록하고 fails를 세지 않는다.
			// (라이브 3단 위계에서 조기 verify 1회 + 완료 후 1회 = 가짜 에스컬레이션이 관측됨.
			//  더 정밀한 방식은 "실패 사이에 새 작업 이벤트가 있었는가"지만, 그 필요가 관측되면 그때 올린다)
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
						`❌ ${c.id} — fail${anyInFlight ? " (하청 진행 중 — 시도 실패로 세지 않음)" : ` #${c.fails}`}\n${c.lastError}`,
					);
				}
			}
			writeJson(criteriaFile(ctx.cwd), all);
			lastNudgeFingerprint = ""; // 상태가 변했으니 게이트가 다시 개입할 수 있다
			const escalated = all.filter((c) => c.status === "fail" && c.fails >= 2);
			if (escalated.length > 0) {
				appendStatus(ctx.cwd, { node: "auditor", event: "escalation", detail: escalated.map((c) => c.id).join(",") });
				lines.push(
					`\n⚠️ 동일 기준 2회 이상 실패: ${escalated.map((c) => c.id).join(", ")} — 맹목 재시도 금지. 배운 것을 정리해 사용자에게 에스컬레이션하라.`,
				);
			}
			return { content: [{ type: "text", text: lines.join("\n") }], details: { criteria: all } };
		},
	});

	pi.registerTool({
		name: "request_qa",
		label: "Request QA",
		description:
			"완료 선언 대신 사용자에게 QA 패키지를 제시한다. 기준별로 사용자가 직접 확인할 방법을 매핑한다. 완료는 사용자 QA 후에만 성립한다.",
		parameters: Type.Object({
			items: Type.Array(
				Type.Object({
					criterion: Type.String({ description: "기준 설명" }),
					how: Type.String({ description: "사용자가 확인하는 방법 — 명령, URL, 눈으로 볼 것" }),
				}),
			),
			notes: Type.Optional(Type.String({ description: "알려진 한계·미결 사항" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const crit = readJson<Criterion[]>(criteriaFile(ctx.cwd), []);
			const auto = crit.map((c) => `  ${c.status === "pass" ? "✅" : c.status === "fail" ? "❌" : "⏳"} ${c.id}: ${c.desc}`);
			const manual = params.items.map((i, n) => `  ${n + 1}. ${i.criterion}\n     → 확인: ${i.how}`);
			const pkg = [
				"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
				" QA 패키지 — 완료 선언 전 사용자 확인 요청",
				"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
				"기계 검증 결과:",
				...auto,
				"",
				"직접 확인 요청:",
				...manual,
				...(params.notes ? ["", `참고: ${params.notes}`] : []),
				"",
				"피드백을 주시면 원장 개정(수정 루프) 또는 마무리로 진행합니다.",
				"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
			].join("\n");
			qaRequested = true;
			appendStatus(ctx.cwd, { node: "auditor", event: "qa_requested" });
			return { content: [{ type: "text", text: pkg }], details: { qaRequested: true } };
		},
	});

	// ── 4. settle 게이트 — "과정이 충분해 보여서 멈춤"의 물리적 방지 ────────
	pi.on("agent_settled", async (_event, ctx) => {
		// print/json 원샷 모드엔 QA를 받을 상호작용이 없고, teardown 중 주입은 stale ctx를 만든다
		if (ctx.mode !== "tui" && ctx.mode !== "rpc") return;
		const crit = readJson<Criterion[]>(criteriaFile(ctx.cwd), []);
		if (crit.length === 0) return;
		const failing = crit.filter((c) => c.status === "fail");
		const pending = crit.filter((c) => c.status === "pending");
		const escalated = failing.filter((c) => c.fails >= 2);
		const fingerprint = JSON.stringify({ s: crit.map((c) => [c.id, c.status, c.fails]), qa: qaRequested });
		if (fingerprint === lastNudgeFingerprint) return; // 같은 상태로는 두 번 개입하지 않는다

		if (escalated.length > 0) return; // 에스컬레이션은 verify가 이미 알렸다 — 사용자 차례
		// 하청이 진행 중이면 침묵한다 — 위임 후 대기는 올바른 상태이고, 재촉하면 조기 verify로
		// fails만 부풀어 가짜 에스컬레이션이 된다(라이브 3단 위계에서 관측된 결함). 완료 신호는 watcher가 깨운다.
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
					`[simply gate] 미완 기준이 있는 채로 멈췄다: ${[...failing, ...pending].map((c) => `${c.id}(${c.status})`).join(", ")}. 원장 기준으로 작업을 계속하고 verify로 재검증하라. 도달 불가능하다고 판단되면 근거와 함께 사용자에게 보고하라.`,
				);
				return;
			}
			if (!qaRequested) {
				lastNudgeFingerprint = fingerprint;
				pi.sendUserMessage(
					`[simply gate] 모든 기준 통과. 완료를 선언하지 말고 request_qa로 QA 패키지를 제시하라 — 완료는 사용자 QA 후에만 성립한다.`,
				);
			}
		} catch {
			// teardown 경합 등으로 주입이 불가능하면 조용히 넘어간다 — 다음 settle에서 다시 시도된다
		}
	});
}
