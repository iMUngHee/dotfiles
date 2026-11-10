---
name: product-craft
description: "Design and build client surfaces that look current and miss nothing basic: pages, apps, dashboards, desktop and mobile windows, terminal UIs, decks. Sources real references, a design system and assets before designing, derives UX checks from the app's own objects, and reviews the render with crops, measurement and a separate reviewer. Use for new or materially changed surfaces, redesigns, UX/UI audits, and design-contract.md work. Skip routine frontend edits with no UX/UI decision, PR review, and completed-feature verification."
argument-hint: "[audit] [surface request]"
disable-model-invocation: false
---

# Product Craft

Make the surface the owner would have asked for if they had time to specify it: it looks like
a current, well-made product of its kind, every object on it can be handled the way people
expect, and nothing on screen is misaligned, clipped, or inconsistent.

Task: $ARGUMENTS (if empty, infer the surface and outcome from the request)

Three habits produce generic, gap-ridden surfaces. Each step below exists to break one:

- **Designing from principles instead of from a reference.** A finished product is thousands
  of decisions that already fit together. Start from one and carry its values.
- **Deriving UX from the request instead of from the objects.** Nobody asks for rename,
  delete, or syntax highlighting. They are owed anyway.
- **Reviewing by glancing at a whole screenshot you built yourself.** A downscaled window
  hides a 3px offset, and the builder sees what they meant to make.

## When to use

- New or materially changed surface, redesign, or a `design-contract.md` to write or update →
  run the loop.
- "Review / audit this UI" on an existing surface → **Audit mode** below.
- PR or diff review → `code-review`. Confirming a finished feature meets its goal → `verify`.
- A routine edit with no UX or visual decision → no contract needed; just do it, then run the
  review step on what you touched.

## Depth

Pick the lightest that fits and say which.

| Depth | When | What runs |
| --- | --- | --- |
| Touch-up | One component or state on a surface that already has a look | Experience check for the touched objects, build, review |
| Screen | A new or reworked screen inside an existing product | Whole loop, materials limited to what the product does not already settle |
| App | New product, multi-screen flow, or redesign | Whole loop |

An existing `design-contract.md` is evidence at every depth: read the nearest one first, keep
what it settles, and write new entries in the lean form of `references/contract.md` without
rewriting its older sections.

## The loop

Each step has one reference file. Read it when you reach the step, not before. Each of steps
1–4 ends by writing its result into `design-contract.md` before the next begins — the matrix
and journeys exist in the contract before anything is built, because they are what the build
and the review are checked against. Written afterwards, they only describe what was made.

### 1. Frame

State in a few lines: the medium (web, desktop, mobile, terminal, CLI output, deck, print),
the toolkit, the kind of app it is, who uses it and for what, and the depth. Then find the
**host ceiling** — what this toolkit or host cannot draw (no custom colours, no blur, fixed
pane width, no font weight). Read `references/media.md` for the medium. If the ceiling makes
the requested quality impossible, say so now rather than redesigning three times inside it.

### 2. Materials — `references/materials.md`

Before any layout or colour decision, collect:

- **References**: real products of the same kind and medium, captured as screenshots.
- **A design system or component library** when the stack has one and the project does not.
- **An asset inventory**: every icon, app icon, illustration, placeholder and empty-state image
  the surface needs, each with a source.

No reference, no direction. A direction that cannot point at what it was taken from is a
default in disguise.

### 3. Experience — `references/experience.md`

Derive what the surface owes from the app itself:

- An **object × action matrix**: every object a user sees, against what people expect to do
  to it. Each cell is `yes`, or `no` with a reason.
- **Journeys**: the few paths that matter, written as steps that can be replayed on the build.
- **States** each screen can be in, and the **component baselines** from
  `references/component-baselines.md` for every component kind in use.

Anything you decided without the owner goes into one short **Decided for you** list that
leads your report. It is never recorded as settled.

### 4. Direction — `references/interface.md`

Turn the materials into one committed look: concrete values (palette, type, radius, spacing
rhythm, density, icon style, motion) taken from the chosen reference, each with its source.

- **Owner present** → show two or three candidates in `references/candidate-viewer.html` and
  let them answer with a number.
- **Owner away** → see *When the owner is away*.

### 5. Build — `references/build.md`

Build from the contract. Use the library's components, carry the reference's values exactly,
produce every asset in the inventory, and cover every `yes` cell and every state. When a
toolkit skill is installed for the stack, load it before writing UI code and follow it on
toolkit facts.

### 6. Review — `references/review.md`

Run the review on the running build: native-resolution tiles, geometry measurement, a style
census of the source, the journeys replayed, the result beside its reference, and a reviewer
in a separate context who has not seen the code. Fix what is found and run it again. Stop
when nothing above polish remains, or after three rounds — then report exactly what is left.

Do not report the surface as done on the strength of having built it. The review output is
the evidence.

## When the owner is away

Delegation ("do it your way", "I'm away") is not permission to skip a step. It changes who
picks, nothing else.

1. Materials and the experience work still happen in full.
2. Pick the direction yourself: the reference that best matches what the owner has said about
   their taste, in this request or in the project's contract and history. When their words
   point nowhere, pick the most accomplished reference, not the safest one. "Conservative
   because nobody was there to object" is the failure this rule exists to stop.
3. Build that one direction properly rather than several mocks nobody will look at.
4. Leave the reference board — the captured references and the built result — in the viewer,
   so the owner can redirect with one sentence.
5. Record one line in the contract's Decision Log: what you chose, from which reference, and
   why. Lead your report with the **Decided for you** list.

## What to record

`design-contract.md` is a working document, not a ledger. It holds what the next agent needs
in order to continue the surface without re-deriving it: the frame, the references and the
values carried from them, the matrix, the journeys, the asset inventory, and the decision
log. Template and rules: `references/contract.md`.

Write it only where the owner has asked for the surface to be built or the contract to be
written. An audit writes nothing.

## Audit mode

Read-only. Run step 3 against the existing surface (which cells are empty, which journeys
break, which baselines are missing) and step 6 against its render. Report findings ranked by
what they cost the user, each with evidence and one fix. Change nothing; a later request
turns accepted findings into work.

## Working with other skills

- **`design`** plans the technical change when it spans files or needs architecture. Settle
  the contract here first; the plan then cites the contract path and turns each journey and
  required matrix cell into a success criterion.
- **`verify`** confirms the finished feature against the plan; it replays the journeys.
- **Toolkit skills** (for example a WinUI skill) own toolkit facts: which control, which API,
  which pitfalls. This skill owns what the surface should be and whether it turned out well.
  Where a look decision and a toolkit rule collide, keep the look and pay the cost the
  toolkit skill names (keyboard, accessibility, contrast themes) — or change the look, but
  decide it, do not drift.
- **An installed web-page design skill** with its own themes and checks may run steps 4–5 for
  a marketing or content page. Steps 2, 3 and 6 still run here.

## Reporting

Lead with what the owner can look at: the build, and the result beside its reference. Then
the **Decided for you** list, then what the review still shows. Keep process out of it.
