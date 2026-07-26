#!/bin/bash
# Claude Code Stop hook → simply status ledger
# The single signal line that tells the auditor a worker has stopped, without conversation.
# It says "stopped", not "done": completion verdicts belong to the verify gate.
[ -z "$SIMPLY_STATUS_FILE" ] && exit 0
printf '{"ts":"%s","node":"%s","event":"stopped"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${SIMPLY_NODE:-unknown}" >> "$SIMPLY_STATUS_FILE"
exit 0
