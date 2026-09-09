# windows/

Native Windows tier. The counterpart of `homebrew/` + `zsh/` + `ghostty/`, plus
the Cowork surface that has no Unix equivalent.

## Design

The AI config deploy is **not** reimplemented here. `windows/scripts/deploy-ai.ps1`
runs the same `ai/scripts/bootstrap.sh` under Git Bash, so bash stays the single
source of truth for what lands in `~/.claude` and `~/.codex` on every platform.
A PowerShell port would be a second implementation of the 3-tier merge rules
(per-file `rules/` and `memory/` symlinks, the skills overlay, generated
`MEMORY.md`, the jq settings merge) — exactly the logic that drifts.

Two things make that work:

| Requirement | Why |
|---|---|
| `MSYS=winsymlinks:nativestrict` | Makes `ln -s` create real NTFS symlinks instead of MSYS's default *copy*. `nativestrict` (not `native`) turns a failure into an error rather than a silent fallback, so a broken deploy is loud. |
| Developer Mode | Lets an unelevated process create symlinks. `New-Item -ItemType SymbolicLink` on PowerShell 5.1 still demands Administrator because it does not pass `SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE`; `mklink` and Git Bash do. |

`deploy-ai.ps1` verifies afterwards that `~/.claude/PERSONAL.md` really is a
symlink. A copy is indistinguishable from a link until an edit to `ai/` quietly
stops propagating, so exit 0 alone is not trusted.

### Changes this required in the shared tiers

Adding Windows touched three files outside `windows/`. Each is platform-neutral
in form; all three were only reachable from here.

| File | Change | Why |
|---|---|---|
| `.gitattributes` (new) | `* text=auto eol=lf` | Git for Windows defaults `core.autocrlf=true`, so a fresh clone rewrites every tracked file to CRLF. Git Bash tolerates a CRLF shebang, but WSL bash, `/usr/bin/env` and node shebangs do not. |
| `claude/scripts/bootstrap.sh`, `codex/scripts/bootstrap.sh` | `link_skill_dir` removes a non-symlink target before linking | `ln -sfn DIR TARGET` *descends into* TARGET when it is a real directory, creating `TARGET/<name>` and leaving the stale directory shadowing the skill. The cleanup sweep deletes only symlinks (to preserve user-added skills), so nothing else clears it. Reachable on any platform, but Windows produces those directories whenever a deploy runs in the degraded mode described above. |
| `claude/hooks/notify.sh`, `codex/hooks/notify.sh` | `ensure_daemon` gained a `MINGW*\|MSYS*\|CYGWIN*` case | See [Notifications](#notifications). |

## Layout

| Path | Role | Unix counterpart |
|---|---|---|
| `bootstrap.ps1` | entrypoint | `bootstrap.sh` |
| `packages.ps1` | winget package set | `homebrew/Brewfile` |
| `profile.ps1` | interactive shell config | `zsh/.zshrc` |
| `starship.toml` | prompt | the `PROMPT` block in `.zshrc` |
| `terminal/settings.fragment.json` | terminal appearance | `ghostty/config` |
| `claude-settings.windows.json` | Windows-only Claude keys | — |
| `notifier/toast.ps1` | notification sender | `notifier/macos`, `notifier/linux` |
| `lib/common.ps1` | shared helpers | — |
| `scripts/deploy-*.ps1` | per-surface deploy | `*/scripts/bootstrap.sh` |
| `scripts/install-nerdfont.ps1` | FiraCode Nerd Font | the ghostty AppImage installer in `homebrew/bootstrap.sh` |
| `scripts/pack-skills.ps1` | Cowork skill zips | — |
| `dist/` | build output (gitignored) | — |
| `private.ps1` | machine-local overrides (gitignored) | `zsh/private.sh` |

## Setup

```powershell
winget install --id Git.Git --exact
git clone --recurse-submodules <repo> $HOME\.config
pwsh -File $HOME\.config\windows\bootstrap.ps1
```

Developer Mode must be on: **Settings > System > For developers > Developer Mode**.
Without it every symlink step fails and the deploy degrades to copies.

Flags: `-SkipPackages`, `-SkipOptional` (no desktop apps or fonts),
`-SkipCowork`, `-NoBackup` (forwarded to the bash bootstrap), `-DryRun`.

Re-run any time with `cfg-sync`.

## AI surfaces on this machine

| Surface | How it installs | Hooks run? |
|---|---|---|
| Claude Code (CLI) | winget `Anthropic.ClaudeCode` | yes, through Git Bash |
| Claude Desktop / Cowork | winget `Anthropic.Claude` | no |
| Codex CLI | npm `@openai/codex` | yes, through Git Bash |
| Codex desktop app | Microsoft Store `9PLM9XGG6VKS` | no |

The Codex desktop app is the one package here that does not come from the winget
community repo. The only OpenAI-published entry there is the CLI; OpenAI folded
Codex into the ChatGPT desktop app, which ships through the Store — and the Appx
it installs is in fact named `OpenAI.Codex`. The `ChatGPT` results in the winget
repo (`j178`, `lencx`, `sonnylab`) are third-party wrappers, not this.

The two GUI surfaces read the same deployed `~/.claude` and `~/.codex` files but
run no hooks, which is why `claude/CLAUDE.md` scopes its "Hook-Enforced" section
explicitly — a protection that is only asserted, never executed, is worse than
no claim at all.

## Updating

`buu` — the same name as the Mac alias, and deliberately more than
`winget upgrade --all`. brew owns nearly everything on macOS; winget does not,
because four things here have no winget package at all:

| Source | What | Why not winget |
|---|---|---|
| winget + msstore | every CLI, runtime and app in `packages.ps1` | — |
| `go install` | `pager` | not packaged anywhere, no release binaries |
| `npm -g` | `tree-sitter-cli`, `@openai/codex` | not in winget / manifest 5 weeks stale |
| PSGallery | `PSReadLine`, `PSFzf` | PowerShell modules, not packages |
| GitHub release | FiraCode Nerd Font | winget's only Nerd Font is JetBrainsMono |

`winget upgrade --all` on its own silently leaves all four behind, and one of
them fails quietly rather than loudly: upgrading `tree-sitter-cli` through npm
does not touch the copy of `tree-sitter.exe` that `packages.ps1` places ahead of
npm's sh shim on PATH, so Neovim would keep running the old binary. `buu`
re-copies it.

```powershell
buu          # everything except the font
buu -Font    # also re-check ryanoasis/nerd-fonts (27 MB download)
```

Claude Code is winget-installed and `DISABLE_AUTOUPDATER` is set in
`claude/settings.json`, so it updates only through `buu` — its in-app
"Update available!" banner is telling you to run exactly this.

The Codex CLI moved off winget for the opposite reason: `winget upgrade`
answered "no available upgrade" while Codex itself advertised one, because the
community manifest was pinned to 0.146.1 (2026-08-05) five weeks after upstream
had shipped 0.153.4 (2026-09-04). npm is OpenAI's own channel and matches
upstream, so `buu` now actually moves it.

Neovim plugins and mason tools are outside all of it: `:Lazy sync`,
`:MasonUpdate`.

## Cowork

Cowork runs inside the Claude Desktop app (`winget install --id Anthropic.Claude`),
which on Windows is the only way to reach it.

Its skills, plugins and connectors live on the **Claude account**, not on disk —
there is nothing to symlink. So the repo's contribution is packaging:

```powershell
cowork-skills                     # zip every skill to windows/dist/cowork-skills/
cowork-skills -Only design,eli5   # just these
cowork-skills -List               # report only
```

Then upload in **Cowork sidebar > Customize > + > Skills**. Uploaded skills follow
your account to web and mobile, so it is once per skill, not once per machine.

The report flags skills whose `allowed-tools` include `Bash` or `Agent` as
`code`: those are Claude Code workflow skills (worktrees, per-commit review,
subagents). They upload without error but have little to do in Cowork.

> Cowork holds its own **copy** of each skill. Editing a `SKILL.md` in this repo
> does not reach it — re-run `cowork-skills` and re-upload. This is the one place
> Windows loses the symlink guarantee that `~/.claude/skills` gives Claude Code.

## Notifications

`notifier/` builds a Swift app on macOS and a Go daemon on Linux. Windows needs
neither — the OS runs the notification service already. Only the *sender* was
missing, so `deploy-notifier.ps1` writes a shim at the path the shared hooks
already look for (`~/.agent-notifier/bin/agent-notifier-send`) which calls
`notifier/toast.ps1`.

`claude/hooks/notify.sh` and `codex/hooks/notify.sh` needed one change for this:
`ensure_daemon` gained a `MINGW*|MSYS*|CYGWIN*` case. Without it, Windows matched
neither `Darwin` nor `Linux`, fell through to the unix-socket wait loop, and paid
3 seconds on every hook invocation waiting for a socket that never appears.

The toast runs under `powershell.exe`, not `pwsh` — PowerShell 7 dropped the
built-in WinRT projection those types need.

macOS suppresses notifications while a terminal is focused (`is_terminal_focused`
via AppleScript). There is no equivalent here, so Windows always notifies.

## Known gaps

| Gap | Reason |
|---|---|
| Font is not from winget | winget's whole Nerd Font catalogue is one package (`DEVCOM.JetBrainsMonoNerdFont`), and `ghostty/config` pins FiraCode. `scripts/install-nerdfont.ps1` fetches it from `ryanoasis/nerd-fonts` with SHA-256 verification and installs per-user (no elevation), the same shape as the ghostty AppImage step on Linux. |
| No tmux | No native Windows port. Windows Terminal panes cover the splitting; the tmux status scripts, pane labels and the `claude`/`codex` wrapper functions in `.zshrc` have no counterpart. |
| No Ghostty | No Windows build. `ghostty/config` maps to Windows Terminal except `adjust-cell-height` and the cursor-smear shader, which have no WT setting. |
| No Claude Code sandboxing | Native Windows does not support it. `claude/settings.json` already sets `sandbox.enabled: false`. |
| Codex CLI | Not installed here; `ai/scripts/bootstrap.sh` skips its deploy when `codex` is not on PATH, and the sanity checks handle the resulting absent `~/.codex/AGENTS.md`. |
| Prompt `git:(x)` clean mark | zsh shows `✔` when clean; starship has no "clean" variable, so clean renders as bare `git:(main)`. Dirty still shows `✗`. |
