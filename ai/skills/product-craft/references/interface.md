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
  one `c` parameter per candidate, in order — screenshots or HTML files, by relative path —
  and one `reference` per candidate in the same order, since each candidate comes from its
  own reference:
  `candidate-viewer.html?c=one.png&c=two.html&reference=one-ref.png&reference=two-ref.png`.
  A single `reference` is shown beside every candidate; a reference wider than its pane is
  scaled down to fit it. The file itself is not edited. Number keys and arrows switch, `F`
  toggles fit and actual size, `R` shows the reference beside the candidate. Save that
  address as a one-line `board.html` beside it that redirects there, so the board opens
  with a double-click.
- Say which you would pick, in one sentence, in the conversation — not on the page.
- The owner answers with a number. "2, but with the list from 1" is a request to redraw 2,
  not to splice.

If the owner says none of them is right, ask what is wrong in their words, find a different
reference, and redraw. Do not adjust the same three.

### The board, when Node can run here

The board puts the viewer beside an A2UI panel and hands the owner's answer back to you as
data. The owner picks a candidate, tunes the tokens you expose with a live preview, and pins
places to change. It is served by `../scripts/board.mjs` (relative to this file); its look
and journeys are in `../design-contract.md`. You compose the panel for each round from the
board catalog. `node <skill>/scripts/board.mjs catalog` prints that catalog: the basic A2UI
components plus CandidatePicker, Heading, Hint, SubmitButton, CommentField, ColorToken,
SizeNudge, AlignPicker, RegionNotes, and the function `showCandidate`.

1. Put the candidates, their assets and their references in a directory of their own, such as
   `.agents/design/board/`. Everything in it except dotfiles and `.board/` is served.
2. Write `board.json` there: `{"candidates": [{"path": "one.html", "reference": "one-ref.png",
   "thumbnail": "one-thumb.png"}, ...], "surface": "surface.json"}`. The order is the
   numbering. Give either a reference per candidate or one shared `"reference"` at the top,
   not both. Thumbnails are optional and show on the picker cards.
3. For live preview, write each tunable value of an HTML candidate as a custom property on
   `:root` in an inline `<style>`, and use it through `var()`: `:root { --accent: #03c75a;
   --gap: 16px; --align: start; } .price { color: var(--accent); }`. Declaring a token again on
   another rule, or only in an external stylesheet, leaves the control without a preview there.
   A candidate with a Content-Security-Policy meta is served as written, with no preview or
   pins.
4. Compose `surface.json` starting from `feedback-surface.json`, which is the minimal surface:
   - Keep the ids `choice` (a CandidatePicker), `comment`, `decide` and `none`, and the
     bindings their actions carry.
   - Add a ColorToken, SizeNudge or AlignPicker only for a token the candidates declare and
     this round is deciding. Bind each to `/adjust/<token>` with the candidates' own value as
     `initial`. Use one control per token, at most 20 per surface. A ColorToken warns when the text
     it colours falls below 4.5:1 on the chosen candidate. Text on a background image or
     gradient is reported as unmeasured, so keep a token's text on plain or translucent colour
     when its contrast matters.
   - Add RegionNotes, bound to `/pins`, when placement matters this round.
   - Questions of your own go in components bound to `/extra/<key>`.
   - Leave out controls nobody is deciding, and never describe or rank the candidates on the
     page.
   - serve refuses a surface that breaks the catalog or the control contract (exit 2), and
     warns about a token no candidate can preview.
5. Run `npm install --prefix <this skill's directory>` once. Then start
   `node <skill>/scripts/board.mjs serve <dir>` as a background process, read its line
   `board: ready <url> round=<round>`, and give the owner the url.
6. Run `node <skill>/scripts/board.mjs wait <dir> --round <round>` in the foreground.
   - It prints the answer as one JSON line and exits 0.
   - Exit 3 means no answer yet: run it again. Waiting is not delegation.
   - Exit 5 means the round ended without an answer: say so and ask in the conversation.

Read the answer by the rules above:
- **Choice.** `candidate.decide` with an empty comment takes that number as it is.
- **Comment.** A comment that asks for a change — "2, with the list from 1" — is a request to
  redraw that candidate, not to splice. A comment that only remarks is recorded.
- **Adjustments.** `adjust` holds only the tokens the owner changed, with values their control
  allowed. Apply them to the chosen candidate, and record each in the contract's Visual System
  as `departure: owner adjusted on board`.
- **Pins.** Each pin names its candidate, a selector, the position inside that element
  (`ox`, `oy`) and the page (`x`, `y`), the element's text and the owner's note. The board
  letters pins A, B, C… in array order; the sent summary uses those letters. Pins on the
  chosen candidate are located change requests. Pins on another candidate are notes for
  redrawing the chosen one, not parts to splice in.
- **Reject all.** For `candidate.none`, the comment and any pins are the owner's account of
  what is wrong. When they do not say, ask before redrawing.
- **Decision Log.** Put the comment and the notes into the Decision Log in the owner's words.

Fall back to the viewer and a number in the conversation when any of these happens:
- Node is missing, or `npm install` fails.
- serve ends before printing its ready line, with any exit code or signal. A sandbox that
  forbids listening on a port ends it with exit 2.
- No ready line appears within ten seconds.

Each answer closes its round; to ask again, start a new serve. If the owner answers in the
conversation instead, use that answer and run `board.mjs stop <dir> --round <round>`.

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
