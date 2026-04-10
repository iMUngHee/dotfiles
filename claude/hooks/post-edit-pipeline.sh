#!/usr/bin/env bash
# PostToolUse hook (Edit|Write): auto-format → typecheck, sequential pipeline
# Debounce gates the entire pipeline (format + typecheck together)
# Always exit 0 (informational only, never block)

DEBOUNCE_SEC=30
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"

source "$HOOK_DIR/lib/detect-project.sh"

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
SESSION_ID="${SESSION_ID//[^a-zA-Z0-9_-]/}"
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.file // .tool_input.path // empty')

DEBOUNCE_FILE="/tmp/claude-pipeline-last-${SESSION_ID:-default}"
[[ -z "$FILE" ]] && exit 0

PROJECT_ROOT=$(detect_project_root)
[[ -z "$PROJECT_ROOT" ]] && exit 0

# Debounce: skip entire pipeline if last run was recent
if [[ -f "$DEBOUNCE_FILE" ]]; then
  LAST=$(cat "$DEBOUNCE_FILE" 2>/dev/null)
  NOW=$(date +%s)
  if [[ -n "$LAST" ]] && (( NOW - LAST < DEBOUNCE_SEC )); then
    exit 0
  fi
fi
date +%s > "$DEBOUNCE_FILE"

detect_checker "$FILE" "$PROJECT_ROOT"

# --- Stage 1: Auto-format ---
if [[ -n "$FMT_CMD" ]]; then
  CHECKSUM_BEFORE=$(md5 -q "$FILE" 2>/dev/null)
  if [[ -n "$CHECKSUM_BEFORE" ]]; then
    # Run formatter with 5s timeout (portable_timeout for macOS)
    portable_timeout 5 bash -c "$FMT_CMD \"\$1\"" _ "$FILE" &>/dev/null
    CHECKSUM_AFTER=$(md5 -q "$FILE" 2>/dev/null)
    if [[ "$CHECKSUM_BEFORE" != "$CHECKSUM_AFTER" ]]; then
      FMT_NAME="${FMT_CMD%% *}"
      FMT_NAME="${FMT_NAME##*/}"
      echo "[auto-format] $FMT_NAME formatted $(basename "$FILE")"
    fi
  fi
fi

# --- Stage 2: Type check ---
[[ -z "$CHECK_CMD" ]] && exit 0

TMPOUT="/tmp/claude-pipeline-typecheck-output-${SESSION_ID:-default}"
cd "$PROJECT_ROOT" && portable_timeout 30 bash -c "$CHECK_CMD" > "$TMPOUT" 2>&1
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
  OUTPUT=$(head -20 "$TMPOUT")
  if [[ -n "$OUTPUT" ]]; then
    echo "[typecheck] ${LANG_LABEL} errors after editing $(basename "$FILE"):"
    echo "$OUTPUT"
  fi
fi

rm -f "$TMPOUT" 2>/dev/null
exit 0
