# Platforms

This config deploys to macOS, Linux and Windows (Git Bash, plus PowerShell for
`windows/`). A change run on one of them is only reasoned about on the others.
This file is where that gap is written down: what to run on each machine, what
each platform does differently, and which checks are still owed.

## After a pull, on any machine

The post-merge hook (post-rewrite after a rebase pull) re-runs bootstrap and
syncs vendored entries that `vendor.sh check` reports as `update` or `missing`,
but it installs no npm dependencies. On a
new machine, or after a pull that changes a pm package's lockfile, run `npm ci`
in that package first.

It builds no binaries either: pager and gaebu, which the hooks call bare, come
from the package layer (`~/.config/bootstrap.sh`, `windows/bootstrap.ps1`). On a
machine that predates that step, build them once, then deploy again so the
gaebu MCP server is registered:

```bash
bash -c '. ~/.config/lib/agent-clis.sh && ensure_pager && ensure_gaebu'   # macOS / Linux
bash ~/.config/ai/scripts/bootstrap.sh
```

On Windows: `pwsh -File ~/.config/windows/scripts/install-gaebu.ps1` (pager:
`install-pager.ps1`), then the bootstrap line above under Git Bash. Then:

```bash
bash ~/.config/ai/scripts/vendor.sh                      # every row ok / ok (pinned)
node --test ~/.config/ai/lib/*.test.mjs                  # 0 fail; skips name their platform
(cd ~/.config/ai/skills/pm-roadmap && npm ci && npm test) # typecheck + suite
(cd ~/.config/ai/skills/pm-context && npm ci && npm test)
claude plugin test ~/.config/claude/mods/pm-band         # likewise pager-view
```

`tsc -p claude/mods/<mod>` needs a TypeScript; `ai/skills/pm-roadmap/node_modules/.bin/tsc`
works when none is installed. The `config-audit` skill checks the deployed tool homes.

If a pull changes Codex hook definitions (including matchers), open the Codex TUI
on **each machine** and review/trust the new or changed hooks. Trust is local;
bootstrap does not grant it. Codex 0.163.0 headless `codex exec` can silently skip
untrusted hooks, so exit 0 alone is not hook verification. Grant trust in the TUI;
reserve `--dangerously-bypass-hook-trust` for controlled, explicitly authorized
integration tests. See `codex/README.md` for the output contract and review details.
If an old startup warning remains after the configuration was fixed, restart the
shared server through `/daemon` and check again; connected sessions may be interrupted.

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

### Verified on Windows 2026-11-03

- Pulled dotfiles through `bac5838`; the post-merge bootstrap regenerated the
  tool homes. Template-owned Codex hooks match after excluding machine-managed
  `hooks.state`; Claude's mod paths resolve after expanding `~`.
- `stop-hooks.test.mjs`: 29 passed, 16 skipped with platform reasons. Native
  Windows Node needs `cygpath -m` for executables found by Git Bash: spawning
  `/usr/bin/bash` directly fails with `ENOENT`. The GNU timeout process-tree
  cases and both tools' clippy/check fixtures passed after that conversion.
  Fixture process checks and cleanup also use MSYS `kill` on Windows because
  shell `$$`/`$!` values are not native Windows PIDs.
- Full `ai/lib` suite: 193 passed, 23 skipped, 0 failed. The pm-roadmap and
  pm-context suites passed 11 and 2 test files respectively; pager-view and
  pm-band passed 51 and 46 cases, and both mods typechecked. Vendor check
  passed after syncing the newly referenced pinned `rust-guidelines` checkout.
- Pager `65515fe`: `go test ./...` and `go vet ./...` passed. The installed
  binary's native Codex loop smoke passed: 47 working messages, 46 causal hops,
  idle wake suppression, important release delivery and duplicate protection;
  all 62 accepted records remained. This used isolated state and a local model
  fixture, not a real cross-machine relay. Existing resident MCP processes were
  not restarted; this evidence covers the installed binary and fresh hosts.

### Verified on 2026-10-28

- Synced through `ecaa264` and deployed with `windows/scripts/deploy-ai.ps1`.
  The generated instruction headers and size, Claude's copied instructions and
  native symlink, Windows Git Bash path, and every template-owned Codex hook
  key were checked. Machine-managed `hooks.state` is preserved by the merge.
  Automatic external-agent import sync is disabled in the template and deployed
  TOML, so bootstrap does not turn Claude chat imports back on.
- `node --test ai/lib/*.test.mjs`: 160 passed, 7 skipped with platform reasons.
  This includes private-memory expansion and stripping, manifest handling,
  native skill replacement, object/namespaced tool input, Unicode filenames,
  JSON hook feedback, and the machine-local Git filter. The private-memory
  assertion now compares the emitted path with Git Bash's actual `HOME`, not
  Node's native Windows spelling; `/tmp` aliases need more than slash replacement.
- Both pm packages passed `npm test`: 11 test files in `pm-roadmap`, including
  its typecheck, and 2 in `pm-context`. `claude plugin test` passed 46 cases in
  `pm-band` and 37 in `pager-view`.
- A statusline payload with `total_input_tokens: 203000` rendered `203k`
  without stderr. After bootstrap registered the new required smudge filter,
  real `git checkout-index` calls for `ghostty/config` and
  `aerospace/aerospace.toml` reproduced the working files.
- Pager upstream `ad6a9f4` passed `go test ./...`, `go vet ./...`, and the Windows
  installer smoke before local changes. Fix `4b46b64` then passed the same checks
  and was reinstalled from its clean commit with Go 1.27.0. New ephemeral
  app-server sessions exchanged mail through new MCP processes with correct
  caller identity and inbox isolation; already-read wake prompts were blocked,
  unread mail still delivered, and the three test records were preserved.
  Codex CLI 0.163.0 and desktop host 0.165.0-alpha.1.2 supplied `_meta.threadId`.
  Linux and macOS Go builds compiled; their runtimes were not exercised.
- Replacing `pager.exe` does not replace resident `pager mcp` processes. Closing
  and reopening a Codex desktop window left the old shared server and its old
  MCP binaries running. Reconnect MCP or restart the shared app-server, and
  check process replacement; a server restart can interrupt connected chats.

### Verified on 2026-10-30

- Pager `e3f2312` passed `go test ./...`, `go vet ./...`, and Linux/amd64 and
  Darwin/arm64 cross-builds. The Windows installer rebuilt the clean commit;
  installed Go build metadata reports that revision and `vcs.modified=false`.
- Two fresh persisted Codex threads on desktop host `0.165.0-alpha.1.2` ran real
  host turns against a deterministic local Responses endpoint. Native hook
  registration and its trusted hash were checked explicitly. While one turn
  was busy, eight concurrent sender processes produced one queued pager wake.
  Legacy duplicates merged to one, other-thread wakes remained independent,
  and ordinary queued user input retained its ID and content.
- The installed binary repeated the same live test: MCP reads removed obsolete
  notifications; subsequent mail queued a new wake; native queue execution
  injected unread mail into the model request. Already-read delayed wakes were
  rejected before any model HTTP request. All 12 mail records remained stored.
  The model endpoint was a local fixture, not a cloud model service.
- Existing persistent MCP processes still require reconnecting after the binary
  replacement. A standalone helper's reload cannot replace MCP clients owned
  by another running app-server; closing a desktop window is not proof of it.

- Pager `6fedd3e` replaced hourly/hop work quotas with a conservative idle-loop
  wake pause. Both peers must explicitly report fresh idle state with unchanged
  bodies, checkpoints and human epochs for two minutes. Missing/stale signals
  remain unknown and fail open; the guard is cooperative, not semantic proof.
  Result/failure/release events bypass pauses, are prioritized over update
  backlog, and can use event IDs to deduplicate retries. Mail is always stored.
- The installed clean `6fedd3e` binary passed the native two-thread loop smoke
  test (`scripts/codex-loop-smoke.py`, Codex 0.165.0-alpha.1.2, local deterministic
  Responses provider). Real shell/MCP calls changed an actual artifact across
  47 messages / 46 causal hops without a pause. Idle ping-pong stopped waking
  with nine unread updates retained. A simulated GPU lease was then released
  by a real shell call; its release event reached the next model request ahead
  of that backlog, without a human epoch reset. Retrying the event before and
  after reading made one record/wake. All 61 accepted mail records remained.
- The installed binary also repeated the native queue suite: eight concurrent
  sends coalesced to one notification; ordinary queued user input survived;
  mid-turn reads cleared generated wakes and stale wakes made no model call.
  All 12 fixture records remained. Windows Go tests/vet and Linux/amd64 plus
  Darwin/arm64 cross-builds passed. A SQLite backup preceded real-store v4-to-v5
  migration; integrity was OK and all 295 baseline messages were preserved.
- Already-running MCP processes retained the old image after installation.
  Reconnect those clients to load new tool metadata/policy, or use the freshly
  installed CLI in ongoing work. Basic relay messages remain v1-compatible;
  typed/progress metadata and causal hops above three need upgraded v2 peers.

### Verified on 2026-11-04

- `stop-hooks.test.mjs`, the whole file, on macOS and on Linux (the VM, GNU
  sed 4.8, from a clone of its config carrying the same hooks): 55 passed,
  12 skipped with platform reasons, 0 failed. It includes the process-tree
  `portable_timeout`, the clippy/check `.rs` checker, the crate-edition
  `rustfmt` cases and the Stop block that must reach Claude on stderr.
- macOS: `ensure_gaebu` from `lib/agent-clis.sh` built gaebu into
  `~/.local/bin` (pager was present, so only its skip path ran), and the next
  `ai/scripts/bootstrap.sh` printed `Registered gaebu MCP server (user scope)`.

## Pending checks

Checks a change still owes on a platform it was not run on. Add one when you
cannot run something; remove it in the commit that records the result.

- [ ] **macOS** — run the Codex pager-name SessionStart integration
      on Codex 0.167.0 with Node 22 or later. Review the changed hook in `/hooks`,
      start/resume a session, then `/rename other` and send a prompt. Verify
      the name returns to `pager whoami` and is visible via `thread-name`.
      Linux protocol/wrapper tests, actual TUI rename/next-prompt recovery,
      mail delivery and combined startup-wake smoke are covered; the POSIX executable fixtures
      in `codex/hooks/pager-session-name.test.mjs` skip on native Windows.
      On Windows 2026-11-08 (Codex 0.167.0, Node 26.12.1) the rename never ran:
      `spawn("codex")` cannot start npm's `codex.cmd` shim and failed with
      ENOENT, which the hook swallows. With the win32 shell spawn, running
      `pager-session-name.mjs` for a live session set its `thread_name` to the
      pager name (`~/.codex/session_index.jsonl`) and left no proxy process.
      With `NoDefaultCurrentDirectoryInExePath` unset, a `codex.cmd` planted in
      the working directory ran unless the shell starts in the hook's
      directory; a stub proxy that ignores EOF ended at the 3 s timeout
      (3096 ms) and outlived the hook.
      The TUI `/rename` was then restored to the pager name on the next prompt
      (observed by the person, 2026-11-08), so Windows is done. On Linux and
      macOS, rerun `node --test codex/hooks/pager-session-name.test.mjs`:
      `finish()` now also closes the proxy's pipes there, untested since.

- [ ] **macOS and Linux (Bash)** — on a machine without pager and gaebu, run
      `bash -c '. ~/.config/lib/agent-clis.sh && ensure_pager && ensure_gaebu'`
      and check both build into `~/.local/bin` (`pager who`, `gaebu --version`),
      then that `bash ~/.config/ai/scripts/bootstrap.sh` prints `Registered gaebu
      MCP server`. On Windows 2026-11-04 only the skip path and the missing-tool
      warnings of `lib/agent-clis.sh` ran; `install-gaebu.ps1` ran its build,
      `-Force` swap and skip paths. On macOS 2026-11-04 the gaebu half passed
      (see Verified on 2026-11-04); pager's build path and Linux remain.
- [ ] **macOS and Linux (zsh)** — `zsh/.zshrc` puts `~/.local/bin` on PATH
      (`[ -d "$HOME/.local/bin" ] && export PATH="$HOME/.local/bin:$PATH"` in the
      `# $PATH` block), so the hooks find a bare `pager` and `gaebu`; check
      `command -v gaebu` in a new terminal.

- [ ] **Linux (Bash)** — pipe a sample payload with
      `context_window.total_input_tokens` into `claude/extensions/statusline.sh`
      and check the context segment ends in an absolute size such as `203k`
      (verified on macOS and Windows 2026-10-28).
- [ ] **Linux (Bash)** — run the local private-memory cases in
      `ai/lib/bootstrap-deploy.test.mjs` (verified on macOS 2026-10-26): token
      expansion, frontmatter stripping, filenames with spaces, manifest
      deduplication, repeat deploys, and an absent private-memory directory.
      Also run `ai/lib/sync-back-manifest.test.mjs`, where an unlisted
      private file is not manifest drift (also verified on Windows 2026-10-28).
- [ ] **Linux** — run the PostToolUse JSON feedback cases and Stop
      formatting/retry regressions in `ai/lib/{raw-tool-input-hooks,stop-hooks}.test.mjs`,
      which passed on Windows 2026-10-28.
- [ ] **Windows / Linux** — verify live hook completion and model-visible
      checker feedback after reviewing hook trust locally. Automated Windows
      coverage does not establish that a live host trusts or runs those hooks.
- [ ] **macOS** — run `ai/lib/bootstrap-deploy.test.mjs` and
      `ai/lib/raw-tool-input-hooks.test.mjs` for stable skill links, replacement
      failures and Codex command-extension boundaries. Verify macOS's BSD
      `mv -h` fallback (native Windows cases passed 2026-10-28).
- [ ] **Windows** — exercise native skill-link replacement with concurrent
      live readers; readable-link fixtures and unchanged-link identity passed,
      but concurrent readers were not exercised.
- [ ] **macOS** — run the object `patch`/`input`/`diff`, namespaced
      tool, and Unicode Stop filename regressions in
      `ai/lib/{raw-tool-input-hooks,stop-hooks}.test.mjs` (verified on Linux
      2026-10-21; also verified on Windows 2026-10-28).
- [ ] **macOS** — the machine-local smudge is now a script, not
      `cat`. Neither has Omarchy, so it only passes files through, but the
      filter is `required` and a failure there would stop every pull that
      touches `ghostty/config` or `aerospace/aerospace.toml`. Run
      `ai/lib/git-filter-machine-local.test.mjs` and one such pull after
      bootstrap re-registers the smudge (verified on Linux 2026-10-21;
      Windows filter tests and actual checkouts passed 2026-10-28).
- [ ] **Windows** — test pager's cross-machine relay transport against a real peer.
- [ ] **macOS / Linux** — run pager's runtime suite and session/MCP flows after
      `6fedd3e`, including the native loop smoke; this machine only cross-compiled
      those targets.
- [ ] **macOS / Linux** — open a `/pager` room with unread in a real terminal:
      it opens with the `new` rule on top. That is `$.ui.scroll`, which no kit
      test reaches (`revealOf` covers only the decision after each answer); tmux
      on macOS 2026-11-02 painted rooms without unread only.
- [ ] **Windows / Linux** — open `/pager` in a real terminal and check every
      folded body (Korean prose, a code block, a heading) takes at most eight
      rows and `▾ N more lines` equals the rows unfolding adds. `foldOf` now
      models the terminal's wrap (wrap-ansi, trim off, hard), measured in tmux
      on macOS 2026-11-02 with Claude Code 2.1.316, where all fourteen test
      bodies matched; the Windows captures of 2026-10-30 predate it.
- [ ] **macOS** — once a Codex release fixes openai/codex#25416, re-check that
      the `workspace-local-sockets` profile reaches `/tmp/agent-notifier.sock`
      and the tmux socket (`d9e376d`). On 0.163.0 it does not (see `## macOS`).
- [ ] **Windows** — Codex's automatic Stop hook no longer times out at 45 s now
      that the template says 360 (`d9e376d`); a manual run took 112 s, exit 0.
- [ ] **Arch** — run `arch/bootstrap.sh` (and once with `--dry-run`) and check
      the `lib/rust-analyzer.sh` step adds the component to pacman's rustup, so
      `rust-analyzer --version` answers. Verified on macOS 2026-11-02: present,
      no-toolchain (warns, downloads nothing) and no-rustup branches.
- [ ] **Arch** — `arch/packages.sh` now installs `cargo-nextest` (extra) and
      `cargo-mutants` (AUR); check both answer `--version` after a bootstrap.
- [ ] **macOS** — `brew bundle` installs `staticcheck` and `homebrew/bootstrap.sh`
      builds `gremlins` v0.6.0 into `~/.local/bin` (`lib/go-tools.sh`); check
      `staticcheck -version` and `gremlins --version` in a new terminal, then run
      the go skill's mutation step (`gremlins unleash --diff <start>` with
      `-count=1` appended to `GOFLAGS`) on a changed module. On Linux 2026-11-07 the install, the skip
      when present, the `--dry-run` line and the skill's commands all ran.
- [ ] **Windows** — the go skill's tools are not installed there: no
      `staticcheck` or `gremlins` step in `windows/bootstrap.ps1`. Add one
      (as `install-rust-tools.ps1` does for Rust) or note the skill's steps that
      skip there.
- [ ] **macOS / Windows (Git Bash)** — the hooks no longer run any type checker
      (tsc, go vet and cargo were removed; `detect_checker` is now
      `detect_formatter`, setting only `FMT_CMD`). Run
      `node --test ai/lib/stop-hooks.test.mjs ai/lib/raw-tool-input-hooks.test.mjs`
      (all passed on Linux 2026-11-07), and on Windows, where the `Stop runs no
      type checker` cases skip, edit a `.ts` file under a `tsconfig.json` and
      check that Stop runs no `tsc`.
- [ ] **Windows (Git Bash)** — run the `rustfmt gets the edition` and `Stop
      blocks a failing suite` cases in `ai/lib/stop-hooks.test.mjs` (passed on
      macOS and Linux 2026-11-04). Then edit a `.rs` file in a CRLF checkout of
      an edition-2024 crate and check the hook ran `rustfmt --edition 2024`;
      and source `claude/hooks/lib/detect-project.sh`, run `cargo_edition` on a
      file under a `//host/share` path with no Cargo.toml above it, and check
      it returns instead of looping (MSYS `dirname //` is `//`, so the climb
      ends on parent == dir; checked only by reading).
- [ ] **Windows** — run `windows/bootstrap.ps1` (or
      `windows/scripts/install-rust-tools.ps1` alone) under Windows PowerShell
      5.1 and under 7, then check `rust-analyzer --version`, `cargo nextest
      --version` (0.9.150) and `cargo mutants --version` (27.1.0) in a new
      terminal, and that a second run reports both tools present. Verified on
      macOS 2026-11-02 with pwsh 7.6.9: both scripts parse; under
      `$ErrorActionPreference = 'Stop'` as bootstrap sets it, the installer's
      download, SHA-256 check (a wrong pin refuses the install), extract, a
      failed copy (warns, the script runs to its end) and the present-skip on a
      rerun.
      Not run: the version probe, Add-UserPath, and Windows PowerShell 5.1 —
      run it through bootstrap.ps1 under 5.1 in particular, since 5.1 turns a
      native command's stderr into errors under Stop and the guards around
      `rustup` and the version probe were checked only by reading.
