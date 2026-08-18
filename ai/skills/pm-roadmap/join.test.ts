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

    // ── next candidates: Order gate + inbox exclusion; no persisted selector projection ──
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
    assert.equal("focus" in nc, false, "candidate projection has no legacy selector field");

    // deterministic sort: a-cur (P2, key A) before c-1 (P2, key C)
    const order = nc.eligible.map((c) => `${c.key}/${c.id}`);
    assert.ok(order.indexOf("A/a-cur") < order.indexOf("C/c-1"), "sorted by (priority, taskKey, order, id)");

    // ── recent-closed merge across tasks, newest first ──
    const rc = await j.recentClosed(root, 100);
    assert.ok(rc.some((r) => r.id === "b-1" && r.key === "B"));
    assert.equal(rc[0].closed >= rc[rc.length - 1].closed, true, "sorted desc by Closed");
    assert.equal(rc.length, 7, "6 from A + 1 from B");

    // ── resolveItem + buildNextPrompt ──
    const currentPlan = ".agents/plans/2026-06-22-a-current.md";
    await writeFile(join(root, currentPlan), `---
id: a-current
status: active
pm_loop: true
base_branch: main
base_commit: 0123456789012345678901234567890123456789
branch: agent/a-current
worktree: .agents/worktrees/agent/a-current
---
# current

## Implementation Steps

- [ ] wire the mapped checkout
`);
    await ops.itemSetPlan(root, "A", "a-cur", currentPlan, O);
    await mkdir(join(root, ".agents", "state"), { recursive: true });
    await writeFile(join(root, ".agents", "state", "current.txt"), `${currentPlan}\n`);
    const linkedCurrent = await j.resolveCurrentPlan(root);
    assert.equal(linkedCurrent.state, "linked");
    assert.equal(linkedCurrent.state === "linked" ? linkedCurrent.item.key : null, "A");
    assert.equal(linkedCurrent.state === "linked" ? linkedCurrent.plan.nextStep : null, "wire the mapped checkout");

    const standalonePlan = ".agents/plans/2026-06-22-standalone.md";
    await writeFile(join(root, standalonePlan), `---
id: standalone
title: Standalone
status: active
pm_loop: false
base_branch: main
base_commit: 0123456789012345678901234567890123456789
branch: agent/standalone
worktree: .agents/worktrees/standalone
---
# standalone
`);
    await writeFile(join(root, ".agents", "state", "current.txt"), `${standalonePlan}\n`);
    assert.equal((await j.resolveCurrentPlan(root)).state, "standalone");
    await writeFile(join(root, ".agents", "state", "current.txt"), ".agents/plans/missing.md\n");
    const staleCurrent = await j.resolveCurrentPlan(root);
    assert.equal(staleCurrent.state, "stale");
    assert.equal(staleCurrent.state === "stale" ? staleCurrent.reason : null, "missing_plan");
    await writeFile(join(root, ".agents", "state", "current.txt"), "");
    assert.equal((await j.resolveCurrentPlan(root)).state, "empty");

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
    assert.ok(prompt.includes("branch: agent/a-current · worktree: .agents/worktrees/agent/a-current"));
    assert.ok(prompt.includes("codex -C .agents/worktrees/agent/a-current"));
    assert.ok(prompt.includes("cd .agents/worktrees/agent/a-current && claude"));
    assert.equal(view!.plan?.baseCommit, "0123456789012345678901234567890123456789");

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

    // ── dependency edges (DependsOn): cross-task blocking, precedence, unblock, exposure ──
    // a closed target never blocks (b-1 is done): c-1 depends on b-1 ⇒ still eligible
    await ops.itemSetDeps(root, "C", "c-1", ["b-1"], O);
    let ncd = await j.nextCandidates(root);
    assert.ok(ncd.eligible.some((c) => c.id === "c-1"), "dep on a closed item does not block");
    // cross-task open target blocks: c-1 depends on a-cur (open in task A)
    await ops.itemSetDeps(root, "C", "c-1", ["a-cur"], O);
    ncd = await j.nextCandidates(root);
    const c1b = ncd.blocked.find((c) => c.id === "c-1");
    assert.ok(c1b && c1b.blockedBy === "a-cur", "cross-task dependency blocks");
    assert.deepEqual(c1b!.dependsOn, ["a-cur"], "candidate carries dependsOn");
    // dependency blocker takes precedence over an earlier-Order sibling (c-2 is order-blocked by c-1)
    await ops.itemSetDeps(root, "C", "c-2", ["a-cur"], O);
    ncd = await j.nextCandidates(root);
    assert.equal(ncd.blocked.find((c) => c.id === "c-2")!.blockedBy, "a-cur", "dep blocker precedes order blocker");
    // closing/dropping the dependency unblocks the dependent
    await ops.dropItem(root, "A", "a-cur", { reason: "test unblock", ...O });
    ncd = await j.nextCandidates(root);
    assert.ok(ncd.eligible.some((c) => c.id === "c-1"), "dropping the dep target unblocks the dependent");
    // ItemView + kickoff expose DependsOn
    await ops.itemSetDeps(root, "C", "c-1", ["c-2"], O);
    const cv = await j.resolveItem(root, "C", "c-1");
    assert.deepEqual(cv!.dependsOn, ["c-2"], "ItemView carries dependsOn");
    const dprompt = j.buildNextPrompt(cv!);
    assert.ok(dprompt.includes("## Depends on") && dprompt.includes("c-2"), "kickoff shows Depends on list");

    // ── blocker reason: Order chains and DependsOn render identically without it ──
    // Two items blocked by the same id for different reasons read the same in `list`, so
    // clearing a dependency while an Order chain remains looks like it did nothing.
    await ops.taskCreate(root, "ORD", "Order task", O);
    await ops.itemAdd(root, { task: "ORD" }, { id: "o-1", title: "O1", order: "1" }, O);
    await ops.itemAdd(root, { task: "ORD" }, { id: "o-2", title: "O2", order: "2" }, O);
    await ops.itemAdd(root, { task: "ORD" }, { id: "o-dep", title: "Odep" }, O);
    await ops.itemSetDeps(root, "ORD", "o-dep", ["o-1"], O);

    let ordered = await j.nextCandidates(root);
    const byOrder = ordered.blocked.find((c) => c.id === "o-2");
    const byDep = ordered.blocked.find((c) => c.id === "o-dep");
    assert.ok(byOrder && byOrder.blockedBy === "o-1", "o-2 blocked by o-1");
    assert.ok(byDep && byDep.blockedBy === "o-1", "o-dep blocked by o-1 too — same id, different cause");
    assert.equal(byOrder!.blockedByReason, "order", "an earlier-Order sibling is reported as order");
    assert.equal(byDep!.blockedByReason, "dependency", "a DependsOn target is reported as dependency");

    // precedence is unchanged: a dep outranks an Order sibling on the same item
    await ops.itemSetOrder(root, "ORD", "o-dep", "3", O);
    ordered = await j.nextCandidates(root);
    const both = ordered.blocked.find((c) => c.id === "o-dep");
    assert.equal(both!.blockedBy, "o-1", "dep blocker still wins the id");
    assert.equal(both!.blockedByReason, "dependency", "dep blocker still wins the reason");

    // eligible items carry no reason at all
    assert.ok(ordered.eligible.every((c) => c.blockedByReason === undefined), "eligible candidates have no blocker reason");

    // clearing the Order is what unblocks o-2 — the exit this plan adds
    await ops.itemSetOrder(root, "ORD", "o-2", "-", O);
    ordered = await j.nextCandidates(root);
    assert.ok(ordered.eligible.some((c) => c.id === "o-2"), "clearing Order moves the item to eligible");
    assert.ok(ordered.eligible.some((c) => c.id === "o-1"), "the sibling that was never blocked is unaffected");
    assert.ok(ordered.blocked.some((c) => c.id === "o-dep"), "a genuine dependency still blocks");

    console.log("join.test.ts OK");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
