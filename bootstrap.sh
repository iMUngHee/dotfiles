#!/bin/bash
# bootstrap.sh — ~/.config root entrypoint for a fresh machine.
#   1) homebrew/bootstrap.sh  — brew bundle + ghostty/claude-code + oh-my-zsh + ~/.zshenv
#   2) brew shellenv in THIS scope so freshly-installed CLIs (e.g. codex) are on PATH
#   3) ai/scripts/bootstrap.sh — deploy claude/codex config (flags passed through)
#
# Step 2 matters because a child script's `brew shellenv` does NOT propagate to
# this parent; without it the AI deploy's `command -v codex` would still skip.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== ~/.config bootstrap ==="

# 1. packages + shell environment
"$SCRIPT_DIR/homebrew/bootstrap.sh"

# 2. put brew-installed CLIs on PATH for the AI deploy step (root scope)
if [ -x /opt/homebrew/bin/brew ]; then
    BREW=/opt/homebrew/bin/brew
elif [ -x /home/linuxbrew/.linuxbrew/bin/brew ]; then
    BREW=/home/linuxbrew/.linuxbrew/bin/brew
else
    BREW="$(command -v brew || true)"
fi
if [ -n "${BREW:-}" ] && [ -x "$BREW" ] && shellenv_out="$("$BREW" shellenv)"; then
    eval "$shellenv_out"
fi

# 3. AI config deploy (e.g. --no-backup is forwarded)
"$SCRIPT_DIR/ai/scripts/bootstrap.sh" "$@"

echo "=== ~/.config bootstrap done ==="
