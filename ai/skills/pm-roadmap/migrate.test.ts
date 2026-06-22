// Tests for migrate.ts. Run: ./node_modules/.bin/tsx migrate.test.ts
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "./migrate.ts";
import { validateRoadmap } from "./validate.ts";
import { parseBlocks } from "./store.ts";

const APPLY = { apply: true, yes: true, today: "2026-06-22", runid: "t1" };
const exists = (p: string) => stat(p).then(() => true).catch(() => false);
const ids = async (p: string) => parseBlocks(await readFile(p, "utf-8").catch(() => "")).blocks.map((b) => b.id);

async function makePlan(root: string, rel: string, status = "done") {
  await mkdir(join(root, ".agents", "plans"), { recursive: true });
  await writeFile(join(root, rel), `---\nid: p\nstatus: ${status}\n---\n# p\n\n## Post-Implementation Notes\n\n-\n`);
}
async function tmp() { return mkdtemp(join(tmpdir(), "migrate-test-")); }

async function main() {
  // ── no ROADMAP → no-op ──
  {
    const root = await tmp();
    try { const r = await migrate(root, APPLY); assert.equal(r.noop, "no-legacy"); assert.equal(r.applied, false); }
    finally { await rm(root, { recursive: true, force: true }); }
  }

  // ── (a) .config shape: 1 task, open + closed(plan) + links + memory ──
  {
    const root = await tmp();
    try {
      await mkdir(join(root, ".agents", "task-context"), { recursive: true });
      await mkdir(join(root, ".agents", "memory"), { recursive: true });
      await writeFile(join(root, ".agents", "ROADMAP.md"),
        `---\nproject: t\nfocus:\nupdated: 2026-06-10\n---\n# t — Backlog\n\n## Open\n\n- **it-1** — Item one\n  - Priority: P1\n  - Status: open\n  - Task: ALPHA\n  - Plan: -\n  - Note: hi\n\n## Recently Closed\n\n- **c-1** → .agents/plans/2026-06-01-c-1.md (done) · Task: ALPHA\n`);
      await writeFile(join(root, ".agents", "task-context", "ALPHA.md"), `# ALPHA\n\n- **Wiki**\n  - URL: https://x\n  - Triggers: a, b\n  - Summary: s\n`);
      await writeFile(join(root, ".agents", "memory", "ALPHA.md"), `# ALPHA\n\n- **note1**\n  - Note: remember\n  - Date: 2026-06-01\n`);
      await makePlan(root, ".agents/plans/2026-06-01-c-1.md", "done");

      // dry-run writes nothing
      const dry = await migrate(root, { today: "2026-06-22" });
      assert.equal(dry.applied, false);
      assert.equal(await exists(join(root, ".agents", "tasks")), false, "dry-run writes nothing");

      // apply
      const r = await migrate(root, APPLY);
      assert.ok(r.applied && r.ok, r.out);
      assert.deepEqual(await ids(join(root, ".agents", "tasks", "ALPHA", "backlog.md")), ["it-1"]);
      assert.deepEqual(await ids(join(root, ".agents", "tasks", "ALPHA", "closed.md")), ["c-1"]);
      assert.deepEqual(await ids(join(root, ".agents", "tasks", "ALPHA", "links.md")), ["Wiki"]);
      assert.deepEqual(await ids(join(root, ".agents", "tasks", "ALPHA", "memory.md")), ["note1"]);
      assert.equal(await exists(join(root, ".agents", "ROADMAP.md")), false, "legacy ROADMAP removed");
      assert.equal(await exists(join(root, ".agents", "task-context")), false, "legacy task-context removed");
      assert.equal((await validateRoadmap(root)).errors.length, 0, "migrated tree validates clean");

      // re-run → no-op
      assert.equal((await migrate(root, APPLY)).noop, "already-migrated");
    } finally { await rm(root, { recursive: true, force: true }); }
  }

  // ── (b) multi-task + taskless → inbox ──
  {
    const root = await tmp();
    try {
      await mkdir(join(root, ".agents"), { recursive: true });
      await writeFile(join(root, ".agents", "ROADMAP.md"),
        `---\nproject: t\nfocus:\nupdated: 2026-06-10\n---\n# t — Backlog\n\n## Open\n\n- **a-1** — A item\n  - Status: open\n  - Task: ALPHA\n  - Plan: -\n- **free-1** — Untriaged\n  - Status: open\n  - Task: _INBOX\n  - Plan: -\n\n## Recently Closed\n\n- **b-1** → .agents/plans/2026-06-02-b-1.md (done) · Task: BETA\n`);
      await makePlan(root, ".agents/plans/2026-06-02-b-1.md", "done");

      const r = await migrate(root, APPLY);
      assert.ok(r.applied && r.ok, r.out);
      assert.deepEqual(await ids(join(root, ".agents", "tasks", "ALPHA", "backlog.md")), ["a-1"]);
      assert.deepEqual(await ids(join(root, ".agents", "tasks", "BETA", "closed.md")), ["b-1"]);
      assert.deepEqual(await ids(join(root, ".agents", "inbox.md")), ["free-1"], "taskless → inbox.md");
      assert.equal((await validateRoadmap(root)).errors.length, 0);
    } finally { await rm(root, { recursive: true, force: true }); }
  }

  // ── (c) legacy `## Memory` section inside a task-context file → memory.md ──
  {
    const root = await tmp();
    try {
      await mkdir(join(root, ".agents", "task-context"), { recursive: true });
      await writeFile(join(root, ".agents", "ROADMAP.md"),
        `---\nproject: t\nfocus:\nupdated: 2026-06-10\n---\n# t — Backlog\n\n## Open\n\n- **g-1** — G item\n  - Status: open\n  - Task: GAMMA\n  - Plan: -\n\n## Recently Closed\n`);
      await writeFile(join(root, ".agents", "task-context", "GAMMA.md"),
        `# GAMMA\n\n- **Doc**\n  - URL: https://g\n  - Triggers: g\n  - Summary: gg\n\n## Memory\n\n- **legacy-note**\n  - Note: from the section\n  - Date: 2026-06-03\n`);

      const r = await migrate(root, APPLY);
      assert.ok(r.applied && r.ok, r.out);
      assert.deepEqual(await ids(join(root, ".agents", "tasks", "GAMMA", "links.md")), ["Doc"]);
      assert.deepEqual(await ids(join(root, ".agents", "tasks", "GAMMA", "memory.md")), ["legacy-note"], "## Memory split into memory.md");
      assert.equal((await validateRoadmap(root)).errors.length, 0);
    } finally { await rm(root, { recursive: true, force: true }); }
  }

  // ── (d) induced validate failure → FULL rollback from backup (legacy intact + re-runnable) ──
  {
    const root = await tmp();
    try {
      await mkdir(join(root, ".agents"), { recursive: true });
      // a closed item references a plan file that does NOT exist → validate C7 fails post-migration
      await writeFile(join(root, ".agents", "ROADMAP.md"),
        `---\nproject: t\nfocus:\nupdated: 2026-06-10\n---\n# t — Backlog\n\n## Open\n\n## Recently Closed\n\n- **c-bad** → .agents/plans/2026-06-01-missing.md (done) · Task: ALPHA\n`);
      const r = await migrate(root, { apply: true, yes: true, today: "2026-06-22", runid: "tfail" });
      assert.equal(r.ok, false, "validation failure → not ok");
      assert.equal(r.applied, false, "validation failure → not applied");
      assert.ok(await exists(join(root, ".agents", "ROADMAP.md")), "legacy ROADMAP.md kept on failure");
      assert.equal(await exists(join(root, ".agents", "tasks")), false, "FULL rollback removed tasks/ (not stuck as already-migrated)");
      // re-run is NOT a no-op — tasks/ was fully removed, so the repo is re-runnable
      const r2 = await migrate(root, { apply: true, yes: true, today: "2026-06-22", runid: "tfail2" });
      assert.notEqual(r2.noop, "already-migrated", "rollback left the repo re-runnable");
      assert.equal(r2.ok, false, "re-run fails the same induced validation");
    } finally { await rm(root, { recursive: true, force: true }); }
  }

  console.log("migrate.test.ts OK");
}

await main();
