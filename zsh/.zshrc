#
# ~/.zshenv
# export ZDOTDIR="$HOME/.config/zsh"
# export ZSHRC_PATH="$ZDOTDIR/.zshrc"
#

if [ -x /opt/homebrew/bin/brew ]; then
	eval "$(/opt/homebrew/bin/brew shellenv)"
fi

# Requried
export ZSH="$HOME/.oh-my-zsh"
export ZSH_CUSTOM="$ZDOTDIR/custom"
export LANG=en_US.UTF-8
export BAT_THEME="Catppuccin Mocha"

ZSH_THEME=""

plugins=(
	git
	zsh-autosuggestions
	zsh-syntax-highlighting
)

source $ZSH_CUSTOM/themes/catppuccin_mocha-zsh-syntax-highlighting.zsh
source $ZSH/oh-my-zsh.sh

# Custom prompt: full path + git + newline arrow (Catppuccin Mocha truecolor)
# Must be AFTER oh-my-zsh source (lib/theme-and-appearance.zsh overwrites defaults)
_c() { printf "%%{\\e[38;2;%d;%d;%dm%%}" "$1" "$2" "$3"; }
PROMPT="$(_c 137 180 250)%~%f \$(git_prompt_info)
%(?:$(_c 166 227 161):$(_c 243 139 168))➜%f "
ZSH_THEME_GIT_PROMPT_PREFIX="$(_c 203 166 247)git:($(_c 166 227 161)"
ZSH_THEME_GIT_PROMPT_SUFFIX="%f "
ZSH_THEME_GIT_PROMPT_DIRTY="$(_c 203 166 247)) $(_c 249 226 175)✗"
ZSH_THEME_GIT_PROMPT_CLEAN="$(_c 203 166 247)) $(_c 166 227 161)✔"
unfunction _c 2>/dev/null

# Script
conditional_eval() {
	local cmd="$1"
	shift

	if command -v "$cmd" >/dev/null; then
		eval "$("$cmd" "$@")"
	fi
}

## fnm
conditional_eval fnm env --use-on-cd

## thefuck
conditional_eval thefuck --alias plz

# $PATH
export PATH="$HOME/.local/share/nvim/mason/bin:$PATH"
export PATH="$(brew --prefix rustup)/bin:$PATH"

# Alias
alias buu="brew update;brew upgrade"
alias l="eza -alH --icons --git --color=always"
alias vim="nvim"
alias vi="nvim"
alias ulock="open -a ScreenSaverEngine"

# Preserve working directory across Claude Code sessions
claude() {
  local start_dir="$PWD"
  command claude "$@"
  cd "$start_dir"
}

# Utils
source $ZSH_CUSTOM/functions.zsh

# Loads private
if [ -r $ZDOTDIR/private.sh ]; then
  echo "Loads $ZDOTDIR/private.sh"
	source $ZDOTDIR/private.sh
fi
