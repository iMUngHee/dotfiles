# Interface Concept Stage

Use this after the experience is approved, when no applicable visual direction exists, when a
redesign changes direction materially, or when `study` runs.

Read `reference-study.md` first. Candidates drawn without studying how this problem has
already been solved well tend to converge on defaults.

## Candidates

Draw more than one genuinely different reading of the same approved job. Two is thin; four
gives the user real room to react. The count is not the point — spread and finish are. Four
half-drawn variations on one idea are worth less than two fully realized opposites.

Each candidate should read as though a different studio answered the same brief.

### What makes candidates actually different

Structure, not surface. Candidates differ when they differ in:

- what dominates the screen and what yields to it,
- how content is grouped, and in what order the reader meets it,
- where navigation lives and how much of it is present at once,
- what the reader does first, and how they get to the next thing,
- what holds the composition together — a grid, a rule, an interval, a single anchor,
- how dense the surface is, and what that density says about the content.

Two candidates sharing one structure and differing only in surface values are one candidate in
two coats. So are two sharing a section order with renamed sections. If A becomes B by swapping
palette, type stack, and ratios, redraft — that exact failure has shipped from this stage
before.

The declared medium supplies its own **differentiation vocabulary**, and reading it is not
optional: a constrained medium has a smaller structural vocabulary, so a prohibition list on
its own shrinks the space until candidates collapse back into cosmetic variants. That is the
recorded failure mode, and the vocabulary exists to keep the space open.

Each vocabulary entry is tagged. `interface-owned` entries are free to vary between candidates
inside the approved experience. `experience-delta` entries change IA, flow, screen inventory,
or content priority — take the experience delta first; do not draw a candidate that quietly
rewrites the approved experience in order to look different. Forcing structural difference
while forbidding experience change, with no way to tell which is which, is what produced the
collapse before.

A quick check: reduce both candidates to their region skeletons. If the skeletons are the same
picture, so are the candidates.

### Naming them

Name each candidate for the idea it carries, drawn from the job and from what the references
showed. Labels like safe, sharp, or borrowed are a heuristic for hunting spread — one
conventional, one pushed, one adapted from a neighbouring domain — not a required set, and
not a substitute for the idea. A borrowed reading earns the name only if something was
genuinely borrowed.

### Recording a candidate

State the idea in one sentence without naming a color or a font. Then: what dominates and why
the job justifies it; how the reader moves through it; the one tension it holds and its
counterpoint; one memorable moment that serves the job, or an honest `N/A`; one convention it
breaks and why this content tolerates that; and how success and recovery stay obvious.

An idea that cannot be stated without naming colors or fonts is not yet an idea.

Macrostructure must arise from the approved IA, flow, screen inventory, content priority, and
surface profile. Never default a workflow surface to landing-page sections, or a dense tool to
decorative cards.

## Artifacts

Each candidate is a **single self-contained artifact in the declared medium's own substrate**,
carrying realistic content — real text lengths, real data volume, real Korean strings when the
product is Korean. One file, one hash, one authority; no external reference, and nothing shared
between candidates.

What that file *is* comes from `medium-profiles.md`. For the web it is an HTML file with style,
script, SVG, images, and fonts inlined. For a terminal it is the captured run at the declared
widths. For a stream it is the output captured both on a TTY and piped. For a deck it is the
rendered units, for print the rendered pages. For a native GUI it is a build screenshot, or —
when that is genuinely impossible — a platform-shell mock **explicitly labeled a mock** and
gated as an unrendered concept rather than passed off as a render.

Where the medium gives the author type authority, the type pairing is a decision, not an
inheritance: name the display face and the body face and say what each is for, and embed them
as base64 `@font-face` data URIs subset to the glyphs used. Reading self-containment as "only
fonts already on this machine" is what quietly returns every candidate to the same system
stack. Where the medium has no type authority at all — a cell grid or a stream — that rule does
not apply, and hierarchy has to come from weight, rules, spacing, and position instead.

Show candidates on the same screen with the same content so the comparison is controlled. The
screen and the content hold still; everything else is free to move.

Each candidate carries **region markers** so two candidates can be compared mechanically rather
than by impression: `data-region`, `data-parent`, and `data-entry` in markup, or a sibling
`<candidate>.regions.json` array of `{region, parent, order, entry}` where markup does not
exist. Reduced to that skeleton, two candidates that differ only in finish produce identical
lists — which is the check that catches a palette swap wearing two names.

Render and inspect each candidate at both extremes of the medium's adaptation axis before
showing it. For Full work, inspect every affected macrostructure at both extremes; a delta that
changes macrostructure or adaptation behavior carries the same requirement. One screen may
evidence several obligations when its inspected states make each transformation explicit — do
not multiply screens to produce one artifact per row. A medium with no adaptation axis inspects
what its profile names instead (a deck at full size and thumbnail, a page at its boundaries and
in greyscale), and a genuinely unaffected presentation may use `N/A:<concrete reason>`.

A candidate generated but never looked at is not a candidate.

Do not wire APIs, persistence, production routing, or durable application state.

## Selection

**The user chooses.** Present the candidates, say which one you would pick and why, and stop
there. Taste is what the user is here to supply, and deciding it for them is the one failure
this stage cannot recover from.

Present them through `../../product-craft/references/decision-dashboard.html` so every open
decision is visible at once instead of arriving one at a time in prose. Tier 1 picks a base
candidate whole. Tier 2 offers only axes that are **genuinely open** — not settled by the
contract or the captured evidence — capped at four, and each option moves **within the chosen
base**. An axis the taste profile has settled is a different case: it stays on the page as a
marked pre-selection rather than a question, outside the cap, so it can still be flipped. A request to take one base's element into another is not an
override; it is a signal to redraw, because element-level mixing across bases is precisely how
candidates collapse into one idea in two coats.

Values coming from `../../product-craft/taste-profile.md` appear pre-selected and marked as profile-supplied, so
they can always be seen and flipped; a value with fewer than three confirmations is shown but
never pre-selected. A silent default is the same defect as an undisclosed inference.

Record the chosen artifact in the contract's `## Artifact Ledger` with its revision and the
states and adaptation extremes actually reviewed. Record `direction_selected` with the user's
own words and the chosen `ART-NNN` — or `ART-NNN@<axis combination>` when the artifact carries
variant hooks and they picked a combination inside it. The revision still covers the whole
file, so editing the artifact changes the hash and any earlier selection surfaces as drift
under the existing check.

A pasted payload is valid evidence: its required `note` is the user's own words. A payload with
`redraft: true` records no token and sends the work back to redrawing.

For an external product surface with no single owner to ask, commit the sharpest direction
that serves the job and survives every floor — not merely the most unusual one — and say that
you did. A mixed or unclear audience is a gate, not a judgement call.

If rendering is impossible, say so and gate on labeled text concepts. Never treat an
unrendered direction as selected.

Open the selected direction with:

```text
Art direction: <idea> — <why it fits this product, audience, and job>
```

Record the selected direction as `Surface Obligations` rows with `Stage: interface`, each
deriving from the experience obligations it serves, with artifact evidence shaped as
`artifact:<ART-NNN>#<state>@<adaptation extreme>`.

One artifact may evidence several obligations, but each row names the specific observation
that proves its own transformation. An obligation that originates at this stage — a purely
interface-owned requirement with no experience parent — uses `Derives from: —`.

## Redesign

1. Capture current content, product identity, accepted workflows, states, constraints, and
   implementation boundaries.
2. Keep one candidate as `keep and refine` when direction changes materially.
3. Change structure, rhythm, hierarchy, and component voice without silently changing approved
   experience scope.
4. Emit `EXPERIENCE DELTA REQUIRED` for any desired job, IA, state, recovery, or microcopy
   change.
5. Show what stays, what changes, and why the new direction serves the job better.

## Study

The method lives in `reference-study.md`. Present the diagnosis for acceptance before it
becomes a candidate or a contract delta.

## Before handing off

- Can each idea be stated without naming colors or fonts?
- Would the candidates' wireframes be different pictures?
- Is hierarchy a consequence of the job and content priority, or of habit?
- Does each direction hold one controlled tension rather than evenly distributed styling?
- Is the signature moment visible and useful, or is its `N/A` honest?
- Could this interface belong to an unrelated product after swapping logo and copy?
- Are large type, gradients, pills, cards, shadows, and motion each there for a named reason?

An unsupported answer is a design gap, not a cue to add decoration.
