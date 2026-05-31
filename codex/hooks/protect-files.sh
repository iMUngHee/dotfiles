#!/usr/bin/env bash
# PreToolUse hook: block access to sensitive files and lockfiles.
set -euo pipefail

input=$(cat)

if ! command -v jq &>/dev/null; then
  echo "[codex protect-files] Blocked: jq not found." >&2
  exit 2
fi

ext_patterns=(".env" ".pem" ".key" ".p12" ".pfx")
exact_patterns=("package-lock.json" "pnpm-lock.yaml" "yarn.lock" "Cargo.lock" "go.sum" "bun.lock" "bun.lockb")
segment_patterns=("credentials" "secrets")
substring_patterns=("-secret")
# Allowlisted basenames that legitimately contain a blocked substring
# (OS secret-store helpers). Referencing or editing these is permitted.
allowlist_basenames=("mcp-secret-env.sh" "mcp-secret-set.sh")

check_file() {
  local f="$1"
  [[ -z "$f" ]] && return 1

  local base
  base="$(basename "$f")"

  # Allowlist: OS secret-store helpers legitimately contain a blocked
  # substring ('-secret'). Referencing or editing them is permitted.
  for a in "${allowlist_basenames[@]}"; do
    [[ "$base" == "$a" ]] && return 1
  done

  for p in "${ext_patterns[@]}"; do
    if [[ "$base" == *"$p" ]]; then
      echo "[codex protect-files] Blocked: '$f' matches extension pattern '$p'." >&2
      return 0
    fi
  done

  if [[ "$base" == .env.* ]]; then
    echo "[codex protect-files] Blocked: '$f' matches .env.* pattern." >&2
    return 0
  fi

  for p in "${exact_patterns[@]}"; do
    if [[ "$base" == "$p" ]]; then
      echo "[codex protect-files] Blocked: '$f' matches exact filename pattern '$p'." >&2
      return 0
    fi
  done

  for p in "${segment_patterns[@]}"; do
    if [[ "$f" == *"/$p/"* || "$f" == "$p/"* || "$base" == "$p" ]]; then
      echo "[codex protect-files] Blocked: '$f' matches path segment pattern '$p'." >&2
      return 0
    fi
  done

  for p in "${substring_patterns[@]}"; do
    if [[ "$f" == *"$p"* ]]; then
      echo "[codex protect-files] Blocked: '$f' matches substring pattern '$p'." >&2
      return 0
    fi
  done

  return 1
}

check_command() {
  local cmd="$1"
  [[ -z "$cmd" ]] && return 1

  # Mask allowlisted helper basenames before matching so referencing the OS
  # secret-store helpers is not blocked by the '-secret' substring.
  local scan="$cmd"
  for a in "${allowlist_basenames[@]}"; do
    scan="${scan//$a/__allowlisted__}"
  done

  local all_patterns=()
  all_patterns+=("${ext_patterns[@]}")
  all_patterns+=("${exact_patterns[@]}")
  all_patterns+=("${segment_patterns[@]}")
  all_patterns+=("${substring_patterns[@]}")
  all_patterns+=(".env.")

  for p in "${all_patterns[@]}"; do
    if [[ "$scan" == *"$p"* ]]; then
      echo "[codex protect-files] Blocked: command references sensitive pattern '$p'." >&2
      return 0
    fi
  done

  return 1
}

tool=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)
command_text=$(printf '%s' "$input" | jq -r '
  .tool_input.command //
  .tool_input.cmd //
  .tool_input.shell_command //
  empty
' 2>/dev/null)

case "$tool" in
  Bash|exec_command|shell_command|local_shell|command)
    if check_command "$command_text"; then
      exit 2
    fi
    ;;
esac

paths=$(printf '%s' "$input" | jq -r '
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
' 2>/dev/null)

[[ -z "$paths" ]] && exit 0

while IFS= read -r path; do
  if check_file "$path"; then
    exit 2
  fi
done <<< "$paths"

exit 0
