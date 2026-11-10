# Experience

The request describes what the owner thought to mention. This step works out what the surface
owes beyond that, from the app's own objects, so the gaps are found here instead of by the
owner after the build.

## 1. Objects × actions

List every **object** a user can see or act on — the nouns of this app: a book, a bookmark, a
recent item, a page, a job, a message, a setting, an account. Take them from the request, the
data model, the references, and the owner's sibling apps.

For each object, fill a row. The columns are what people expect to be able to do to a thing
on a screen; keep the ones that could apply and add any the domain brings (play, share,
export, pin, archive, retry).

| Object | Create / add | Open / view | Rename / edit | Delete / remove | Reorder / sort | Find / filter | Select many | Undo | By mouse | By keyboard |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

Each cell is one of:

- `yes` — with where it lives **on screen**: a button, a menu item, a visible per-item
  action, a mode the screen offers. A shortcut or modifier-click may be an additional route,
  never the only one: an action the user cannot find by looking does not count as `yes`.
  In the keyboard column, `yes` means reachable by focus and a key, with the key shown
  somewhere (menu, tooltip, key list). An undo the operating system provides (the system
  trash) is `no — <where it can be recovered>` unless the screen offers the way back.
- `no — <reason>` — a deliberate omission the owner would agree with ("no reorder: list is
  always newest first").

An empty cell is not allowed, and neither is a `no` without a reason. Most omissions an owner
later complains about are cells nobody looked at: an item that can be created but not
renamed, removed by keyboard but not by mouse, deleted with no way back.

Then check three things against the matrix:

- **Destructive actions** say what is lost and either confirm or offer undo.
- **Sibling parity**: anything the owner's related apps do for the same kind of object
  (a password lock, an export, a rename) is `yes` here or a reasoned `no`.
- **Reference parity**: skim what the references offer for these objects. Anything common
  to all of them is table stakes for this kind of app.

## 2. Journeys

Write the few paths that make the app worth having — usually three to six — as numbered
steps a person or an agent can replay on the running build:

```text
J1 — Add a folder of images and start reading
1. Launch with an empty library → the empty state says how to add something.
2. Drop a folder on the window → progress appears and can be cancelled.
3. Import finishes → the book appears, focused, with its title and page count.
4. Press Enter → the reader opens on page one.
```

Each step names what the user does and what they must then see. Include the first-run path
and at least one path where something goes wrong. These are replayed in the review; a journey
that cannot be replayed step by step is too vague.

Walk each step once now, before anything is built, asking four questions:

1. Does the user know what they are trying to do here?
2. Can they find the control that does it?
3. Does the control say it will do that?
4. After acting, can they tell it worked — and what to do next?

A "no" is a design change now or a line in **Decided for you**.

## 3. States

For each screen, name what it shows when it is: empty for the first time, empty after a
filter, loading, partly loaded, failed, full of long or numerous content, and mid-action
(saving, importing). Give the words it shows and the way out. A screen designed only for
three tidy sample rows is not designed.

Use realistic content from here on — real title lengths, real counts, real Korean strings
when the product is Korean — in the contract, in candidates, and in the build's fixtures.

## 4. Component baselines

For every kind of component the surface uses, apply `component-baselines.md`. Those are the
things nobody requests and everybody notices missing.

## 5. Decided for you

Collect every choice made without the owner into one list, ten lines at most, most
consequential first:

```text
Decided for you
- Recent list keeps 200 items, oldest dropped. (no limit was stated)
- Removing a bookmark has one-step undo instead of a confirmation.
- No reorder for bookmarks: always newest first.
```

This list leads the report. Do not bury these in the contract as settled facts, and do not
hold the work waiting for answers when the owner is away — decide, list, continue. Ask first
only when a choice would change what the app is for, lose data, or be expensive to reverse.
