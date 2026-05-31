#!/usr/bin/env bash
# Store one MCP environment value for codex/scripts/mcp-secret-env.sh.
set -euo pipefail

profile="${1:-}"
key="${2:-}"

if [[ -z "$profile" || -z "$key" ]]; then
  echo "usage: mcp-secret-set.sh <profile> <key> < secret-value" >&2
  exit 2
fi

value=$(cat)
if [[ -z "$value" ]]; then
  echo "mcp-secret-set: refused empty value for ${profile}/${key}" >&2
  exit 2
fi

case "$(uname -s)" in
  Darwin)
    security add-generic-password \
      -U \
      -s "codex-mcp:${profile}" \
      -a "$key" \
      -w "$value" >/dev/null
    ;;
  Linux)
    if ! command -v secret-tool &>/dev/null; then
      echo "mcp-secret-set: secret-tool not found" >&2
      exit 2
    fi
    printf '%s' "$value" | secret-tool store \
      --label="Codex MCP ${profile} ${key}" \
      service codex-mcp profile "$profile" key "$key"
    ;;
  *)
    echo "mcp-secret-set: unsupported OS" >&2
    exit 2
    ;;
esac
