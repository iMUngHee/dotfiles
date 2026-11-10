# Build

Build what the contract says, in the project's own architecture. The contract already holds
the look as values and the behaviour as a matrix and journeys; building is carrying those
over without loss.

## Before writing UI code

1. Read the contract's Visual System, Component Rules, matrix, journeys, states and asset
   inventory, and open the chosen reference's screenshots. Keep them open while building.
2. Look at how the project already does UI: its components, tokens or theme resources,
   styling conventions, and tests. Extend those; do not start a parallel system.
3. If a toolkit skill is installed for this stack, load it now. It decides which control or
   API realises a design, and what the toolkit's pitfalls are.
4. If the plan spans several files or changes architecture, the technical plan comes first
   (`design`), built from the contract.

## Carrying the look

- **Put the direction's values in one place** — theme resources, tokens, or constants — and
  use only those names in the UI code. One definition per colour role, text style, radius and
  spacing step. This is what keeps secondary text the same grey on every screen.
- **Use the values exactly.** Do not round a 13px size to 14 or swap a reference colour for
  the toolkit's nearest default because it is handier.
- **A shared value changes every screen that uses it.** When the work alters app-wide
  tokens, theme resources or a shared component, every other screen is now part of the
  change: capture and review them too, and restyle the shared pieces they show — dialogs,
  notifications, menus — so the old look does not survive in them.
- **Build each component kind once** and reuse it. Two hand-written versions of a list row
  are how inconsistency starts.
- **Use the component library** for anything it provides, themed to the direction's values.
  Restyle through the library's supported means before replacing a control wholesale. When a
  design needs a custom control, it also needs keyboard handling, focus, accessibility names,
  every state, and the platform's contrast themes — budget for that or change the design.
- **Set real content into it**: the long title, the 200-item list, the Korean strings, the
  empty library. Fixtures with three short rows hide everything.

## Covering the behaviour

- Every `yes` cell of the object × action matrix exists, where the matrix says it lives, by
  pointer and by keyboard.
- Every state of every screen is built — empty, loading, failed, long content — with its
  words and its way out.
- Every component baseline that applies is met.
- Each journey can be walked from its first step to its last.

When the build shows that something in the contract cannot be done as written, or a better
answer appears, change the contract and note it in the Decision Log; do not let the build
and the contract quietly disagree. When it changes what the owner would see or lose, add it
to **Decided for you**.

## Assets

Produce everything in the asset inventory as part of the build, not afterwards:

- Interface icons from the one chosen set, at the size and stroke the direction names, on a
  shared baseline with their labels.
- Self-drawn vector assets rendered at their real sizes, looked at, and corrected.
- Generated images produced from the reference and palette, looked at, and regenerated
  until they fit; background removal and resizing done as repeatable steps.
- Every platform size and format the app needs (window, taskbar or dock, installer, favicon).

Keep sources and the steps that produced the final files in the project, so the asset can be
rebuilt.

## While building

Run and look often. Take a screenshot after each screen comes together and compare it with
the reference before moving on; drift caught at the first screen costs minutes, drift caught
at the end costs the build.

## Handing over to review

Record in the contract's Implementation Bridge: the library and version in use, where the
tokens or theme resources live, how to run the app with realistic fixtures, and how to reach
each state. Then run `review.md`. Building is not the end of the work.
