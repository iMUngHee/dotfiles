#!/bin/bash
# ai/scripts/sync-back.sh — orchestrator for sync-back.
# Calls each tool's sync-back if applicable.
# --strict: forward to per-tool scripts (currently used by claude sync-back
#           to fail on AGENTS.manifest drift instead of just warning).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CLAUDE_DIR="$ROOT_DIR/claude"
CODEX_DIR="$ROOT_DIR/codex"

"$CLAUDE_DIR/scripts/sync-back.sh" "$@"

if [ -x "$CODEX_DIR/scripts/sync-back.sh" ]; then
    "$CODEX_DIR/scripts/sync-back.sh" "$@"
fi
