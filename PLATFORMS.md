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

## Pending checks

Checks a change still owes on a platform it was not run on. Add one when you
cannot run something; remove it in the commit that records the result.

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
- [ ] **macOS** — once a Codex release fixes openai/codex#25416, re-check that
      the `workspace-local-sockets` profile reaches `/tmp/agent-notifier.sock`
      and the tmux socket (`d9e376d`). On 0.163.0 it does not (see `## macOS`).
- [ ] **Windows** — Codex's automatic Stop hook no longer times out at 45 s now
      that the template says 360 (`d9e376d`); a manual run took 112 s, exit 0.
