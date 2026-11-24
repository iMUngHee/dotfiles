# Maintenance defaults

Use the decisions that affect this repository. Resolve ordinary preferences from the checkout and present an inferred setup in one sentence. If purpose is unknown, ask what the maintainer expects to do with the project. Defer stack-specific files until that answer exists.

| Decision | Default | When to ask |
| --- | --- | --- |
| Conventions | Keep reasoned decisions and existing tools. Select relevant guide items for concrete failures ([conventions.md](conventions.md)). | A choice would require a disruptive migration. |
| Strictness | Enforce adopted machine-decidable rules on new code. Record why an exception is needed; ratchet measurable existing violations and leave judgment to review. | A constraint would exclude a legitimate use or change a public contract. |
| Gate | One `scripts/check.sh` with fast and full tiers, run by a pre-push hook. Extend an existing gate instead of adding a second. Wire an existing CI to call the same script; do not create CI. | The maintainer wants CI created, or the full tier needs special hardware or credentials. |
| Compatibility | Identify a concrete consumer of a command, setting, file format, result or interaction. Preserve its observable behavior. | A missing acceptance criterion determines whether the result is correct. |
| Verification | Reuse the cheapest relevant working entrypoint. Pick further methods by risk ([verification.md](verification.md)). Name the changed behavior, trigger and expected observation. | An expensive job, specialized device, uncertain scientific threshold, or a model or proof toolchain needs a human decision. |
| Agent guidance | Keep one editable source with the smallest working loader arrangement. Place short rules, their reasons and maintenance commands in the existing contributor guidance ([skills.md](skills.md), [documentation.md](documentation.md)). | Independent human-owned instructions conflict with the requested migration. |
| Versioning | Trace each published contract to its consumers and version owner. Preserve the release unit, bump rules, tags and changelog those consumers use. For a first release, choose the version and release signals its consumers need ([conventions.md](conventions.md)). Defer publishing machinery until there is a release target. | Independent release units or a compatibility promise cannot be inferred. |

A keyboard-only save/reopen flow may need a manual GUI check; a terminal UI may need restoration verified after exit. A small CPU fixture can exercise a research pipeline and a full dataset can test numerical equivalence only once the reference and tolerance are known. A runner that exits successfully with zero applicable tests proves only that the runner starts. Record actual and proposed checks separately. Put each check in fast or full by its cost.

## Shared source and discovery

Reuse an existing manifest, handwritten entrypoint or generator first. A simple layout can keep AGENTS.md as the editable document and CLAUDE.md containing `@AGENTS.md` where the installed Claude loader supports imports. Preserve any existing tool-specific instructions. With a concrete shared skill, expose the same source through both .agents/skills/<name> and .claude/skills/<name> using the repository's existing mechanism. Inspect both SKILL.md paths after wiring. If directory links are unavailable, use an existing copy/sync mechanism or report the missing discovery path.

For a new two-tool layout that needs generated surfaces and already supports Node 22.16+ and relative symlinks:

- Copy the bundled asset to scripts/agents-build.mjs. Inspect any existing destination before copying.
- Write project guidance in .ai/PROJECT.md. Put actual area rules in .ai/rules/*.md and actual skills in .ai/skills/<name>/SKILL.md. Both collections are optional.
- To scope a rule, begin the file with YAML frontmatter containing only a `paths:` list of indented dash-prefixed patterns, optionally quoted. Use plain Markdown for an unconditional rule.
- Run `node scripts/agents-build.mjs`, then `node scripts/agents-build.mjs --check`. The builder creates root instruction files, Claude rule links and both tools' skill links. Edit the sources to change them. The consuming repository owns its builder.
- When Node or link creation is unavailable use the simple layout. Keep the existing environment sufficient to maintain the project.

Official support indicates a compatible default. Describe a choice as measurably more efficient only with a relevant comparison.
