# zsh/custom/manpager.zsh — colored man pages through bat.
#
# Loaded by oh-my-zsh, which sources $ZSH_CUSTOM/*.zsh (oh-my-zsh.sh:242). That
# happens before .zshrc sets PROMPT, which is fine: these are plain exports and
# nothing later overwrites them.
#
# Taken from Omarchy's default/bash/envs, but kept here rather than in
# arch/zsh.sh because it depends on bat alone. bat is in the Brewfile and in
# arch/packages.sh, so every platform has it — leaving this on the Omarchy tier
# would have withheld it from macOS for no reason.
if command -v bat >/dev/null 2>&1; then
	export MANROFFOPT="-c"
	export MANPAGER="sh -c 'col -bx | bat -l man -p'"
fi
