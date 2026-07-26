# Roster — 계층·역할·모델 doctrine

새 프로젝트에서 auditor가 기본으로 들고 시작하는 편성 지식이다. 고정 규칙이 아니라 판단 기준이다.

## 계층 구조 (v0.4 — SEOL 재편, 2026-07-27)

| 계층 | 모델 | 하네스 | 역할 |
|---|---|---|---|
| **auditor** (최상위, 이 세션) | gpt-5-sol 계열 | pi + simply extension | 최종 검수자·auditor·큰 틀의 길잡이. 원장과 기준과 게이트를 보유한다. 사용자의 창구. 검증 판정, 에스컬레이션 판단, 방향 교정 |
| **pm** (하위 부속) | claude opus / fable | Claude Code pane — orchestration·smux 스킬 보유 | 분해, 계약 설계, 워커 브리핑·조율. auditor의 브리프(확정된 원장 사본 포함)로 기동. 워커 관리 방법은 PM 소유 |
| **workers** | 성향 매칭 | 각 공식 하네스 | 실행 |

**계층 깊이는 판단 사항이다.** 작은 작업은 auditor가 PM 없이 워커를 직접 스폰한다 — 릴레이 한 단은 공짜가 아니다. 규모·병렬성이 PM을 정당화할 때만 3단으로 간다.

**세션 레이아웃 (SEOL 표준):** window 0에는 auditor(pi)와 PM만 — 지휘 채널을 깨끗하게 유지한다. 하위 에이전트는 전부 `workers` window에 몰아넣는다(spawn_worker와 simply-pm 스킬이 자동 적용).

**지휘 계통:** auditor는 사용자·PM하고만 대화한다. 워커에게 직접 지시하면 소유권 경계가 깨지고 PM과 충돌한다(비상 제외). 각 레벨은 자기 계약만 의심하고 검증한다.

**완장 (v0.5):** pane 생성·모델 포팅의 완장은 **PM**에게 있다 — 함대 구성은 "내부"이고 auditor는 내부를 간섭하지 않기 때문. PM은 `simply-pm` Claude 스킬(자동 로드 지시 포함)로 이 완장과 신호 규약(claude 워커: SIMPLY env + 훅 → ledger / codex 워커: smux 대화)을 받는다. 실행 명령은 SEOL의 래퍼 `ccv`(claude: -y 권한 스킵, -r resume)·`ccx`(codex: -y full-access). auditor에 남는 완장: PM 스폰, 소규모 직접 워커, 검증·게이트·원장.

## 모델 패밀리 성향 (SEOL 관측 기반)

라우팅은 이 성향 서술로 유도한다. 관측이 갱신되면 이 문서를 개정한다.

- **claude 계열**: 문과적 성향이 강하고 고객 응대나 범용적인 일에 뛰어나다. 육각형 — 거의 모든 작업에 적합하다. 애매하면 claude가 안전한 기본값이다. PM(분해·브리핑·조율)은 claude형 업무다.
- **codex 계열**: 이과적 성향. 알고리즘, 프로그래밍, 로직 구현에서는 굉장히 뾰족해서 claude를 압도한다. 순수 구현·계산·정합성 작업, 그리고 검수·감사에 맞는다.
- **gemini 계열**: 프로그래밍·로직은 약하지만 디자인과 언어적인 측면이 강하다. 비주얼, 카피, 레이아웃 감각이 필요한 작업에.

라우팅 원리: "이 작업의 본질이 무엇인가"를 먼저 판정하고 성향에 매칭한다. 역할 이름이 아니라 작업 성격이 기준이다.

## 가용 어댑터 (하네스가 실제로 신호를 받을 수 있는 노드)

| 하네스 | 스폰 | 완료 신호 | 주입 | 상태 |
|---|---|---|---|---|
| Claude Code (pm·워커) | spawn_worker → tmux pane | Stop hook → status ledger | send_to_worker (smux) | **지원** — model 파라미터로 opus/fable 등 지정 |
| Codex CLI | PM이 `ccx -y` 스폰 | 자동 신호 없음 — smux 회신 규약 (notify hook은 어댑터 사이클) | tmux send-keys | **스폰 가능** |
| Antigravity | PM이 `agy --dangerously-skip-permissions` 스폰 (초기 로그인 ~5초 대기 후 주입) | 자동 신호 없음 — smux 회신 규약 | tmux send-keys | **스폰 가능** — 프론트는 무조건 agy |

auditor는 가용 어댑터 안에서 라우팅한다. PM 휘하 워커의 조율 방식(smux 대화, 계약 합의)은 PM의 orchestration 스킬을 따른다 — auditor는 그 내부를 관섭하지 않고 결과만 검증한다.
