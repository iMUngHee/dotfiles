# Bundled gate contract

This is how the bundled [driver](check.sh), [hook](pre-push) and [layer helper](check-layers.sh) behave. The policy for choosing and wiring a gate is in [gate](../references/gate.md).

## Registration

`scripts/check-config.sh` defines `tool_versions` (print the versions of tools whose upgrade can change a result) and `register_checks`, which registers each check as `check <name> <fast|full> <hint> -- <command...>`. The gate registers `banned patterns` when `scripts/check-data/banned-patterns.tsv` exists, `formal drift` and each `formal:<name>` when `scripts/check-data/formal.tsv` exists, and `rule tags` when `.ai/rules` exists or check-config defines `rule_files`. Registration only records; checks run after the list is complete. `--fast` runs the `fast` checks, the default runs all. Every check runs even after one fails; the summary lists each failed name with its hint and the script exits 1. The hint says how to fix the failure, because the moment a check fails is the moment its reader is looking. `--list` prints the registered names, one per line, and runs nothing. `--write-baselines` rewrites every ratchet baseline to the current violations; it is how a baseline is created or lowered, and the base comparison still refuses growth.

## Base

Ratchet and layer-debt checks compare against one base, resolved once per run after `scripts/check-config.sh` is sourced (so it may set `CHECK_BASE`) and printed by `scripts/check.sh --base`, which also runs without that file and sends its output to stderr (stdout holds only the OID or `root`; diagnostics go to stderr and the exit status is nonzero when none resolves):

1. `CHECK_BASE` when set; it must name a commit.
2. Otherwise the default branch is `origin/HEAD`, else local `main`, else `master`; with none of them the base is unresolved. The base is `git merge-base HEAD <default branch>`.
3. When that merge-base is `HEAD` itself and HEAD is the default branch (for `origin/HEAD`, the branch it points to with `refs/remotes/origin/` removed) or detached, the last commit is the change: the base is the first parent named in HEAD's commit header, `root` when the header names none, and unresolved when the named parent cannot be read, as at a shallow boundary. On any other branch HEAD is the base, since only the working tree has changed.

An unresolved base fails the ratchet and the layer helper with the reason, such as fetching more history or setting `CHECK_BASE`. `root` adopts the baselines and the layer policy as they are, and `Ratchet-Reset` trailers are read from all of HEAD's history. The gate passes the base to its checks as `CHECK_RESOLVED_BASE`, empty when unresolved with the reason in `CHECK_BASE_ERROR`; the [layer helper](#layer-policy) uses it and, run on its own, resolves the base with the same rules, including a `CHECK_BASE` that `scripts/check-config.sh` sets (it carries the same resolver, so it also works beside a repository's own gate). Limitation: on the default branch several commits made without a run are compared only through the last one, and a working-tree change on top of the first commit counts as part of the adoption; CI that checks several commits, or a run meant to cover them, sets `CHECK_BASE` to the commit before the changes.

## Pass record

After a full or fast run passes on a clean working tree, the gate appends `<mode> <key>` to `$(git rev-parse --git-path check-passes)`. The key hashes the HEAD commit OID, the resolved base (an OID, `root`, or `none` when unresolved), the output of the repository's `tool_versions` function and the UTC date (`CHECK_TODAY=YYYY-MM-DD` overrides it). `--passed` exits 0 only when the base resolves, the working tree is clean and the current key is recorded; a run without a base never compared growth, so it never counts. The date in the key makes expiring exceptions and deadlines run again on a new day.

## Banned patterns

`scripts/check-data/banned-patterns.tsv`, tab-separated, `#` comments, columns: `id`, `ere` (a `git grep -E` pattern), `allow` (comma-separated shell globs where `*` also matches `/`, or `-`), `mode` (`ban` or `ratchet`), `deadline` (`YYYY-MM-DD` or `-`), `reason`, `fix`. The search covers tracked files and untracked files git does not ignore, outside `scripts/check-data/`. A failure prints `path:line`, the id, the reason and the fix. Each matching line is decided by the first rule that applies:
1. Inside an `allow` path: exempt. A permanent structural exception, such as an API allowed only inside the framework that wraps it. An inline exception there is redundant and only warns.
2. Past `deadline`: fail, whatever the inline exception or baseline says. Use this for removing a deprecated API by a date.
3. Carries `check-allow(<id>): <reason> until=YYYY-MM-DD` for the same id: exempt while the reason is present and the date has not passed; otherwise fail. An exempt line leaves the ratchet count, so a baselined violation that gains an inline exception needs its baseline lowered in the same change.
4. `mode=ban`: fail. `mode=ratchet`: counted against the baseline.

## Ratchet baseline

`scripts/check-data/ratchet/<id>.txt` holds `sha256(line with surrounding whitespace trimmed)<TAB>count<TAB>example path`, one line per distinct content. A violation is its content, not its location, so moving a file passes and replacing one baselined violation with a different one fails.
- A content hash counted above its baseline, or absent from it, fails. The message gives the count against the baseline and lists every line with that content, since content cannot tell the new copy from the old ones.
- A content hash counted below its baseline fails until the baseline is lowered, so the baseline only shrinks.
- The baseline file may not gain hashes or counts relative to the same file at the base. A baseline the base does not list is a first adoption and passes; one it lists but cannot produce, as in a partial clone, fails.
- A reformat changes hashes without adding violations. A commit in `base..HEAD` with the trailer `Ratchet-Reset: <id> <reason>` lets that id's hashes change, provided its total count does not exceed the base's total.
- Limit: a content hash cannot tell a moved line from the same content reintroduced elsewhere; the second is caught only when the count rises. A ratchet hit in a file whose path holds a tab or a newline is misread; keep such paths out of ratchet patterns.

## Rule tags

The gate registers `rule tags` when `.ai/rules` exists or check-config defines `rule_files`. Two grammars apply, never mixed:

- **`.ai/rules/*.md` (unchanged).** Outside frontmatter and fenced code, an unindented `- ` line starts a rule item and the indented lines after it continue it. The item's last line ends with exactly one tag: `[check: a, b]` naming at least one check, or `[unchecked: reason]` with a reason. A name is a `--list` name or `banned:<id>`. A missing, empty, duplicated or unknown tag fails. CRLF reads as LF. Other list markers (`*`, `1.`) are not rules there; that is a known gap of this grammar, and new rules belong in a `rule_files` document.
- **`rule_files` documents (closed grammar).** `rule_files` prints one repository-relative path per line. A leading `./` is dropped and repeated `/` collapse; an absolute path, a `.` or `..` segment, a symlink in any component or a path Git records as a symlink, a path not listed by `git ls-files` with that exact spelling, or an unreadable file fails with the path. A function that exits non-zero fails with its name and status. Paths under `.ai/rules/` keep the legacy grammar and are checked once. Frontmatter is not skipped. Outside fences, every unindented list line (`-`, `*`, `+`, or one to nine digits followed by `.` or `)`, then a space, a tab or the end of the line) starts a rule item, also directly after a paragraph; a marker with no text on its line fails; indented lines continue the item; an indented list line fails as a nested list, and so does a list line inside a block quote (`> - …`); a table cell is not a list. An HTML comment fails, because it could hide a rule. A fence opens only at column 0 with three or more backticks or tildes (a backtick fence whose info string holds a backtick is not a fence) and closes at a line of the same character, at least as long, indented at most three spaces, with nothing after it; a fence still open at the end of the file fails with its opening line. The tag rules are the same as above, and an `[unchecked: …]` reason needs more than one word, such as `[unchecked: review judges allocation on the request path]`.

## Formal verification record

`scripts/check-data/formal.tsv`, tab-separated, `#` comments, CRLF read as LF, columns: `name` (`[A-Za-z0-9_-]+`, unique), `command` (run from the repository root), `covers` (comma-separated shell globs where `*` also matches `/`), `synced` (the 40-digit commit at which the model or proof was last confirmed to describe the code), `tier` (`full` or `manual`), `property` (one sentence). A row with an empty field, a bad value, `-` as `covers` or a repeated name fails.
- `formal drift` (fast): `synced` must exist and be an ancestor of HEAD. The changed paths are `git diff --name-only -z --no-renames <synced>` (the synced tree against the working tree, index included; both sides of a rename; deletions) plus untracked files git does not ignore. Paths under `scripts/check-data/` never count, so updating `synced` is not itself drift. A changed path matching `covers` fails the row with its name and command: rerun the check, confirm the model still describes the code, then set `synced` to the commit you checked. The gate cannot see whether the check was rerun; the development guide's procedure for bringing a formal check back in step covers that. The check needs `synced` in local history, so a shallow clone (CI with depth 1) must fetch enough history first.
- A `tier=full` row is registered as the full check `formal:<name>` running `command`, so rule tags can name it. A `manual` row belongs in the development guide's table of verification commands.

## Pre-push

The hook refuses a dirty working tree, because the checks read the working tree and an uncommitted edit could hide a violation in HEAD. It refuses to push any commit other than HEAD and says to check that branch out first. Otherwise it skips when `check.sh --passed` succeeds and runs `check.sh --fast` when it does not. The hook and the gate unset `git rev-parse --local-env-vars` first, so running from a linked worktree cannot reach another repository.

## Layer policy

For a repository whose stack has no native dependency-policy tool. `scripts/check-layers.sh --doc <ARCHITECTURE path> -- <extractor command...>` reads the fixed policy `scripts/check-data/layers.tsv`: tab-separated, `#` comments, rows `layer<TAB><name><TAB><glob>[,<glob>...]`, `allow<TAB><from-layer><TAB><to-layer>`, `debt<TAB><from-path><TAB><to-path>` and an optional `empty-ok`. Globs match repository-relative paths and take only `*` and `?`, which also match `/`, and a nonempty `[...]` or `[!...]` listing characters other than `[`, `]` and `\`; any other glob makes the row malformed. Layer names use letters, digits, `_`, `.` and `-`. The extractor prints production dependencies as `from<TAB>to` and `file<TAB><path>` for each production file without one, so that every file is classified (a bare path fails, since a truncated edge would look the same); internal files are canonical repository-relative paths (no leading `./`, `.` or `..` segment, repeated `/`, control character, DEL or absolute path) and external dependencies are `ext:<name>` with a nonempty name; output holding a NUL byte fails.

1. Every policy row and extractor line is validated first; a malformed row, an allow row naming an unknown layer, a non-canonical endpoint or declared file, or an extractor that exits non-zero fails.
2. Every declared file and the internal endpoint of every edge, external edges included, must match exactly one layer, else it fails as unclassified or ambiguous.
3. Edges with an `ext:` endpoint are then dropped. A same-layer edge passes; a cross-layer edge passes when an `allow` row permits it; otherwise it fails with both layers, the allowed targets and the ARCHITECTURE path given by `--doc`, unless a `debt` row names exactly that edge.
4. A `debt` row is valid only for an edge that exists and is still forbidden; one for a vanished or now-allowed edge fails until deleted. Against the [base](#base), `debt` rows may only be removed: a row added since the base fails. When the base is `root` or confirms the policy file absent, its rows are the first adoption; when the base cannot be read, the check fails.
5. With no edge between internal files, the check fails unless the policy has `empty-ok`.
