# Direction

Turn the materials into one committed look, written as values a builder can apply without
interpreting.

## From reference to direction

A direction is: *this reference's look, adapted to this app's content and structure*. State
it in one line that names the source — "Library and reader in the manner of <product>: near
black canvas, cover-first grid, chrome that recedes" — then write the values.

Take from the chosen reference, measured rather than estimated:

| Dimension | Write down |
| --- | --- |
| Colour | Each background layer, each text level, the accent, borders and separators, state colours — as values, for light and dark if both exist |
| Type | Families (with a fallback for Korean when needed), every size in use with its line height and weight, and what each is for |
| Shape | Corner radius per element class, border widths, how surfaces are separated |
| Depth | Shadows or layering, exactly as used, or their absence |
| Spacing | The base step and the gaps that repeat: page padding, gaps between groups, row height, control height |
| Density | How much fits on a screen at the default window size |
| Icons | The set, size, stroke weight, filled or outline |
| Motion | What moves, for how long, and what never moves |
| Signature | The one or two details that make the reference feel finished, and how this app will have its own equivalent |

Every value says how it was arrived at, as one of:

- `from <reference, screen>` — taken from the reference as measured (colours sampled, or
  sizes read from its styles or from a capture at known scale);
- `derived: <how>` — worked out from reference values where the reference shows nothing (a
  light theme from a dark capture, a size between two measured ones, a size estimated from
  a capture at unknown scale);
- `departure: <reason>` — deliberately different (the product's own accent, a typeface that
  sets Korean well).

A value with none of these is a default; replace it or account for it. Do not invent a
source to make a value look measured.

Then adapt structure to this app: its objects and journeys decide what dominates the window,
what is persistent, and what appears on demand. Do not pour this app's content into the
reference's layout unchanged, and do not keep a sidebar, toolbar or card grid merely because
it is the usual shape — keep it when the content calls for it.

Check the direction against three things before building:

- **The host ceiling.** Everything in it can actually be drawn by this toolkit.
- **Legibility.** Text and essential indicators are readable against their backgrounds in
  every theme the surface supports, and state is never carried by colour alone.
- **Sameness.** Put it beside the owner's other apps and beside a stock app of this toolkit.
  If it could be mistaken for either, it has not taken enough from the reference.

## Candidates, when the owner is choosing

Make two or three, each built from a **different reference**, so they differ in structure
and character rather than in tint. Same screen, same realistic content in each.

- Produce each in the medium's own substrate where that is cheap, or as a faithful mock
  clearly marked as a mock (see `media.md`).
- Render each and look at it before showing it. Fix what is broken first; a candidate with
  clipped text is not a candidate.
- Put them in `candidate-viewer.html`: one per screen at full size, the reference available
  beside it, no descriptions. Copy the viewer next to the candidate files and open it with
  one `c` parameter per candidate, in order — screenshots or HTML files, by relative path:
  `candidate-viewer.html?c=one.png&c=two.png&c=three.html&reference=ref.png`. The file
  itself is not edited. Number keys and arrows switch, `F` toggles fit and actual size, `R`
  shows the reference beside the candidate. Save that address as a one-line `board.html`
  beside it that redirects there, so the board opens with a double-click.
- Say which you would pick, in one sentence, in the conversation — not on the page.
- The owner answers with a number. "2, but with the list from 1" is a request to redraw 2,
  not to splice.

If the owner says none of them is right, ask what is wrong in their words, find a different
reference, and redraw. Do not adjust the same three.

## When the owner is away

Build one direction from the reference that best fits what the owner has said, as
`SKILL.md` describes. Still record the references you did not choose and why, and leave them
in the viewer beside the built result.

## Writing it into the contract

Visual System holds the direction line, the chosen reference, and the value table above.
Component Rules holds how each component kind in use looks in each state, in those values.
Do / Don't holds the few guardrails specific to this surface — the things that would quietly
turn it generic.

Write values, not adjectives. "Compact" is not a row height.
