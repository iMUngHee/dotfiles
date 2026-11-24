# What the repository holds

The harness is what a contributor, human or agent, reads and runs to make a fitting change with only the checkout. Two working repositories mark its range. A small analysis engine keeps a short agent entry file, an architecture note, a conventions file of the rules the code cannot show, a contributing guide, normative specifications it already had, and a nine-line gate over the stack's strict lints. A platform with isolation, security and release risk adds path-scoped agent rules, a development guide giving the reason behind each rule, reference documents that checks keep true, operations documents and a few project skills. Start at the small end. A piece goes into the document that already serves its readers; it gets its own file only when people consult or maintain it independently.

| Piece | Holds | Default home | Own file when |
| --- | --- | --- | --- |
| Entry point | What the project is, a map of where things live, the commands, how to work, pointers to the rest | The existing AGENTS.md or contributor section of the README | No entry exists |
| Conventions | Rules the code cannot show: invariants and what the code may claim, boundaries, normative interfaces, test and fixture rules, language rules with guide IDs, the gate, commits. Each says what enforces it | A section of the entry point | The rules outgrow a section or have their own reviewers |
| Architecture | The shape, why it is cut this way, the module map, which interfaces are specified and versioned and which are free to change, what is deliberately left out | Existing design docs, else the conventions | The project has a boundary a contributor could cross and the reasons need more than a line |
| Development guide | Procedures (setup, gate, workflow, release) and the reason behind each rule | The contributing guide | Rules need reasons and examples that would bury the short rule text |
| Reference | Public surfaces: commands, configuration, environment variables, API, schema | Existing user or API docs | Consumers depend on a surface; keep each true with an inventory check |
| Decisions and research | Why a design was chosen, measurements, sources, known limits | Existing ADR or research records | A decision rests on evidence a later contributor must re-check |
| Scoped agent rules | Short rules loaded while editing matching paths | None | The agent needs the rule exactly while editing those paths |
| Project skills | A repeated project procedure with a concrete check | None | See [maintenance](maintenance.md#conditional-skills) |

## Writing the guidance

Start at the existing contributor entry point. For a representative change, point from it to the owner and its supported extension path. Record the boundary that matters on that path and why it exists: permitted dependencies, who may update state or release a resource, where errors become public, or which work stays off a hot path. Point to a real example contributors can extend, and give the shortcut it rules out. Keep current design apart from any proposed migration, and keep the repository's distinction between design decisions, public reference and evidence such as measurements, research or known limits.

Give each decision one editable source and link human and agent entry points to it. Say what enforces each rule: the compiler or type that makes it unrepresentable, the named gate check, or what a reviewer must judge. For tagged rule lists (see [gate](gate.md) contract 6), name a registered check only to the extent it enforces the rule and use `[unchecked: reason]` otherwise; if code outside the gate enforces it, say so in the reason and point to its proof. Verify that each stated boundary matches the code and exercise the path another contributor would follow; a link check only proves the destination exists. Update the owning document and related contract fixtures in the same change as the decision, interface or example it describes.

## Keeping it true

Prefer checks such as these: a reference document fails when the code exposes a name it does not list, generated agent guidance fails when it differs from its source, comments and test messages fail when they point at plans or session artifacts, the changelog fails when it disagrees with the version owner, and a module fails when it imports across a documented boundary ([gate](gate.md#repository-checks)). Review ownership and intent separately.

## Agent guidance source and loaders

Reuse an existing manifest, handwritten entrypoint or generator first. A simple layout keeps AGENTS.md as the editable document and a CLAUDE.md containing `@AGENTS.md` where the installed Claude loader supports imports. Preserve any existing tool-specific instructions; for a handwritten AGENTS.md keep every byte and append only what is missing. With a concrete shared skill, expose the same source through both .agents/skills/<name> and .claude/skills/<name> using the repository's existing mechanism, and inspect both SKILL.md paths after wiring. If directory links are unavailable, use an existing copy or sync mechanism or report the missing discovery path.

For a new two-tool layout that needs generated surfaces and already supports Node 22.16+ and relative symlinks:

- Copy the bundled asset to scripts/agents-build.mjs. Inspect any existing destination before copying.
- Write project guidance in .ai/PROJECT.md. Put actual area rules in .ai/rules/*.md and actual skills in .ai/skills/<name>/SKILL.md. Both collections are optional.
- To scope a rule, begin the file with YAML frontmatter containing only a `paths:` list of indented dash-prefixed patterns, optionally quoted. Use plain Markdown for an unconditional rule.
- Run `node scripts/agents-build.mjs`, then `node scripts/agents-build.mjs --check`. The builder creates root instruction files, Claude rule links and both tools' skill links. Edit the sources to change them. The consuming repository owns its builder. Verify discovery, an idempotent rerun and the bundled 32 KiB generated AGENTS.md limit.
- When Node or link creation is unavailable use the simple layout. Keep the existing environment sufficient to maintain the project.
