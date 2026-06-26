#!/usr/bin/env bash
# Fail-open adapter for crux Codex hooks.
set -euo pipefail

event="${1:-}"
[[ -n "$event" ]] || exit 0

if ! command -v crux &>/dev/null; then
  exit 0
fi

tmp_out=$(mktemp "${TMPDIR:-/tmp}/codex-crux.XXXXXX")
tmp_err=$(mktemp "${TMPDIR:-/tmp}/codex-crux.err.XXXXXX")
cleanup() {
  rm -f "$tmp_out" "$tmp_err"
}
trap cleanup EXIT

if crux hook "$event" >"$tmp_out" 2>"$tmp_err"; then
  cat "$tmp_out"
  exit 0
fi

if [[ -s "$tmp_err" ]]; then
  sed 's/^/[codex crux] /' "$tmp_err" >&2
fi

exit 0
