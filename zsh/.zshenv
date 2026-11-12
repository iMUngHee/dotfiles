# zsh/.zshenv — environment for every zsh, including non-interactive ones
# (scripts, agent tool shells, and the git hooks they run). zsh reads only
# ~/.zshenv on its own; the managed block lib/shell-env.sh writes there sources
# this file.

# mise shims for non-interactive shells. .zshrc's `mise activate` covers
# interactive ones, but Omarchy's env-bootstrap appends the shims after the
# system directories, so mise-pinned tools lost to older /usr/bin copies. The
# shims go right after mise's command-wrappers wherever those sit (git, for
# one, prepends its exec-path to a hook's PATH): the wrappers must win for
# claude/codex account switching. No-op where mise is absent (macOS uses fnm).
() {
  local data=${MISE_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/mise}
  local shims=$data/shims wrappers=$data/command-wrappers/bin
  [[ -d $shims ]] || return 0
  path=(${path:#$shims})
  local i=${path[(ie)$wrappers]}
  if (( i <= $#path )); then
    path=(${path[1,i]} $shims ${path[i+1,-1]})
  else
    path=($shims $path)
  fi
}
