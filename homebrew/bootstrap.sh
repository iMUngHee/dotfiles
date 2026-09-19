#!/bin/bash
# homebrew/bootstrap.sh — install packages + shell env the Brewfile can't cover.
#   - brew bundle (formula/cask; OS guards live in the Brewfile)
#   - ~/.zshenv ZDOTDIR guarantee   (lib/shell-env.sh)
#   - oh-my-zsh, keeping the repo zshrc (lib/shell-env.sh)
#
# This is the macOS package layer. Linux reaches it only on a Linuxbrew box
# with no pacman — Arch/Omarchy goes to arch/bootstrap.sh instead, which is why
# there is no longer a Linux-only block here: the ghostty AppImage download and
# the claude.ai install.sh pipe existed because bazzite had a package for
# neither. Both are ordinary entries in arch/packages.sh now.
#
# Idempotent: re-running is safe. Optional-step failures are collected and
# printed as a WARN summary; only critical failures (no brew) abort.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OS="$(uname -s)"
WARNINGS=()

warn() { echo "⚠ $1"; WARNINGS+=("$1"); }
have() { command -v "$1" >/dev/null 2>&1; }

# shellcheck source=../lib/shell-env.sh
. "$ROOT_DIR/lib/shell-env.sh"

# ── brew 경로 감지 (zsh/.zshrc:7-10 패턴) ──────────────────────
if [ -x /opt/homebrew/bin/brew ]; then
    BREW=/opt/homebrew/bin/brew
elif [ -x /home/linuxbrew/.linuxbrew/bin/brew ]; then
    BREW=/home/linuxbrew/.linuxbrew/bin/brew
elif have brew; then
    BREW="$(command -v brew)"
else
    echo "ERROR: Homebrew not found. Install first: https://brew.sh"   # critical
    exit 1
fi

# brew shellenv — 실패를 eval 뒤에 묻지 않도록 명시 처리
if shellenv_out="$("$BREW" shellenv)"; then
    eval "$shellenv_out"
else
    echo "ERROR: '$BREW shellenv' failed"
    exit 1
fi

echo "=== homebrew bootstrap ($OS) ==="
echo "brew: $BREW"

# ── 1. brew bundle ────────────────────────────────────────────
echo "── brew bundle ──"
brew bundle --file "$SCRIPT_DIR/Brewfile"

# ── 2+3. shell environment (shared with the Arch path) ────────
ensure_zshenv
ensure_oh_my_zsh

# ── WARN summary (실패가 exit 0에 묻히지 않도록) ──────────────
if [ "${#WARNINGS[@]}" -gt 0 ]; then
    echo ""
    echo "=== ⚠ ${#WARNINGS[@]} warning(s) ==="
    for w in "${WARNINGS[@]}"; do echo "  - $w"; done
fi
echo "=== homebrew bootstrap done ==="
