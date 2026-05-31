#!/usr/bin/env bash
# Stop hook: bounded final quality gate, then shared notification.
set -euo pipefail

MAX_RETRIES=2
CHECKER_TIMEOUT=30
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

current_count=0
if [[ -f "$counter_file" ]]; then
  current_count=$(cat "$counter_file" 2>/dev/null || echo 0)
  [[ "$current_count" =~ ^[0-9]+$ ]] || current_count=0
fi

if (( current_count >= MAX_RETRIES )); then
  output=$(head -10 "$tmp_out")
  echo "[codex final-gate] ${LANG_LABEL} check failed after ${MAX_RETRIES} retries. Allowing stop." >&2
  [[ -n "$output" ]] && echo "$output" >&2
  rm -f "$counter_file"
  notify_and_exit
fi

echo $((current_count + 1)) > "$counter_file"
output=$(head -20 "$tmp_out")
echo "[codex final-gate] ${LANG_LABEL} check failed (attempt $((current_count + 1))/${MAX_RETRIES}). Fix and retry." >&2
[[ -n "$output" ]] && echo "$output" >&2
rm -f "$tmp_out" 2>/dev/null
exit 2
