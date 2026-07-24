// lifecycle.test.ts — exercises the two /design + /retro lifecycle paths through the
// REAL CLI (runCli → ops), proving the documented hooks produce coherent end-states and
// leave the validator clean. Run: ./node_modules/.bin/tsx lifecycle.test.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./pm-roadmap.ts";
import * as ops from "./ops.ts";
import { ensureManagedWorktree, reservationPaths, stagePlan } from "../../lib/worktree.mjs";
import { acquireOwnerLock, releaseOwnerLock } from "../../lib/owner-lock.mjs";

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
    const persistedLegacy = await cli("persist", "TKA", "feat-a", planA, "--title", "Feature A");
    assert.equal(persistedLegacy.code, 0);
    assert.match(persistedLegacy.out, /^persisted_legacy /, "uncontended legacy persist keeps its existing outcome");
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

    // A launcher race after the legacy plan/item transaction parks the result instead
    // of falsely claiming that it selected the plan.
    const legacyRacePlan = ".agents/plans/2026-07-24-legacy-race.md";
    await writePlan(root, legacyRacePlan);
    const legacyBarrier = await acquireOwnerLock(join(root, ".agents/state/current.lock"), {
      operation: "test-legacy-persist-current-race",
      retries: 0,
    });
    const legacyRace = ops.createPlanAndBacklogItem(
      root,
      "TKA",
      { id: "legacy-race", title: "Legacy race" },
      legacyRacePlan,
      { retries: 0 },
    );
    for (let attempt = 0; attempt < 400 && !(await read(root, ".agents/tasks/TKA/backlog.md")).includes("legacy-race"); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    await writeFile(join(root, ".agents/state/current.txt"), "newer-legacy.md\n");
    await releaseOwnerLock(legacyBarrier);
    const legacyRaceResult = await legacyRace;
    assert.equal(legacyRaceResult.outcome, "persisted_parked");
    assert.equal((await read(root, ".agents/state/current.txt")).trim(), "newer-legacy.md");
    await writeFile(join(root, ".agents/state/current.txt"), "");

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

      await writeFile(join(ensureA.execution_root, ".agents/state/current.txt"), "");
      const mappedRetryBarrier = await acquireOwnerLock(join(ensureA.execution_root, ".agents/state/current.lock"), {
        operation: "test-mapped-owner-current-race",
        retries: 0,
      });
      const racedMappedRetry = ops.createPlanAndBacklogItem(
        ensureA.execution_root,
        "TKA",
        { id: "reserved-a", title: "Reserved A" },
        planReservedA,
        { retries: 0 },
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      await writeFile(join(ensureA.execution_root, ".agents/state/current.txt"), "newer-mapped-owner.md\n");
      await releaseOwnerLock(mappedRetryBarrier);
      await assert.rejects(racedMappedRetry, /target pointer reconciliation failed: newer-mapped-owner\.md/);
      assert.equal((await read(ensureA.execution_root, ".agents/state/current.txt")).trim(), "newer-mapped-owner.md");
      await writeFile(join(ensureA.execution_root, ".agents/state/current.txt"), `${planReservedA}\n`);

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

      const targetRacePlan = ".agents/plans/2026-07-24-target-race-winner.md";
      await writeFile(join(gitRoot, targetRacePlan), "---\nid: target-race-winner\nstatus: active\npm_loop: false\n---\n");
      await writeFile(join(gitRoot, ".agents/state/current.txt"), "main-before-target-race.md\n");
      await writeFile(join(ensureB.execution_root, ".agents/state/current.txt"), "");
      const targetRaceSelection = await ops.selectPlan(gitRoot, planReservedB, {
        retries: 0,
        transaction: {
          id: "select-target-race",
          beforeApply: async (target: { path: string }) => {
            if ((target as { root?: string }).root !== await realpath(ensureB.execution_root) || target.path !== ".agents/state/current.txt") return;
            await writeFile(join(ensureB.execution_root, ".agents/state/current.txt"), `${targetRacePlan}\n`);
          },
        } as any,
      });
      assert.equal(targetRaceSelection.selected, false, "target apply race rejects selection");
      assert.match(targetRaceSelection.reason, /selection conflict/);
      assert.equal((await read(gitRoot, ".agents/state/current.txt")).trim(), "main-before-target-race.md", "target race leaves main unchanged");
      assert.equal((await read(ensureB.execution_root, ".agents/state/current.txt")).trim(), targetRacePlan, "target race preserves the newer target pointer");

      await writeFile(join(gitRoot, ".agents/state/current.txt"), "main-before-main-race.md\n");
      await writeFile(join(ensureB.execution_root, ".agents/state/current.txt"), "target-before-main-race.md\n");
      const mainRaceSelection = await ops.selectPlan(gitRoot, planReservedB, {
        retries: 0,
        transaction: {
          id: "select-main-race",
          beforeApply: async (target: { path: string }) => {
            if ((target as { root?: string }).root !== await realpath(gitRoot) || target.path !== ".agents/state/current.txt") return;
            await writeFile(join(gitRoot, ".agents/state/current.txt"), "newer-main-race.md\n");
          },
        } as any,
      });
      assert.equal(mainRaceSelection.selected, false, "main apply race rejects selection");
      assert.match(mainRaceSelection.reason, /selection conflict/);
      assert.equal((await read(gitRoot, ".agents/state/current.txt")).trim(), "newer-main-race.md", "main race preserves the newer launcher");
      assert.equal((await read(ensureB.execution_root, ".agents/state/current.txt")).trim(), "target-before-main-race.md", "main race rolls target back");

      const terminalSelectPlan = ".agents/plans/2026-07-24-terminal-select.md";
      await writeFile(join(gitRoot, terminalSelectPlan), `---\nid: terminal-select\nstatus: done\npm_loop: false\nbase_branch: main\nbase_commit: ${ensureB.base_commit}\nbranch: ${ensureB.branch}\nworktree: ${ensureB.worktree}\n---\n`);
      await writeFile(join(gitRoot, ".agents/state/current.txt"), "main-before-terminal.md\n");
      await writeFile(join(ensureB.execution_root, ".agents/state/current.txt"), "target-before-terminal.md\n");
      const terminalSelection = await ops.selectPlan(gitRoot, terminalSelectPlan, { retries: 0 });
      assert.equal(terminalSelection.selected, false);
      assert.equal(terminalSelection.reason, "plan is not selectable: done");
      assert.equal((await read(gitRoot, ".agents/state/current.txt")).trim(), "main-before-terminal.md");
      assert.equal((await read(ensureB.execution_root, ".agents/state/current.txt")).trim(), "target-before-terminal.md");

      assert.equal((await gitCli("select", "--plan", planReservedB)).code, 0, "explicit selection may replace it later");
      assert.equal((await read(gitRoot, ".agents/state/current.txt")).trim(), planReservedB);
      assert.equal((await read(ensureB.execution_root, ".agents/state/current.txt")).trim(), planReservedB);

      const ensureLinkedCrash = await ensureManagedWorktree({ root: gitRoot, id: "reserved-linked-crash", base: "main" });
      const targetLinkedCrash = (...a: string[]) => runCli(ensureLinkedCrash.execution_root, a);
      const planLinkedCrash = ".agents/plans/2026-07-24-reserved-linked-crash.md";
      const stagedLinkedCrash = `---\nid: reserved-linked-crash\nstatus: draft\npm_loop: true\nbase_branch: main\nbase_commit: ${ensureLinkedCrash.base_commit}\nbranch: ${ensureLinkedCrash.branch}\nworktree: ${ensureLinkedCrash.worktree}\n---\n# Linked crash\n`;
      await stagePlan({ root: gitRoot, id: "reserved-linked-crash", content: stagedLinkedCrash });
      assert.match((await targetLinkedCrash("persist", "TKA", "reserved-linked-crash", planLinkedCrash, "--title", "Linked crash")).out, /^persisted_selected /);
      assert.equal((await targetLinkedCrash("approve", "TKA", "reserved-linked-crash")).code, 0);
      await assert.rejects(
        ops.completePlanFromRetro(ensureLinkedCrash.execution_root, "TKA", "reserved-linked-crash", {
          planPath: planLinkedCrash,
          terminalStatus: "done",
          closedDate: "2026-07-24",
          retries: 0,
          transaction: { id: "linked-committed-crash", crashAt: "committed" },
        }),
        /simulated process crash at committed/,
      );
      await ops.reservedIds(ensureLinkedCrash.execution_root, { retries: 0 });
      assert.match(await read(gitRoot, planLinkedCrash), /status: done/);
      assert.match(await read(gitRoot, ".agents/tasks/TKA/closed.md"), /reserved-linked-crash/);
      assert.equal((await read(gitRoot, ".agents/state/current.txt")).trim(), "", "linked committed recovery clears matching launcher");
      assert.equal((await read(ensureLinkedCrash.execution_root, ".agents/state/current.txt")).trim(), "", "linked committed recovery clears matching execution pointer");
      assert.equal((await read(pointerOther.execution_root, ".agents/state/current.txt")).trim(), "unrelated.md", "linked recovery preserves unrelated pointer");
      await writeFile(join(gitRoot, ".agents/state/current.txt"), `${planReservedB}\n`);

      const ensureStandaloneRace = await ensureManagedWorktree({ root: gitRoot, id: "reserved-standalone-race", base: "main" });
      const planStandaloneRace = ".agents/plans/2026-07-24-reserved-standalone-race.md";
      const stagedStandaloneRace = `---\nid: reserved-standalone-race\nstatus: draft\npm_loop: false\nbase_branch: main\nbase_commit: ${ensureStandaloneRace.base_commit}\nbranch: ${ensureStandaloneRace.branch}\nworktree: ${ensureStandaloneRace.worktree}\n---\n# Standalone race\n`;
      await stagePlan({ root: gitRoot, id: "reserved-standalone-race", content: stagedStandaloneRace });
      const standaloneBarrier = await acquireOwnerLock(join(ensureStandaloneRace.execution_root, ".agents/state/current.lock"), {
        operation: "test-standalone-current-race",
        retries: 0,
      });
      const racedStandalone = ops.createStandalonePlan(
        ensureStandaloneRace.execution_root,
        "reserved-standalone-race",
        planStandaloneRace,
        { retries: 0 },
      );
      for (let attempt = 0; attempt < 400 && !(await read(gitRoot, planStandaloneRace)); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      await writeFile(join(ensureStandaloneRace.execution_root, ".agents/state/current.txt"), "newer-standalone.md\n");
      await releaseOwnerLock(standaloneBarrier);
      await assert.rejects(racedStandalone, /target pointer reconciliation failed: newer-standalone\.md/);
      assert.equal((await read(gitRoot, ".agents/state/current.txt")).trim(), planReservedB, "standalone target conflict does not select main");
      assert.notEqual(await read(gitRoot, ".agents/worktree-reservations/reserved-standalone-race.json"), "", "standalone target conflict retains reservation");
      assert.notEqual(await read(gitRoot, ".agents/worktree-reservations/reserved-standalone-race.plan.md"), "", "standalone target conflict retains staged bytes");

      const ensureStandaloneCrash = await ensureManagedWorktree({ root: gitRoot, id: "reserved-standalone-crash", base: "main" });
      const targetStandaloneCrash = (...a: string[]) => runCli(ensureStandaloneCrash.execution_root, a);
      const planStandaloneCrash = ".agents/plans/2026-07-24-reserved-standalone-crash.md";
      const stagedStandaloneCrash = `---\nid: reserved-standalone-crash\nstatus: draft\npm_loop: false\nbase_branch: main\nbase_commit: ${ensureStandaloneCrash.base_commit}\nbranch: ${ensureStandaloneCrash.branch}\nworktree: ${ensureStandaloneCrash.worktree}\n---\n# Standalone crash\n`;
      await stagePlan({ root: gitRoot, id: "reserved-standalone-crash", content: stagedStandaloneCrash });
      assert.match((await targetStandaloneCrash("persist", "--standalone", "--id", "reserved-standalone-crash", "--plan", planStandaloneCrash)).out, /^persisted_selected standalone /);
      assert.equal((await targetStandaloneCrash("approve", "--standalone", "--plan", planStandaloneCrash)).code, 0);
      await assert.rejects(
        ops.standaloneComplete(ensureStandaloneCrash.execution_root, planStandaloneCrash, "done", {
          retries: 0,
          transaction: { id: "standalone-committed-crash", crashAt: "committed" },
        }),
        /simulated process crash at committed/,
      );
      await ops.reservedIds(ensureStandaloneCrash.execution_root, { retries: 0 });
      assert.match(await read(gitRoot, planStandaloneCrash), /status: done/);
      assert.equal((await read(gitRoot, ".agents/state/current.txt")).trim(), "", "committed recovery clears matching main pointer");
      assert.equal((await read(ensureStandaloneCrash.execution_root, ".agents/state/current.txt")).trim(), "", "committed recovery clears matching execution pointer");

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
