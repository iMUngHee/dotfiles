# Review

Find what is wrong with the running surface before the owner does. A whole-window screenshot
looked at by the agent that built it catches almost nothing: the image reaches you scaled
down, so a few pixels of misalignment vanish, and you see what you intended. Every step here
exists to get around one of those two limits.

Scripts are in `../scripts/` relative to this file. They have no dependencies beyond Node.

## 0. Capture

Run the real build with realistic fixtures. Capture every screen and every state the
contract names, at the medium's extremes (`media.md`), into `.agents/design/review/`.
Screens you could not capture are listed as not reviewed — never passed over in silence.

## 1. Tiles — see real pixels

```bash
node <skill>/scripts/tiles.mjs <screenshot.png> <out-dir> --tile 1024x1024
node <skill>/scripts/tiles.mjs <screenshot.png> <out-dir> --region x,y,w,h
```

Look at every tile of every screen at native resolution, and cut a region around each
toolbar, list row, dialog and form. In each, check:

- **Alignment**: icons and their labels share a centre line; items in a row share a
  baseline; left edges of stacked items line up; nothing is one or two pixels off.
- **Spacing**: gaps inside a group are equal; padding is balanced on both sides; an icon has
  not eaten one side of a button.
- **Text**: no line breaks in the middle of a word (Korean: of an 어절); no orphaned
  single word or syllable; nothing clipped, overlapped or cut by an edge; ellipses where
  text is cut on purpose.
- **Edges**: nothing important under a title bar, scrollbar or fixed bar; borders meet at
  corners; images are not stretched or blurred.

## 2. Measure — do not trust the eye for geometry

- **Web and web-based shells**: evaluate the contents of `scripts/measure-dom.js` in the
  page (browser console or the session's page-script tool). It returns rows whose children's
  centre lines differ, text that wraps where a single line was intended, overflow and
  clipping, and undersized targets.
- **Windows desktop**: `pwsh -NoProfile -File scripts/measure-uia.ps1 -ProcessId <pid>` (or
  `-WindowTitle '<pattern>'`) reads the accessibility tree and prints rows whose centre
  lines differ and elements outside the window; `-Full` adds every element's rectangle.
- **Elsewhere**: use the toolkit's inspector or accessibility tree to read rectangles for
  each row of controls and compare centre lines yourself. When the surface exposes nothing
  (custom drawing), say so; tiles are then the only check.

Each script prints its own usage. Treat every reported delta as real until you have looked
at that spot in a tile.

## 3. Census — consistency lives in the source

```bash
node <skill>/scripts/style-census.mjs <ui source paths...>
```

It lists every distinct colour, font size, weight, radius and spacing value in the UI
source, how often each is used, and which are near-duplicates of each other. Three greys a
shade apart, a size used once, a radius that appears on one card only — each is either a
deliberate token or an inconsistency. Fold the accidents into the direction's values. A
value defined once in a theme or token file is a definition, not a finding; a literal used
once in UI code usually is one. `--json` gives every location.

Then compare screens with each other: the same kind of thing (section header, secondary
text, list row, primary button) looks the same everywhere it appears.

## 4. Replay the journeys

Walk every journey in the contract on the running build, step by step, by actually
operating it — with the pointer where a user would use the pointer and the keyboard where
they would use the keyboard. At each step confirm the user sees what the journey says.
A step you could not perform is recorded as not replayed, not as passed.

Then check the matrix: for each `yes` cell, do it once. For each component kind, check its
baseline.

## 5. Beside the reference

Put each main screen next to the reference it was taken from, at the same size. Ask one
question: would someone shown both believe they are products of the same quality? Name what
makes the build look less finished — thinner hierarchy, weaker spacing rhythm, flatter
surfaces, stock controls showing through, missing imagery, default icons — and fix those
things specifically.

Also put it next to a stock app of the toolkit and the owner's other apps. If it is
indistinguishable from either, the direction did not make it into the build.

## 6. A reviewer in a separate context

Hand the captures to a reviewer that has not seen the code or the contract's reasoning — a
fresh agent in its own context, or another available session. The builder's knowledge of
what was intended is exactly what must be absent. Give it only:

- the screenshots and tiles,
- the reference screenshots,
- one line on what the app is for,
- this brief: *"You are seeing this product for the first time. List everything that looks
  wrong, unfinished, inconsistent or confusing, most costly first. For each: where it is,
  what is wrong, and what you expected instead. Do not praise. Do not explain what the
  design intends."*

Where the session can drive the app, also ask that reviewer to attempt the journeys from
their one-line titles alone and report where it got stuck or expected something that was
not there.

## Findings

Record each finding as:

```text
- [blocks | degrades | polish] <where> — <what is wrong> → <fix>
  evidence: <tile path, measured delta, census line, or journey step>
```

- **blocks**: a journey cannot be completed, content cannot be read or reached.
- **degrades**: works, but looks broken or unfinished, or slows the user down — a
  misaligned icon, a mid-word break, three greys for one role, a missing rename.
- **polish**: a competent reviewer would mention it but not mind.

Fix blocks and degrades and run the affected steps again. Three rounds at most; after that,
or when nothing above polish remains, stop and report.

## Reporting

State what was reviewed and how, what was found and fixed, what remains with its severity,
and what was not reviewed. Attach the build beside its reference. Never write that the
surface is finished on the strength of having built it — say what the review showed.
