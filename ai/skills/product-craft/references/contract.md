# design-contract.md

The contract is the surface's working memory: what the next agent needs in order to continue
it without re-deriving anything. It is not a ledger. There are no approval records, ids,
hashes or status tables in it.

## Rules

- One contract per surface, next to the code it governs (repository root for a single-app
  repository, the app's directory otherwise). A nearer contract overrides a parent's
  sections it restates.
- Keep the section names and order below; other tooling and older contracts rely on them.
  Leave out a section that has nothing in it yet, except that an App-depth contract fills
  all of them.
- Write values and concrete rules. An adjective is not a value.
- Older contracts carry obligation tables, approval tokens and gate records from an earlier
  format. Read them as evidence of what was decided. Do not extend those tables and do not
  rewrite them; add new entries in the form below.
- The build and the contract must agree. When the build changes a decision, change the
  contract in the same piece of work.
- Write the contract only as part of work the owner asked for. An audit writes nothing.

## Template

```markdown
# design-contract.md

## Scope & Inheritance
What this covers (paths, windows, screens), the parent contract if any, the owner, last
updated. Medium, toolkit, and the host ceiling.

## Surface Type & Craft Profile
What kind of app this is and what it is optimising for. The references studied, with URL
and screenshot path, and which one the direction is taken from.

## Product Context
Who uses it, for what jobs, what success looks like, what is out of scope.

## UX Model
Screens and how they connect. The object × action matrix. The journeys, as replayable steps.

## Data & State Model
What each object holds that the user sees. The states of each screen with their words and
way out.

## Interaction Model
Keyboard map, pointer behaviour, destructive actions and their undo or confirmation,
validation and feedback timing.

## Visual System
The direction in one line naming its reference. The value table: colour, type, shape, depth,
spacing, density, icons, motion — each value with its source.

## Component Rules
Each component kind in use: how it looks in each state, in the values above, and which
library component realises it.

## Responsive & Accessibility
Behaviour at the smallest and largest supported size and at scaled displays; themes
supported; contrast, focus and target-size values; reduce-motion behaviour.

## Performance & Formatting
What must feel instant and how waiting is shown. Formats for dates, numbers, durations,
sizes.

## Microcopy
The words: labels, empty states, errors with their recovery, confirmations.

## Do / Don't
The few guardrails specific to this surface.

## Artifact Ledger
Optional. Files that carry decisions: reference screenshots, candidates shown, the chosen
one, review captures. Path and one line each. Omit when there are none.

## Implementation Bridge
Library and version, where tokens or theme resources live, the asset inventory with sources
and how each asset is rebuilt, how to run with realistic fixtures and reach each state, the
review commands.

## Decision Log & Open Questions
Dated lines: what was decided, by whom (the owner's words, or "delegated: chosen by <agent>
because <reason>"), and what is still open. The current **Decided for you** list.
```

## Depth

- **Touch-up**: add or amend only the lines the change touches, plus a Decision Log entry.
- **Screen**: the sections the new screen needs — at least UX Model additions (matrix rows,
  journeys), states, Component Rules for new kinds, and the asset rows.
- **App**: every section.
