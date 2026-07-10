// Tests for validate.ts. Run: ./node_modules/.bin/tsx validate.test.ts
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as ops from "./ops.ts";
import { validateRoadmap } from "./validate.ts";
import { taskFile } from "./store.ts";

const O = { nowMs: 1_750_000_000_000, nowDate: "2026-06-22", retries: 0 as number };
const has = (r: { errors: { check: string }[] }, c: string) => r.errors.some((e) => e.check === c);

async function makePlan(root: string, rel: string, status = "draft", pmLoop = true): Promise<void> {
  await mkdir(join(root, ".agents", "plans"), { recursive: true });
  await writeFile(join(root, rel), `---\nid: p\nstatus: ${status}\npm_loop: ${pmLoop}\n---\n# p\n`);
}
async function writeState(root: string, name: string, val: string): Promise<void> {
  await mkdir(join(root, ".agents", "state"), { recursive: true });
  await writeFile(join(root, ".agents", "state", name), val);
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "validate-test-"));
  try {
    // ── clean tree → 0 errors ──
    await ops.taskCreate(root, "A", "A", O);
    await ops.itemAdd(root, { task: "A" }, { id: "a-1", title: "x" }, O); // planless open
    let r = await validateRoadmap(root);
    assert.equal(r.errors.length, 0, "clean: " + JSON.stringify(r.errors));

    // ── C1: id reuse across backlog+closed ──
    await writeFile(taskFile(root, "A", "closed.md"), `# A — Closed\n\n- **a-1** — dup\n  - Status: done\n  - Plan: .agents/plans/x.md\n  - Closed: 2026-01-01\n`);
    assert.ok(has(await validateRoadmap(root), "C1"), "C1 id reuse");
    await writeFile(taskFile(root, "A", "closed.md"), `# A — Closed\n`); // reset

    // ── C2: plan 1:1 (two backlog items same Plan) ──
    await makePlan(root, ".agents/plans/shared.md", "draft");
    await writeFile(taskFile(root, "A", "backlog.md"), `# A — Backlog\n\n- **a-1** — x\n  - Priority: P2\n  - Status: draft\n  - Plan: .agents/plans/shared.md\n  - Note: \n- **a-2** — y\n  - Priority: P2\n  - Status: draft\n  - Plan: .agents/plans/shared.md\n  - Note: \n`);
    assert.ok(has(await validateRoadmap(root), "C2"), "C2 plan 1:1");

    // ── C4: status mirror (item active, plan draft) ──
    await writeFile(taskFile(root, "A", "backlog.md"), `# A — Backlog\n\n- **a-1** — x\n  - Priority: P2\n  - Status: active\n  - Plan: .agents/plans/shared.md\n  - Note: \n`);
    assert.ok(has(await validateRoadmap(root), "C4"), "C4 status mirror");

    // ── C5: bad backlog status ──
    await writeFile(taskFile(root, "A", "backlog.md"), `# A — Backlog\n\n- **a-1** — x\n  - Priority: P2\n  - Status: done\n  - Plan: -\n  - Note: \n`);
    assert.ok(has(await validateRoadmap(root), "C5"), "C5 section membership");

    // ── C6: planless closed recorded as done ──
    await writeFile(taskFile(root, "A", "backlog.md"), `# A — Backlog\n`);
    await writeFile(taskFile(root, "A", "closed.md"), `# A — Closed\n\n- **a-9** — x\n  - Status: done\n  - Plan: -\n  - Closed: 2026-01-01\n`);
    assert.ok(has(await validateRoadmap(root), "C6"), "C6 planless done");

    // ── C7: closed plan path missing ──
    await writeFile(taskFile(root, "A", "closed.md"), `# A — Closed\n\n- **a-9** — x\n  - Status: done\n  - Plan: .agents/plans/gone.md\n  - Closed: 2026-01-01\n`);
    assert.ok(has(await validateRoadmap(root), "C7"), "C7 closed plan missing");
    await writeFile(taskFile(root, "A", "closed.md"), `# A — Closed\n`); // reset

    // ── C8: focus names an inbox item ──
    await ops.itemAdd(root, { inbox: true }, { id: "inb-1", title: "i" }, O);
    await writeState(root, "focus.txt", "inb-1\n");
    assert.ok(has(await validateRoadmap(root), "C8"), "C8 focus inbox");
    await writeState(root, "focus.txt", "");

    // ── C3: orphan in-flight plan (pm_loop:true) → error; pm_loop:false → exempt ──
    await makePlan(root, ".agents/plans/orphan.md", "active", true);
    await writeState(root, "current.txt", ".agents/plans/orphan.md\n");
    assert.ok(has(await validateRoadmap(root), "C3"), "C3 orphan in-flight (pm_loop true)");
    await makePlan(root, ".agents/plans/orphan.md", "active", false); // now out-of-loop
    assert.ok(!has(await validateRoadmap(root), "C3"), "C3 exempt when pm_loop:false");

    // ── C9: current.txt points to a terminal plan ──
    await makePlan(root, ".agents/plans/term.md", "done", false);
    await writeState(root, "current.txt", ".agents/plans/term.md\n");
    assert.ok(has(await validateRoadmap(root), "C9"), "C9 current not draft|active");
    await writeState(root, "current.txt", "");

    // ── C10 (warn): duplicate Order in a task ──
    await writeFile(taskFile(root, "A", "backlog.md"), `# A — Backlog\n\n- **a-1** — x\n  - Priority: P2\n  - Status: open\n  - Order: 1\n  - Plan: -\n  - Note: \n- **a-2** — y\n  - Priority: P2\n  - Status: open\n  - Order: 1\n  - Plan: -\n  - Note: \n`);
    assert.ok((await validateRoadmap(root)).warns.some((w) => w.check === "C10"), "C10 dup order warn");

    // ── C12: invalid task.md mode (absence/solo/collab allowed) ──
    await ops.taskCreate(root, "M", "M", O);
    await writeFile(taskFile(root, "M", "task.md"), `---\nkey: M\ntitle: M\nstatus: active\nmode: bogus\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n# M\n`);
    assert.ok(has(await validateRoadmap(root), "C12"), "C12 bad mode");
    // blank `mode:` value → treated as absence → solo, NOT a C12 error (#8c)
    await writeFile(taskFile(root, "M", "task.md"), `---\nkey: M\ntitle: M\nstatus: active\nmode: \ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n# M\n`);
    assert.ok(!has(await validateRoadmap(root), "C12"), "C12: blank mode is not an error (→ solo)");
    // absent `mode:` line → no error (→ solo), unchanged legacy behavior (no migration needed)
    await writeFile(taskFile(root, "M", "task.md"), `---\nkey: M\ntitle: M\nstatus: active\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n# M\n`);
    assert.ok(!has(await validateRoadmap(root), "C12"), "C12: absent mode is not an error (→ solo)");
    await writeFile(taskFile(root, "M", "task.md"), `---\nkey: M\ntitle: M\nstatus: active\nmode: collab\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n# M\n`); // → collab

    // ── C13 (warn): collab owner not in non-empty roster ──
    await ops.taskSetCollaborators(root, "M", "carol, erin", O);
    await ops.itemAdd(root, { task: "M" }, { id: "m-1", title: "x" }, O);
    await ops.itemSetOwner(root, "M", "m-1", "mallory", O); // first owner (no guard)
    assert.ok((await validateRoadmap(root)).warns.some((w) => w.check === "C13"), "C13 owner not in roster");
    await ops.itemSetOwner(root, "M", "m-1", "carol", { force: true, ...O }); // reassign to a roster member
    assert.ok(!(await validateRoadmap(root)).warns.some((w) => w.check === "C13"), "C13 clears when owner in roster");

    // ── C14: DependsOn target not a reserved id (hand-written, bypassing the ops guard) ──
    await ops.taskCreate(root, "DV", "DV", O);
    await ops.itemAdd(root, { task: "DV" }, { id: "dv-1", title: "one" }, O);
    await ops.itemAdd(root, { task: "DV" }, { id: "dv-2", title: "two" }, O);
    const dvBacklog = (dep1: string) =>
      `# DV — Backlog\n\n- **dv-1** — one\n  - Priority: P2\n  - Status: open\n  - Plan: -\n  - Note: ${dep1 ? `\n  - DependsOn: ${dep1}` : ""}\n- **dv-2** — two\n  - Priority: P2\n  - Status: open\n  - Plan: -\n  - Note: \n`;
    await writeFile(taskFile(root, "DV", "backlog.md"), dvBacklog("totally-unknown-xyz"));
    assert.ok(has(await validateRoadmap(root), "C14"), "C14 dangling DependsOn target");
    await writeFile(taskFile(root, "DV", "backlog.md"), dvBacklog("dv-2"));
    assert.ok(!has(await validateRoadmap(root), "C14"), "C14 clears when target is a known id");

    // ── C15: dependency cycle + self-loop ──
    await writeFile(taskFile(root, "DV", "backlog.md"),
      `# DV — Backlog\n\n- **dv-1** — one\n  - Priority: P2\n  - Status: open\n  - Plan: -\n  - DependsOn: dv-2\n- **dv-2** — two\n  - Priority: P2\n  - Status: open\n  - Plan: -\n  - DependsOn: dv-1\n`);
    assert.ok(has(await validateRoadmap(root), "C15"), "C15 dependency cycle");
    await writeFile(taskFile(root, "DV", "backlog.md"), dvBacklog("dv-1"));
    assert.ok(has(await validateRoadmap(root), "C15"), "C15 self-dependency");
    await writeFile(taskFile(root, "DV", "backlog.md"), dvBacklog(""));

    // ── dep on an archived (still-reserved) id is valid — no C14 ──
    await ops.taskCreate(root, "ARCH", "Arch", O);
    await ops.itemAdd(root, { task: "ARCH" }, { id: "arch-1", title: "z" }, O);
    await ops.dropItem(root, "ARCH", "arch-1", { reason: "x", ...O });
    await ops.taskArchive(root, "ARCH", O); // arch-1 now lives in archive/ARCH/closed.md, still reserved
    await writeFile(taskFile(root, "DV", "backlog.md"), dvBacklog("arch-1"));
    assert.ok(!has(await validateRoadmap(root), "C14"), "dep on an archived (reserved) id is valid — no C14");
    await writeFile(taskFile(root, "DV", "backlog.md"), dvBacklog(""));

    console.log("validate.test.ts OK");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
