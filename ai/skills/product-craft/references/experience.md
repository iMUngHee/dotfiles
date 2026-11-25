# Experience

The request describes what the owner thought to mention. This step works out what the surface
owes beyond that, from the app's own objects, so the gaps are found here instead of by the
owner after the build.

## 1. Objects × actions

List every **object** a user can see or act on — the nouns of this app: a book, a bookmark, a
recent item, a page, a job, a message, a setting, an account. Before deciding what fits the
scope, use the request, existing behaviour, data model, and product references to discover
the actions and rules that affect each object. Look beyond the reference screenshots to
related screens or help for the action's options and effects.

For each object, fill a row. The columns are what people expect to be able to do to a thing
on a screen; keep the ones that could apply and add any the domain brings (play, share,
export, pin, archive, retry). For each main action, ask what changes when:

- The actor, permission, device, entry point, or source or destination changes.
- The action applies to one object, a group, or a combination of objects or rules.
- The object or a related object is in a different state, including before or after an
  effective time, after completion, or when it is hidden from the normal view.
- A setting, limit, or plan changes availability, the result, or the path to recover.
- The action affects someone else or changes, retains, or removes related data.

Record the variants that change what the user can do or what happens next. Check each rule
against the available evidence before relying on it. A brief that is silent about a relevant
action or variant leaves its support open. Spell out the plausible alternatives and their UI
consequences in the contract's Open Questions. When you need a working assumption, name the
branch you provisionally chose and what would change under the other rule.

| Object | Create / add | Open / view | Rename / edit | Delete / remove | Reorder / sort | Find / filter | Select many | Undo | By mouse | By keyboard |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

Each applicable cell is one of:

- `yes` — with where it lives **on screen**: a button, a menu item, a visible per-item
  action, a mode the screen offers. A shortcut or modifier-click may be an additional route,
  never the only one: an action the user cannot find by looking does not count as `yes`.
  In the keyboard column, `yes` means reachable by focus and a key, with the key shown
  somewhere (menu, tooltip, key list). An undo the operating system provides (the system
  trash) is `no — <where it can be recovered>` unless the screen offers the way back.
- `no — <reason>` — a known constraint, evidence that the action does not apply, or an
  explicit scope decision ("no reorder: list is always newest first").
- `open — <question>` — a plausible action or rule with support still unknown. Name the
  evidence or decision needed and keep the alternatives visible in Open Questions.

Fill every applicable cell and check the rows for partial support. If an action is available
for one role, state, or object but unavailable for another, record both outcomes and what the
user can do in each case.

Then check three things against the matrix:

- **Destructive actions** say what is lost and either confirm or offer undo.
- **Sibling parity**: look for actions in the owner's related apps for the same kind of
  object (a password lock, an export, a rename) and account for them in the matrix.
- **Reference parity**: skim what the references offer for these objects. Anything common
  to all of them is table stakes for this kind of app.

## 2. Journeys

Use the object × action matrix and screen states to enumerate every reachable user scenario
within the surface's scope. For each goal, follow the supported entry points, user choices,
and possible outcomes through to completion, exit, or recovery. Write distinct paths for
variants that change the action, the data affected, or the next step. Carry any provisional
path as an assumption and link it to the corresponding open question. Check first use, empty and
populated data, permissions, validation, failures, retry, cancel, and back or resume wherever
they apply. For repeated loading, retry, and navigation behaviour, write the shared steps
once and name where they apply.

Record each distinct path in the contract as numbered steps a person or an agent can replay
on the running build. Branches can refer to shared steps:

```text
J1 — Add a folder of images and start reading
1. Launch with an empty library → the empty state says how to add something.
2. Drop a folder on the window → progress appears and can be cancelled.
3. Import finishes → the book appears, focused, with its title and page count.
4. Press Enter → the reader opens on page one.

J1b — Recover when the folder cannot be read
1. Follow J1 through step 2 with a folder the app cannot read.
2. Import fails → the app names the folder and offers to choose another.
3. Choose a readable folder → progress resumes, then follow J1 from step 3.
```

Each step names the action or event, what the user sees, and where they can go next. Before
Direction, check each applicable action and reachable screen state against the journeys.
Record why any apparent path is unreachable or out of scope. Carry the UI response for each
path into the design so its screens, controls, messages, and transitions can be replayed in
the review.

Walk each step once now, before anything is built, asking four questions:

1. Does the user know what they are trying to do here?
2. Can they find the control that does it?
3. Does the control say it will do that?
4. After acting, can they tell it worked — and what to do next?

Resolve each "no" in the design and log any choice you make for the owner under
**Decided for you**.

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
