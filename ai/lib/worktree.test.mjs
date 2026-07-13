import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  adoptPlan,
  cancelProvisional,
  ensureManagedWorktree,
  ensureCurrent,
  reservationPaths,
  resolveCurrent,
  validateManagedWorktrees,
  writeCurrentCAS,
  pruneManagedWorktree,
} from "./worktree.mjs";
import { acquireLock, releaseLock } from "../skills/pm-roadmap/store.ts";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "worktree-engine-"));
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  await writeFile(join(root, "README.md"), "main\n");
  git(root, "add", "README.md");
  git(root, "commit", "-m", "main");
  git(root, "checkout", "-b", "release/test");
  await writeFile(join(root, "BASE.txt"), "alternate\n");
  git(root, "add", "BASE.txt");
  git(root, "commit", "-m", "alternate base");
  const baseCommit = git(root, "rev-parse", "HEAD");
  git(root, "checkout", "main");
  await mkdir(join(root, ".agents", "tasks"), { recursive: true });
  await mkdir(join(root, ".agents", "plans"), { recursive: true });
  await mkdir(join(root, ".agents", "state"), { recursive: true });
  return { root, baseCommit };
}

test("alternate-base ensure creates one reusable managed worktree with shared/local topology", async (t) => {
  const { root, baseCommit } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const first = await ensureManagedWorktree({ root, id: "feature-a", base: "release/test" });
  assert.equal(first.base_commit, baseCommit);
  assert.equal(git(first.execution_root, "rev-parse", "HEAD"), baseCommit);
  assert.equal(git(first.execution_root, "branch", "--show-current"), "agent/feature-a");
  assert.equal(await realpath(join(first.execution_root, ".agents", "tasks")), await realpath(join(root, ".agents", "tasks")));
  assert.equal(await realpath(join(first.execution_root, ".agents", "plans")), await realpath(join(root, ".agents", "plans")));
  assert.equal((await stat(join(first.execution_root, ".agents", "state"))).isDirectory(), true);

  const countBefore = git(root, "worktree", "list", "--porcelain").match(/^worktree /gm)?.length;
  const second = await ensureManagedWorktree({ root, id: "feature-a", base: "release/test" });
  const countAfter = git(root, "worktree", "list", "--porcelain").match(/^worktree /gm)?.length;
  assert.equal(second.execution_root, first.execution_root);
  assert.equal(countAfter, countBefore);
  await assert.rejects(
    ensureManagedWorktree({ root, id: "feature-other", base: "main", branch: first.branch }),
    /already checked out/,
  );
  await assert.rejects(
    ensureManagedWorktree({ root, id: "feature-other", base: "main", branch: "agent/feature-other", worktree: first.worktree }),
    /occupied by branch/,
  );
  await assert.rejects(
    ensureManagedWorktree({ root, id: "outside-managed-root", base: "main", worktree: "elsewhere/outside" }),
    /must be below/,
  );
});

test("managed topology repairs wrong links and refuses non-empty real shared paths", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const repairedPath = join(root, ".agents", "worktrees", "repair-links");
  git(root, "worktree", "add", "-b", "agent/repair-links", repairedPath, "main");
  await mkdir(join(repairedPath, ".agents"), { recursive: true });
  await symlink("missing-tasks", join(repairedPath, ".agents", "tasks"));
  await symlink("missing-plans", join(repairedPath, ".agents", "plans"));
  const repaired = await ensureManagedWorktree({ root, id: "repair-links", base: "main" });
  assert.equal(await realpath(join(repaired.execution_root, ".agents", "tasks")), await realpath(join(root, ".agents", "tasks")));
  assert.equal(await realpath(join(repaired.execution_root, ".agents", "plans")), await realpath(join(root, ".agents", "plans")));

  const conflictPath = join(root, ".agents", "worktrees", "store-conflict");
  git(root, "worktree", "add", "-b", "agent/store-conflict", conflictPath, "main");
  await mkdir(join(conflictPath, ".agents", "tasks"), { recursive: true });
  await writeFile(join(conflictPath, ".agents", "tasks", "local.md"), "do not delete\n");
  await assert.rejects(ensureManagedWorktree({ root, id: "store-conflict", base: "main" }), /store conflict/);
  assert.equal(await readFile(join(conflictPath, ".agents", "tasks", "local.md"), "utf8"), "do not delete\n");
});

test("current resolution routes main to mapped worktree and uses immutable base commit", async (t) => {
  const { root, baseCommit } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const ensured = await ensureManagedWorktree({ root, id: "feature-b", base: "release/test" });
  const planRel = ".agents/plans/2026-07-13-feature-b.md";
  await writeFile(join(root, planRel), `---\nid: feature-b\nstatus: draft\nbase_branch: release/test\nbase_commit: ${baseCommit}\nbranch: ${ensured.branch}\nworktree: ${ensured.worktree}\n---\n`);
  await writeFile(join(root, ".agents", "state", "current.txt"), `${planRel}\n`);
  await writeFile(join(ensured.execution_root, ".agents", "state", "current.txt"), `${planRel}\n`);

  git(root, "branch", "-f", "release/test", "main");
  const resolved = await resolveCurrent(root);
  assert.equal(resolved.status, "ok");
  assert.equal(resolved.execution_root, ensured.execution_root);
  assert.equal(resolved.base_commit, baseCommit);
  assert.equal(resolved.route_required, true);

  const fromExecutionRoot = await resolveCurrent(ensured.execution_root);
  assert.equal(fromExecutionRoot.status, "ok");
  assert.equal(fromExecutionRoot.route_required, false, "mapped worktree is already rooted");

  const wrong = await ensureManagedWorktree({ root, id: "feature-wrong", base: "main" });
  await writeFile(join(wrong.execution_root, ".agents", "state", "current.txt"), `${planRel}\n`);
  const fromWrongWorktree = await resolveCurrent(wrong.execution_root);
  assert.equal(fromWrongWorktree.status, "ok");
  assert.equal(fromWrongWorktree.execution_root, ensured.execution_root);
  assert.equal(fromWrongWorktree.route_required, true, "wrong worktree routes to the mapped owner");

  const legacyRel = ".agents/plans/2026-07-13-legacy.md";
  await writeFile(join(root, legacyRel), "---\nid: legacy\nstatus: draft\n---\n");
  await writeFile(join(wrong.execution_root, ".agents", "state", "current.txt"), `${legacyRel}\n`);
  const legacy = await resolveCurrent(wrong.execution_root);
  assert.equal(legacy.status, "legacy_unmapped");

  await writeFile(join(wrong.execution_root, ".agents", "state", "current.txt"), `${planRel}\n`);
  const repaired = await ensureCurrent({ root: wrong.execution_root });
  assert.equal(repaired.status, "ok");
  assert.equal(await readFile(join(wrong.execution_root, ".agents", "state", "current.txt"), "utf8"), "", "wrong local pointer is cleared");
  assert.equal(await readFile(join(root, ".agents", "state", "current.txt"), "utf8"), `${planRel}\n`, "main launcher selection is retained");

  await writeFile(join(root, planRel), (await readFile(join(root, planRel), "utf8")).replace("status: draft", "status: done"));
  const terminal = await ensureCurrent({ root });
  assert.equal(terminal.status, "terminal");
  assert.equal(await readFile(join(root, ".agents", "state", "current.txt"), "utf8"), "", "terminal exact-match launcher pointer is cleared");
});

test("pointer CAS preserves a newer selection", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const pointer = join(root, ".agents", "state", "current.txt");
  await writeFile(pointer, "newer.md\n");
  const result = await writeCurrentCAS(root, "older.md", "target.md");
  assert.deepEqual(result, { updated: false, current: "newer.md", reason: "cas_conflict" });
  assert.equal(await readFile(pointer, "utf8"), "newer.md\n");

  await writeFile(pointer, "observed.md\n");
  const concurrent = await Promise.all([
    writeCurrentCAS(root, "observed.md", "winner-a.md"),
    writeCurrentCAS(root, "observed.md", "winner-b.md"),
  ]);
  assert.equal(concurrent.filter((entry) => entry.updated).length, 1);
  assert.equal(concurrent.filter((entry) => entry.reason === "cas_conflict").length, 1);
  const selected = (await readFile(pointer, "utf8")).trim();
  assert.ok(selected === "winner-a.md" || selected === "winner-b.md");
});

test("legacy adoption maps a clean main checkout", async (t) => {
    const { root } = await fixture();
    t.after(() => rm(root, { recursive: true, force: true }));
    const planRel = ".agents/plans/2026-07-13-adopt-clean.md";
    await writeFile(join(root, planRel), "---\nid: adopt-clean\ntitle: Adopt legacy\nstatus: draft\n---\n");

    const adopted = await adoptPlan({ root, plan: planRel, base: "main", select: true });
    const markdown = await readFile(join(root, planRel), "utf8");
    assert.match(markdown, new RegExp(`base_commit: ${adopted.base_commit}`));
    assert.match(markdown, new RegExp(`branch: ${adopted.branch.replace("/", "\\/")}`));
    assert.match(markdown, new RegExp(`worktree: ${adopted.worktree.replaceAll("/", "\\/")}`));
    assert.equal((await resolveCurrent(root)).status, "ok");
    assert.equal(git(root, "status", "--short"), "");
});

test("legacy adoption rejects a dirty main checkout without creating ownership", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const planRel = ".agents/plans/2026-07-13-adopt-dirty.md";
  const original = "---\nid: adopt-dirty\ntitle: Adopt legacy\nstatus: draft\n---\n";
  await writeFile(join(root, planRel), original);
  await writeFile(join(root, "README.md"), "uncommitted main edit\n");
  const beforeCount = listCount(root);

  await assert.rejects(adoptPlan({ root, plan: planRel, base: "main", select: true }), /dirty main checkout/);
  assert.equal(await readFile(join(root, planRel), "utf8"), original);
  assert.equal(listCount(root), beforeCount);
  assert.equal(await readFile(reservationPaths(root, "adopt-dirty").json, "utf8").catch(() => ""), "");
});

test("provisional cancellation shares the PM lock and rechecks durable plan ownership", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const ensured = await ensureManagedWorktree({ root, id: "cancel-race", base: "main" });
  await acquireLock(root, "test-barrier", { retries: 0 });
  const cancellation = cancelProvisional({ root, id: "cancel-race" });
  const planRel = ".agents/plans/2026-07-13-cancel-race.md";
  await writeFile(join(root, planRel), `---\nid: cancel-race\nstatus: draft\nbase_branch: main\nbase_commit: ${ensured.base_commit}\nbranch: ${ensured.branch}\nworktree: ${ensured.worktree}\n---\n`);
  await releaseLock(root);
  const result = await cancellation;
  assert.equal(result.reason, "owned_by_plan");
  assert.equal(git(root, "worktree", "list", "--porcelain").includes(ensured.execution_root), true);
  assert.equal((await readFile(reservationPaths(root, "cancel-race").json, "utf8")).length > 0, true);
});

test("provisional cancellation removes only clean commit-free worktrees", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const clean = await ensureManagedWorktree({ root, id: "cancel-clean", base: "main" });
  assert.equal((await cancelProvisional({ root, id: "cancel-clean" })).reason, "cancelled");
  assert.equal(git(root, "worktree", "list", "--porcelain").includes(clean.execution_root), false);

  const dirty = await ensureManagedWorktree({ root, id: "cancel-dirty", base: "main" });
  await writeFile(join(dirty.execution_root, "DIRTY.txt"), "dirty\n");
  assert.equal((await cancelProvisional({ root, id: "cancel-dirty" })).reason, "dirty");

  const committed = await ensureManagedWorktree({ root, id: "cancel-committed", base: "main" });
  await writeFile(join(committed.execution_root, "COMMITTED.txt"), "commit\n");
  git(committed.execution_root, "add", "COMMITTED.txt");
  git(committed.execution_root, "commit", "-m", "work");
  assert.equal((await cancelProvisional({ root, id: "cancel-committed" })).reason, "committed");

  const current = await ensureManagedWorktree({ root, id: "cancel-current", base: "main" });
  await writeFile(join(current.execution_root, ".agents", "state", "current.txt"), "in-flight.md\n");
  assert.equal((await cancelProvisional({ root, id: "cancel-current" })).reason, "current");
  assert.equal(git(root, "worktree", "list", "--porcelain").includes(current.execution_root), true);
});

test("validation reports provisional, abandoned, handoff, and orphan reservation states", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const clean = await ensureManagedWorktree({ root, id: "validate-clean", base: "main" });
  let report = await validateManagedWorktrees(root);
  assert.equal(report.ok, true);
  assert.deepEqual(report.reservations.find((entry) => entry.id === "validate-clean")?.state, "provisional");

  await writeFile(join(clean.execution_root, "DIRTY.txt"), "dirty\n");
  report = await validateManagedWorktrees(root);
  assert.equal(report.issues.some((issue) => issue.code === "abandoned_reservation_dirty" && issue.id === "validate-clean"), true);
  await rm(join(clean.execution_root, "DIRTY.txt"));

  const planRel = ".agents/plans/2026-07-13-validate-clean.md";
  await writeFile(join(root, planRel), `---\nid: validate-clean\nstatus: draft\nbase_branch: main\nbase_commit: ${clean.base_commit}\nbranch: ${clean.branch}\nworktree: ${clean.worktree}\n---\n`);
  report = await validateManagedWorktrees(root);
  assert.equal(report.issues.some((issue) => issue.code === "reservation_handoff_pending" && issue.plan === planRel), true);

  await writeFile(join(root, ".agents", "plans", "legacy-unmapped.md"), "---\nid: legacy-unmapped\nstatus: draft\n---\n");
  assert.equal((await validateManagedWorktrees(root)).issues.some((issue) => issue.plan?.endsWith("legacy-unmapped.md")), false, "default validates current plus reservations");
  assert.equal((await validateManagedWorktrees(root, { all: true })).issues.some((issue) => issue.code === "unmapped_plan" && issue.plan.endsWith("legacy-unmapped.md")), true, "--all audits every non-terminal plan");

  const reservationDir = join(root, ".agents", "worktree-reservations");
  await writeFile(join(reservationDir, "orphan.plan.md"), "orphan\n");
  await writeFile(join(reservationDir, "stage.plan.md.tmp-123"), "temp\n");
  report = await validateManagedWorktrees(root);
  assert.equal(report.issues.some((issue) => issue.code === "orphan_reservation_stage" && issue.id === "orphan"), true);
  assert.equal(report.issues.some((issue) => issue.code === "orphan_reservation_temp"), true);
});

test("prune requires a terminal plan, refuses current/dirty worktrees, and preserves the branch", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const ensured = await ensureManagedWorktree({ root, id: "feature-c", base: "main" });
  await unlink(reservationPaths(root, "feature-c").json);
  const planRel = ".agents/plans/2026-07-13-feature-c.md";
  const active = `---\nid: feature-c\nstatus: active\nbase_branch: main\nbase_commit: ${ensured.base_commit}\nbranch: ${ensured.branch}\nworktree: ${ensured.worktree}\n---\n`;
  await writeFile(join(root, planRel), active);
  await assert.rejects(pruneManagedWorktree({ root, plan: planRel }), /non-terminal plan/);

  await writeFile(join(root, planRel), active.replace("status: active", "status: done"));
  await writeFile(join(ensured.execution_root, "DIRTY.txt"), "keep\n");
  await assert.rejects(pruneManagedWorktree({ root, plan: planRel }), /dirty/);
  await rm(join(ensured.execution_root, "DIRTY.txt"));
  await writeFile(join(ensured.execution_root, ".agents", "state", "current.txt"), `${planRel}\n`);
  await assert.rejects(pruneManagedWorktree({ root, plan: planRel }), /current pointer/);
  await writeFile(join(ensured.execution_root, ".agents", "state", "current.txt"), "");
  const pruned = await pruneManagedWorktree({ root, plan: planRel });
  assert.equal(pruned.removed, true);
  assert.equal(git(root, "show-ref", "--verify", `refs/heads/${ensured.branch}`).length > 0, true);
});

function listCount(root) {
  return git(root, "worktree", "list", "--porcelain").match(/^worktree /gm)?.length ?? 0;
}
