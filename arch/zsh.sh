#!/bin/zsh
# arch/zsh.sh — Omarchy's shell layer, ported to zsh.
#
# Omarchy keeps its shell setup in /usr/share/omarchy/default/bash/ and ships no
# zsh equivalent, so switching the login shell to zsh drops all of it. Most of
# that loss is fine: .zshrc and oh-my-zsh already cover zoxide, fzf, eza, the
# git aliases and history, and EDITOR/BAT_THEME are deliberately this repo's
# rather than Omarchy's. What follows is the part that was functional rather
# than cosmetic.
#
# Why a platform directory holds runtime shell config: windows/ already does
# exactly this — profile.ps1 and starship.toml sit beside bootstrap.ps1 and
# packages.ps1. The tier owns both how it is installed and how its shell
# behaves.
#
# Why it is loaded through zsh/private.sh rather than .zshrc: the starship block
# has to run after .zshrc:45 sets PROMPT, and private.sh (line 178) is the only
# point past it. oh-my-zsh loads $ZSH_CUSTOM/*.zsh at line 40, which is before
# PROMPT, so zsh/custom/ cannot host it. arch/bootstrap.sh writes the one-line
# stub that pulls this file in; the stub is machine-local, this file is not.
#
# Not ported: default/bash/aliases and default/bash/fns/* (bash-syntax helpers,
# worth porting case by case rather than in bulk), and the
# `complete -I -A command -X 'omarchy-*'` line that hides the individual
# binaries from command completion, which has no concise zsh equivalent.
# MANPAGER moved to zsh/custom/manpager.zsh — it only needs bat, so every
# platform should have it, not just this one.

# ── starship prompt ──────────────────────────────────────────────────────────
# Replaces the PROMPT and ZSH_THEME_GIT_PROMPT_* that zsh/.zshrc sets. Those
# stay as they are: they are the macOS implementation of the same prompt, and
# windows/starship.toml is the third. Nothing in .zshrc needs editing.
#
# Omarchy ships ~/.config/starship.toml but never re-themes it, so the stock
# prompt keeps its hardcoded cyan through every theme switch. The template at
# omarchy/themed/starship.toml.tpl fixes that: omarchy-theme-set renders it into
# the staged theme directory with the current palette substituted, and
# STARSHIP_CONFIG points there.
#
# The guard matters. Templates are only rendered for themes that carry a
# colors.toml, so an older theme leaves no file behind; without it starship
# would ignore the missing STARSHIP_CONFIG and fall back to its own built-in
# defaults rather than to Omarchy's config.
if command -v starship >/dev/null 2>&1; then
	themed_starship="$HOME/.local/state/omarchy/current/theme/starship.toml"
	[[ -r $themed_starship ]] && export STARSHIP_CONFIG="$themed_starship"
	unset themed_starship
	eval "$(starship init zsh)"
fi

# ── BROWSER (default/bash/envs) ──────────────────────────────────────────────
# Terminal programs like gh open URLs through $BROWSER. omarchy-launch-browser
# detaches them from the terminal's process tree; without it the browser dies
# with the shell. Kept shell-scoped on purpose, as Omarchy does: exporting it
# session-wide makes xdg-settings refuse to change the default browser.
if [[ -z ${BROWSER:-} ]] && command -v omarchy-launch-browser >/dev/null 2>&1; then
	export BROWSER=omarchy-launch-browser
fi

# ── `omarchy` subcommand completion (default/bash/completions) ───────────────
# Reimplemented rather than sourced: the Omarchy version is bash-only — it
# drives COMPREPLY/compgen and calls `shopt`, which zsh has no counterpart for,
# so even bashcompinit cannot carry it across. This covers the part that earns
# its keep, completing each level of the omarchy-<a>-<b> dispatcher by scanning
# the binaries on disk. It does not parse the `# omarchy:args=` specs the bash
# one reads for argument values.
if command -v omarchy >/dev/null 2>&1 && (( $+functions[compdef] )); then
	_omarchy() {
		local omarchy_path bin_dir prefix part file base rest next i
		omarchy_path=$(command -v omarchy 2>/dev/null) || return 1
		bin_dir=${$(readlink -f -- "$omarchy_path" 2>/dev/null || print -r -- "$omarchy_path"):h}
		[[ -d $bin_dir ]] || return 1

		# Rebuild the dispatcher prefix from the words already typed, skipping
		# flags, the same way the bash version does.
		prefix="omarchy"
		for (( i = 2; i < CURRENT; i++ )); do
			part=${words[i]}
			[[ -z $part || $part == -* ]] && continue
			prefix+="-$part"
		done

		local -a candidates
		local -A seen
		# (N) is nullglob: no match must expand to nothing, not to the pattern.
		for file in $bin_dir/$prefix-*(N); do
			[[ -f $file && -x $file ]] || continue
			base=${file:t}
			rest=${base#$prefix-}
			next=${rest%%-*}
			[[ -n $next && -z ${seen[$next]:-} ]] || continue
			seen[$next]=1
			candidates+=($next)
		done
		(( CURRENT == 2 )) && candidates+=(commands)

		(( ${#candidates} )) && _describe -t omarchy-commands 'omarchy command' candidates
	}
	compdef _omarchy omarchy
fi
