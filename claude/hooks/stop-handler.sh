#!/usr/bin/env bash
# Stop hook: final quality gate + notification (unified handler)
# Runs type checker on modified files before allowing completion.
# exit 2 = block stop (Claude continues working), exit 0 = allow stop
#
# Flow:
#   1. Check for modified files (unstaged + staged)
#   2. Detect project type, run checker with timeout
#   3. If fail + retries < 2 → exit 2 (block, no notification)
#   4. If pass or retries exhausted → notify + exit 0

MAX_RETRIES=2
CHECKER_TIMEOUT=30
SUITE_TIMEOUT=300
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"

source "$HOOK_DIR/lib/detect-project.sh"

INPUT=$(cat)

# Extract session_id for retry counter (fallback to PPID if unavailable)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
SESSION_ID="${SESSION_ID//[^a-zA-Z0-9_-]/}"
[[ -z "$SESSION_ID" ]] && SESSION_ID="$PPID"
COUNTER_FILE="/tmp/claude-final-gate-${SESSION_ID}"

# --- Helper: run existing notify.sh and exit ---
run_notify_and_exit() {
  rm -f "$TMPOUT" 2>/dev/null
  "$HOOK_DIR/notify.sh" stop <<< "$INPUT"
  exit 0
}

# --- Helper: a gate stage failed — block with retry budget, then let through ---
# Reads $TMPOUT for the failure output. $1 is the label shown to Claude.
fail_gate() {
  local label="$1" count=0
  if [[ -f "$COUNTER_FILE" ]]; then
    count=$(cat "$COUNTER_FILE" 2>/dev/null)
    [[ -z "$count" ]] && count=0
  fi

  if (( count >= MAX_RETRIES )); then
    echo "[final-gate] ${label} failed after ${MAX_RETRIES} retries. Allowing stop."
    head -10 "$TMPOUT" 2>/dev/null
    rm -f "$COUNTER_FILE"
    run_notify_and_exit
  fi

  echo $(( count + 1 )) > "$COUNTER_FILE"
  echo "[final-gate] ${label} failed (attempt $(( count + 1 ))/${MAX_RETRIES}). Fix and retry."
  head -20 "$TMPOUT" 2>/dev/null
  rm -f "$TMPOUT" 2>/dev/null
  exit 2
}

# --- Check for modified files ---
PROJECT_ROOT=$(detect_project_root)
if [[ -z "$PROJECT_ROOT" ]]; then
  run_notify_and_exit
fi

cd "$PROJECT_ROOT" || run_notify_and_exit

CHANGED_FILES=$(git diff --name-only 2>/dev/null; git diff --cached --name-only 2>/dev/null)
if [[ -z "$CHANGED_FILES" ]]; then
  # No modified files — read-only session, skip gate
  rm -f "$COUNTER_FILE"
  run_notify_and_exit
fi

# Dedup (unstaged and staged lists can overlap)
CHANGED_FILES=$(echo "$CHANGED_FILES" | sort -u)

# --- Stage 0: Auto-format modified files (covers post-edit-pipeline debounce gaps) ---
FORMATTED=0
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  [[ -f "$file" ]] || continue
  detect_checker "$file" "$PROJECT_ROOT"
  [[ -z "$FMT_CMD" ]] && continue
  BEFORE=$(md5 -q "$file" 2>/dev/null)
  portable_timeout 5 bash -c "$FMT_CMD \"\$1\"" _ "$file" &>/dev/null
  AFTER=$(md5 -q "$file" 2>/dev/null)
  [[ "$BEFORE" != "$AFTER" ]] && FORMATTED=$((FORMATTED + 1))
done <<< "$CHANGED_FILES"
(( FORMATTED > 0 )) && echo "[final-gate] auto-formatted ${FORMATTED} file(s)"

TMPOUT="/tmp/claude-final-gate-output-${SESSION_ID}"

# --- Helper: run one suite from a subdirectory, failing the gate on nonzero ---
run_suite() {
  local label="$1" dir="$2"; shift 2
  ( cd "$PROJECT_ROOT/$dir" 2>/dev/null && portable_timeout "$SUITE_TIMEOUT" "$@" ) > "$TMPOUT" 2>&1 \
    || fail_gate "$label"
}

# --- Stage 1: This repo's own test suites, selected by changed path ---
# The suites exist but were wired to nothing, so a change could ship them red —
# that is how a rule asserted verbatim by ai/lib/*.test.mjs got deleted. Each
# trigger is scoped so untouched areas cost nothing (pm-roadmap alone is ~50s).
if [[ "$PROJECT_ROOT" == "$HOME/.config" ]] && command -v node &>/dev/null; then
  # Instruction files are asserted by string match, and a doc-only change
  # reaches no type checker at all.
  if grep -qE '^(ai|claude|codex)/.*\.(md|sh)$' <<< "$CHANGED_FILES"; then
    run_suite "contract tests" . \
      node --test ai/lib/session-routing-consumers.test.mjs ai/lib/inject-context-hooks.test.mjs
  fi
  # Shared engine: every .mjs consumer, not just the contract pair.
  if grep -qE '^ai/lib/' <<< "$CHANGED_FILES"; then
    run_suite "ai/lib suite" . bash -c 'node --test ai/lib/*.test.mjs'
  fi
  if grep -qE '^ai/skills/pm-roadmap/' <<< "$CHANGED_FILES"; then
    run_suite "pm-roadmap tests" ai/skills/pm-roadmap npm test --silent
  fi
  if grep -qE '^ai/skills/pm-context/' <<< "$CHANGED_FILES"; then
    run_suite "pm-context tests" ai/skills/pm-context npm test --silent
  fi
  if grep -qE '^ai/skills/config-audit/' <<< "$CHANGED_FILES" && command -v go &>/dev/null; then
    run_suite "config-audit go tests" ai/skills/config-audit/scripts go test ./...
  fi
fi

# --- Detect project type from changed files ---
CHECK_CMD=""
for file in $CHANGED_FILES; do
  detect_checker "$file" "$PROJECT_ROOT"
  [[ -n "$CHECK_CMD" ]] && break
done

if [[ -z "$CHECK_CMD" ]]; then
  # No supported checker for this project
  rm -f "$COUNTER_FILE"
  run_notify_and_exit
fi

# --- Stage 2: Run type checker ---
portable_timeout "$CHECKER_TIMEOUT" bash -c "$CHECK_CMD" > "$TMPOUT" 2>&1 || fail_gate "${LANG_LABEL} check"

# All stages passed — clean up counter, notify, allow stop
rm -f "$COUNTER_FILE"
run_notify_and_exit
