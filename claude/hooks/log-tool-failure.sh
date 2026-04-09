#!/usr/bin/env bash
# PostToolUseFailure hook: log tool failures for debugging and pattern analysis
# Triggered only on tool failures (no grep filtering needed)
# Always exits 0 — informational only, never blocks
# Requires: jq

LOG_FILE="$HOME/.claude/tool-failures.log"
MAX_SIZE=$((1024 * 1024))  # 1MB

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
RESPONSE=$(echo "$INPUT" | jq -r '.tool_response // empty')

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
ERROR_SUMMARY=$(echo "$RESPONSE" | head -5)

# Log rotation: keep last 200 lines if > 1MB
if [[ -f "$LOG_FILE" ]] && [[ $(stat -f%z "$LOG_FILE" 2>/dev/null || echo 0) -gt $MAX_SIZE ]]; then
  tail -200 "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
fi

{
  echo "[$TIMESTAMP] tool=$TOOL"
  echo "  $ERROR_SUMMARY"
  echo ""
} >> "$LOG_FILE"

exit 0
