# Seeded rules and project skills

These keep the repository improving after bootstrap. Write them under `.ai/` (or the repository's existing agent-guidance source), name skills with the project's prefix, and make every one work with nothing but the repository: no personal skills, home paths or machine details. Adapt the text to the repository's commands and nouns; leave no placeholders.

## Maintenance rule

`.ai/rules/maintenance.md`, unconditional. Each item ends with its tag (see [gate.md](gate.md) contract 6):

- When a change is corrected for a mistake that a machine can catch, make the mistake fail at the highest level that works: structure first, then a type, a ban whose message names what to use instead or a banned-patterns line, then a test; prose last. Show the check failing on the real mistake before adding it. [unchecked: judged in review; the gate cannot see why a check was added]
- Put existing occurrences of a newly banned pattern in the ratchet baseline instead of fixing them in the same change, and leave the clean-up to the garden skill. [check: banned patterns]
- Write prose rules only for decisions that need judgment, and tag every rule with the check that enforces it or the reason none can. [check: rule tags]
- When asked for a table of rules and what enforces them, the tags in `.ai/rules` are that table; do not keep a second one. [check: rule tags]
- Never edit a ratchet baseline by hand; regenerate it with `scripts/check.sh --write-baselines`; the gate refuses a baseline that grows relative to the base. [check: banned patterns]
- A comment states a reason or constraint the code cannot. It never justifies a workaround or points at plans, sessions or review rounds. [check: banned:<the repository's comment pattern ids>]

## Default skills

Create these three in every bootstrapped repository.

### `<prefix>-code-review`

Review a branch commit by commit. Run `scripts/check.sh` first and report its failures as findings. Judge each commit against `.ai/rules` and the development guide. End the review by closing every finding that has happened before: name the check, ban, ratchet entry or structural change that stops it recurring, and add it in the same branch or as a follow-up for the garden skill. A finding that needs judgment becomes or extends a tagged `unchecked` rule, and an `unchecked` rule that a check could now enforce is proposed as one. Judge new tests against the development guide's criteria for choosing cases; a test that still passes when the behavior it names breaks, or fails when only internals change, is a finding too.

### `<prefix>-rule-docs-sync`

Find where rules, generated agent files and human documentation disagree, and fix the source. Check that every rule's tag still names a check that exists and still enforces it, that the development guide gives the reason for each rule, and that generated files were rebuilt from their sources. List `unchecked` rules that a check could now enforce, and remove a rule whose mistake the structure now makes impossible.

### `<prefix>-garden`

Make one small, behavior-preserving clean-up change at a time. Pick from, in order: a ratchet baseline entry, a pattern near its deadline, dead code or an unused dependency the full gate reports, an old example of a banned pattern in documentation or tests. Turning an `unchecked` rule into a check is design work, not clean-up; leave it to code review. Fix it, lower the baseline with `scripts/check.sh --write-baselines`, run the gate, and commit the clean-up on its own. Run it on a schedule or at the end of feature work.

## Conditional skills

Create these only when the repository gives them something concrete to check.

| Skill | Create when | Does |
| --- | --- | --- |
| `<prefix>-security-review` | The repository has a security boundary: authentication, isolation, secrets, untrusted input crossing into privileged code | Checks a change against each named boundary |
| `<prefix>-change-checklist` | The repository exposes an inventory that must change together: environment variables, commands, routes, bindings, schema | Lists what else to change when one entry is added or renamed |
| `<prefix>-feature-verify` | The repository can run its application or service locally | Drives it through the feature map with the reusable driver and keeps the evidence |

Mark deployment or production-touching skills as invoked only on request.
