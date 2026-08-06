#!/bin/bash
# ai/scripts/bootstrap.sh — orchestrator for the 3-tier deploy.
# Calls each tool's bootstrap if the tool is installed.
# Performs auto-backup of ~/.claude and ~/.codex on first/each run, retaining
# at most KEEP_BACKUPS copies and dropping anything older than 7 days.
# Final sanity checks after both tools deploy.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
AI_DIR="$ROOT_DIR/ai"
CLAUDE_DIR="$ROOT_DIR/claude"
CODEX_DIR="$ROOT_DIR/codex"

NO_BACKUP=0
NO_CLEANUP=0
KEEP_BACKUPS=3
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

# ── 2. Cleanup old backups (keep newest KEEP_BACKUPS, drop anything >7d) ──
# Age alone cannot bound repeated deploys: 8 runs in one afternoon left 7GB
# behind, every copy younger than the 7-day cutoff. The count sweep is the
# real guard; the age sweep only trims what outlives it.
if [ "$NO_CLEANUP" -eq 0 ]; then
    for prefix in .claude.bak .codex.bak; do
        find "$HOME" -maxdepth 1 -type d -name "$prefix.*" -mtime +7 -exec rm -rf {} + 2>/dev/null || true
        ls -dt "$HOME/$prefix".* 2>/dev/null | tail -n +$(( KEEP_BACKUPS + 1 )) | xargs -I{} rm -rf {} || true
    done
fi

# ── 3. Tool bootstraps ──
"$CLAUDE_DIR/scripts/bootstrap.sh"

if command -v codex &>/dev/null; then
    "$CODEX_DIR/scripts/bootstrap.sh"
else
    echo "Skipped codex bootstrap (codex CLI not installed)."
fi

# ── 4. Shared notifier ──
case "$(uname -s)" in
    Darwin)
        if command -v swiftc &>/dev/null; then
            "$ROOT_DIR/notifier/macos/build.sh"
        else
            echo "Skipped AgentNotifier macOS build (swiftc not found)."
        fi
        ;;
    Linux)
        if command -v go &>/dev/null; then
            "$ROOT_DIR/notifier/linux/build.sh"
        else
            echo "Skipped AgentNotifier Linux build (go not found)."
        fi
        ;;
esac

# ── 5. Sanity ──
"$AI_DIR/lib/verify-no-residual-tokens.sh"
"$AI_DIR/lib/verify-agents-md-size.sh"

# ── 6. Notice ──
cat <<'EOF'

=== Bootstrap complete ===
Edit source files under ~/.config/ai/, claude/, codex/ — NOT the deployed copies.
- Most ~/.claude/* are symlinks (Claude); editing those mutates ai/ originals.
- ~/.claude/CLAUDE.md is a COPY (keeps @imports internal). Direct edits are lost.
- ~/.codex/AGENTS.md is generated (concat+sed expand). Direct edits are lost.
- ~/.claude/MEMORY.md is generated. Direct edits are lost.
- Skills overlay: ~/.claude/skills/, ~/.agents/skills/ (Codex).
- AgentNotifier is shared by Claude and Codex hooks.
- New ai/*.md? Add to ai/AGENTS.manifest before next bootstrap.
EOF
