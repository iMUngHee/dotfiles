#!/bin/bash
# Verify ~/.codex/AGENTS.md size against the cap declared in
# codex/config.toml.template's project_doc_max_bytes.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TEMPLATE="$ROOT_DIR/codex/config.toml.template"
TARGET="$HOME/.codex/AGENTS.md"

[ -f "$TARGET" ] || { echo "OK: ~/.codex/AGENTS.md not present (codex not deployed)"; exit 0; }

CAP=$(awk -F'=' '/^[[:space:]]*project_doc_max_bytes[[:space:]]*=/ { gsub(/[[:space:]]/, "", $2); print $2 }' "$TEMPLATE" 2>/dev/null)
CAP=${CAP:-32768}

SIZE=$(wc -c < "$TARGET" | tr -d ' ')

if [ "$SIZE" -gt "$CAP" ]; then
    echo "FAIL: ~/.codex/AGENTS.md is $SIZE B (cap $CAP B). Codex will head-truncate the tail."
    exit 1
fi

PCT=$((SIZE * 100 / CAP))
echo "OK: ~/.codex/AGENTS.md $SIZE B / $CAP B ($PCT%)"
