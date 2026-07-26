# 원장 — simply (SEOL 하네스)

> 이 문서는 이 프로젝트의 "완료가 무엇인가"에 대한 단일 진실이다.
> 개정은 SEOL의 입력으로만 이루어진다. 상태: **확정** (v0.1)
> 개정 이력: v0 2026-07-27 초안 → v0.1 2026-07-27 SEOL 확정 + 기본 편성 doctrine 추가, QA 형태·위치 확정 → v0.2 2026-07-27 PM 모델을 gpt-5-sol로 변경(pi의 claude는 extra usage 과금이므로) → v0.3 2026-07-27 개선 루프(autoresearch rail) 설계를 V2 보류로 추가 → v0.4 2026-07-27 계층 재편: pi 노드를 PM에서 auditor(최종 검수자·길잡이)로, PM은 claude(opus/fable) 하위 부속으로 — codex-PM doctrine 긴장 해소 → v0.5 2026-07-27 완장 명문화: pane·모델 포팅은 PM 소유, `simply-pm` Claude 스킬로 주입(ccv/ccx 실행법·신호 규약 포함) → v0.6 2026-07-27 프론트엔드는 무조건 agy(Antigravity CLI, --dangerously-skip-permissions, 초기 로그인 ~5초) — "Antigravity pane 불가" 가정 폐기

## 완성된 결과 (관찰 가능한 행동)

SEOL이 tmux에서 `simply`를 시작하면 pi 위에서 **auditor**(최종 검수자·큰 틀 길잡이)가 뜬다. 이후:

1. SEOL이 목표를 말하면 auditor가 결과를 구체화하는 인터뷰를 하고, 확인된 결과를 **작업 원장**(outcome + 기준별 검증 방법)으로 기록한다.
2. auditor는 **roster doctrine을 기본 지식으로 보유**한 채 계층을 판단한다: 규모가 정당화하면 PM(claude opus/fable, Claude Code pane)을 스폰해 확정 원장과 함께 위임하고, PM이 orchestration·smux 스킬로 워커들을 분해·브리핑·조율한다. 작은 작업은 auditor가 워커를 직접 스폰한다. auditor는 사용자·PM하고만 대화한다. 컨텍스트가 필요한 파생 작업은 자기 세션을 fork해 처리 후 폐기한다.
3. 워커의 완료·상태는 대화 없이 감지된다: 워커 하네스별 어댑터(Claude Code는 Stop hook)가 공유 status ledger에 쓰고, 하네스 코드가 watch해서 결정에 필요한 델타만 PM에 주입한다. 대화는 계약 합의와 에스컬레이션에만 쓴다.
4. 각 노드는 자기 기준을 기계적으로 검증하며 루프를 돈다. ledger의 "pass"는 검증 게이트(verify)만 쓸 수 있다. 같은 실패 2회면 맹목 재시도 대신 에스컬레이션.
5. 작업 원장의 전 기준 통과 시 PM은 완료 선언 대신 **QA 패키지를 PM pane 터미널에** 제시한다(기준별 → 확인 명령/URL 매핑). QA 전 완료 선언은 하네스가 반려한다.
6. QA 피드백은 작업 원장의 개정으로 반영되고, 마무리 또는 루프 재개로 이어진다.

## 기본 편성 doctrine (roster)

새 프로젝트 시작 시 PM이 기본으로 들고 있는 지식. 상세는 `roster.md`.

- 기본 편성 예시: **pm**(gpt-5-sol 계열, pi에서 구동 — pi의 claude는 extra usage 과금이라 구독 경제성상 codex. 고점이 필요한 순간엔 `/model`로 claude/fable 스팟 전환 가능) / **backend**(gpt-5-sol 계열, Codex CLI) / **frontend**(gemini 3.1 pro, Antigravity)
- 라우팅 원리: 역할→모델 고정 매핑이 아니라 **모델 패밀리의 성향 서술로 유도** — claude(육각형 범용·문과적·응대), codex(이과적·알고리즘/로직에서 압도적으로 뾰족), gemini(로직 약함·디자인/언어 강함). PM은 이 성향과 작업 성격을 매칭해 판단한다.

## 사용자·환경

SEOL 단독, 로컬 Mac(darwin), tmux 상시 사용. 프로젝트 위치 `~/realmyworld/simply`. 워커는 구독 경제성상 각 공식 하네스에서 구동(pi의 Claude OAuth는 extra usage 과금).

## 제약

- 판단은 모델에, 루프·관측·게이트는 코드에. 프롬프트로 규율을 강제하지 않는다.
- 프롬프트 계층은 최소 가이드: APPEND_SYSTEM.md는 baseline 실패가 관찰된 것만, 한 줄씩.
- 기존 자산 계승: simplepowers 스킬, smux(주입 전용 채널로 축소), orchestration/prompt 스킬의 교리.
- 워커 pane은 인간 관전용으로 유지 — SEOL이 언제든 보고 개입 가능해야 한다.

## V1 성공 기준 (수락 기준 — 각각 기계적으로 확인)

1. **E2E 데모**: 실제 토이 과제 1개로 "인터뷰 → 작업 원장 생성 → 워커 스폰+브리프 → ledger 완료 감지 → 검증 루프 → QA 패키지 제시"가 QA 게이트 외 사람 개입 없이 완주된다.
2. **원장 고정**: PM의 매 턴 컨텍스트에 작업 원장이 존재한다 — 강제 컴팩션 후에도.
3. **무답변 감지**: 워커 완료가 워커의 답변 메시지 없이 status ledger 경유로 PM에 도달한다.
4. **루프 게이트**: 기준 미달 시 자동 재투입되고, 동일 실패 2회 시 에스컬레이션이 SEOL에게 온다.
5. **QA 게이트**: QA 패키지 제시 없이 PM이 완료를 선언하려 하면 하네스가 반려한다.
6. **roster 내장**: 새 프로젝트에서 auditor가 별도 설명 없이 roster doctrine에 따라 편성을 제안한다.
7. **3단 위계 E2E** (v0.4 추가): auditor → PM(claude, orchestration 스킬로 워커 조율) → worker 구성으로 실전 과제 1개가 완주된다 — auditor는 워커와 직접 대화하지 않고, 검증·QA 게이트는 auditor 층에서만 작동한다.

## 의도적 보류 (V1 제외)

병렬 워커 그래프(계약 동시 진행), fork 엣지 자동화, 쌍둥이 상호 의심 검증, **Codex CLI·Antigravity 자동 신호 어댑터**(스폰·주입은 v0.5~0.6에서 ccx/agy로 이미 가능 — 남은 것은 Stop/notify류 자동 정지 신호뿐이며, 그때까지는 smux 회신 규약으로 조율). **계층별 신호 라우팅**(3단 라이브에서 관측: PM 소유 워커의 정지 신호가 auditor로만 가고 PM에게는 안 감 — nodes에 parent 필드를 두고, watcher가 PM 소유 워커 이벤트를 PM pane에 smux로 주입하는 방향). **개선 루프(autoresearch rail — regime 분류, rail freeze, holdout, Pareto 게이트, `improve` 스킬)**는 `docs/improvement-loops.md`의 설계로 V2 사이클에서 (v0.3 개정, 2026-07-27 SEOL 입력).
