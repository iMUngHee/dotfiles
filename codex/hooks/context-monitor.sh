#!/usr/bin/env bash
# PostToolUse hook: warn when Codex hook input includes context usage metrics.
set -euo pipefail

input=$(cat)
session_id=$(printf '%s' "$input" | jq -r '.session_id // "default"' 2>/dev/null)
session_id="${session_id//[^a-zA-Z0-9_-]/}"

pct=$(printf '%s' "$input" | jq -r '
  .context_window.used_percentage //
  .context.used_percentage //
  .usage.context_used_percentage //
  empty
' 2>/dev/null)

[[ -n "$pct" ]] || exit 0
pct_int=${pct%.*}
[[ "$pct_int" =~ ^[0-9]+$ ]] || exit 0
[[ "$pct_int" -ge 50 ]] || exit 0

marker_dir="/tmp/codex/sessions/${session_id:-default}/context-markers"
mkdir -p "$marker_dir"

if [[ "$pct_int" -ge 65 && ! -f "$marker_dir/critical" ]]; then
  touch "$marker_dir/critical" "$marker_dir/half"
  echo "[codex context monitor] Context ${pct_int}% used. Finish the current step and preserve task state."
  exit 0
fi

if [[ "$pct_int" -ge 50 && ! -f "$marker_dir/half" ]]; then
  touch "$marker_dir/half"
  echo "[codex context monitor] Context ${pct_int}% used. Consider wrapping up the current task."
  exit 0
fi

exit 0
