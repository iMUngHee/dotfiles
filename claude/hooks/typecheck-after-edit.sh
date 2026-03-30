#!/usr/bin/env bash
# PostToolUse hook: run language-specific type checker after Edit/Write
# Debounce: skip if last check was within DEBOUNCE_SEC seconds
# Always exit 0 (informational only, never block)

DEBOUNCE_SEC=30
TIMESTAMP_FILE="/tmp/claude-typecheck-last"

INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.file // empty')
[[ -z "$FILE" ]] && exit 0

# Determine language and check command
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
[[ -z "$PROJECT_ROOT" ]] && exit 0

CHECK_CMD=""
case "$FILE" in
  *.ts|*.tsx)
    [[ -f "$PROJECT_ROOT/tsconfig.json" ]] && CHECK_CMD="npx tsc --noEmit --pretty 2>&1"
    ;;
  *.go)
    [[ -f "$PROJECT_ROOT/go.mod" ]] && CHECK_CMD="go vet ./... 2>&1"
    ;;
  *.rs)
    [[ -f "$PROJECT_ROOT/Cargo.toml" ]] && CHECK_CMD="cargo check --message-format short 2>&1"
    ;;
esac
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
  LANG_LABEL=""
  case "$FILE" in
    *.ts|*.tsx) LANG_LABEL="tsc" ;;
    *.go)       LANG_LABEL="go vet" ;;
    *.rs)       LANG_LABEL="cargo check" ;;
  esac
  echo "[typecheck] ${LANG_LABEL} errors after editing $(basename "$FILE"):"
  echo "$OUTPUT"
fi

exit 0
