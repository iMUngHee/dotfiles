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
export BAT_THEME="Dracula"

ZSH_THEME="dracula"

plugins=(
	git
	zsh-autosuggestions
	zsh-syntax-highlighting
)
prompt_context() {}

source $ZSH_CUSTOM/themes/dracula_theme.sh
source $ZSH/oh-my-zsh.sh

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

# Loads private
if [ -r $ZDOTDIR/private.sh ]; then
  echo "Loads $ZDOTDIR/private.sh"
	source $ZDOTDIR/private.sh
fi
