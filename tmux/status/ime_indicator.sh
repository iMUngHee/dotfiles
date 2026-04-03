#!/usr/bin/env bash
# IME-aware cursor color for tmux + Ghostty
# Korean → red cursor | English → default cursor
# No stdout — silent side effect via tmux set -p cursor-colour

is_korean() {
    case "$(uname -s)" in
        Darwin)
            local src
            src=$(defaults read ~/Library/Preferences/com.apple.HIToolbox.plist \
                AppleCurrentKeyboardLayoutInputSourceID 2>/dev/null) || return 1
            [[ "$src" == *Korean* || "$src" == *Hangul* || "$src" == *Gureum* ]]
            ;;
        Linux)
            local src=""
            if command -v ibus &>/dev/null; then
                src=$(ibus engine 2>/dev/null)
            elif command -v fcitx5-remote &>/dev/null; then
                src=$(fcitx5-remote -n 2>/dev/null)
            fi
            [[ "$src" == *hangul* || "$src" == *Korean* || "$src" == *Hangul* ]]
            ;;
        *) return 1 ;;
    esac
}

# $TMUX_PANE may not be set in status-right #() context — fallback to display-message
pane="${TMUX_PANE:-$(tmux display-message -p '#{pane_id}' 2>/dev/null)}"
[[ -z "$pane" ]] && exit 0

if is_korean; then
    tmux set -p -t "$pane" cursor-colour "#f38ba8" 2>/dev/null   # Catppuccin red
    tmux set -p -t "$pane" window-style 'bg=#1e2e2e' 2>/dev/null # Catppuccin teal tint
else
    tmux set -p -t "$pane" cursor-colour "#cdd6f4" 2>/dev/null   # Catppuccin text (white)
    tmux set -pu -t "$pane" window-style 2>/dev/null              # Reset to default
fi
