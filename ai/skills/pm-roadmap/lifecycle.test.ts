// lifecycle.test.ts — exercises the two /design + /retro lifecycle paths through the
// REAL CLI (runCli → ops), proving the documented hooks produce coherent end-states and
// leave the validator clean. Run: ./node_modules/.bin/tsx lifecycle.test.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./pm-roadmap.ts";
import * as ops from "./ops.ts";
import { ensureManagedWorktree, reservationPaths, stagePlan } from "../../lib/worktree.mjs";

async function writePlan(root: string, rel: string, opts: { status?: string; deferred?: string; pmLoop?: boolean } = {}): Promise<void> {
  await mkdir(join(root, ".agents", "plans"), { recursive: true });
  const body = `---\nid: p\nstatus: ${opts.status ?? "draft"}\npm_loop: ${opts.pmLoop ?? true}\n---\n# p\n\n## Implementation Steps\n\n- [ ] 1. Example\n- [ ] 2. Concurrent example\n\n## Post-Implementation Notes\n\n- done\n${opts.deferred ?? ""}`;
  await writeFile(join(root, rel), body);
}
const read = (root: string, p: string) => readFile(join(root, p), "utf8").catch(() => "");

async function main() {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-test-"));
  const cli = (...a: string[]) => runCli(root, a);
  try {
    assert.equal((await cli("task", "create", "TKA", "--title", "Task A")).code, 0);

    // ── Path A: /design persist → 승인(approve) → /retro complete(done) + ## Deferred harvest ──
    const planA = ".agents/plans/2026-06-22-feat-a.md";
    await writePlan(root, planA, {
      deferred: "\n## Deferred\n\n- **feat-a-followup** — A follow-up\n  - Priority: P2\n  - Note: harvested by retro\n",
    });
    // persist: create+link the item AND point current.txt, one transaction
    assert.equal((await cli("persist", "TKA", "feat-a", planA, "--title", "Feature A")).code, 0);
    assert.equal((await read(root, ".agents/state/current.txt")).trim(), planA, "persist pointed current.txt");
    assert.ok((await read(root, ".agents/tasks/TKA/backlog.md")).includes("Status: draft"), "persisted item mirrors plan = draft");
    assert.equal((await cli("validate")).code, 0, "validate clean after persist");

    // 승인: approve mirrors the backlog item to active
    assert.equal((await cli("approve", "TKA", "feat-a")).code, 0);
    assert.ok((await read(root, ".agents/tasks/TKA/backlog.md")).includes("Status: active"), "approved item is active");
    assert.ok((await read(root, planA)).includes("status: active"), "approve atomically mirrors plan status");
    await Promise.all([
      cli("plan-step", "check", planA, "1"),
      cli("plan-step", "check", planA, "2"),
    ]);
    const stepped = await read(root, planA);
    assert.ok(stepped.includes("- [x] 1. Example") && stepped.includes("- [x] 2. Concurrent example"), "concurrent plan-step writes both survive");

    // /retro complete: plan→done + item→closed + ## Deferred harvest + current.txt cleared, all-or-nothing
    assert.equal((await cli("complete", "TKA", "feat-a", "--plan", planA, "--status", "done")).code, 0);
    assert.ok((await read(root, planA)).includes("status: done"), "complete set the plan → done");
    assert.ok((await read(root, ".agents/tasks/TKA/closed.md")).includes("feat-a"), "item moved to closed.md");
    assert.ok((await read(root, ".agents/tasks/TKA/backlog.md")).includes("feat-a-followup"), "## Deferred harvested into backlog");
    assert.equal((await read(root, ".agents/state/current.txt")).trim(), "", "complete cleared current.txt");
    assert.equal((await cli("validate")).code, 0, "validate clean after complete");

    // ── Path B: /design persist → 취소(close --status dropped) ──
    const planB = ".agents/plans/2026-06-22-feat-b.md";
    await writePlan(root, planB);
    assert.equal((await cli("persist", "TKA", "feat-b", planB, "--title", "Feature B")).code, 0);
    // 취소 uses the same terminal lifecycle transaction as retro.
    assert.equal((await cli("complete", "TKA", "feat-b", "--plan", planB, "--status", "dropped", "--reason", "abandoned")).code, 0);
    const closed = await read(root, ".agents/tasks/TKA/closed.md");
    assert.ok(closed.includes("feat-b") && closed.includes("Status: dropped") && closed.includes("Reason: abandoned"), "feat-b closed dropped with reason");
    assert.ok((await read(root, planB)).includes("status: dropped"), "drop mirrors plan status");
    assert.equal((await cli("validate")).code, 0, "validate clean after 취소/drop");

    // ── Path C: standalone plans journal only their plan and use the same pointer cleanup ──
    const standalone = ".agents/plans/2026-06-22-standalone.md";
    await writePlan(root, standalone, { pmLoop: false });
    await writeFile(join(root, ".agents/state/current.txt"), `${standalone}\n`);
    assert.equal((await cli("approve", "--standalone", "--plan", standalone)).code, 0);
    assert.ok((await read(root, standalone)).includes("status: active"));
    assert.equal((await cli("complete", "--standalone", "--plan", standalone, "--status", "done")).code, 0);
    assert.ok((await read(root, standalone)).includes("status: done"));
    assert.equal((await read(root, ".agents/state/current.txt")).trim(), "");

    // ── Reserved staging: canonical creation, selected/parked convergence, cleanup ──
    const gitRoot = await mkdtemp(join(tmpdir(), "reserved-lifecycle-"));
    try {
      const git = (...args: string[]) => execFileSync("git", args, { cwd: gitRoot, encoding: "utf8" });
      git("init", "-b", "main");
      git("config", "user.email", "test@example.com");
      git("config", "user.name", "Test");
      await writeFile(join(gitRoot, "README.md"), "x\n");
      git("add", "README.md");
      git("commit", "-m", "init");
      const gitCli = (...a: string[]) => runCli(gitRoot, a);
      assert.equal((await gitCli("task", "create", "TKA", "--title", "Task A")).code, 0);

      // Existing open/Plan:- item: both journal targets roll back together, then CLI persist
      // links the same block without replacing its title or metadata.
      assert.equal((await gitCli(
        "add", "reserved-existing", "Reserved Existing", "--task", "TKA",
        "-p", "P1", "-o", "7", "--note", "keep-me",
      )).code, 0);
      const ensureExisting = await ensureManagedWorktree({ root: gitRoot, id: "reserved-existing", base: "main" });
      const targetExisting = (...a: string[]) => runCli(ensureExisting.execution_root, a);
      const planExisting = ".agents/plans/2026-07-15-reserved-existing.md";
      const stagedExisting = `---\nid: reserved-existing\nstatus: draft\npm_loop: true\nbase_branch: main\nbase_commit: ${ensureExisting.base_commit}\nbranch: ${ensureExisting.branch}\nworktree: ${ensureExisting.worktree}\n---\n# Reserved existing\n`;
      await stagePlan({ root: gitRoot, id: "reserved-existing", content: stagedExisting });
      const existingBacklogBefore = await read(gitRoot, ".agents/tasks/TKA/backlog.md");
      await assert.rejects(
        ops.createPlanAndBacklogItem(
          ensureExisting.execution_root,
          "TKA",
          { id: "reserved-existing", title: "Replacement title" },
          planExisting,
          { retries: 0, transaction: { failAfter: 1 } },
        ),
        /injected transaction failure after 1/,
      );
      assert.equal(await read(gitRoot, planExisting), "", "failed persist leaves canonical plan absent");
      assert.equal(await read(gitRoot, ".agents/tasks/TKA/backlog.md"), existingBacklogBefore, "failed persist restores backlog bytes");
      const existingPersisted = await targetExisting("persist", "TKA", "reserved-existing", planExisting, "--title", "Replacement title");
      assert.match(existingPersisted.out, /^persisted_selected /);
      assert.equal(await read(gitRoot, planExisting), stagedExisting);
      const existingBacklogAfter = await read(gitRoot, ".agents/tasks/TKA/backlog.md");
      assert.match(existingBacklogAfter, /\*\*reserved-existing\*\* — Reserved Existing/);
      assert.match(existingBacklogAfter, /Status: draft/);
      assert.match(existingBacklogAfter, new RegExp(`Plan: ${planExisting.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
      assert.match(existingBacklogAfter, /Priority: P1/);
      assert.match(existingBacklogAfter, /Order: 7/);
      assert.match(existingBacklogAfter, /Note: keep-me/);
      assert.equal(await read(gitRoot, ".agents/worktree-reservations/reserved-existing.json"), "", "successful link consumes reservation");
      assert.equal((await gitCli("validate")).code, 0, "existing-item persist leaves roadmap valid");

      // A committed journal is recoverable, but a foreign target pointer must survive the
      // retry and keep the reservation available instead of being re-baselined/overwritten.
      assert.equal((await gitCli("add", "pointer-conflict", "Pointer Conflict", "--task", "TKA")).code, 0);
      const ensureConflict = await ensureManagedWorktree({ root: gitRoot, id: "pointer-conflict", base: "main" });
      const planConflict = ".agents/plans/2026-07-15-pointer-conflict.md";
      const stagedConflict = `---\nid: pointer-conflict\nstatus: draft\npm_loop: true\nbase_branch: main\nbase_commit: ${ensureConflict.base_commit}\nbranch: ${ensureConflict.branch}\nworktree: ${ensureConflict.worktree}\n---\n# Pointer conflict\n`;
      await stagePlan({ root: gitRoot, id: "pointer-conflict", content: stagedConflict });
      await assert.rejects(
        ops.createPlanAndBacklogItem(
          ensureConflict.execution_root,
          "TKA",
          { id: "pointer-conflict", title: "Pointer Conflict" },
          planConflict,
          { retries: 0, transaction: { crashAt: "committed" } },
        ),
        /simulated process crash at committed/,
      );
      await writeFile(join(ensureConflict.execution_root, ".agents/state/current.txt"), "foreign-plan.md\n");
      await assert.rejects(
        ops.createPlanAndBacklogItem(
          ensureConflict.execution_root,
          "TKA",
          { id: "pointer-conflict", title: "Pointer Conflict" },
          planConflict,
          { retries: 0 },
        ),
        /target current conflict: foreign-plan\.md/,
      );
      assert.equal((await read(ensureConflict.execution_root, ".agents/state/current.txt")).trim(), "foreign-plan.md");
      assert.notEqual(await read(gitRoot, ".agents/worktree-reservations/pointer-conflict.json"), "", "pointer conflict retains reservation");

      const ensureA = await ensureManagedWorktree({ root: gitRoot, id: "reserved-a", base: "main" });
      const targetCliA = (...a: string[]) => runCli(ensureA.execution_root, a);
      const planReservedA = ".agents/plans/2026-06-22-reserved-a.md";
      const stagedA = `---\nid: reserved-a\nstatus: draft\npm_loop: true\nbase_branch: main\nbase_commit: ${ensureA.base_commit}\nbranch: ${ensureA.branch}\nworktree: ${ensureA.worktree}\n---\n# A\n`;
      await stagePlan({ root: gitRoot, id: "reserved-a", content: stagedA });
      const reservationA = await read(gitRoot, ".agents/worktree-reservations/reserved-a.json");
      await assert.rejects(gitCli("persist", "TKA", "reserved-a", planReservedA, "--title", "Reserved A"), /execution root mismatch/);
      const persistedA = await targetCliA("persist", "TKA", "reserved-a", planReservedA, "--title", "Reserved A");
      assert.match(persistedA.out, /^persisted_selected /);
      assert.equal(await read(gitRoot, planReservedA), stagedA, "canonical plan created from staged bytes");
      assert.equal((await read(gitRoot, ".agents/state/current.txt")).trim(), planReservedA);
      assert.equal((await read(ensureA.execution_root, ".agents/state/current.txt")).trim(), planReservedA);
      assert.equal(await read(gitRoot, ".agents/worktree-reservations/reserved-a.json"), "", "reservation removed last");

      // Crash after stage cleanup but before reservation cleanup reconciles from the exact canonical owner.
      await writeFile(reservationPaths(gitRoot, "reserved-a").json, reservationA);
      assert.equal(await read(gitRoot, ".agents/worktree-reservations/reserved-a.plan.md"), "", "stage is already absent");
      const retriedA = await targetCliA("persist", "TKA", "reserved-a", planReservedA, "--title", "Reserved A");
      assert.match(retriedA.out, /^persisted_selected /);
      assert.equal(await read(gitRoot, ".agents/worktree-reservations/reserved-a.json"), "", "retry removes the residual reservation");
      await assert.rejects(gitCli("persist", "TKA", "reserved-a", planReservedA, "--title", "Reserved A"), /execution root mismatch/, "reservation-free retry still rejects main");
      assert.match((await targetCliA("persist", "TKA", "reserved-a", planReservedA, "--title", "Reserved A")).out, /^persisted_selected /, "reservation-free target retry converges");

      await assert.rejects(gitCli("approve", "TKA", "reserved-a"), /execution root mismatch/);
      await assert.rejects(gitCli("worktree", "prune", "--plan", planReservedA), /non-terminal plan/, "PM CLI cannot prune an active owner");
      assert.equal((await targetCliA("approve", "TKA", "reserved-a")).code, 0);
      const pointerOther = await ensureManagedWorktree({ root: gitRoot, id: "pointer-other", base: "main" });
      await writeFile(join(pointerOther.execution_root, ".agents/state/current.txt"), "unrelated.md\n");
      await assert.rejects(gitCli("complete", "TKA", "reserved-a", "--plan", planReservedA, "--status", "done"), /execution root mismatch/);
      assert.equal((await targetCliA("complete", "TKA", "reserved-a", "--plan", planReservedA, "--status", "done")).code, 0);
      assert.equal((await read(gitRoot, ".agents/state/current.txt")).trim(), "", "matching main pointer cleared");
      assert.equal((await read(ensureA.execution_root, ".agents/state/current.txt")).trim(), "", "matching execution pointer cleared");
      assert.equal((await read(pointerOther.execution_root, ".agents/state/current.txt")).trim(), "unrelated.md", "unrelated worktree selection survives");
      const prunedA = await gitCli("worktree", "prune", "--plan", planReservedA);
      assert.equal(prunedA.code, 0);
      assert.equal(JSON.parse(prunedA.out).removed, true, "PM CLI prunes only after the plan is terminal and pointers are clear");
      assert.equal(git("show-ref", "--verify", `refs/heads/${ensureA.branch}`).length > 0, true, "terminal prune keeps the branch");

      const ensureB = await ensureManagedWorktree({ root: gitRoot, id: "reserved-b", base: "main" });
      const targetCliB = (...a: string[]) => runCli(ensureB.execution_root, a);
      const planReservedB = ".agents/plans/2026-06-22-reserved-b.md";
      const stagedB = `---\nid: reserved-b\nstatus: draft\npm_loop: true\nbase_branch: main\nbase_commit: ${ensureB.base_commit}\nbranch: ${ensureB.branch}\nworktree: ${ensureB.worktree}\n---\n# B\n`;
      await stagePlan({ root: gitRoot, id: "reserved-b", content: stagedB });
      await writeFile(join(gitRoot, ".agents", "state", "current.txt"), "newer.md\n");
      const persistedB = await targetCliB("persist", "TKA", "reserved-b", planReservedB, "--title", "Reserved B");
      assert.match(persistedB.out, /^persisted_parked /);
      assert.equal((await read(gitRoot, ".agents/state/current.txt")).trim(), "newer.md", "newer main selection survives");
      assert.equal((await read(ensureB.execution_root, ".agents/state/current.txt")).trim(), planReservedB, "parked plan still owns target");
      const retriedB = await targetCliB("persist", "TKA", "reserved-b", planReservedB, "--title", "Reserved B");
      assert.match(retriedB.out, /^persisted_parked /, "retry converges without inventing a new main expectation");
      assert.equal((await read(gitRoot, ".agents/state/current.txt")).trim(), "newer.md", "retry preserves the newer selection");
      assert.equal((await gitCli("select", "--plan", planReservedB)).code, 0, "explicit selection may replace it later");
      assert.equal((await read(gitRoot, ".agents/state/current.txt")).trim(), planReservedB);

      const ensureStandalone = await ensureManagedWorktree({ root: gitRoot, id: "reserved-standalone", base: "main" });
      const targetStandalone = (...a: string[]) => runCli(ensureStandalone.execution_root, a);
      const planStandalone = ".agents/plans/2026-06-22-reserved-standalone.md";
      const stagedStandalone = `---\nid: reserved-standalone\nstatus: draft\npm_loop: false\nbase_branch: main\nbase_commit: ${ensureStandalone.base_commit}\nbranch: ${ensureStandalone.branch}\nworktree: ${ensureStandalone.worktree}\n---\n# Standalone\n`;
      await stagePlan({ root: gitRoot, id: "reserved-standalone", content: stagedStandalone });
      const standalonePersist = await targetStandalone("persist", "--standalone", "--id", "reserved-standalone", "--plan", planStandalone);
      assert.match(standalonePersist.out, /^persisted_selected standalone /);
      await assert.rejects(gitCli("persist", "--standalone", "--id", "reserved-standalone", "--plan", planStandalone), /execution root mismatch/, "standalone retry rejects main after reservation cleanup");
      assert.match((await targetStandalone("persist", "--standalone", "--id", "reserved-standalone", "--plan", planStandalone)).out, /^persisted_selected standalone /);
      assert.equal((await gitCli("get", "reserved-standalone")).code, 1, "standalone persistence creates no task item");
      assert.equal((await targetStandalone("approve", "--standalone", "--plan", planStandalone)).code, 0);
      assert.equal((await targetStandalone("complete", "--standalone", "--plan", planStandalone, "--status", "done")).code, 0);
      assert.equal((await read(gitRoot, ".agents/state/current.txt")).trim(), "");
      assert.equal((await read(ensureStandalone.execution_root, ".agents/state/current.txt")).trim(), "");
    } finally {
      await rm(gitRoot, { recursive: true, force: true });
    }

    console.log("lifecycle.test.ts OK");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
