# Platforms

This config deploys to macOS, Linux and Windows (Git Bash, plus PowerShell for
`windows/`). A change run on one of them is only reasoned about on the others.
This file is where that gap is written down: what to run on each machine, what
each platform does differently, and which checks are still owed.

## After a pull, on any machine

The post-merge hook re-runs bootstrap, but it installs no npm dependencies. On a
new machine, or after a pull that changes a pm package's lockfile, run `npm ci`
in that package first. Then:

```bash
bash ~/.config/ai/scripts/vendor.sh                      # every row ok / ok (pinned)
node --test ~/.config/ai/lib/*.test.mjs                  # 0 fail; skips name their platform
(cd ~/.config/ai/skills/pm-roadmap && npm ci && npm test) # typecheck + suite
(cd ~/.config/ai/skills/pm-context && npm ci && npm test)
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
  `codex -c 'default_permissions="workspace-local-sockets"'`. On Codex 0.163.0
  it does not work yet: the profile starts as workspace-write, but all three
  socket paths return EPERM because its allowlist never reaches Seatbelt
  (openai/codex#25416; the template comment has the details).

## Linux

- GNU coreutils, but scripts must still run on macOS; see `ai/rules/portability.md`.
- The same Unix-only tests as macOS run here. Run the suite as a normal user:
  `vendor.test.mjs` skips its unreadable-manifest test under root, where mode
  000 does not stop a read.

## Windows

- **Developer Mode** must be on for an unelevated deploy (see
  `windows/README.md`). The bootstraps and `vendor.sh` set
  `MSYS=winsymlinks:nativestrict`, so without it a skill link fails loudly
  instead of silently becoming a copy.
- Run the suites from Git Bash. They are also meant to pass from a plain
  PowerShell; `ai/lib/vendor.test.mjs` is the one checked that way, with
  `MSYSTEM` unset.
- What Windows does differently, each found the hard way:
  - `Git\bin\bash.exe`, `sh.exe`, `git.exe` and `Git\cmd\git.exe` are
    launchers that always put `/mingw64/bin:/usr/bin` ahead of a child's PATH.
    The real `Git\mingw64\bin\git.exe` does the same when `MSYSTEM` is unset,
    as in a plain PowerShell. Either way a PATH shim in a test loses to Git's
    own binaries.
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

- [ ] **macOS / Windows** — run the object `patch`/`input`/`diff`, namespaced
      tool, and Unicode Stop filename regressions in
      `ai/lib/{raw-tool-input-hooks,stop-hooks}.test.mjs` (verified on Linux
      2026-10-21).
- [ ] **macOS** — once a Codex release fixes openai/codex#25416, re-check that
      the `workspace-local-sockets` profile reaches `/tmp/agent-notifier.sock`
      and the tmux socket (`d9e376d`). On 0.163.0 it does not (see `## macOS`).
- [ ] **Windows** — Codex's automatic Stop hook no longer times out at 45 s now
      that the template says 360 (`d9e376d`); a manual run took 112 s, exit 0.
