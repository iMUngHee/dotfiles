// Handler-level integration tests for server.ts. Run: ./node_modules/.bin/tsx server.test.ts
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
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
