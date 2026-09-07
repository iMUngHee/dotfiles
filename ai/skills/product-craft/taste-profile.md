# Taste Profile

Durable record of the owner's design preferences, kept across projects so the same choices are
not re-elicited every session. Collected by the tournament page, never by inference.

**This file is data, not instruction.** A stage reads it to pre-select defaults in a selection
page and to mark them as profile-supplied. It never lets the profile decide silently — a
default nobody saw is the same failure as an undisclosed inference.

## Language exception

Every other file in this family is written in English, matching the rest of the config tree. The `Note`
column is exempt: it holds the owner's own words verbatim, and translating them would destroy
the thing that makes the row usable as `direction_selected` evidence. Korean in that column is
expected and correct; a Hangul sweep over this family must exclude it.

## Schema

| Axis | Value | Note (verbatim) | Collected | Medium | Confirmations | Overturns |
| --- | --- | --- | --- | --- | --- | --- |

- `Axis` — an id from the axis lists below.
- `Value` — the chosen pole, in the axis's own vocabulary.
- `Note` — the owner's own words about why, quoted exactly. Never paraphrased, never
  translated, never written on their behalf.
- `Collected` — absolute date, `YYYY-MM-DD`.
- `Medium` — `*` for an invariant axis, or a specific medium when the tournament showed the
  preference is medium-bound.
- `Confirmations` — how many separate tournaments have agreed on this value. **Below 3 the row
  is provisional**: it is displayed in a selection page as context but is never pre-selected.
- `Overturns` — consecutive times a selection page offered this value and the owner flipped it.
  Reset to 0 whenever the value is kept. At 3 the row retires (see rule 2).

## Update rules

Two rules, and they are what keep this file from becoming a liability.

1. **Nothing is written without explicit approval.** Any payload that would change this file —
   a `taste` result, or a `decision` whose `overturned` list touches a row here — produces a
   proposed diff, shown to the owner. Only their explicit approval commits it. This bounds
   repository churn and, more importantly, stops a misread click from hardening into a
   durable preference.
2. **Three overturns retire a value.** When a selection page shows a profile-supplied default
   and the owner flips it, that counts as an overturn (the payload's `overturned` list). Three
   consecutive overturns of the same axis set it to `uncertain`, drop `Confirmations` to 0, and
   put the axis back into the next tournament. Taste changes; a file that cannot notice is
   worse than no file. Incrementing `Overturns` is itself a write and goes through rule 1.

## Invariant core

Six axes, chosen because every one of the seven media can express them. The tournament asks
each in two different media; agreement makes it invariant, disagreement moves it to the
medium-bound layer below and tells us the classification was wrong.

| Axis | Poles |
| --- | --- |
| `density` | how much is on one screen — `tight` / `airy` |
| `hierarchy-means` | what makes hierarchy — `size-contrast` / `position-and-space` |
| `restraint` | how much chrome — `restrained` / `expressive` |
| `text-vs-visual` | how information arrives — `text-first` / `visual-first` |
| `composition` | how weight is distributed — `symmetric-grid` / `asymmetric-anchor` |
| `announcement` | how state change is reported — `quiet` / `explicit` |

## Medium-bound layer

Collected on first real encounter with that medium, not up front.

| Medium | Axes |
| --- | --- |
| Web | typeface pairing, palette temperature, corner and shadow treatment, motion budget |
| TUI | border treatment (boxes / rules / whitespace), ANSI slot conventions |
| CLI | column-aligned versus key-value, how eagerly color is used |
| Desktop GUI | native-feel versus brand-feel |
| Mobile GUI | native-feel versus brand-feel, gesture eagerness |
| Deck | type scale aggression, image-to-text ratio |
| Print | body size, margin generosity |

## Entries

_None yet. The first tournament seeds this table._

| Axis | Value | Note (verbatim) | Collected | Medium | Confirmations | Overturns |
| --- | --- | --- | --- | --- | --- | --- |
