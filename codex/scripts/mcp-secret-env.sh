#!/usr/bin/env bash
# Load MCP environment values from the OS secret store, then exec a server.
set -euo pipefail

profile="${1:-}"
if [[ -z "$profile" ]]; then
  echo "usage: mcp-secret-env.sh <profile> -- <command> [args...]" >&2
  exit 2
fi
shift
if [[ "${1:-}" != "--" ]]; then
  echo "usage: mcp-secret-env.sh <profile> -- <command> [args...]" >&2
  exit 2
fi
shift
[[ "$#" -gt 0 ]] || {
  echo "mcp-secret-env: missing command" >&2
  exit 2
}

required_keys() {
  case "$profile" in
    mcp-atlassian-go)
      printf '%s\n' CONFLUENCE_PERSONAL_TOKEN CONFLUENCE_URL JIRA_PERSONAL_TOKEN JIRA_URL
      ;;
    mcp-github)
      printf '%s\n' GITHUB_HOST GITHUB_PERSONAL_ACCESS_TOKEN
      ;;
    *)
      echo "mcp-secret-env: unknown profile '${profile}'" >&2
      return 2
      ;;
  esac
}

lookup_secret() {
  local key="$1"
  local current="${!key:-}"
  if [[ -n "$current" ]]; then
    printf '%s' "$current"
    return 0
  fi

  case "$(uname -s)" in
    Darwin)
      security find-generic-password -s "codex-mcp:${profile}" -a "$key" -w 2>/dev/null
      ;;
    Linux)
      command -v secret-tool &>/dev/null || return 1
      secret-tool lookup service codex-mcp profile "$profile" key "$key" 2>/dev/null
      ;;
    *)
      return 1
      ;;
  esac
}

while IFS= read -r key; do
  [[ -n "$key" ]] || continue
  value=$(lookup_secret "$key" || true)
  if [[ -z "$value" ]]; then
    echo "mcp-secret-env: missing ${profile}/${key}" >&2
    exit 2
  fi
  export "$key=$value"
done < <(required_keys)

exec "$@"
