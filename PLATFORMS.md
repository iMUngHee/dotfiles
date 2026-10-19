# Platforms

This config deploys to macOS, Linux and Windows (Git Bash, plus PowerShell for
`windows/`). A change run on one of them is only reasoned about on the others.
This file is where that gap is written down: what to run on each machine, what
each platform does differently, and which checks are still owed.

## After a pull, on any machine

The post-merge hook re-runs bootstrap. Then:

```bash
bash ~/.config/ai/scripts/vendor.sh                      # every row ok / ok (pinned)
node --test ~/.config/ai/lib/*.test.mjs                  # 0 fail; skips name their platform
(cd ~/.config/ai/skills/pm-roadmap && npm test)          # typecheck + suite
(cd ~/.config/ai/skills/pm-context && npm test)
claude plugin test ~/.config/claude/mods/pm-band         # likewise pager-view
```

`tsc -p claude/mods/<mod>` needs a TypeScript; `ai/skills/pm-roadmap/node_modules/.bin/tsc`
works when none is installed. The `config-audit` skill checks the deployed tool homes.

## macOS

- `/bin/bash` is 3.2 and the coreutils are BSD; see `ai/rules/portability.md`.
- Some tests run only here and on Linux. They are skipped on Windows with the
  reason in the skip message (e.g. a backslash inside a filename in
  `ai/lib/raw-tool-input-hooks.test.mjs`).
- The Codex `workspace-local-sockets` permission profile (`codex/config.toml.template`)
  exists for the notifier socket and the tmux socket. It is opt-in:
  `codex -c 'default_permissions="workspace-local-sockets"'`.

## Linux

- GNU coreutils, but scripts must still run on macOS; see `ai/rules/portability.md`.
- The same Unix-only tests as macOS run here.

## Windows

- **Developer Mode** must be on. The bootstraps and `vendor.sh` set
  `MSYS=winsymlinks:nativestrict`, so without it a skill link fails loudly
  instead of silently becoming a copy.
- Run the suites from Git Bash. They are also meant to pass from a plain
  PowerShell; `ai/lib/vendor.test.mjs` is the one checked that way, with
  `MSYSTEM` unset.
- What Windows does differently, each found the hard way:
  - `Git\bin\bash.exe`, `sh.exe` and `git.exe` are launchers, and git itself
    (when `/mingw64/bin` is missing from PATH, as in a plain PowerShell) puts
    `/mingw64/bin:/usr/bin` ahead of a child's PATH. A PATH shim in a test
    loses to Git's own binaries.
  - MSYS awk drops the CR before a newline and MSYS `basename` splits on a
    backslash, so CRLF and backslash bugs that exist on Unix do not reproduce
    here. Reproduce with `awk -v BINMODE=3`, or skip with a reason.
  - Tool payloads give paths with backslashes and in any letter case; the
    protect hooks normalize both.
  - `jq` writes CRLF; `git config` reads a backslash as an escape.
  - npm runs package scripts in `cmd.exe`: no `sh` loops, call node entry
    points (`node ./node_modules/tsx/dist/cli.mjs`).
- Older deploys left copied skills; bootstrap moves them to
  `~/.claude/skill-backups/` and `~/.agents/skill-backups/`. Delete those once
  they hold nothing you need.

## Pending checks

Checks a change still owes on a platform it was not run on. Add one when you
cannot run something; remove it in the commit that records the result.

- [ ] **macOS, Linux** — full `ai/lib` suite after `6498454..b1bc21c`
      (2026-10-19, run only on Windows). The Unix-only protect-hook tests and
      bash 3.2 behaviour of `[[ -ef ]]`, `shopt -s nocasematch` and
      `${f//\\//}` in the hooks are first exercised there.
- [ ] **macOS** — the Codex `workspace-local-sockets` profile actually reaches
      `/tmp/agent-notifier.sock` and the tmux socket (`d9e376d`).
- [ ] **Windows** — Codex's automatic Stop hook no longer times out at 45 s now
      that the template says 360 (`d9e376d`); a manual run took 112 s, exit 0.
