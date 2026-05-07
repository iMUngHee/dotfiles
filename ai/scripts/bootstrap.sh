#!/bin/bash
# ai/scripts/bootstrap.sh — orchestrator for the 3-tier deploy.
# Calls each tool's bootstrap if the tool is installed.
# Performs auto-backup of ~/.claude and ~/.codex on first/each run, with
# 7-day retention cleanup. Final sanity checks after both tools deploy.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
AI_DIR="$ROOT_DIR/ai"
CLAUDE_DIR="$ROOT_DIR/claude"
CODEX_DIR="$ROOT_DIR/codex"

NO_BACKUP=0
NO_CLEANUP=0
for arg in "$@"; do
    case "$arg" in
        --no-backup) NO_BACKUP=1 ;;
        --no-cleanup-backups) NO_CLEANUP=1 ;;
    esac
done

echo "=== ai orchestrator bootstrap ==="
echo "Root:   $ROOT_DIR"

# ── 1. Backup (unless --no-backup) ──
if [ "$NO_BACKUP" -eq 0 ]; then
    TS=$(date +%s)
    if [ -d "$HOME/.claude" ] && [ ! -L "$HOME/.claude" ]; then
        cp -a "$HOME/.claude" "$HOME/.claude.bak.$TS"
        echo "Backed up ~/.claude → ~/.claude.bak.$TS"
    fi
    if [ -d "$HOME/.codex" ] && [ ! -L "$HOME/.codex" ]; then
        cp -a "$HOME/.codex" "$HOME/.codex.bak.$TS"
        echo "Backed up ~/.codex → ~/.codex.bak.$TS"
    fi
fi

# ── 2. Cleanup old backups (>7d) ──
if [ "$NO_CLEANUP" -eq 0 ]; then
    find "$HOME" -maxdepth 1 -type d -name '.claude.bak.*' -mtime +7 -exec rm -rf {} + 2>/dev/null || true
    find "$HOME" -maxdepth 1 -type d -name '.codex.bak.*'  -mtime +7 -exec rm -rf {} + 2>/dev/null || true
fi

# ── 3. Tool bootstraps ──
"$CLAUDE_DIR/scripts/bootstrap.sh"

if command -v codex &>/dev/null; then
    "$CODEX_DIR/scripts/bootstrap.sh"
else
    echo "Skipped codex bootstrap (codex CLI not installed)."
fi

# ── 4. Sanity ──
"$AI_DIR/lib/verify-no-residual-tokens.sh"
"$AI_DIR/lib/verify-agents-md-size.sh"

# ── 5. Notice ──
cat <<'EOF'

=== Bootstrap complete ===
Edit source files under ~/.config/ai/, claude/, codex/ — NOT the deployed copies.
- ~/.claude/* are symlinks (Claude); editing those mutates ai/ originals.
- ~/.codex/AGENTS.md is generated (concat+sed expand). Direct edits are lost.
- ~/.claude/MEMORY.md is generated. Direct edits are lost.
- Skills overlay: ~/.claude/skills/, ~/.agents/skills/ (Codex).
- New ai/*.md? Add to ai/AGENTS.manifest before next bootstrap.
EOF
