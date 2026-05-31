#!/usr/bin/env bash
# PostToolUse hook: bounded auto-format and project check after file edits.
set -euo pipefail

DEBOUNCE_SEC=30
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"

source "$HOOK_DIR/lib/detect-project.sh"

input=$(cat)
session_id=$(printf '%s' "$input" | jq -r '.session_id // "default"' 2>/dev/null)
session_id="${session_id//[^a-zA-Z0-9_-]/}"

extract_paths() {
  printf '%s' "$input" | jq -r '
    .tool_input as $i |
    [
      $i.file_path?,
      $i.path?,
      $i.filename?,
      $i.source_path?,
      $i.destination_path?,
      $i.sourcePath?,
      $i.destinationPath?,
      ($i.files[]?.file_path?),
      ($i.files[]?.path?),
      ($i.edits[]?.file_path?),
      ($i.edits[]?.path?)
    ] | .[] | select(type == "string" and length > 0)
  ' 2>/dev/null

  printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null | awk '
    /^\*\*\* (Add|Update|Delete) File: / {
      sub(/^\*\*\* (Add|Update|Delete) File: /, "")
      print
      next
    }
    /^\*\*\* Move to: / {
      sub(/^\*\*\* Move to: /, "")
      print
      next
    }
  '
}

paths=$(extract_paths | awk 'NF && !seen[$0]++')
[[ -n "$paths" ]] || exit 0

project_root=$(detect_project_root)
[[ -n "$project_root" ]] || exit 0

debounce_file="/tmp/codex-pipeline-last-${session_id:-default}"
if [[ -f "$debounce_file" ]]; then
  last=$(cat "$debounce_file" 2>/dev/null)
  now=$(date +%s)
  if [[ -n "$last" ]] && (( now - last < DEBOUNCE_SEC )); then
    exit 0
  fi
fi
date +%s > "$debounce_file"

selected_check_cmd=""
selected_lang_label=""
selected_check_file=""

while IFS= read -r file; do
  [[ -n "$file" ]] || continue
  detect_checker "$file" "$project_root"

  if [[ -z "$selected_check_cmd" && -n "$CHECK_CMD" ]]; then
    selected_check_cmd="$CHECK_CMD"
    selected_lang_label="$LANG_LABEL"
    selected_check_file="$file"
  fi

  if [[ -f "$file" && -n "$FMT_CMD" ]]; then
    before=$(file_checksum "$file")
    if [[ -n "$before" ]]; then
      portable_timeout 5 bash -c "$FMT_CMD \"\$1\"" _ "$file" &>/dev/null || true
      after=$(file_checksum "$file")
      if [[ "$before" != "$after" ]]; then
        fmt_name="${FMT_CMD%% *}"
        fmt_name="${fmt_name##*/}"
        echo "[codex auto-format] $fmt_name formatted $(basename "$file")"
      fi
    fi
  fi
done <<< "$paths"

CHECK_CMD="$selected_check_cmd"
LANG_LABEL="$selected_lang_label"
[[ -n "$CHECK_CMD" ]] || exit 0

tmp_out="/tmp/codex-pipeline-check-output-${session_id:-default}"
set +e
(cd "$project_root" && portable_timeout 30 bash -c "$CHECK_CMD" > "$tmp_out" 2>&1)
exit_code=$?
set -e

if [[ $exit_code -ne 0 ]]; then
  output=$(head -20 "$tmp_out")
  if [[ -n "$output" ]]; then
    echo "[codex typecheck] ${LANG_LABEL} errors after editing $(basename "$selected_check_file"):"
    echo "$output"
  fi
fi

rm -f "$tmp_out" 2>/dev/null
exit 0
