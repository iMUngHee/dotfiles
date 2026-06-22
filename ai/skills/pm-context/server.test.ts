// Handler-level integration tests for server.ts. Run: ./node_modules/.bin/tsx server.test.ts
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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

    // join + validate
    r = await handle(root, "GET", "/api/roadmap/a-1/join", P, undefined);
    assert.equal((r.json as any).id, "a-1");
    r = await handle(root, "GET", "/api/roadmap/validate", P, undefined);
    assert.ok(Array.isArray((r.json as any).errors));

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
