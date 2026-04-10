#!/usr/bin/env bash
# PostToolUse hook: inject context usage warnings before autocompact (70%)

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
SESSION_ID="${SESSION_ID//[^a-zA-Z0-9_-]/}"
SID_DIR="/tmp/claude/sessions/${SESSION_ID:-default}"

PCT_FILE="$SID_DIR/context-pct"
MARKER_DIR="$SID_DIR/context-markers"

# No metrics yet (statusline hasn't run) → silent exit
[[ ! -f "$PCT_FILE" ]] && exit 0

PCT=$(cat "$PCT_FILE" 2>/dev/null)
[[ -z "$PCT" || "$PCT" -lt 50 ]] && exit 0

mkdir -p "$MARKER_DIR"

if [[ "$PCT" -ge 65 ]] && [[ ! -f "$MARKER_DIR/critical" ]]; then
  touch "$MARKER_DIR/critical" "$MARKER_DIR/half"
  echo "[context monitor] Context ${PCT}% used — autocompact imminent at 70%."
  echo "Finish current step. Summarize: task status, key decisions, modified files."
  exit 0
fi

if [[ "$PCT" -ge 50 ]] && [[ ! -f "$MARKER_DIR/half" ]]; then
  touch "$MARKER_DIR/half"
  echo "[context monitor] Context ${PCT}% used — halfway point."
  echo "Consider wrapping up the current task before context pressure increases."
  exit 0
fi

exit 0
