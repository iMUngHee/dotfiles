#!/usr/bin/env bash
# PostToolUse hook: log tool response sizes for adoption-decision analysis.
# Records only byte size per tool — no response content — to decide whether
# a context-compression MCP is worth building/adopting.
# Always exits 0, never blocks.
# Requires: jq

LOG="$HOME/.claude/tool-sizes.jsonl"
MAX_SIZE=$((5 * 1024 * 1024))  # 5MB

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
SIZE=$(echo "$INPUT" | jq -r '.tool_response // empty' | wc -c | tr -d ' ')
TS=$(date +%s)

if [[ -f "$LOG" ]] && [[ $(stat -f%z "$LOG" 2>/dev/null || echo 0) -gt $MAX_SIZE ]]; then
  tail -10000 "$LOG" > "${LOG}.tmp" && mv "${LOG}.tmp" "$LOG"
fi

jq -nc --arg ts "$TS" --arg tool "$TOOL" --argjson size "$SIZE" \
  '{ts: $ts, tool: $tool, size: $size}' >> "$LOG"

exit 0
