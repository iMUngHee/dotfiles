// Simulates the two /design+/retro lifecycle paths against the data model to
// prove the documented hooks produce coherent, serializable end-states.
// Run: ./node_modules/.bin/tsx lifecycle.test.ts
import assert from "node:assert/strict";
import { parseRoadmap, serializeRoadmap, type Roadmap, type RoadmapItem, type Status } from "./roadmap.ts";

const OPEN_STATUSES = new Set<Status>(["open", "draft", "active"]);

function assertOpenInvariant(rm: Roadmap, where: string) {
  for (const it of rm.open) {
    assert.ok(OPEN_STATUSES.has(it.status), `${where}: ## Open must only hold {open,draft,active}, found ${it.status} on ${it.id}`);
  }
}

// ── mutation helpers mirroring exactly what the design/retro hooks instruct ──
function mirrorStatus(rm: Roadmap, id: string, status: Status) {
  const it = rm.open.find((x) => x.id === id);
  assert.ok(it, `mirror: item ${id} not open`);
  it!.status = status; // verbatim mirror of plan frontmatter
}
function close(rm: Roadmap, id: string, status: "done" | "dropped") {
  const i = rm.open.findIndex((x) => x.id === id);
  assert.ok(i >= 0, `close: item ${id} not open`);
  const it = rm.open.splice(i, 1)[0];
  // closed record keeps the item's task (null → suffix omitted, never `Task: _INBOX`)
  rm.recentlyClosed.unshift({ id: it.id, plan: it.plan, status, note: "", task: it.task });
}
function harvest(rm: Roadmap, item: Pick<RoadmapItem, "id" | "title" | "note">) {
  rm.open.push({ id: item.id, title: item.title, priority: "P2", status: "open", order: 0, task: null, plan: null, note: item.note });
}

// initial backlog: two plan-linked items at draft (just persisted by /design)
const start = parseRoadmap(`---
project: demo
focus: feat-a
updated: 2026-06-09
---

# demo — Backlog

## Open

- **feat-a** — feature A
  - Priority: P0
  - Status: draft
  - Parent: -
  - Task: TKA
  - Plan: .agents/plans/2026-06-09-feat-a.md
  - Note: -
- **feat-b** — feature B
  - Priority: P1
  - Status: draft
  - Parent: -
  - Plan: .agents/plans/2026-06-09-feat-b.md
  - Context: -
  - Note: -

## Recently Closed
`);
assertOpenInvariant(start, "initial");
assert.equal(start.open.every((i) => i.status === "draft"), true);

// ── Path A: feat-a  draft → 승인(active) → /retro done + harvest defer ──
mirrorStatus(start, "feat-a", "active");
assertOpenInvariant(start, "after 승인");
close(start, "feat-a", "done");
harvest(start, { id: "feat-a-followup", title: "A follow-up deferred in retro", note: "harvested from feat-a Post-Impl Notes" });

// ── Path B: feat-b  draft → 취소(dropped) ──
close(start, "feat-b", "dropped");

// ── assertions on end state ──
assertOpenInvariant(start, "end");
// feat-a and feat-b left ## Open; only the harvested planless item remains open
assert.deepEqual(start.open.map((i) => i.id), ["feat-a-followup"]);
const followup = start.open[0];
assert.equal(followup.status, "open");
assert.equal(followup.plan, null, "harvested item is planless");

// closed: done path (form a, task kept) + dropped path (form a, taskless legacy → suffix omitted)
const closedById = Object.fromEntries(start.recentlyClosed.map((c) => [c.id, c]));
assert.deepEqual(closedById["feat-a"], { id: "feat-a", plan: ".agents/plans/2026-06-09-feat-a.md", status: "done", note: "", task: "TKA" });
assert.deepEqual(closedById["feat-b"], { id: "feat-b", plan: ".agents/plans/2026-06-09-feat-b.md", status: "dropped", note: "", task: null });
assert.ok(serializeRoadmap(start).includes("(done) · Task: TKA"), "done record carries the Task suffix");
assert.ok(!serializeRoadmap(start).includes("· Task: _INBOX"), "taskless close never writes a `· Task: _INBOX` suffix (open-section `- Task: _INBOX` is a different, valid form)");

// final state round-trips cleanly
assert.deepEqual(parseRoadmap(serializeRoadmap(start)), start, "end-state must round-trip");

console.log("PASS: lifecycle — done+harvest path & cancel/dropped path, ## Open invariant held, status mirrored, end-state serializable");
