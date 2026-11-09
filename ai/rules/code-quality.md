# Code Quality

Holds for code you write or change in any language. A project's own
CONVENTIONS.md or lint configuration wins where it says otherwise.

- Split code by responsibility: each module owns one concept behind a small
  interface, and new code goes where its concept already lives, not into
  whichever file you happen to be editing.
  Bad: a retry policy appended to `handlers.go`. Good: it lives in `retry.go`
  next to the client that uses it.
- Keep a module only if deleting it would push its complexity onto its
  callers; a pass-through layer whose interface is as wide as its body is noise.
  Bad: `UserService.get(id)` that only calls `repo.get(id)`.
- Point dependencies one way: follow the project's layering, and where it has
  none keep I/O, frameworks and UI at the edges without inventing layers.
  Bad: a pricing function that reads an env var. Good: the caller passes it in.
- Parse untrusted input once at the boundary into a precise type instead of
  passing raw strings, maps or `any` inward, and never silence the type
  checker or linter without a stated reason.
  Bad: `def handle(payload: dict)` used five calls deep. Good: `Order.parse(payload)` at the edge.
- Comment only what the code cannot say (why, constraints, trade-offs), and
  describe the code as it is now: never cite internal plans, sessions or steps
  or narrate the change in progress; link a shared issue or spec when it
  explains a constraint.
  Bad: `// Step 2: new retry logic (was a loop before)`. Good: `// The API rate-limits bursts; back off exponentially.`
- Size data structures and algorithms to the expected input, and claim a
  performance effect only alongside a measurement.
  Bad: a list scan inside a loop over 100k rows. Good: a map built once, with the benchmark that shows it.
- Before committing code, run the `tidy` skill over the diff.
