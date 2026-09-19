#!/bin/bash
# lib/shell-env.sh — shell environment steps shared by every platform bootstrap.
#
# Sourced, not executed. homebrew/bootstrap.sh (macOS) and arch/bootstrap.sh
# (Arch/Omarchy) both need the same two guarantees, and windows/ has its own
# PowerShell equivalent. Keeping them here means a fix to the ZDOTDIR handoff
# lands once instead of drifting between the two Unix package layers.
#
# Callers may define warn(); a no-op-safe fallback is provided so this file can
# be sourced standalone.

if ! declare -F warn >/dev/null 2>&1; then
    warn() { echo "⚠ $1"; }
fi
have() { command -v "$1" >/dev/null 2>&1; }

# ── ~/.zshenv ZDOTDIR 보장 (3-케이스) ──────────────────────────
# zsh reads ~/.zshenv before anything else, and it is the only file whose
# location is not ZDOTDIR-relative — so it is where the handoff to
# ~/.config/zsh has to happen. The three cases are: no file, a file that
# already sets ZDOTDIR (leave it alone, it may be deliberate), and a file that
# does not (append a marked block, after a backup).
ensure_zshenv() {
    local zshenv="$HOME/.zshenv"
    local mark_start="# >>> config-bootstrap >>>"
    local mark_end="# <<< config-bootstrap <<<"
    local block
    block="$mark_start
export ZDOTDIR=\"\$HOME/.config/zsh\"
export ZSHRC_PATH=\"\$ZDOTDIR/.zshrc\"
$mark_end"
    if [ ! -f "$zshenv" ]; then
        printf '%s\n' "$block" >"$zshenv"
        echo "~/.zshenv created (ZDOTDIR)"
    elif grep -q "ZDOTDIR" "$zshenv"; then
        echo "~/.zshenv already sets ZDOTDIR — unchanged"
    elif grep -qF "$mark_start" "$zshenv"; then
        echo "~/.zshenv managed block already present — unchanged"
    else
        cp "$zshenv" "$zshenv.bak.$(date +%s)"
        printf '\n%s\n' "$block" >>"$zshenv"
        echo "~/.zshenv: appended ZDOTDIR managed block (backup saved)"
    fi
}

# ── oh-my-zsh (KEEP_ZSHRC — zsh/.zshrc is the repo's, not the installer's) ──
ensure_oh_my_zsh() {
    if [ -d "$HOME/.oh-my-zsh" ]; then
        echo "oh-my-zsh present — skip"
        return 0
    fi
    echo "── installing oh-my-zsh ──"
    if ! have curl; then
        warn "curl not found — skipped oh-my-zsh"
        return 0
    fi
    KEEP_ZSHRC=yes RUNZSH=no CHSH=no \
        sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" \
        || warn "oh-my-zsh install failed"
}
