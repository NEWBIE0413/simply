#!/bin/bash
# Claude Code Stop hook → simply status ledger
# 워커의 "멈춤"을 대화 없이 PM에게 알리는 유일한 신호선.
# "done"이 아니라 "stopped"인 이유: 완료 판정은 verify 게이트의 몫이다.
[ -z "$SIMPLY_STATUS_FILE" ] && exit 0
printf '{"ts":"%s","node":"%s","event":"stopped"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${SIMPLY_NODE:-unknown}" >> "$SIMPLY_STATUS_FILE"
exit 0
