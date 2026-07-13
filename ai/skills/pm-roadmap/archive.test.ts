// Tests for archive.ts. Run: ./node_modules/.bin/tsx archive.test.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile, rename, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as ops from "./ops.ts";
import { archivePlans } from "./archive.ts";
import { taskFile, readStamped, parseBlocks, getField } from "./store.ts";

const O = { nowMs: 1_750_000_000_000, nowDate: "2026-06-22", retries: 0 as number };
const exists = (p: string) => stat(p).then(() => true).catch(() => false);
async function planField(root: string, key: string, id: string): Promise<string | null> {
  const s = await readStamped(taskFile(root, key, "closed.md"));
  const b = s ? parseBlocks(s.content).blocks.find((x) => x.id === id) : null;
  return b ? getField(b, "Plan") : null;
}
async function makePlan(root: string, rel: string, status = "done") {
  await mkdir(join(root, ".agents", "plans"), { recursive: true });
  await writeFile(join(root, rel), `---\nid: p\nstatus: ${status}\n---\n# p\n`);
}
// create a closed item in task A linked to plan `rel`
async function closeWithPlan(root: string, id: string, rel: string, status = "done") {
  await makePlan(root, rel, status);
  await ops.itemAdd(root, { task: "A" }, { id, title: id }, O);
  await ops.itemSetPlan(root, "A", id, rel, O);
  await ops.itemClose(root, "A", id, { status: status as "done" | "dropped", reason: status === "dropped" ? "x" : undefined, plan: rel, closedDate: "2026-01-01", ...O });
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "archive-test-"));
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
    git("init", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    await writeFile(join(root, "README.md"), "x\n");
    git("add", "README.md");
    git("commit", "-m", "init");
    await ops.taskCreate(root, "A", "A", O);
    // old terminal unreferenced → archived + closed.md pointer rewritten
    await closeWithPlan(root, "old-1", ".agents/plans/2026-01-01-old.md", "done");
    // recent terminal → protected by age
    await closeWithPlan(root, "recent-1", ".agents/plans/2026-06-20-recent.md", "done");

    const r = await archivePlans(root, { today: "2026-06-22" });
    assert.ok(r.moved.some((m) => m.plan === ".agents/plans/2026-01-01-old.md"), "old plan moved");
    assert.ok(!r.moved.some((m) => m.plan.includes("recent")), "recent plan protected by age");
    assert.equal(await exists(join(root, ".agents/plans/archive/2026-01-01-old.md")), true, "moved to archive/");
    assert.equal(await exists(join(root, ".agents/plans/2026-01-01-old.md")), false, "gone from plans/");
    assert.equal(await planField(root, "A", "old-1"), ".agents/plans/archive/2026-01-01-old.md", "closed.md pointer rewritten");
    assert.equal(await planField(root, "A", "recent-1"), ".agents/plans/2026-06-20-recent.md", "recent pointer unchanged");

    // current.txt protection
    await closeWithPlan(root, "cur-1", ".agents/plans/2026-01-02-cur.md", "done");
    await mkdir(join(root, ".agents", "state"), { recursive: true });
    await writeFile(join(root, ".agents", "state", "current.txt"), ".agents/plans/2026-01-02-cur.md\n");
    const r2 = await archivePlans(root, { today: "2026-06-22" });
    assert.ok(!r2.moved.some((m) => m.plan.includes("cur")), "current.txt plan protected");
    await writeFile(join(root, ".agents", "state", "current.txt"), "");

    // a pointer in a secondary managed worktree protects the terminal plan too.
    await closeWithPlan(root, "secondary-1", ".agents/plans/2026-01-04-secondary.md", "done");
    const secondary = join(root, ".agents", "worktrees", "secondary");
    git("worktree", "add", "-b", "secondary", secondary, "main");
    await mkdir(join(secondary, ".agents", "state"), { recursive: true });
    await writeFile(join(secondary, ".agents", "state", "current.txt"), ".agents/plans/2026-01-04-secondary.md\n");
    const protectedRun = await archivePlans(root, { today: "2026-06-22" });
    assert.ok(protectedRun.skipped.some((s) => s.plan === "2026-01-04-secondary.md" && s.reason.startsWith("protected-by-current:")));
    await writeFile(join(secondary, ".agents", "state", "current.txt"), "");
    const afterCleanup = await archivePlans(root, { today: "2026-06-22" });
    assert.ok(afterCleanup.moved.some((m) => m.plan.endsWith("2026-01-04-secondary.md")), "archives after secondary pointer cleanup");

    // idempotent recovery: file already in archive/, closed.md still points at plans/
    await closeWithPlan(root, "rec-1", ".agents/plans/2026-01-03-rec.md", "done");
    await mkdir(join(root, ".agents", "plans", "archive"), { recursive: true });
    await rename(join(root, ".agents/plans/2026-01-03-rec.md"), join(root, ".agents/plans/archive/2026-01-03-rec.md"));
    const r3 = await archivePlans(root, { today: "2026-06-22" });
    assert.ok(r3.recovered.includes(".agents/plans/2026-01-03-rec.md"), "recovery detected");
    assert.equal(await planField(root, "A", "rec-1"), ".agents/plans/archive/2026-01-03-rec.md", "recovery rewrote pointer");

    console.log("archive.test.ts OK");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
