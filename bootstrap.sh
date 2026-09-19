#!/bin/bash
# bootstrap.sh — ~/.config root entrypoint for a fresh machine.
#   1) the platform's package layer — see the dispatch table below
#   2) put freshly-installed CLIs on PATH in THIS scope
#   3) ai/scripts/bootstrap.sh — deploy claude/codex config (flags passed through)
#
# Platform dispatch:
#   Darwin                 → homebrew/bootstrap.sh   (brew bundle + Brewfile)
#   Linux + pacman         → arch/bootstrap.sh       (pacman/AUR + mise)
#   Linux + brew, no pacman→ homebrew/bootstrap.sh   (Linuxbrew)
#   Windows                → windows/bootstrap.ps1, which calls ai/ directly
#
# Step 2 matters because a child script's PATH edits do NOT propagate to this
# parent; without it the AI deploy's `command -v codex` would still skip.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OS="$(uname -s)"

echo "=== ~/.config bootstrap ($OS) ==="

have() { command -v "$1" >/dev/null 2>&1; }

# ── 1. packages + shell environment ─────────────────────────────────────────
PLATFORM=""
if [ "$OS" = "Linux" ] && have pacman; then
    PLATFORM=arch
    "$SCRIPT_DIR/arch/bootstrap.sh"
else
    PLATFORM=homebrew
    "$SCRIPT_DIR/homebrew/bootstrap.sh"
fi

# ── 2. put the package layer's CLIs on PATH for the AI deploy (root scope) ──
case "$PLATFORM" in
    homebrew)
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
        ;;
    arch)
        # pacman writes to /usr/bin, already on PATH. mise does not: its shims
        # are what make `command -v codex` true, and a `mise install` that just
        # ran in the child leaves this shell's PATH untouched.
        for d in "$HOME/.local/share/mise/shims" "$HOME/.local/bin"; do
            [ -d "$d" ] && case ":$PATH:" in
                *":$d:"*) ;;
                *) PATH="$d:$PATH" ;;
            esac
        done
        export PATH
        ;;
esac

# ── 3. AI config deploy (e.g. --no-backup is forwarded) ─────────────────────
"$SCRIPT_DIR/ai/scripts/bootstrap.sh" "$@"

echo "=== ~/.config bootstrap done ==="
