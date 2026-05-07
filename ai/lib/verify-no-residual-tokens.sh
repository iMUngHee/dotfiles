#!/bin/bash
# Verify that ~/.codex/AGENTS.md (post-build) has no {{TOKEN}} residues,
# and that all tokens used in ai/ source are in the defined token set.
set -euo pipefail

KNOWN='\{\{(TOOL_HOME|TOOL_NAME|TOOL_NAME_LC|INSTRUCTIONS_FILE|CONFIG_FILE|PLAN_DIR|STATE_DIR)\}\}'

# 1. ~/.codex/AGENTS.md must have zero {{TOKEN}}
if [ -f "$HOME/.codex/AGENTS.md" ]; then
    residual=$(grep -E '\{\{[A-Z_]+\}\}' "$HOME/.codex/AGENTS.md" || true)
    if [ -n "$residual" ]; then
        echo "FAIL: residual tokens in ~/.codex/AGENTS.md"
        echo "$residual" | head -10
        exit 1
    fi
fi

# 2. ai/ source: detect undefined tokens
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
unknown=$(grep -rEo '\{\{[A-Z_]+\}\}' "$ROOT_DIR/ai/" 2>/dev/null \
    | grep -vE "$KNOWN" \
    | sort -u || true)
if [ -n "$unknown" ]; then
    echo "FAIL: undefined tokens used in ai/ source:"
    echo "$unknown"
    echo "Either add to the known token set in this script + bootstrap expand functions,"
    echo "or replace with literal value."
    exit 1
fi

echo "OK: no residual tokens in ~/.codex/AGENTS.md, no undefined tokens in ai/."
