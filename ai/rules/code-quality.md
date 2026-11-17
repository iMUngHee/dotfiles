# Code Quality

Holds for code you write or change in any language. A project's own
CONVENTIONS.md or lint configuration wins where it says otherwise.

- Split code by responsibility: each module owns one concept behind a small
  interface, and new code goes where its concept already lives, not into
  whichever file you happen to be editing.
- Keep a module only if deleting it would push its complexity onto its
  callers; a pass-through layer whose interface is as wide as its body is noise.
- Point dependencies one way: follow the project's layering, and where it has
  none keep I/O, frameworks and UI at the edges without inventing layers.
- Parse untrusted input once at the boundary into a precise type instead of
  passing raw strings, maps or `any` inward, and never silence the type
  checker or linter without a stated reason.
- Comment only what the code cannot say (why, constraints, trade-offs), and
  describe the code as it is now: never cite internal plans, sessions or steps
  or narrate the change in progress; link a shared issue or spec when it
  explains a constraint.
- Size data structures and algorithms to the expected input, and claim a
  performance effect only alongside a measurement.
- Before committing code, run the `tidy` skill over the diff.
