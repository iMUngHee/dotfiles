#!/usr/bin/env bash
# PostToolUse hook: run language-specific type checker after Edit/Write
# Debounce: skip if last check was within DEBOUNCE_SEC seconds
# Always exit 0 (informational only, never block)
#
# NOTE: In the default settings.json, post-edit-pipeline.sh is used instead.
# This script is kept for standalone use or fallback.

DEBOUNCE_SEC=30
TIMESTAMP_FILE="/tmp/claude-typecheck-last"
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"

source "$HOOK_DIR/lib/detect-project.sh"

INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.file // empty')
[[ -z "$FILE" ]] && exit 0

PROJECT_ROOT=$(detect_project_root)
[[ -z "$PROJECT_ROOT" ]] && exit 0

detect_checker "$FILE" "$PROJECT_ROOT"
[[ -z "$CHECK_CMD" ]] && exit 0

# Debounce: skip if last run was recent
if [[ -f "$TIMESTAMP_FILE" ]]; then
  LAST=$(cat "$TIMESTAMP_FILE" 2>/dev/null)
  NOW=$(date +%s)
  if [[ -n "$LAST" ]] && (( NOW - LAST < DEBOUNCE_SEC )); then
    exit 0
  fi
fi
date +%s > "$TIMESTAMP_FILE"

# Run check from project root (avoid subshell to preserve exit code)
TMPOUT="/tmp/claude-typecheck-output"
cd "$PROJECT_ROOT" && eval "$CHECK_CMD" > "$TMPOUT" 2>&1
EXIT_CODE=$?
OUTPUT=$(head -20 "$TMPOUT")

if [[ $EXIT_CODE -ne 0 && -n "$OUTPUT" ]]; then
  echo "[typecheck] ${LANG_LABEL} errors after editing $(basename "$FILE"):"
  echo "$OUTPUT"
fi

exit 0
