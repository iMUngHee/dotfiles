// _INBOX eligibility fixtures. Run: ./node_modules/.bin/tsx inbox.test.ts
import assert from "node:assert/strict";
import { parseRoadmap } from "./roadmap.ts";
import { selectTarget, inboxCount, buildNextPrompt } from "./join.ts";

const FIXTURE = `---
project: demo
focus: -
updated: 2026-06-10
---

# demo — Backlog

## Open

- **idea-one** — untriaged idea (highest priority but inboxed)
  - Priority: P0
  - Status: open
  - Task: _INBOX
  - Plan: -
  - Note: parked
- **real-work** — task-assigned unit
  - Priority: P2
  - Status: open
  - Task: TK
  - Plan: -
  - Note: do this

## Recently Closed
`;

const rm = parseRoadmap(FIXTURE);

// inbox item is never auto-selected, even at higher priority
const target = selectTarget(rm);
assert.equal(target?.id, "real-work", "inbox item must not be auto-selected");

// explicit id still resolves an inbox item (user assertion)
assert.equal(selectTarget(rm, "idea-one")?.id, "idea-one");

// count + prompt report line
assert.equal(inboxCount(rm), 1);
const prompt = buildNextPrompt(
  { closed: false, item: target!, plan: null, task: target!.task, contextLinks: [], contextMemory: [], siblings: [], note: target!.note },
  inboxCount(rm),
);
assert.ok(prompt.includes("inbox: 1 item awaiting triage"), prompt);

// all-inbox backlog → no auto-selectable target
const onlyInbox = parseRoadmap(FIXTURE.replace("Task: TK", "Task: _INBOX"));
assert.equal(selectTarget(onlyInbox), null, "all-inbox backlog has no eligible target");
assert.equal(inboxCount(onlyInbox), 2);

console.log("inbox.test.ts: all fixtures PASS");
