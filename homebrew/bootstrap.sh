#!/bin/bash
# homebrew/bootstrap.sh — install packages + shell env the Brewfile can't cover.
#   - brew bundle (formula/cask/flatpak; OS guards live in the Brewfile)
#   - ~/.zshenv ZDOTDIR guarantee (3 cases)
#   - oh-my-zsh (both platforms, keeps repo zshrc)
#   - Linux-only: ghostty (AppImage), claude-code (native installer)
# Idempotent: re-running is safe. Optional-step failures are collected and
# printed as a WARN summary; only critical failures (no brew) abort.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OS="$(uname -s)"
WARNINGS=()

warn() { echo "⚠ $1"; WARNINGS+=("$1"); }
have() { command -v "$1" >/dev/null 2>&1; }

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

# ── 1. brew bundle (formula/cask/flatpak) ─────────────────────
echo "── brew bundle ──"
brew bundle --file "$SCRIPT_DIR/Brewfile"

# ── 2. ~/.zshenv ZDOTDIR 보장 (3-케이스) ──────────────────────
ZSHENV="$HOME/.zshenv"
ZMARK_START="# >>> config-bootstrap >>>"
ZMARK_END="# <<< config-bootstrap <<<"
ensure_zshenv() {
    local block
    block="$ZMARK_START
export ZDOTDIR=\"\$HOME/.config/zsh\"
export ZSHRC_PATH=\"\$ZDOTDIR/.zshrc\"
$ZMARK_END"
    if [ ! -f "$ZSHENV" ]; then
        printf '%s\n' "$block" >"$ZSHENV"
        echo "~/.zshenv created (ZDOTDIR)"
    elif grep -q "ZDOTDIR" "$ZSHENV"; then
        echo "~/.zshenv already sets ZDOTDIR — unchanged"
    elif grep -qF "$ZMARK_START" "$ZSHENV"; then
        echo "~/.zshenv managed block already present — unchanged"
    else
        cp "$ZSHENV" "$ZSHENV.bak.$(date +%s)"
        printf '\n%s\n' "$block" >>"$ZSHENV"
        echo "~/.zshenv: appended ZDOTDIR managed block (backup saved)"
    fi
}
ensure_zshenv

# ── 3. oh-my-zsh (both, keep repo zshrc) ──────────────────────
if [ ! -d "$HOME/.oh-my-zsh" ]; then
    echo "── installing oh-my-zsh ──"
    if have curl; then
        KEEP_ZSHRC=yes RUNZSH=no CHSH=no \
            sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" \
            || warn "oh-my-zsh install failed"
    else
        warn "curl not found — skipped oh-my-zsh"
    fi
else
    echo "oh-my-zsh present — skip"
fi

# ── 4. Linux-only: ghostty (AppImage), claude-code (installer) ─
LOCAL_BIN="$HOME/.local/bin"

install_ghostty() {
    local arch json appimage_url sum_url tmp file expected actual sum
    case "$(uname -m)" in
        x86_64) arch=x86_64 ;;
        aarch64 | arm64) arch=aarch64 ;;
        *) warn "ghostty: unsupported arch $(uname -m)"; return 0 ;;
    esac
    have jq || { warn "ghostty: jq required to resolve release — skipped"; return 0; }
    json="$(curl -fsSL https://api.github.com/repos/pkgforge-dev/ghostty-appimage/releases/latest)" \
        || { warn "ghostty: GitHub API fetch failed"; return 0; }
    appimage_url="$(printf '%s' "$json" | jq -r --arg a "$arch" \
        '.assets[]|select(.name|test("Ghostty.*"+$a+"\\.AppImage$"))|.browser_download_url' | head -1)"
    sum_url="$(printf '%s' "$json" | jq -r --arg a "$arch" \
        '.assets[]|select(.name|test("Ghostty.*"+$a+".*(sha256|SHA256)"))|.browser_download_url' | head -1)"
    [ -n "$appimage_url" ] || { warn "ghostty: no AppImage asset for $arch"; return 0; }

    mkdir -p "$LOCAL_BIN"
    tmp="$(mktemp -d "$LOCAL_BIN/.ghostty-install.XXXXXX")"   # same fs → atomic mv
    file="$tmp/ghostty.AppImage"
    echo "  download: $appimage_url"
    curl -fsSL -o "$file" "$appimage_url" || { warn "ghostty: download failed"; rm -rf "$tmp"; return 0; }

    # checksum 3-갈래: 일치→설치 / 없음→WARN+진행 / mismatch→중단
    if [ -n "$sum_url" ]; then
        sum="$(curl -fsSL "$sum_url" 2>/dev/null || true)"
        expected="$(printf '%s' "$sum" | grep -oiE '[0-9a-f]{64}' | head -1)"
        actual="$(sha256sum "$file" | awk '{print $1}')"
        if [ -z "$expected" ]; then
            warn "ghostty: checksum unreadable — proceeding best-effort (src=$sum_url)"
        elif [ "$expected" = "$actual" ]; then
            echo "  checksum OK"
        else
            warn "ghostty: CHECKSUM MISMATCH — aborting install (possible tampering)"
            rm -rf "$tmp"; return 0
        fi
    else
        warn "ghostty: no checksum asset — proceeding best-effort (src=$appimage_url)"
    fi

    chmod +x "$file"
    mv -f "$file" "$LOCAL_BIN/ghostty"   # atomic (same filesystem)
    rm -rf "$tmp"
    echo "  installed: $LOCAL_BIN/ghostty"
}

if [ "$OS" = "Linux" ]; then
    if ! have ghostty && [ ! -x "$LOCAL_BIN/ghostty" ]; then
        echo "── installing ghostty (AppImage) ──"
        install_ghostty
    else
        echo "ghostty present — skip"
    fi

    if ! have claude; then
        echo "── installing claude-code (native installer) ──"
        echo "  source: https://claude.ai/install.sh"
        curl -fsSL https://claude.ai/install.sh | bash || warn "claude-code install failed"
    else
        echo "claude-code present — skip"
    fi
fi

# ── WARN summary (실패가 exit 0에 묻히지 않도록) ──────────────
if [ "${#WARNINGS[@]}" -gt 0 ]; then
    echo ""
    echo "=== ⚠ ${#WARNINGS[@]} warning(s) ==="
    for w in "${WARNINGS[@]}"; do echo "  - $w"; done
fi
echo "=== homebrew bootstrap done ==="
