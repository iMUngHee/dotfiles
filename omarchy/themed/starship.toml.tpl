# Omarchy user template: starship — the third implementation of one prompt.
#
#   ~/path/to/dir git:(branch) ✗
#   ➜
#
# The repo keeps a single prompt shape across platforms, implemented per
# platform because no one mechanism spans them:
#
#   macOS    zsh/.zshrc:44-51   native zsh PROMPT + ZSH_THEME_GIT_PROMPT_*
#   Windows  windows/starship.toml   starship port of that PROMPT
#   Omarchy  this file          the Windows port, themed
#
# This is windows/starship.toml with its hardcoded Catppuccin Mocha literals
# swapped for Omarchy theme variables. Structure and every format string are
# copied verbatim on purpose: the shape is the contract, and the comments below
# are the ported reasoning, kept because the traps they describe are silent.
#
#   {{ blue }}     path            was #89b4fa
#   {{ magenta }}  git:( )         was #cba6f7
#   {{ green }}    branch, ➜       was #a6e3a1
#   {{ yellow }}   dirty mark      was #f9e2af
#   {{ red }}      error ➜, RO     was #f38ba8
#
# Every theme defines these five, light ones included (catppuccin-latte,
# flexoki-light), so the mapping holds across the whole theme set. They are the
# palette's semantic colours, which is what windows/starship.toml's own comment
# names them by — accent is deliberately not used, since it is an arbitrary hue
# per theme and would lose "blue path".
#
# Rendered to ~/.local/state/omarchy/current/theme/starship.toml on each theme
# switch; zsh/private.sh points STARSHIP_CONFIG there and falls back to
# ~/.config/starship.toml when a theme carries no colors.toml to render from.
#
# Only the modules named in `format` render, which is what keeps this prompt as
# quiet as the zsh one — starship's defaults would add language/version
# segments that PROMPT never had.

format = """$directory$git_branch$git_status
$character"""

add_newline = false
command_timeout = 1000

[directory]
style = "{{ blue }}"
format = "[$path]($style)[$read_only]($read_only_style) "
truncation_length = 0        # %~ does not truncate
truncate_to_repo = false     # %~ is absolute-from-home, not repo-relative
home_symbol = "~"
# read_only has no counterpart in the zsh PROMPT — it arrived with the Windows
# port and is kept here deliberately, not copied by accident. It renders only
# in a directory you cannot write to, and in that moment knowing so is worth
# more than matching macOS. Dropping it would not unify the three anyway: this
# file is the Windows port themed, so it splits Windows off rather than closing
# the gap. Real unification means editing windows/starship.toml too.
read_only = " RO"
read_only_style = "{{ red }}"

[git_branch]
# ZSH_THEME_GIT_PROMPT_PREFIX = "git:(" mauve, then the branch in green.
# Parentheses delimit conditional groups in a starship format string, so a
# LITERAL paren must be backslash-escaped or the module fails to parse and
# renders nothing at all. Single-quoted TOML (a literal string) is used so the
# backslash reaches starship instead of being eaten by TOML's own escaping.
format = '[git:\(]({{ magenta }})[$branch]({{ green }})'
only_attached = false

[git_status]
# ZSH_THEME_GIT_PROMPT_{CLEAN,DIRTY} both close the paren, then diverge on the
# mark. Two starship facts shape this:
#
#  1. There is no "clean" variable, so the closing paren is an unconditional
#     literal and only the mark rides the conditional group `( ... )`, which
#     collapses when every variable inside it is empty.
#  2. $all_status CONCATENATES the per-category indicators, so setting them all
#     to "X" prints one per category — `git:(main) XXX` for a tree that is
#     modified + staged + untracked. zsh's parse_git_dirty is a single boolean.
#
# So each indicator is a zero-width space, written as the TOML escape \u200B so
# it stays visible to whoever reads this file: non-empty enough to keep the
# group alive, but invisible, which leaves exactly one literal mark no matter
# how many categories are dirty. Result: `git:(main)` clean, `git:(main) ✗`
# dirty.
# The leading \) is the escaped literal paren that closes `git:(branch`; the
# unescaped outer ( ) is the conditional group that collapses when clean.
#
# Note this drops the zsh prompt's ✔ on a clean tree — a divergence that came
# with the Windows port, not with theming.
style = "{{ yellow }}"
format = '[\)]({{ magenta }})([ ✗$all_status]($style))'
conflicted = "\u200B"
untracked = "\u200B"
modified = "\u200B"
staged = "\u200B"
renamed = "\u200B"
deleted = "\u200B"
typechanged = "\u200B"
stashed = ""
ahead = ""
behind = ""
diverged = ""

[character]
success_symbol = "[➜]({{ green }})"
error_symbol = "[➜]({{ red }})"
vimcmd_symbol = "[➜]({{ magenta }})"
