# pi 하네스 엔지니어링 레퍼런스

> 대상: `@earendil-works/pi-coding-agent` **0.82.1** (2026-07-27 설치본 기준)
> 근거: 패키지 동봉 공식 docs 32편 전체 + 소스맵에서 추출한 원본 TypeScript(`~/cld/pi-src/`, 176 files) + examples/extensions 81종.
> 목적: simplepowers 철학(결과 위주 개발) 위에 루프·그래프 엔지니어링을 얹기 위한 ground truth.

---

## 0. pi의 설계 철학 — 우리와의 접점

pi는 "minimal terminal coding harness"다. 코어를 작게 유지하고 **MCP, 서브에이전트, 권한 팝업, plan mode, todo, 백그라운드 bash를 의도적으로 코어에서 제외**했다. 공식 입장: "There's many ways to do this. Spawn pi instances via tmux, or build your own with extensions."

→ 우리가 만들 루프/그래프 하네스는 pi가 일부러 비워둔 자리에 정확히 들어간다. 확장 수단은 4종: **extensions(TS 코드) / skills(markdown) / prompt templates(markdown) / packages(배포 묶음)**.

## 1. 프롬프트 스택 (source: `core/system-prompt.ts`)

기본 시스템 프롬프트는 **~20줄**이다. 내용: 역할 한 문장 + Available tools 목록(도구별 한 줄 snippet) + Guidelines(기본 2줄: "Be concise", "Show file paths clearly") + pi 문서 위치 안내. Claude Code의 거대 preset과 달리 보존할 내장 워크플로우 가이드가 거의 없다.

조립 순서 (`buildSystemPrompt`):

```
1. 기본 프롬프트  (또는 SYSTEM.md / --system-prompt 로 완전 교체)
2. + APPEND_SYSTEM.md / --append-system-prompt
3. + <project_context> — AGENTS.md/CLAUDE.md 들 (<project_instructions path=...> 로 래핑)
4. + <available_skills> XML (read 도구가 있을 때만)
5. + Current working directory
```

파일 위치:
| 파일 | 전역 | 프로젝트 |
|---|---|---|
| 시스템 프롬프트 교체 | `~/.pi/agent/SYSTEM.md` | `.pi/SYSTEM.md` |
| 시스템 프롬프트 추가 | `~/.pi/agent/APPEND_SYSTEM.md` | `.pi/APPEND_SYSTEM.md` |
| 컨텍스트(doctrine) | `~/.pi/agent/AGENTS.md` | cwd→상위 디렉터리의 `AGENTS.md`/`CLAUDE.md` |

턴 단위 개입: `before_agent_start` 이벤트가 `systemPrompt`를 체인으로 재작성 가능, `context` 이벤트가 매 LLM 호출 직전 메시지 배열을 재작성 가능.

**계층 배치 판단(우리 철학 매핑):** 메타 원칙 → APPEND_SYSTEM.md (단, baseline 실패 관찰 후에만 한 줄씩). 프로젝트 doctrine → AGENTS.md. 역할 모듈 → skills. 실행면 통제 → `--tools`/`-xt`/extensions. 루프·그래프 → extensions + RPC/SDK.

## 2. 리소스 계층

### Skills (Agent Skills 표준 구현, lenient)
- 로드 경로: 전역 `~/.pi/agent/skills/`, `~/.agents/skills/` / 프로젝트(trust 후) `.pi/skills/`, `.agents/skills/`(cwd~repo root) / 패키지 / settings `skills` 배열 / `--skill <path>`
- **settings의 `skills` 배열에 `~/.claude/skills` 를 넣으면 Claude Code 스킬 공유 가능** (현재는 simplepowers만 심링크로 연결됨)
- frontmatter: `name`(필수), `description`(필수, 없으면 로드 안 됨, max 1024), `allowed-tools`(실험적), `disable-model-invocation`(true면 시스템 프롬프트에서 숨김 → `/skill:name` 전용)
- 발견: 시스템 프롬프트에 name+description만 XML로 → 매칭 시 모델이 `read`로 본문 로드(항상 하진 않음 — `/skill:name`으로 강제 가능, `enableSkillCommands: true` 기본)
- 이름 충돌: 먼저 발견된 쪽 승리(경고)

### Prompt templates
- `~/.pi/agent/prompts/*.md`, `.pi/prompts/*.md`(non-recursive), `/이름`으로 확장
- 인자: `$1` `$2`, `$@`/`$ARGUMENTS`, `${1:-default}`, `${@:N:L}` 슬라이싱, frontmatter `description`/`argument-hint`

### Packages
- `pi install npm:@foo/bar@1.0.0 | git:github.com/u/r@v1 | <로컬경로>` (`-l`이면 프로젝트 스코프, `.pi/settings.json`에 기록·자동 설치)
- package.json `pi` 키로 extensions/skills/prompts/themes 선언, 관례 디렉터리도 인식
- 코어 패키지들(`pi-ai`, `pi-agent-core`, `pi-coding-agent`, `pi-tui`, `typebox`)은 반드시 peerDependencies `"*"`
- settings 객체형 엔트리로 리소스 필터링(글롭, `!`, `+`, `-`), `pi config` TUI로 on/off

### Settings (`~/.pi/agent/settings.json` ← `.pi/settings.json` deep-merge, 프로젝트 per-key 승리)
하네스 관련 핵심 키: `defaultProvider`/`defaultModel`/`defaultThinkingLevel`, `thinkingBudgets`, `compaction.{enabled,reserveTokens(16384),keepRecentTokens(20000)}`, `retry.{enabled,maxRetries(3),...}`, `steeringMode`/`followUpMode`(`one-at-a-time`|`all`), `defaultProjectTrust`, `sessionDir`, `enabledModels`, `packages`/`extensions`/`skills`/`prompts`/`themes` 배열, `enableSkillCommands`, `npmCommand`, `shellCommandPrefix`.

### Project Trust — 헤드리스 최대 함정
- 인터랙티브: 프로젝트 로컬 리소스가 있으면 시작 시 물어봄 → `~/.pi/agent/trust.json`
- **`-p`/`--mode json`/`--mode rpc`는 절대 묻지 않음.** 저장된 결정이 없으면 `defaultProjectTrust` 적용: `ask`(기본)와 `never`는 **조용히 프로젝트 리소스 무시**(extension·skill·settings 미로드), `always`만 신뢰. per-run 오버라이드: `--approve`/`-a`, `--no-approve`/`-na`
- AGENTS.md/CLAUDE.md 컨텍스트 파일은 trust와 무관하게 항상 로드
- 오케스트레이터는 반드시 `-a`를 넘기거나 trust.json을 사전 시드할 것

## 3. Extension 시스템 (하네스의 본체)

### 골격
```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: ExtensionAPI) { /* pi.on(...), pi.registerTool(...) */ }
```
- jiti로 TS 무컴파일 로드. 위치: `~/.pi/agent/extensions/*.ts|*/index.ts`, `.pi/extensions/`(trust 후), `-e <path>`, settings/packages
- async factory는 `session_start` 전에 await됨. **factory에서 백그라운드 리소스 시작 금지**(세션 없는 invocation 존재) — `session_start`에서 시작, 멱등한 `session_shutdown`에서 정리
- 이벤트 핸들러는 로드 순서로 체인. `.pi` 하드코딩 대신 `CONFIG_DIR_NAME`, `~/.pi/agent` 대신 `getAgentDir()`

### 이벤트 카탈로그 (개입 가능 여부 중심)

**차단/변형 가능:**
| 이벤트 | 개입 |
|---|---|
| `input` | `{action:"transform",text}` 체인 / `{action:"handled"}` 삼킴. `event.source: "interactive"\|"rpc"\|"extension"` — 자기 주입 메시지 재처리 방지 가드 |
| `before_agent_start` | `{message:{customType,content,display}}` 영구 컨텍스트 주입 + `{systemPrompt}` 턴 단위 재작성(체인) |
| `context` | 매 LLM 호출 직전, deep copy된 `messages` 반환으로 교체 |
| `tool_call` | `{block:true, reason}` 차단. `event.input` 직접 변형 가능(재검증 없음). 핸들러 에러 = 차단(fail-safe) |
| `tool_result` | 부분 패치 `{content?,details?,isError?,usage?}` 미들웨어 체인 |
| `message_end` | 같은 role로 메시지 교체 |
| `user_bash` | `!` 명령 백엔드 교체/결과 대체 |
| `before_provider_headers` / `before_provider_request` | 헤더 in-place 변형 / payload 교체 |
| `session_before_switch/fork/compact/tree` | `{cancel:true}` 또는 결과 대체(컴팩션 요약 등) |
| `project_trust` | `{trusted:"yes"\|"no"\|"undecided", remember?}` 필수 반환, 첫 yes/no 승리 |
| `resources_discover` | `{skillPaths?,promptPaths?,themePaths?}` 동적 리소스 루트 추가 |

**관찰 전용:** `session_start/shutdown/info_changed`, `agent_start`, `agent_end`(messages, 아직 retry 가능), **`agent_settled`(진짜 완료 신호)**, `turn_start/end`, `message_start/update`, `tool_execution_start/update/end`, `session_compact/tree`, `model_select`, `thinking_level_select`, `after_provider_response`.

### ExtensionAPI 주요 메서드
- `pi.on(event, handler)` / `pi.registerTool(def)`(런타임 등록도 즉시 반영) / `pi.registerCommand(name,{handler(args, cmdCtx)})` / `pi.registerShortcut` / `pi.registerFlag`
- **`pi.sendUserMessage(content, {deliverAs})`** — 진짜 유저 메시지 주입, idle이면 턴 시작. 스트리밍 중엔 `deliverAs:"steer"|"followUp"` 필수(없으면 throw)
- `pi.sendMessage({customType,content,display,details},{deliverAs:"steer"|"followUp"|"nextTurn",triggerTurn})` — 커스텀 메시지(LLM 컨텍스트 포함)
- `pi.appendEntry(customType, data)` — 세션에 영속, LLM 컨텍스트 제외 (durable 확장 상태)
- `pi.setActiveTools(names)` / `getActiveTools()` / `getAllTools()` — 단계별 도구 게이팅(plan-mode 패턴), 추가-전용 변경은 deferred tool loading으로 캐시 보존
- `pi.exec(cmd,args,{signal,timeout})`, `pi.events`(확장 간 버스), `pi.registerProvider/unregisterProvider`, `pi.setModel/setThinkingLevel`, `pi.setSessionName`, `pi.setLabel(entryId,label)`

### ExtensionContext vs CommandContext
- 모든 핸들러: `ctx.ui`(select/confirm/input/editor/notify + TUI 위젯), `ctx.mode`(`"tui"|"rpc"|"json"|"print"`), `ctx.hasUI`, `ctx.cwd`, `ctx.sessionManager`(읽기: getEntries/getBranch/buildContextEntries/getLeafId), `ctx.model`, `ctx.signal`, `ctx.isIdle()`, `ctx.abort()`, `ctx.compact()`, `ctx.getContextUsage()`, `ctx.getSystemPrompt()`
- **커맨드 핸들러 전용**(이벤트 핸들러에서 부르면 데드락 위험): `ctx.waitForIdle()`, `ctx.newSession({parentSession?,setup?,withSession?})`, `ctx.fork(entryId,{position:"before"|"at"})`, `ctx.switchSession(path)`, `ctx.navigateTree(id,{summarize,label})`, `ctx.reload()`(호출 후 즉시 return), `ctx.getSystemPromptOptions()`
- **stale-object 함정:** newSession/fork/switchSession/reload 후 기존 `pi`/`ctx`/`sessionManager` 캡처는 throw. `withSession`의 fresh ctx만 사용, 캡처는 plain data만

### 커스텀 도구
```typescript
pi.registerTool({
  name, label, description,
  promptSnippet: "Available tools 한 줄",     // 생략 시 목록 미노출
  promptGuidelines: ["도구명을 명시한 불릿"],   // Guidelines에 평평하게 붙음
  parameters: Type.Object({ action: StringEnum(["a","b"] as const) }),  // enum은 반드시 StringEnum
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // 에러는 throw (isError 자동 세팅). onUpdate로 스트리밍.
    return { content:[{type:"text",text:"..."}], details:{}, terminate:true /* 배치 전원이 terminating이면 후속 LLM 호출 생략 */ };
  },
  renderCall?, renderResult?,
});
```
- 파일 변형 도구는 `withFileMutationQueue(absPath, fn)` 필수(병렬 도구 실행과 built-in edit/write 경합)
- 출력은 50KB/2000줄 안으로 truncate(`truncateHead/Tail`), 전체는 임시 파일로
- built-in 오버라이드 가능(동명 등록) — result/`details` 형태 정확히 일치시킬 것
- 경로 인자 앞 `@` 정규화(일부 모델이 붙임)
- `defineTool()`은 typed details용 헬퍼. structured output = `terminate:true` 도구

### 컴팩션 커스텀
- `session_before_compact` → `{cancel}` / `{compaction:{summary,firstKeptEntryId,tokensBefore,usage?}}` / undefined(기본 폴백)
- 헬퍼: `convertToLlm`, `serializeConversation`, `complete`(pi-ai/compat) — 싼 모델로 전체 요약하는 custom-compaction.ts 패턴
- 자동 트리거: `contextTokens > contextWindow - reserveTokens`. cut point는 tool result에 안 걸림. 요약 포맷: Goal/Constraints/Progress/Key Decisions/Next Steps/Critical Context + read/modified files(누적)

## 4. 프로그래매틱 제어 (오케스트레이터 표면)

### 모드 스펙트럼
| 모드 | 용도 |
|---|---|
| `pi -p "..."` | 원샷. stdin 파이프 병합, `@file` 첨부, `--tools`로 읽기전용화 |
| `pi --mode json "..."` | 원샷 + 전체 이벤트 JSONL 출력(첫 줄 session 헤더). stdin 채널 없음 |
| `pi --mode rpc` | 상주 프로세스, stdin/stdout JSONL 양방향 제어 |
| SDK (in-process) | `createAgentSession()` — 최대 제어 |

### RPC 프로토콜 요점
- **프레이밍: `\n`만 구분자. Node `readline` 금지**(U+2028/2029 오분리) — 수동 buffer-split
- 커맨드(모두 optional `id` 상관): `prompt`(스트리밍 중이면 `streamingBehavior:"steer"|"followUp"` 필수), `steer`, `follow_up`, `abort`, `new_session{parentSession?}`, `get_state`, `get_messages`, `set_model`, `set_thinking_level`, `compact{customInstructions?}`, `set_auto_compaction/retry`, **`bash{command}`**(오케스트레이터 셸 — 출력은 다음 `prompt` 때 LLM 컨텍스트 합류), `get_session_stats`(tokens/cost/contextUsage), `switch_session`, `fork{entryId}`, `clone`, **`get_entries{since?}`**(durable cursor — entry id 안정적, 재시작 후에도 증분 추적), `get_tree`, `get_last_assistant_text`, `get_commands`
- 이벤트: `agent_start/end`, **`agent_settled`(완료 판정 기준)**, `turn_start/end`, `message_start/update/end`, `tool_execution_start/update/end`(update의 partialResult는 누적), `queue_update`, `compaction_start/end`, `auto_retry_start/end`, `extension_error`
- 확장 UI 다이얼로그는 `extension_ui_request/response` 서브 프로토콜 — **timeout 없는 다이얼로그는 무한 블록** → 무인 하네스는 응답 로직 필수 또는 확장이 timeout 설정
- `prompt` 응답은 수락 시점(완료 아님). 실패는 이벤트로 흐름

### SDK 요점
```typescript
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
const { session } = await createAgentSession({ sessionManager: SessionManager.inMemory(), modelRuntime: await ModelRuntime.create() });
session.subscribe(ev => ...);          // AgentSessionEvent — RPC와 동일 유니언
await session.prompt("...");           // 수락된 런 전체(재시도 포함) 후 resolve
```
- 옵션: `cwd`, `agentDir`, `model`, `thinkingLevel`, `tools`(allowlist — 커스텀/확장 도구도 명시 필요), `customTools`(defineTool), `excludeTools`, `noTools:"all"|"builtin"`, `resourceLoader`, `sessionManager`, `settingsManager`
- `DefaultResourceLoader` 오버라이드 훅: `systemPromptOverride`, `skillsOverride`, `promptsOverride`, `agentsFilesOverride`(가상 AGENTS.md 주입), `extensionFactories`(인라인 확장), `eventBus`
- 세션 교체 계층: `createAgentSessionRuntime()` → `runtime.newSession()/switchSession()/fork(entryId,{position})/importFromJsonl()` — **교체 후 `runtime.session`은 새 객체, 재구독+`bindExtensions` 필수**
- `session.agent.state.messages/tools` 할당 가능(컨텍스트 주입/복원), `session.agent.waitForIdle()`
- 헬퍼: `runPrintMode(runtime,...)`, `runRpcMode(runtime)`(자기 프로세스에서 RPC 노출), `InteractiveMode`
- `SettingsManager.inMemory()`/`applyOverrides()`, 쓰기는 async — `flush()` 필요

### 세션 = durable state
- JSONL append-only **트리**(`id`/`parentId`, leaf가 현재 위치), v3. 위치: `~/.pi/agent/sessions/--<cwd>--/<ts>_<uuid>.jsonl`
- 엔트리 타입: `session`(헤더, `parentSession`으로 포크 계보), `message`, `model_change`, `thinking_level_change`, `compaction`(retainedTail 체크포인트), `branch_summary`, `custom`(LLM 컨텍스트 제외), `custom_message`(포함), `label`, `session_info`
- 컴팩션은 LLM 컨텍스트만 lossy — 파일에는 전체 이력 보존. 모델/thinking 선택은 resume에도 생존
- `SessionManager` 정적: `create/open/continueRecent/inMemory/forkFrom/list/listAll`; 트리: `branch(entryId)`, `branchWithSummary`, `createBranchedSession`
- bash 도구에 `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, `PI_REASONING_LEVEL` 주입 — 에이전트가 자기 세션을 자각 가능

### 서브에이전트/병렬 (내장 없음 — 우리가 만드는 것)
- 공식 예제 `examples/extensions/subagent/index.ts`: `pi --mode json -p --no-session [--model M] [--tools ...] [--append-system-prompt f] "Task:..."` 자식 프로세스 스폰, JSON 스트림 파싱, single/parallel(MAX 8, 동시 4)/chain(`{previous}` 치환), SIGTERM→5s→SIGKILL, agents 정의는 `~/.pi/agent/agents`/`.pi/agents` markdown
- 선택지: (a) RPC 서브프로세스 N개(프로세스 격리, 언어 무관) (b) SDK in-process 세션 N개 (c) 원샷 `-p`/`json` 워커
- 에이전트 내부 병렬: 형제 도구 호출은 동시 실행(preflight는 순차) — 결과 이벤트는 완료순 인터리브

## 5. 모델/인증/환경

- 크리덴셜 우선순위: `--api-key` > `auth.json`(OAuth 구독 포함: Claude Pro/Max, ChatGPT, Copilot 등) > env var > models.json 커스텀
- `~/.pi/agent/models.json`으로 커스텀 프로바이더/모델(4개 API 형태), `!command`/`$ENV` 값 해석, `thinkingLevelMap`
- 모델 표기: `provider/id:thinking` (예: `anthropic/claude-opus-4-5:high`)
- **`PI_CODING_AGENT_DIR`** — config 디렉터리 통째 오버라이드(하네스 격리 프로필의 핵심), `PI_CODING_AGENT_SESSION_DIR`, `PI_OFFLINE`, `PI_CACHE_RETENTION=long`
- 샌드박스 없음(의도) — 격리는 OS/컨테이너 책임. trust는 로딩 가드일 뿐 실행 제한 아님

## 6. 하네스 설계에 직결되는 함정 종합

1. **완료 판정은 `agent_settled`** — `agent_end`는 retry/overflow-컴팩션/큐 계속 가능
2. **헤드리스 trust 침묵 무시** — `-a` 또는 trust.json 시드 필수
3. RPC 파싱: `\n` 수동 분리(readline 금지)
4. 스트리밍 중 prompt/sendUserMessage는 `streamingBehavior`/`deliverAs` 필수(아니면 에러/throw)
5. steering 주입 시점: 현재 assistant 턴의 도구 호출 완료 후, 다음 LLM 호출 전
6. RPC `bash` 출력은 다음 `prompt`에야 컨텍스트 합류
7. 세션 교체 후 stale 객체(구독, ctx, sessionManager) — 재구독/재바인딩, `withSession` fresh ctx만
8. 커맨드 전용 메서드를 이벤트 핸들러에서 호출하면 데드락 위험
9. timeout 없는 extension UI 다이얼로그는 무인 모드에서 영구 블록
10. `get_messages`(현재 컨텍스트) vs `get_entries`(전체 이력+버려진 브랜치) 구분
11. factory에서 백그라운드 리소스 시작 금지
12. 도구 에러는 throw로(반환값은 isError 미설정), 출력 50KB/2000줄 truncate
13. 파일 변형 커스텀 도구는 `withFileMutationQueue`
14. `StringEnum` 사용(Type.Union literal은 Google API 비호환)
15. 컴팩션 직후 `contextUsage` null, `SettingsManager` 쓰기는 flush 필요
16. `.pi`/`~/.pi/agent` 하드코딩 금지 — `CONFIG_DIR_NAME`/`getAgentDir()`

## 7. simplepowers → 루프·그래프 매핑 (설계 방향)

**루프 엔지니어링** — success criteria를 exit condition으로:
- 확장 방식: `agent_settled`에서 검증 실행(테스트/명령) → 미달이면 `pi.sendUserMessage(실패 정보)`로 재투입 (git-merge-and-resolve 패턴). 종료는 `terminate:true` structured-output 도구 또는 기준 통과
- 오케스트레이터 방식: RPC로 `prompt` → `agent_settled` 대기 → `bash`로 검증 → 실패 출력과 함께 다음 `prompt` (검증이 프로토콜 레벨에서 컨텍스트에 합류)

**그래프 엔지니어링** — outcome을 하위 outcome DAG로:
- 노드 = pi 인스턴스(RPC 서브프로세스 or SDK 세션), 각자 자기 루프 보유
- 엣지 = orchestration 스킬의 규칙(계약 먼저, 의도 전달, 읽기전용 오케스트레이터)
- 상태 = 세션 JSONL(`get_entries since` 커서로 관찰, `fork`/`parentSession`으로 계보, 세션 파일이 곧 재개 가능한 노드 상태)
- 격리 = `PI_CODING_AGENT_DIR` 프로필 / 컨테이너

**검증 수준 주의:** 이 문서는 공식 docs+원본 소스 기반이지만 실행 검증은 아직 안 거쳤다. 각 메커니즘은 처음 쓸 때 최소 실험(single RPC round-trip 등)으로 확인하고 어긋나면 이 문서를 수정할 것.
