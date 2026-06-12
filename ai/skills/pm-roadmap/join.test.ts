// resolveJoin fixtures: open-first lookup + Recently Closed fallback.
// Run: ./node_modules/.bin/tsx join.test.ts
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRoadmap } from "./roadmap.ts";
import { resolveJoin, resolveClosedJoin } from "./join.ts";

const PLAN = `---
id: shipped-thing
title: Shipped thing
status: done
---

## Goal

Ship the thing.

## Implementation Steps

- [x] do it

## Post-Implementation Notes

Landed cleanly; defer the follow-up polish.
`;

const ROADMAP = `---
project: fixture
focus:
updated: 2026-06-10
---

# fixture — Backlog

## Open

- **both-sides** — Open item that shadows a closed id
  - Priority: P1
  - Status: open
  - Task: TK
  - Plan: -
  - Note: open wins

## Recently Closed

- **both-sides** → .agents/plans/2026-06-10-shipped-thing.md (done)
- **shipped-thing** → .agents/plans/2026-06-10-shipped-thing.md (done) · Task: TK
- **other-task-done** → .agents/plans/2026-06-10-shipped-thing.md (done) · Task: OTHER
- **idea-gone** → dropped · was not worth it
`;

const root = await mkdtemp(join(tmpdir(), "pmjoin-"));
await mkdir(join(root, ".agents", "plans"), { recursive: true });
await writeFile(join(root, ".agents", "plans", "2026-06-10-shipped-thing.md"), PLAN);
const rm = parseRoadmap(ROADMAP);

// 1. open wins over a same-id closed record
{
  const v = await resolveJoin(root, rm, "both-sides");
  assert.ok(v && v.closed === false, "open item resolves as open view");
  assert.equal(v.item.id, "both-sides");
  assert.equal(v.note, "open wins");
  // sibling inheritance is task-exact for suffixed records: TK yes, OTHER no;
  // legacy (both-sides closed row, task null) keeps best-effort inclusion
  const sibIds = v.siblings.map((s) => s.id);
  assert.ok(sibIds.includes("shipped-thing"), `same-task done sibling inherited: ${sibIds}`);
  assert.ok(!sibIds.includes("other-task-done"), `other-task done sibling excluded: ${sibIds}`);
  assert.ok(sibIds.includes("both-sides"), `legacy (task:null) done row keeps best-effort: ${sibIds}`);
}

// 2. closed fallback: plan-linked done → reduced view with plan + post-impl notes + task
{
  const v = await resolveJoin(root, rm, "shipped-thing");
  assert.ok(v && v.closed === true, "closed entry resolves as closed view");
  assert.equal(v.item.status, "done");
  assert.equal(v.item.task, "TK");
  assert.equal(v.plan?.status, "done");
  assert.ok(v.postImplNotes.includes("Landed cleanly"), v.postImplNotes);
}

// 2b. resolveClosedJoin reaches a closed row even when an open item shares the id
{
  const v = await resolveClosedJoin(root, rm, "both-sides");
  assert.ok(v && v.closed === true, "scope=closed bypasses open-wins");
  assert.equal(v.item.task, null, "legacy closed row → task null");
}

// 3. closed fallback: planless dropped → no plan, note carried
{
  const v = await resolveJoin(root, rm, "idea-gone");
  assert.ok(v && v.closed === true);
  assert.equal(v.plan, null);
  assert.equal(v.postImplNotes, "");
  assert.equal(v.item.note, "was not worth it");
}

// 4. unknown id → null
assert.equal(await resolveJoin(root, rm, "nope"), null);

console.log("join.test.ts: all fixtures PASS");
