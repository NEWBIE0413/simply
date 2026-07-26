# simply

과정이 아니라 결과. pi 기반 PM + 이종 워커 함대를 부리는 SEOL의 하네스.

- `LEDGER.md` — 이 프로젝트의 원장 (완료가 무엇인가의 단일 진실)
- `roster.md` — 역할·모델 편성 doctrine (PM의 기본 지식으로 매 턴 주입)
- `extension/simply.ts` — PM extension: 작업원장 상주, status ledger watch, spawn/send/verify/request_qa 도구, settle 게이트
- `hooks/` — 워커(Claude Code) Stop hook → status ledger
- `bin/simply` — 런처 (tmux 안에서 `simply <project-dir>`)
- `docs/pi-reference.md` — pi 0.82.1 하네스 엔지니어링 레퍼런스
- `docs/improvement-loops.md` — 개선 루프(autoresearch rail) V2 설계
- `vendor/pi-src/` — 소스맵에서 추출한 pi 원본 TS (ground truth, git 제외)

## 사용

```bash
# tmux 세션 안에서
bin/simply ~/path/to/project
```

PM(gpt-5-sol)이 뜨면 목표를 말한다. PM이 인터뷰 → `.simply/LEDGER.md` 작업원장 기록 →
`set_criteria` → 워커 스폰/브리프 → status ledger로 완료 감지 → `verify` 루프 → QA 패키지 제시.
프로젝트별 상태는 해당 프로젝트의 `.simply/` 아래에 산다.
