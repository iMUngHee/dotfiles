// Tests for join.ts. Run: ./node_modules/.bin/tsx join.test.ts
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as ops from "./ops.ts";
import * as j from "./join.ts";

const O = { nowMs: 1_750_000_000_000, nowDate: "2026-06-22", retries: 0 as number };

async function makePlan(root: string, rel: string, status = "done", notes = ""): Promise<void> {
  await mkdir(join(root, ".agents", "plans"), { recursive: true });
  await writeFile(join(root, rel), `---\nid: p\nstatus: ${status}\npm_loop: true\n---\n# p\n\n## Post-Implementation Notes\n\n${notes}\n`);
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "join-test-"));
  try {
    // task A: 6 done siblings (each with a plan + Post-Impl note) + 1 open current item
    await ops.taskCreate(root, "A", "Task A", O);
    for (let i = 1; i <= 6; i++) {
      const rel = `.agents/plans/2026-06-0${i}-a-${i}.md`;
      await makePlan(root, rel, "done", `A note ${i}`);
      await ops.itemAdd(root, { task: "A" }, { id: `a-${i}`, title: `A${i}` }, O);
      await ops.itemSetPlan(root, "A", `a-${i}`, rel, O);
      await ops.itemClose(root, "A", `a-${i}`, { status: "done", plan: rel, closedDate: `2026-06-0${i}`, ...O });
    }
    await ops.itemAdd(root, { task: "A" }, { id: "a-cur", title: "current" }, O);

    // task B: a done sibling that must NOT leak into A's inheritance
    await ops.taskCreate(root, "B", "Task B", O);
    const relB = ".agents/plans/2026-06-09-b-1.md";
    await makePlan(root, relB, "done", "B note");
    await ops.itemAdd(root, { task: "B" }, { id: "b-1", title: "B1" }, O);
    await ops.itemSetPlan(root, "B", "b-1", relB, O);
    await ops.itemClose(root, "B", "b-1", { status: "done", plan: relB, closedDate: "2026-06-09", ...O });

    // ── inheritance: same-task only + capped at 5 (6 done → 5) ──
    const sib = await j.doneSiblings(root, "A", "a-cur");
    assert.equal(sib.length, 5, "capped at 5");
    assert.ok(!sib.some((s) => s.id === "b-1"), "no cross-task leak");
    assert.ok(sib.some((s) => s.id === "a-6"), "newest kept");
    assert.ok(!sib.some((s) => s.id === "a-1"), "oldest dropped by cap");

    // cap<=0 ⇒ unlimited (show-older path)
    const sibAll = await j.doneSiblings(root, "A", "a-cur", 0);
    assert.equal(sibAll.length, 6, "cap=0 → all 6 siblings");
    assert.ok(sibAll.some((s) => s.id === "a-1"), "oldest present when unlimited");

    // ── next candidates: Order gate + blocked focus reporting + inbox exclusion ──
    await ops.taskCreate(root, "C", "Task C", O);
    await ops.itemAdd(root, { task: "C" }, { id: "c-1", title: "C1", order: "1" }, O);
    await ops.itemAdd(root, { task: "C" }, { id: "c-2", title: "C2", order: "2" }, O);
    await ops.itemAdd(root, { inbox: true }, { id: "inb-1", title: "Inbox" }, O);

    const nc = await j.nextCandidates(root);
    assert.ok(nc.eligible.some((c) => c.id === "c-1"), "c-1 eligible");
    const c2 = nc.blocked.find((c) => c.id === "c-2");
    assert.ok(c2 && c2.blockedBy === "c-1", "c-2 blocked by c-1");
    assert.ok(!nc.eligible.some((c) => c.id === "inb-1") && !nc.blocked.some((c) => c.id === "inb-1"), "inbox excluded");
    assert.equal(nc.inbox, 1);

    // deterministic sort: a-cur (P2, key A) before c-1 (P2, key C)
    const order = nc.eligible.map((c) => `${c.key}/${c.id}`);
    assert.ok(order.indexOf("A/a-cur") < order.indexOf("C/c-1"), "sorted by (priority, taskKey, order, id)");

    // ── recent-closed merge across tasks, newest first ──
    const rc = await j.recentClosed(root, 100);
    assert.ok(rc.some((r) => r.id === "b-1" && r.key === "B"));
    assert.equal(rc[0].closed >= rc[rc.length - 1].closed, true, "sorted desc by Closed");
    assert.equal(rc.length, 7, "6 from A + 1 from B");

    // ── resolveItem + buildNextPrompt ──
    const view = await j.resolveItem(root, "A", "a-cur");
    assert.ok(view && view.key === "A" && !view.closed);
    assert.equal(view!.siblings.length, 5);
    assert.equal(view!.siblingsTotal, 6, "siblingsTotal = full count before cap");
    const viewAll = await j.resolveItem(root, "A", "a-cur", 0);
    assert.equal(viewAll!.siblings.length, 6, "cap=0 ⇒ all siblings shown");
    assert.equal(viewAll!.siblingsTotal, 6);
    const prompt = j.buildNextPrompt(view!, nc.inbox);
    assert.ok(prompt.includes("# Next: a-cur"));
    assert.ok(prompt.includes("> task: A"));
    assert.ok(prompt.includes("awaiting triage"));

    // closed item is also resolvable
    const closedView = await j.resolveItem(root, "A", "a-6");
    assert.ok(closedView && closedView.closed && closedView.status === "done");

    // ── Post-Impl notes surfaced on PlanInfo (closed-item-postimpl) ──
    assert.equal(closedView!.plan?.postImplNotes, "A note 6", "closed item's plan carries its Post-Impl notes");
    // planInfo unit: extracts the section; placeholder-only (HTML comment) → "" (server adapter then normalizes to null)
    assert.equal(j.planInfo("p.md", "---\nstatus: done\n---\n## Post-Implementation Notes\n\nhello\n").postImplNotes, "hello");
    assert.equal(j.planInfo("p.md", "---\nstatus: done\n---\n## Post-Implementation Notes\n\n<!-- placeholder -->\n").postImplNotes, "");

    // ── collaboration views ──
    assert.equal(await j.taskMode(root, "A"), "solo", "absence → solo");
    await ops.taskCreate(root, "CB", "Collab B", { ...O, mode: "collab" });
    assert.equal(await j.taskMode(root, "CB"), "collab");
    await ops.itemAdd(root, { task: "CB" }, { id: "cb-1", title: "One" }, O);
    await ops.itemAdd(root, { task: "CB" }, { id: "cb-2", title: "Two" }, O);
    await ops.itemSetOwner(root, "CB", "cb-1", "carol", O);
    const ncb = await j.nextCandidates(root);
    const cb1 = [...ncb.eligible, ...ncb.blocked].find((c) => c.id === "cb-1")!;
    assert.equal(cb1.owner, "carol", "candidate carries owner");
    assert.equal(cb1.mode, "collab", "candidate carries mode");
    assert.deepEqual((await j.myItems(root, "carol")).map((c) => c.id), ["cb-1"], "myItems = my collab open items");
    const board = await j.boardByOwner(root);
    assert.ok(board.find((e) => e.owner === "carol")?.items.some((c) => c.id === "cb-1"), "board groups carol");
    assert.ok(board.find((e) => e.owner === "(unassigned)")?.items.some((c) => c.id === "cb-2"), "board groups unassigned");
    await ops.taskSetCollaborators(root, "CB", "carol, dave", O);
    assert.deepEqual(await j.taskCollaborators(root, "CB"), ["carol", "dave"], "roster parsed");

    console.log("join.test.ts OK");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
