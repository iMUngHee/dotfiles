#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLAUDE_DIR="$HOME/.claude"

echo "=== Claude Code dotfiles bootstrap ==="
echo "Repo:   $REPO_DIR"
echo "Target: $CLAUDE_DIR"
echo

# ── 0. Dependency check ──
if ! command -v jq &>/dev/null; then
    echo "ERROR: jq is required. Install: brew install jq"
    exit 1
fi

mkdir -p "$CLAUDE_DIR"

# ── 1. Symlink: read-only files ──
echo "Linking config files..."
for f in CLAUDE.md RTK.md PERSONAL.md DEVGUARD.md; do
    ln -sf "$REPO_DIR/$f" "$CLAUDE_DIR/$f"
done
ln -sf "$REPO_DIR/extensions/statusline.sh" "$CLAUDE_DIR/statusline.sh"

# ── 2. Symlink: directories ──
echo "Linking directories..."

# hooks/ — preserve .rtk-hook.sha256 if hooks/ was a real directory
if [ -d "$CLAUDE_DIR/hooks" ] && [ ! -L "$CLAUDE_DIR/hooks" ]; then
    cp "$CLAUDE_DIR/hooks/.rtk-hook.sha256" /tmp/.rtk-hook.sha256.bak 2>/dev/null || true
    rm -rf "$CLAUDE_DIR/hooks"
fi
ln -sfn "$REPO_DIR/hooks" "$CLAUDE_DIR/hooks"
cp /tmp/.rtk-hook.sha256.bak "$CLAUDE_DIR/hooks/.rtk-hook.sha256" 2>/dev/null || true

# commands/
if [ -d "$CLAUDE_DIR/commands" ] && [ ! -L "$CLAUDE_DIR/commands" ]; then
    rm -rf "$CLAUDE_DIR/commands"
fi
ln -sfn "$REPO_DIR/commands" "$CLAUDE_DIR/commands"

# ── 3. Merge: settings.json (repo keys override, local-only keys preserved) ──
echo "Deploying settings.json..."
if [ -f "$CLAUDE_DIR/settings.json" ]; then
    jq -s '
      .[0] as $local | .[1] as $repo |
      $local * $repo |
      .permissions.allow = (($local.permissions.allow // []) + ($repo.permissions.allow // []) | unique)
    ' "$CLAUDE_DIR/settings.json" "$REPO_DIR/settings.json" \
        > "$CLAUDE_DIR/settings.json.tmp" \
        && mv "$CLAUDE_DIR/settings.json.tmp" "$CLAUDE_DIR/settings.json"
else
    cp "$REPO_DIR/settings.json" "$CLAUDE_DIR/settings.json"
fi

# ── 4. MEMORY.md (merge base + private) ──
echo "Deploying MEMORY.md..."
{
    cat "$REPO_DIR/MEMORY.md"
    [ -f "$REPO_DIR/MEMORY.private.md" ] && cat "$REPO_DIR/MEMORY.private.md"
} > "$CLAUDE_DIR/MEMORY.md"

# ── 5. Symlink: memory directory (global, not under projects/) ──
echo "Linking memory..."
if [ -d "$CLAUDE_DIR/memory" ] && [ ! -L "$CLAUDE_DIR/memory" ]; then
    rm -rf "$CLAUDE_DIR/memory.bak"
    mv "$CLAUDE_DIR/memory" "$CLAUDE_DIR/memory.bak"
fi
ln -sfn "$REPO_DIR/memory" "$CLAUDE_DIR/memory"

# ── 6. Build ClaudeNotifier (optional, requires swiftc) ──
if command -v swiftc &>/dev/null; then
    echo
    echo "Building ClaudeNotifier..."
    bash "$REPO_DIR/notifier/build.sh"
else
    echo
    echo "Skipped ClaudeNotifier build (swiftc not found)."
fi

echo
echo "=== Bootstrap complete ==="
echo "Plugins: run '/plugins' inside Claude Code to reinstall."
