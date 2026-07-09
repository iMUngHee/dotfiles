// Handler-level integration tests for server.ts. Run: ./node_modules/.bin/tsx server.test.ts
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as ops from "../pm-roadmap/ops.ts";
import { handle } from "./server.ts";

const P = new URLSearchParams();

async function main() {
  const root = await mkdtemp(join(tmpdir(), "server-test-"));
  try {
    // PUT creates the task + writes links/memory through ops
    let r = await handle(root, "PUT", "/api/tasks/ALPHA", P, { links: [{ label: "W", url: "https://x", triggers: ["a", "b"], summary: "s" }], memory: [{ title: "n1", note: "hi", date: "2026-01-01" }] });
    assert.equal(r.status, 200);

    // GET task reproduces the legacy shape
    r = await handle(root, "GET", "/api/tasks/ALPHA", P, undefined);
    assert.equal((r.json as any).links[0].label, "W");
    assert.deepEqual((r.json as any).links[0].triggers, ["a", "b"]);
    assert.equal((r.json as any).memory[0].title, "n1");

    // task list with counts
    r = await handle(root, "GET", "/api/tasks", P, undefined);
    assert.ok((r.json as any[]).some((t) => t.key === "ALPHA" && t.linkCount === 1 && t.memCount === 1));

    // derived /api/roadmap view picks up an item added via ops
    await ops.itemAdd(root, { task: "ALPHA" }, { id: "a-1", title: "A1" }, { retries: 0 });
    r = await handle(root, "GET", "/api/roadmap", P, undefined);
    assert.ok((r.json as any).open.some((i: any) => i.id === "a-1" && i.task === "ALPHA"), "roadmap derives open from tasks/");
    // additive collab fields are always present; solo items carry empty owner + mode "solo"
    const soloRow = (r.json as any).open.find((i: any) => i.id === "a-1");
    assert.equal(soloRow.owner, "", "solo open[] owner empty");
    assert.equal(soloRow.mode, "solo", "solo open[] mode solo");

    // open[] additive nextStep (pm-dashboard-rebuild): existing plan path field preserved; nextStep read from the plan.
    assert.equal(soloRow.plan, null, "open[] plan path unchanged (null when item has no plan)");
    assert.equal(soloRow.nextStep, null, "open[] item without a plan → nextStep null");
    await ops.taskCreate(root, "BETA", "B", { retries: 0 });
    await mkdir(join(root, ".agents", "plans"), { recursive: true });
    const stepRel = ".agents/plans/2026-07-01-b-step.md";
    await writeFile(join(root, stepRel), `---\nid: b-step\nstatus: active\npm_loop: true\n---\n# b-step\n\n## Implementation Steps\n\n- [ ] wire the first thing\n`);
    await ops.itemAdd(root, { task: "BETA" }, { id: "b-step", title: "BS" }, { retries: 0 });
    await ops.itemSetPlan(root, "BETA", "b-step", stepRel, { retries: 0 });
    r = await handle(root, "GET", "/api/roadmap", P, undefined);
    const stepRow = (r.json as any).open.find((i: any) => i.id === "b-step");
    assert.equal(stepRow.plan, stepRel, "open[] plan path unchanged (still the plan file path)");
    assert.equal(stepRow.nextStep, "wire the first thing", "open[] exposes additive plan.nextStep (first unchecked step)");
    // join keeps item.plan a string path and top-level plan the PlanInfo object — unaffected by the open[] additive
    r = await handle(root, "GET", "/api/roadmap/b-step/join", P, undefined);
    assert.equal((r.json as any).item.plan, stepRel, "join item.plan stays a string path");
    assert.equal((r.json as any).plan.nextStep, "wire the first thing", "join top-level plan.nextStep present/unchanged");

    // join + validate — join nests into showItem's shape (item / task / contextLinks / contextMemory)
    r = await handle(root, "GET", "/api/roadmap/a-1/join", P, undefined);
    assert.equal((r.json as any).item.id, "a-1", "join nests item for showItem");
    assert.equal((r.json as any).task, "ALPHA", "join exposes task key");
    assert.equal((r.json as any).contextLinks[0].label, "W", "join projects link label");
    assert.equal((r.json as any).contextMemory[0].title, "n1", "join projects memory title");
    assert.equal((r.json as any).siblingsTotal, 0, "join exposes siblingsTotal");
    r = await handle(root, "GET", "/api/roadmap/validate", P, undefined);
    assert.ok(Array.isArray((r.json as any).errors));

    // join honors ?cap= (cap=0 ⇒ unlimited; no siblings here, so still [])
    r = await handle(root, "GET", "/api/roadmap/a-1/join", new URLSearchParams("cap=0"), undefined);
    assert.deepEqual((r.json as any).siblings, [], "cap=0 join resolves");

    // closed item join exposes top-level postImplNotes from its plan (closed-item-postimpl)
    await mkdir(join(root, ".agents", "plans"), { recursive: true });
    const noteRel = ".agents/plans/2026-06-20-a-note.md";
    await writeFile(join(root, noteRel), `---\nid: a-note\nstatus: done\npm_loop: true\n---\n# a-note\n\n## Post-Implementation Notes\n\nshipped it\n`);
    await ops.itemAdd(root, { task: "ALPHA" }, { id: "a-note", title: "AN" }, { retries: 0 });
    await ops.itemSetPlan(root, "ALPHA", "a-note", noteRel, { retries: 0 });
    await ops.itemClose(root, "ALPHA", "a-note", { status: "done", plan: noteRel, closedDate: "2026-06-20", retries: 0 });
    r = await handle(root, "GET", "/api/roadmap/a-note/join", P, undefined);
    assert.equal((r.json as any).postImplNotes, "shipped it", "closed item join exposes top-level postImplNotes");
    // placeholder-only Post-Impl → normalized to null (|| null in the adapter)
    const phRel = ".agents/plans/2026-06-20-a-ph.md";
    await writeFile(join(root, phRel), `---\nid: a-ph\nstatus: done\npm_loop: true\n---\n# a-ph\n\n## Post-Implementation Notes\n\n<!-- placeholder -->\n`);
    await ops.itemAdd(root, { task: "ALPHA" }, { id: "a-ph", title: "PH" }, { retries: 0 });
    await ops.itemSetPlan(root, "ALPHA", "a-ph", phRel, { retries: 0 });
    await ops.itemClose(root, "ALPHA", "a-ph", { status: "done", plan: phRel, closedDate: "2026-06-20", retries: 0 });
    r = await handle(root, "GET", "/api/roadmap/a-ph/join", P, undefined);
    assert.equal((r.json as any).postImplNotes, null, "placeholder-only Post-Impl normalized to null");

    // /api/next exposes the unflattened candidate buckets
    r = await handle(root, "GET", "/api/next", P, undefined);
    assert.ok(Array.isArray((r.json as any).eligible) && Array.isArray((r.json as any).blocked), "next buckets");
    assert.ok((r.json as any).eligible.some((c: any) => c.id === "a-1"), "a-1 eligible");

    // focus set + clear via ops
    r = await handle(root, "POST", "/api/focus", P, { id: "a-1" });
    assert.equal((r.json as any).focus, "a-1", "focus set");
    r = await handle(root, "GET", "/api/next", P, undefined);
    assert.equal((r.json as any).focus, "a-1", "next reflects focus");
    r = await handle(root, "POST", "/api/focus", P, { id: "" });
    assert.equal((r.json as any).focus, null, "focus cleared");
    // focus rejects a non-open id → 409
    r = await handle(root, "POST", "/api/focus", P, { id: "nope" });
    assert.equal(r.status, 409, "focus on unknown id refused");

    // planless drop through ops
    r = await handle(root, "POST", "/api/roadmap/a-1/drop", P, { reason: "no" });
    assert.equal((r.json as any).dropped, true);

    // D7a — a By-stamped link/memory survives a GET→PUT round-trip (merge-by-id non-erasure).
    // The GUI never authors By, so the PUT payload omits it; server.ts must re-attach it by id
    // from the on-disk blocks, else a full-state PUT would erase every By field (data loss).
    await ops.taskCreate(root, "COLLAB", "C", { mode: "collab", retries: 0 });
    await ops.addTaskLink(root, "COLLAB", { label: "spec", url: "https://s", by: "alice" }, { retries: 0 });
    await ops.addTaskMemory(root, "COLLAB", { title: "dec", note: "n", by: "bob" }, { retries: 0 });
    await handle(root, "PUT", "/api/tasks/COLLAB", P, { links: [{ label: "spec", url: "https://s", triggers: [], summary: "" }], memory: [{ title: "dec", note: "n", date: "" }] });
    assert.ok((await readFile(join(root, ".agents/tasks/COLLAB/links.md"), "utf8")).includes("By: alice"), "D7a: PUT preserves link By");
    assert.ok((await readFile(join(root, ".agents/tasks/COLLAB/memory.md"), "utf8")).includes("By: bob"), "D7a: PUT preserves memory By");

    // Additive collab read exposure (pm-skills-dashboard): owner/ownerNote/mode on
    // /api/roadmap open[] + join item{}, by on task-GET/join link+memory projections.
    await ops.itemAdd(root, { task: "COLLAB" }, { id: "c-1", title: "C1" }, { retries: 0 });
    await ops.itemSetOwner(root, "COLLAB", "c-1", "alice", { note: "handoff", retries: 0 });
    r = await handle(root, "GET", "/api/roadmap", P, undefined);
    const collabRow = (r.json as any).open.find((i: any) => i.id === "c-1");
    assert.equal(collabRow.owner, "alice", "roadmap open[] exposes owner");
    assert.equal(collabRow.ownerNote, "handoff", "roadmap open[] exposes ownerNote");
    assert.equal(collabRow.mode, "collab", "roadmap open[] exposes mode");
    r = await handle(root, "GET", "/api/roadmap/c-1/join", P, undefined);
    assert.equal((r.json as any).item.owner, "alice", "join item exposes owner");
    assert.equal((r.json as any).item.ownerNote, "handoff", "join item exposes ownerNote");
    assert.equal((r.json as any).item.mode, "collab", "join item exposes mode");
    assert.equal((r.json as any).contextLinks[0].by, "alice", "join contextLinks exposes by");
    assert.equal((r.json as any).contextMemory[0].by, "bob", "join contextMemory exposes by");
    r = await handle(root, "GET", "/api/tasks/COLLAB", P, undefined);
    assert.equal((r.json as any).links[0].by, "alice", "task GET exposes link by");
    assert.equal((r.json as any).memory[0].by, "bob", "task GET exposes memory by");

    // GET /api/inbox — read-only inbox contents (the /api/next inbox field is a count)
    r = await handle(root, "GET", "/api/inbox", P, undefined);
    assert.deepEqual(r.json, [], "empty inbox → []");
    await ops.itemAdd(root, { inbox: true }, { id: "in-1", title: "I1", note: "untriaged" }, { retries: 0 });
    r = await handle(root, "GET", "/api/inbox", P, undefined);
    assert.equal((r.json as any)[0].id, "in-1", "inbox exposes id");
    assert.equal((r.json as any)[0].note, "untriaged", "inbox exposes note");

    // DELETE → archive (ALPHA now has 0 open items)
    r = await handle(root, "DELETE", "/api/tasks/ALPHA", P, undefined);
    assert.equal(r.status, 204, "delete archives a 0-open task");

    // archived task refuses a write (DELETE again)
    r = await handle(root, "DELETE", "/api/tasks/ALPHA", P, undefined);
    assert.equal(r.status, 409, "archived/absent task delete refused");

    console.log("server.test.ts OK");
  } finally { await rm(root, { recursive: true, force: true }); }
}

await main();
