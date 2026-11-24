# Gate

Use one gate. A clone-local hook can be bypassed; server-side enforcement depends on the existing CI and repository settings. Pre-push and any CI call it; nothing else holds a second copy of the checks. When a gate already runs the repository's checks, keep its implementation and command names. Add a missing tier or selected check in its native form. Do not copy a generic driver just to expose unused flags, records or configuration files. Point the local hook at that gate; the bundled hook assumes the bundled driver's pass-record interface, so adapt the hook to an existing gate instead of replacing the gate to fit the hook.

For a new gate, use the bundled [driver](../assets/check.sh) and [hook](../assets/pre-push) when the repository needs their registration, ratchet or pass-record facilities. Keep custom checks in the consuming repository's check-config.sh. Inspect existing hook configuration before enabling the hook once per clone. A small repository can use its existing test command in both tiers. The contract below describes the bundled implementation.

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

Select a check when it protects an adopted contract precisely and at reasonable cost. Try the stack's existing inspection or test first. Add custom logic only for a concrete gap and record the extra guarantee it buys. For public command or schema checks, exercise the compatibility promise and allow unrelated output or implementation changes. Examples:

- **Work-artifact references.** Comments and test messages that point at plans, review rounds or agent scratch paths. A `ban` pattern with a hint that says to write the reason in the comment itself.
- **Surface inventory drift.** Extract the names the code exposes (environment variables, commands and options, routes, configuration keys) and fail when a reference document does not list one. Keep build- or test-only names in a reasoned exception list inside the check.
- **Layering.** Fail when a module imports across a boundary the architecture document forbids ([documentation.md](documentation.md)); the check reads the allowed dependencies from that document or a data file it links. Prefer the stack's dependency-graph or import-restriction tool; fall back to a manifest or import grep.
- **Generated sources.** Regenerate and fail when the committed output differs, so edits go to the source.
- **Changelog and version.** Fail when the version owner and the changelog's released sections disagree, or when the unreleased section is missing.
- **Dependency audit.** Known advisories, unused dependencies and disallowed licenses in `full`. Each ignore entry carries an id, a date and a reason, and a self-test proves the gate fails on an entry that lacks one.
- **Dead code** in `full`, with the stack's own detector.
- **Documents stay true.** Check an inventory when contributors rely on its completeness, or compare generated text with its source. Review ownership and intent separately ([documentation.md](documentation.md)).
- **Flaky tests fail.** A test that passes only on retry fails the run.

Keep regression cases for custom check logic where a mistake could hide a violation or reject a legitimate change. Reuse existing coverage for thin wrappers around a tested tool.

## Turning a correction into a check

When a recurring or costly mistake warrants work, use the evidence from the affected change:

1. Remove the mistake with structure where possible: one owner for each piece of state, one supported way to do a task, internals that cannot be imported.
2. Otherwise make it fail: a type, the stack's own ban-with-message facility, or a `banned-patterns.tsv` line. Before adding the check, show it failing on the real past mistake or a reproduction of it.
3. Baseline existing occurrences if gradual removal fits the adopted rule. Set a deadline when there is a supported migration and a reason to enforce it.
4. Tag the rule in its owning guidance with the actual check. A recurring mistake that only judgment can catch becomes a rule tagged `unchecked`; record its evidence in the existing review or issue log.

## Mutation testing

A suite that passes when the code is broken proves nothing. When an important behavior can break without a failing test and mutation testing is worth its cost, register it as an optional `full` check limited to the files a change touches, and assess whether a surviving mutant changes an observable contract before adding a test.
