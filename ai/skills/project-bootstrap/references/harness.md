# What the repository holds

The harness is what a contributor reads and runs to make a fitting change with only the checkout. Every repository holds the floor: an entry point, ARCHITECTURE ([architecture](architecture.md)), CONVENTIONS ([conventions](conventions.md#writing-conventions)) and a gate. Start small: a piece above the floor joins the document that already serves its readers and gets its own file only when maintained independently.

| Piece | Holds | Default home | Own file when |
| --- | --- | --- | --- |
| Entry point | What the project is, a map of where things live, the commands, how to work, links to ARCHITECTURE and CONVENTIONS | The existing AGENTS.md or contributor section of the README | No entry exists |
| Development guide | Procedures (setup, gate, workflow, release) and the reason behind each rule | The contributing guide | Rules need reasons and examples that would bury the short rule text |
| Reference | Public surfaces: commands, configuration, environment variables, API, schema | Existing user or API docs | Consumers depend on a surface; keep each true with an inventory check |
| Decisions and research | Why a design was chosen, measurements, sources, known limits | ARCHITECTURE's decisions section, or existing ADR or research records | Decisions outgrow the section, or one rests on evidence a later contributor must re-check |
| Scoped agent rules | Short rules loaded while editing matching paths | None | The agent needs the rule exactly while editing those paths |
| Project skills | A repeated project procedure with a concrete check | None | A map entry ([maintenance](maintenance.md#project-skills)) |

The two normative documents cost reading time in every session. Keep the entry point to a summary and links, and when a structural rule matters only while editing certain paths, give it a scoped agent rule that points into ARCHITECTURE instead of loading the whole document everywhere.

## Writing the guidance

Start at the existing contributor entry point and link both normative documents from it. For a representative change, point to the owner, its extension path in ARCHITECTURE and a real example to extend. Keep current design apart from proposed migrations, and decisions apart from public reference and evidence such as measurements or known limits.

Name the runtime and package-manager versions the gate and commit hooks need, and how to activate them. Give each decision one editable source and link human and agent entry points to it. Say what enforces each rule: the compiler or type that makes it unrepresentable, the named gate check, or what a reviewer must judge. For tagged rule lists (see [rule tags](../assets/check-contract.md#rule-tags)), name a registered check only to the extent it enforces the rule and use `[unchecked: reason]` otherwise; if code outside the gate enforces it, say so in the reason and point to its proof. Verify that each stated boundary matches the code and exercise the path another contributor would follow; a link check only proves the destination exists. Update the owning document and related contract fixtures in the same change as the decision, interface or example it describes.

## Keeping it true

Keep documents true with the checks in [gate](gate.md#repository-checks) (surface inventories, generated guidance, work-artifact references, changelog and version, layering) and review ownership and intent separately.

## Agent guidance source and loaders

Reuse an existing manifest, handwritten entrypoint or generator first. A simple layout keeps AGENTS.md as the editable document and a CLAUDE.md containing `@AGENTS.md` where the installed Claude loader supports imports. For an entry point kept as a link, the drift check verifies the link and its target and is proved to reject an identical plain copy. Preserve any existing tool-specific instructions; for a handwritten AGENTS.md keep every byte and append only what is missing. Expose a concrete shared skill through both .agents/skills/<name> and .claude/skills/<name> with the repository's existing mechanism and inspect both paths, or report the missing discovery path.

For a new two-tool layout that needs generated surfaces and already supports Node 22.16+ and relative symlinks:

- Copy the bundled asset to scripts/agents-build.mjs. Inspect any existing destination before copying.
- Write project guidance in .ai/PROJECT.md. The builder copies it into the root AGENTS.md and CLAUDE.md without rewriting paths, so write its links relative to the repository root (for example `CONVENTIONS.md`, `docs/ARCHITECTURE.md`). Put actual area rules in .ai/rules/*.md and actual skills in .ai/skills/<name>/SKILL.md. Both collections are optional.
- To scope a rule, begin the file with YAML frontmatter containing only a `paths:` list of indented dash-prefixed patterns, optionally quoted. Use plain Markdown for an unconditional rule.
- Run `node scripts/agents-build.mjs`, then `node scripts/agents-build.mjs --check`. The builder creates root instruction files, Claude rule links and both tools' skill links. Edit the sources to change them. The consuming repository owns its builder. Verify discovery, an idempotent rerun and the bundled 32 KiB generated AGENTS.md limit.
- When Node or link creation is unavailable use the simple layout. Keep the existing environment sufficient to maintain the project.
