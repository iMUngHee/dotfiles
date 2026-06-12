// Round-trip fixture for roadmap.ts. Run: ./node_modules/.bin/tsx roadmap.test.ts
import assert from "node:assert/strict";
import { parseRoadmap, serializeRoadmap } from "./roadmap.ts";

const FIXTURE = `---
project: demo
focus: m6-hang
updated: 2026-06-09
---

# demo — Backlog

## Open

- **m6-hang** — ctx_callers intermittent hang
  - Priority: P0
  - Status: active
  - Order: 2
  - Task: CTXM
  - Plan: .agents/plans/2026-06-09-m6.md
  - Note: nondeterministic hang, infra latency suspected
- **r6-ledger** — durable collision ledger
  - Priority: P3
  - Status: open
  - Task: -
  - Plan: -
  - Note: in-tx collision-set eventual inconsistency
- **m6-followup** — callers RPC latency probe
  - Priority: P2
  - Status: open
  - Task: CTXM
  - Plan: -
  - Note: same task as m6-hang

## Recently Closed

- **m5-p2** → .agents/plans/2026-06-08-m5-p2.md (done) · Task: CTXM
- **old-idea** → dropped · superseded by m5-p2
- **noted-drop** → dropped · note with · middot inside · Task: CTXM
- **bare-drop** → dropped · Task: CTXM
`;

const rm = parseRoadmap(FIXTURE);

assert.equal(rm.project, "demo");
assert.equal(rm.focus, "m6-hang");
assert.equal(rm.open.length, 3);

// item with a task → its task is CTXM (task-context KEY)
assert.equal(rm.open[0].id, "m6-hang");
assert.equal(rm.open[0].priority, "P0");
assert.equal(rm.open[0].status, "active");
assert.equal(rm.open[0].task, "CTXM");
assert.equal(rm.open[0].order, 2);
assert.equal(rm.open[1].order, 0); // unset → 0 (file-order fallback)
assert.equal(rm.open[0].plan, ".agents/plans/2026-06-09-m6.md");

// planless, task-less item
assert.equal(rm.open[1].task, null);
assert.equal(rm.open[1].plan, null);

// same task as m6-hang → siblings (grouping is by Task)
assert.equal(rm.open[2].task, "CTXM");

// closed forms — Task suffix parsed (strip-first), legacy rows → task: null
assert.deepEqual(rm.recentlyClosed[0], { id: "m5-p2", plan: ".agents/plans/2026-06-08-m5-p2.md", status: "done", note: "", task: "CTXM" });
assert.deepEqual(rm.recentlyClosed[1], { id: "old-idea", plan: null, status: "dropped", note: "superseded by m5-p2", task: null });
// note containing `·` keeps its middots — only the anchored tail is the suffix
assert.deepEqual(rm.recentlyClosed[2], { id: "noted-drop", plan: null, status: "dropped", note: "note with · middot inside", task: "CTXM" });
// no-note planless drop with task — no empty segment on either side
assert.deepEqual(rm.recentlyClosed[3], { id: "bare-drop", plan: null, status: "dropped", note: "", task: "CTXM" });
assert.ok(serializeRoadmap(rm).includes("- **bare-drop** → dropped · Task: CTXM"), "no-note+task serializes without empty segment");
assert.ok(!serializeRoadmap(rm).includes("·  ·"), "no empty segments anywhere");

// round-trip stable
assert.deepEqual(parseRoadmap(serializeRoadmap(rm)), rm, "round-trip must preserve structure");
assert.equal(serializeRoadmap(parseRoadmap(serializeRoadmap(rm))), serializeRoadmap(rm), "serialize idempotent");

// _INBOX: legacy `-` and `_INBOX` both read as null; writes emit `_INBOX` only
const ser = serializeRoadmap(rm);
assert.ok(ser.includes("  - Task: _INBOX"), "taskless serializes as _INBOX");
assert.ok(!ser.includes("  - Task: -"), "legacy `-` is never written");
assert.equal(parseRoadmap(ser.replace("Task: _INBOX", "Task: -")).open[1].task, null, "legacy `-` alias");
assert.equal(parseRoadmap(ser).open[1].task, null, "_INBOX reads as null");

console.log("PASS: roadmap round-trip (3 open, Task grouping, 2 closed forms, status mirror, _INBOX alias)");
