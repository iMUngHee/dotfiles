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

# ── ~/.zshenv ZDOTDIR 보장 (4-케이스) ──────────────────────────
# zsh reads ~/.zshenv before anything else, and it is the only file whose
# location is not ZDOTDIR-relative — so it is where the handoff to
# ~/.config/zsh has to happen. zsh never reads $ZDOTDIR/.zshenv by itself, so
# the block sources zsh/.zshenv for environment every zsh needs. The four cases
# are: no file, a file with our marked block (rewrite it when it differs, so
# existing machines pick up block changes), a file that sets ZDOTDIR itself
# (leave it alone, it may be deliberate), and a file that does neither (append
# the block, after a backup).
ensure_zshenv() {
    local zshenv="$HOME/.zshenv"
    local mark_start="# >>> config-bootstrap >>>"
    local mark_end="# <<< config-bootstrap <<<"
    local block current updated
    block="$mark_start
export ZDOTDIR=\"\$HOME/.config/zsh\"
export ZSHRC_PATH=\"\$ZDOTDIR/.zshrc\"
if [ -f \"\$ZDOTDIR/.zshenv\" ]; then . \"\$ZDOTDIR/.zshenv\"; fi
$mark_end"
    if [ ! -f "$zshenv" ]; then
        printf '%s\n' "$block" >"$zshenv"
        echo "~/.zshenv created (ZDOTDIR)"
    elif grep -qxF "$mark_start" "$zshenv"; then
        # Rewriting without exactly one end marker would drop the lines after it.
        if [ "$(grep -cxF "$mark_start" "$zshenv")" != 1 ] || [ "$(grep -cxF "$mark_end" "$zshenv")" != 1 ]; then
            warn "~/.zshenv managed block lacks a single end marker — unchanged; fix it by hand"
            return 0
        fi
        current=$(awk -v s="$mark_start" -v e="$mark_end" '$0 == s { f = 1 } f { print } $0 == e { f = 0 }' "$zshenv")
        if [ "$current" = "$block" ]; then
            echo "~/.zshenv managed block already current — unchanged"
            return 0
        fi
        # ENVIRON, not -v: -v would process backslash escapes in the block.
        updated=$(BLOCK="$block" awk -v s="$mark_start" -v e="$mark_end" \
            '$0 == s { print ENVIRON["BLOCK"]; skip = 1; next } skip && $0 == e { skip = 0; next } !skip' \
            "$zshenv") || { warn "~/.zshenv: could not rewrite the managed block — unchanged"; return 0; }
        cp "$zshenv" "$zshenv.bak.$(date +%s)" || { warn "~/.zshenv: backup failed — unchanged"; return 0; }
        # Write through the existing file so a symlinked ~/.zshenv and its mode survive.
        printf '%s\n' "$updated" >"$zshenv" || { warn "~/.zshenv: write failed — restore it from the backup"; return 0; }
        echo "~/.zshenv: refreshed managed block (backup saved)"
    elif grep -q "ZDOTDIR" "$zshenv"; then
        echo "~/.zshenv already sets ZDOTDIR — unchanged"
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
