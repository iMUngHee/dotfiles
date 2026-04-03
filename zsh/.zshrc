#
# ~/.zshenv
# export ZDOTDIR="$HOME/.config/zsh"
# export ZSHRC_PATH="$ZDOTDIR/.zshrc"
#

if [ -x /opt/homebrew/bin/brew ]; then
	eval "$(/opt/homebrew/bin/brew shellenv)"
fi

# Shell core
typeset -U path                 # PATH 중복 엔트리 자동 제거
setopt PUSHD_SILENT             # pushd/popd 스택 출력 억제
setopt GLOB_DOTS                # glob이 dotfile도 매칭
setopt HIST_FIND_NO_DUPS        # Ctrl+R 검색 시 중복 건너뜀
setopt HIST_REDUCE_BLANKS       # 히스토리 저장 시 불필요한 공백 제거
HISTSIZE=100000
SAVEHIST=100000

# Requried
export ZSH="$HOME/.oh-my-zsh"
export ZSH_CUSTOM="$ZDOTDIR/custom"
export LANG=en_US.UTF-8
export BAT_THEME="Catppuccin Mocha"
export EDITOR=nvim

ZSH_THEME=""

plugins=(
	git
	zsh-autosuggestions
	zsh-syntax-highlighting
	zsh-history-substring-search
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

# history-substring-search keybinds (↑/↓, C-p/C-n)
bindkey '^[[A' history-substring-search-up
bindkey '^[[B' history-substring-search-down
bindkey '^P' history-substring-search-up
bindkey '^N' history-substring-search-down

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

## fzf
export FZF_DEFAULT_COMMAND='fd --type f --hidden --follow --exclude .git'
export FZF_CTRL_T_COMMAND="$FZF_DEFAULT_COMMAND"
export FZF_CTRL_T_OPTS="--bind 'ctrl-h:transform:[[ \$FZF_PROMPT =~ hidden ]] &&
  echo \"reload(fd --type f --follow --exclude .git)+change-prompt(> )\" ||
  echo \"reload(fd --type f --hidden --follow --exclude .git)+change-prompt(hidden> )\"'"
export FZF_ALT_C_COMMAND='fd --type d --hidden --follow --exclude .git'
export FZF_ALT_C_OPTS="--bind 'ctrl-h:transform:[[ \$FZF_PROMPT =~ hidden ]] &&
  echo \"reload(fd --type d --follow --exclude .git)+change-prompt(> )\" ||
  echo \"reload(fd --type d --hidden --follow --exclude .git)+change-prompt(hidden> )\"'"
export FZF_DEFAULT_OPTS=" \
  --color=bg+:#313244,bg:#1e1e2e,spinner:#f5e0dc,hl:#f38ba8 \
  --color=fg:#cdd6f4,header:#f38ba8,info:#cba6f7,pointer:#f5e0dc \
  --color=marker:#b4befe,fg+:#cdd6f4,prompt:#cba6f7,hl+:#f38ba8 \
  --color=selected-bg:#45475a"
source <(fzf --zsh)

# $PATH
export PATH="$HOME/.local/share/nvim/mason/bin:$PATH"
export PATH="/opt/homebrew/opt/rustup/bin:$PATH"

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
	source $ZDOTDIR/private.sh
fi
