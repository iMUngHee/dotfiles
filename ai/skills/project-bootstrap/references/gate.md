# Gate

One script decides whether a change may leave the machine. Pre-push and any CI call it; nothing else holds a second copy of the checks. Install the bundled [`assets/check.sh`](../assets/check.sh) as `scripts/check.sh` and [`assets/pre-push`](../assets/pre-push) as `.githooks/pre-push`, write the repository's own checks in `scripts/check-config.sh`, then run `git config core.hooksPath .githooks` once per clone. Keeping the repository's checks out of `check.sh` lets a newer copy of the asset replace it without losing them, so never edit `check.sh` or `pre-push` in the repository; when the asset lacks something, register a check in `check-config.sh` or report the gap. Inspect any existing destination first and extend an existing gate instead of adding a second one. Both scripts run on the bash 3.2 that macOS ships.

## Contract

1. **Registration.** `scripts/check-config.sh` defines `tool_versions` (print the versions of tools whose upgrade can change a result) and `register_checks`, which registers each check as `check <name> <fast|full> <hint> -- <command...>`. The gate registers `banned patterns` when `scripts/check-data/banned-patterns.tsv` exists, `formal drift` and each `formal:<name>` when `scripts/check-data/formal.tsv` exists, and `rule tags` when `.ai/rules` exists. Registration only records; checks run after the list is complete. `--fast` runs the `fast` checks, the default runs all. Every check runs even after one fails; the summary lists each failed name with its hint and the script exits 1. The hint says how to fix the failure, because the moment a check fails is the moment its reader is looking. `--list` prints the registered names, one per line, and runs nothing. `--write-baselines` rewrites every ratchet baseline to the current violations; it is how a baseline is created or lowered, and the base comparison still refuses growth.
2. **Base.** Ratchet checks compare against a base commit: `CHECK_BASE` when set, otherwise `git merge-base HEAD <default branch>`, where the default branch is `origin/HEAD`, else local `main`, else `master`. If no base resolves, the ratchet check fails and says to set `CHECK_BASE`.
3. **Pass record.** After a full or fast run passes on a clean working tree, the gate appends `<mode> <key>` to `$(git rev-parse --git-path check-passes)`. The key hashes the HEAD commit OID, the resolved base OID, the output of the repository's `tool_versions` function and the UTC date (`CHECK_TODAY=YYYY-MM-DD` overrides it). `--passed` exits 0 only when the working tree is clean and the current key is recorded. The date in the key makes expiring exceptions and deadlines run again on a new day.
4. **Banned patterns.** `scripts/check-data/banned-patterns.tsv`, tab-separated, `#` comments, columns: `id`, `ere` (a `git grep -E` pattern), `allow` (comma-separated shell globs where `*` also matches `/`, or `-`), `mode` (`ban` or `ratchet`), `deadline` (`YYYY-MM-DD` or `-`), `reason`, `fix`. The search covers tracked files and untracked files git does not ignore, outside `scripts/check-data/`. A failure prints `path:line`, the id, the reason and the fix. Each matching line is decided by the first rule that applies:
   1. Inside an `allow` path: exempt. A permanent structural exception, such as an API allowed only inside the framework that wraps it. An inline exception there is redundant and only warns.
   2. Past `deadline`: fail, whatever the inline exception or baseline says. Use this for removing a deprecated API by a date.
   3. Carries `check-allow(<id>): <reason> until=YYYY-MM-DD` for the same id: exempt while the reason is present and the date has not passed; otherwise fail. An exempt line leaves the ratchet count, so a baselined violation that gains an inline exception needs its baseline lowered in the same change.
   4. `mode=ban`: fail. `mode=ratchet`: counted against the baseline.
5. **Ratchet baseline.** `scripts/check-data/ratchet/<id>.txt` holds `sha256(line with surrounding whitespace trimmed)<TAB>count<TAB>example path`, one line per distinct content. A violation is its content, not its location, so moving a file passes and replacing one baselined violation with a different one fails.
   - A content hash counted above its baseline, or absent from it, fails. The message gives the count against the baseline and lists every line with that content, since content cannot tell the new copy from the old ones.
   - A content hash counted below its baseline fails until the baseline is lowered, so the baseline only shrinks.
   - The baseline file may not gain hashes or counts relative to the same file at the base. A baseline absent at the base is a first adoption and passes.
   - A reformat changes hashes without adding violations. A commit in `base..HEAD` with the trailer `Ratchet-Reset: <id> <reason>` lets that id's hashes change, provided its total count does not exceed the base's total.
   - Limit: a content hash cannot tell a moved line from the same content reintroduced elsewhere; the second is caught only when the count rises. A ratchet hit in a file whose path holds a tab or a newline is misread; keep such paths out of ratchet patterns.
6. **Rule tags.** In `.ai/rules/*.md`, outside frontmatter and fenced code, an unindented `- ` line starts a rule item and the indented lines after it continue it. The item's last line ends with exactly one tag: `[check: a, b]` naming at least one check, or `[unchecked: reason]` with a reason. A name is a `--list` name or `banned:<id>`. A missing, empty, duplicated or unknown tag fails. CRLF reads as LF.
7. **Formal verification record.** `scripts/check-data/formal.tsv`, tab-separated, `#` comments, CRLF read as LF, columns: `name` (`[A-Za-z0-9_-]+`, unique), `command` (run from the repository root), `covers` (comma-separated shell globs where `*` also matches `/`), `synced` (the 40-digit commit at which the model or proof was last confirmed to describe the code), `tier` (`full` or `manual`), `property` (one sentence). A row with an empty field, a bad value, `-` as `covers` or a repeated name fails.
   - `formal drift` (fast): `synced` must exist and be an ancestor of HEAD. The changed paths are `git diff --name-only -z --no-renames <synced>` (the synced tree against the working tree, index included; both sides of a rename; deletions) plus untracked files git does not ignore. Paths under `scripts/check-data/` never count, so updating `synced` is not itself drift. A changed path matching `covers` fails the row with its name and command: rerun the check, confirm the model still describes the code, then set `synced` to the commit you checked. The gate cannot see whether the check was rerun; the development guide's procedure for bringing a formal check back in step covers that. The check needs `synced` in local history, so a shallow clone (CI with depth 1) must fetch enough history first.
   - A `tier=full` row is registered as the full check `formal:<name>` running `command`, so rule tags can name it. A `manual` row belongs in the development guide's table of verification commands.
8. **Pre-push.** The hook refuses a dirty working tree, because the checks read the working tree and an uncommitted edit could hide a violation in HEAD. It refuses to push any commit other than HEAD and says to check that branch out first. Otherwise it skips when `check.sh --passed` succeeds and runs `check.sh --fast` when it does not. The hook and the gate unset `git rev-parse --local-env-vars` first, so running from a linked worktree cannot reach another repository.

## Repository checks

Write a check for every rule that a machine can decide. Patterns that recur:

- **Work-artifact references.** Comments and test messages that point at plans, review rounds or agent scratch paths. A `ban` pattern with a hint that says to write the reason in the comment itself.
- **Workaround comments.** A comment that justifies a workaround teaches the next agent the workaround. Ban the workaround itself where the stack can, and the justifying phrase where it cannot.
- **Surface inventory drift.** Extract the names the code exposes (environment variables, commands and options, routes, configuration keys) and fail when a reference document does not list one. Keep build- or test-only names in a reasoned exception list inside the check.
- **Layering.** Fail when a module imports across a boundary the architecture forbids. Prefer the stack's dependency-graph or import-restriction tool; fall back to a manifest or import grep.
- **Generated sources.** Regenerate and fail when the committed output differs, so edits go to the source.
- **Changelog and version.** Fail when the version owner and the changelog's released sections disagree, or when the unreleased section is missing.
- **Dependency audit.** Known advisories, unused dependencies and disallowed licenses in `full`. Each ignore entry carries an id, a date and a reason, and a self-test proves the gate fails on an entry that lacks one.
- **Dead code** in `full`, with the stack's own detector.
- **Flaky tests fail.** A test that passes only on retry fails the run.

Every check script that has its own logic gets a self-test the gate runs, so a broken check cannot pass silently.

## Turning a correction into a check

When a reviewer or the maintainer corrects the same mistake twice:

1. Remove the mistake with structure where possible: one owner for each piece of state, one supported way to do a task, internals that cannot be imported.
2. Otherwise make it fail: a type, the stack's own ban-with-message facility, or a `banned-patterns.tsv` line. Before adding the check, show it failing on the real past mistake or a reproduction of it.
3. Put existing occurrences into the ratchet baseline and give them a deadline when they are deprecated.
4. Tag the rule in `.ai/rules` with the check. Write prose only for what needs judgment, tagged `unchecked`.

## Mutation testing

A suite that passes when the code is broken proves nothing. Where the stack has a mutation tool, register it as an optional `full` check limited to the files a change touches, and treat a surviving mutant in changed code as a missing test.
