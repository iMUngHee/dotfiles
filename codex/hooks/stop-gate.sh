#!/usr/bin/env bash
# Stop hook: bounded final quality gate, then shared notification.
set -euo pipefail

MAX_RETRIES=2
CHECKER_TIMEOUT=30
SUITE_TIMEOUT=300
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"

source "$HOOK_DIR/lib/detect-project.sh"

input=$(cat)
session_id=$(printf '%s' "$input" | jq -r '.session_id // "default"' 2>/dev/null)
session_id="${session_id//[^a-zA-Z0-9_-]/}"
[[ -n "$session_id" ]] || session_id="$PPID"

counter_file="/tmp/codex-final-gate-${session_id}"
tmp_out="/tmp/codex-final-gate-output-${session_id}"

notify_and_exit() {
  rm -f "$tmp_out" 2>/dev/null
  "$HOOK_DIR/notify.sh" stop <<< "$input" || true
  exit 0
}

# A gate stage failed: block with the retry budget, then let through.
# Reads "$tmp_out" for the failure output. $1 is the label shown to the agent.
fail_gate() {
  local label="$1" current_count=0
  if [[ -f "$counter_file" ]]; then
    current_count=$(cat "$counter_file" 2>/dev/null || echo 0)
    [[ "$current_count" =~ ^[0-9]+$ ]] || current_count=0
  fi

  if (( current_count >= MAX_RETRIES )); then
    echo "[codex final-gate] ${label} failed after ${MAX_RETRIES} retries. Allowing stop." >&2
    head -10 "$tmp_out" 2>/dev/null >&2 || true
    rm -f "$counter_file"
    notify_and_exit
  fi

  echo $((current_count + 1)) > "$counter_file"
  echo "[codex final-gate] ${label} failed (attempt $((current_count + 1))/${MAX_RETRIES}). Fix and retry." >&2
  head -20 "$tmp_out" 2>/dev/null >&2 || true
  rm -f "$tmp_out" 2>/dev/null
  exit 2
}

project_root=$(detect_project_root)
[[ -n "$project_root" ]] || notify_and_exit

cd "$project_root" || notify_and_exit

changed_files=$(git diff --name-only 2>/dev/null; git diff --cached --name-only 2>/dev/null)
[[ -n "$changed_files" ]] || {
  rm -f "$counter_file"
  notify_and_exit
}

changed_files=$(printf '%s\n' "$changed_files" | sort -u)

formatted=0
while IFS= read -r file; do
  [[ -n "$file" && -f "$file" ]] || continue
  detect_checker "$file" "$project_root"
  [[ -n "$FMT_CMD" ]] || continue
  before=$(file_checksum "$file")
  portable_timeout 5 bash -c "$FMT_CMD \"\$1\"" _ "$file" &>/dev/null || true
  after=$(file_checksum "$file")
  [[ -n "$before" && "$before" != "$after" ]] && formatted=$((formatted + 1))
done <<< "$changed_files"

(( formatted > 0 )) && echo "[codex final-gate] auto-formatted ${formatted} file(s)"

# Run one suite from a subdirectory, failing the gate on nonzero.
run_suite() {
  local label="$1" dir="$2"; shift 2
  set +e
  ( cd "$project_root/$dir" 2>/dev/null && portable_timeout "$SUITE_TIMEOUT" "$@" ) > "$tmp_out" 2>&1
  local rc=$?
  set -e
  (( rc == 0 )) || fail_gate "$label"
}

# Stage 1: this repo's own suites, selected by changed path. Mirrors the same
# stage in claude/hooks/stop-handler.sh. The suites existed but were wired to
# nothing, so a change could ship them red — that is how a rule asserted
# verbatim by ai/lib/*.test.mjs got deleted. Triggers are scoped so untouched
# areas cost nothing (pm-roadmap alone is ~50s).
if [[ "$project_root" == "$HOME/.config" ]] && command -v node &>/dev/null; then
  if grep -qE '^(ai|claude|codex)/.*\.(md|sh)$' <<< "$changed_files"; then
    run_suite "contract tests" . \
      node --test ai/lib/session-routing-consumers.test.mjs ai/lib/inject-context-hooks.test.mjs
  fi
  if grep -qE '^ai/lib/' <<< "$changed_files"; then
    run_suite "ai/lib suite" . bash -c 'node --test ai/lib/*.test.mjs'
  fi
  if grep -qE '^ai/skills/pm-roadmap/' <<< "$changed_files"; then
    run_suite "pm-roadmap tests" ai/skills/pm-roadmap npm test --silent
  fi
  if grep -qE '^ai/skills/pm-context/' <<< "$changed_files"; then
    run_suite "pm-context tests" ai/skills/pm-context npm test --silent
  fi
  if grep -qE '^ai/skills/config-audit/' <<< "$changed_files" && command -v go &>/dev/null; then
    run_suite "config-audit go tests" ai/skills/config-audit/scripts go test ./...
  fi
fi

# Stage 2: type check
CHECK_CMD="" LANG_LABEL=""
while IFS= read -r file; do
  detect_checker "$file" "$project_root"
  [[ -n "$CHECK_CMD" ]] && break
done <<< "$changed_files"

[[ -n "$CHECK_CMD" ]] || {
  rm -f "$counter_file"
  notify_and_exit
}

set +e
portable_timeout "$CHECKER_TIMEOUT" bash -c "$CHECK_CMD" > "$tmp_out" 2>&1
exit_code=$?
set -e

if [[ $exit_code -eq 0 ]]; then
  rm -f "$counter_file"
  notify_and_exit
fi

fail_gate "${LANG_LABEL} check"
