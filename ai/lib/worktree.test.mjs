import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  adoptPlan,
  bindSession,
  cancelProvisional,
  ensureManagedWorktree,
  ensureCurrent,
  ensureSession,
  reservationPaths,
  resolveCurrent,
  resolveSession,
  sessionBindingPaths,
  unbindSession,
  validateManagedWorktrees,
  withCurrentLocks,
  wireManagedStore,
  writeCurrentCAS,
  pruneManagedWorktree,
} from "./worktree.mjs";
import { acquireLock, releaseLock } from "../skills/pm-roadmap/store.ts";
import * as ops from "../skills/pm-roadmap/ops.ts";
import { acquireOwnerLock, inspectOwnerLock, releaseOwnerLock } from "./owner-lock.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "worktree-engine-")));
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

async function mappedPlan(root, id, { status = "draft" } = {}) {
  const ensured = await ensureManagedWorktree({ root, id, base: "main" });
  const plan = `.agents/plans/2026-07-22-${id}.md`;
  await writeFile(join(root, plan), `---\nid: ${id}\ntitle: ${id}\nstatus: ${status}\nbase_branch: main\nbase_commit: ${ensured.base_commit}\nbranch: ${ensured.branch}\nworktree: ${ensured.worktree}\n---\n`);
  await writeFile(join(ensured.execution_root, ".agents", "state", "current.txt"), `${plan}\n`);
  return { ...ensured, plan };
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

test("managed worktree creation rejects a symlinked physical escape before reservation or checkout writes", async (t) => {
  const { root } = await fixture();
  const outside = await realpath(await mkdtemp(join(tmpdir(), "managed-escape-outside-")));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  const managedRoot = join(root, ".agents", "worktrees");
  await mkdir(managedRoot, { recursive: true });
  await symlink(outside, join(managedRoot, "escape"), "dir");
  const reservationDir = reservationPaths(root, "symlink-escape").dir;
  assert.equal(await stat(reservationDir).then(() => true).catch(() => false), false, "preflight begins without reservation scaffolding");

  await assert.rejects(
    ensureManagedWorktree({
      root,
      id: "symlink-escape",
      base: "main",
      worktree: ".agents/worktrees/escape/child",
    }),
    /managed worktree.*physical boundary|symlinked managed worktree ancestor/,
  );
  assert.equal(await stat(join(outside, "child")).then(() => true).catch(() => false), false, "outside checkout was never created");
  assert.equal(await stat(reservationDir).then(() => true).catch(() => false), false, "rejected preflight creates no reservation directory");
  assert.equal(await stat(reservationPaths(root, "symlink-escape").json).then(() => true).catch(() => false), false, "reservation was never written");
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

test("ensure-current reports a typed target conflict when mapped target seeding loses its CAS", async (t) => {
  const { root, baseCommit } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const ensured = await ensureManagedWorktree({ root, id: "ensure-current-race", base: "main" });
  const planRel = ".agents/plans/2026-07-24-ensure-current-race.md";
  await writeFile(join(root, planRel), `---\nid: ensure-current-race\nstatus: draft\npm_loop: false\nbase_branch: main\nbase_commit: ${baseCommit}\nbranch: ${ensured.branch}\nworktree: ${ensured.worktree}\n---\n`);
  await unlink(reservationPaths(root, "ensure-current-race").json);
  await writeFile(join(root, ".agents", "state", "current.txt"), `${planRel}\n`);
  await writeFile(join(ensured.execution_root, ".agents", "state", "current.txt"), "");
  const newerRel = ".agents/plans/2026-07-24-newer-plan.md";
  await writeFile(join(root, newerRel), "---\nid: newer-plan\nstatus: active\npm_loop: false\n---\n");

  const barrier = await acquireOwnerLock(join(ensured.execution_root, ".agents", "state", "current.lock"), {
    operation: "test-ensure-current-race",
    retries: 0,
  });
  const pending = ensureCurrent({ root });
  const observed = pending.then(
    (result) => result,
    (error) => { throw error; },
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  await writeFile(join(ensured.execution_root, ".agents", "state", "current.txt"), `${newerRel}\n`);
  await releaseOwnerLock(barrier);

  const result = await observed;
  assert.equal(result.status, "pointer_conflict");
  assert.equal(result.failure_code, "target_current_changed");
  assert.equal(result.current, newerRel);
  assert.equal((await readFile(join(root, ".agents", "state", "current.txt"), "utf8")).trim(), planRel);
  assert.equal((await readFile(join(ensured.execution_root, ".agents", "state", "current.txt"), "utf8")).trim(), newerRel);
});

test("ensure-current reports a typed caller conflict when wrong-checkout cleanup loses its CAS", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const owner = await ensureManagedWorktree({ root, id: "caller-race-owner", base: "main" });
  const caller = await ensureManagedWorktree({ root, id: "caller-race-source", base: "main" });
  const planRel = ".agents/plans/2026-07-24-caller-race-owner.md";
  await writeFile(join(root, planRel), `---\nid: caller-race-owner\nstatus: draft\npm_loop: false\nbase_branch: main\nbase_commit: ${owner.base_commit}\nbranch: ${owner.branch}\nworktree: ${owner.worktree}\n---\n`);
  await unlink(reservationPaths(root, "caller-race-owner").json);
  await unlink(reservationPaths(root, "caller-race-source").json);
  await writeFile(join(root, ".agents", "state", "current.txt"), `${planRel}\n`);
  await writeFile(join(owner.execution_root, ".agents", "state", "current.txt"), `${planRel}\n`);
  await writeFile(join(caller.execution_root, ".agents", "state", "current.txt"), `${planRel}\n`);

  const barrier = await acquireOwnerLock(join(caller.execution_root, ".agents", "state", "current.lock"), {
    operation: "test-caller-cleanup-race",
    retries: 0,
  });
  const pending = ensureCurrent({ root: caller.execution_root });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await writeFile(join(caller.execution_root, ".agents", "state", "current.txt"), "foreign.md\n");
  await releaseOwnerLock(barrier);

  const result = await pending;
  assert.equal(result.status, "pointer_conflict");
  assert.equal(result.failure_code, "caller_current_changed");
  assert.equal(result.current, "foreign.md");
  assert.equal((await readFile(join(caller.execution_root, ".agents", "state", "current.txt"), "utf8")).trim(), "foreign.md");
});

test("ensure-current reports a typed caller conflict when terminal cleanup loses its CAS", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const planRel = ".agents/plans/2026-07-24-terminal-race.md";
  await writeFile(join(root, planRel), "---\nid: terminal-race\nstatus: done\npm_loop: false\n---\n");
  await writeFile(join(root, ".agents", "state", "current.txt"), `${planRel}\n`);

  const barrier = await acquireOwnerLock(join(root, ".agents", "state", "current.lock"), {
    operation: "test-terminal-cleanup-race",
    retries: 0,
  });
  const pending = ensureCurrent({ root });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await writeFile(join(root, ".agents", "state", "current.txt"), "foreign.md\n");
  await releaseOwnerLock(barrier);

  const result = await pending;
  assert.equal(result.status, "pointer_conflict");
  assert.equal(result.failure_code, "caller_current_changed");
  assert.equal(result.current, "foreign.md");
  assert.equal((await readFile(join(root, ".agents", "state", "current.txt"), "utf8")).trim(), "foreign.md");
});

test("raw CLI executes through a symlinked runtime parent exactly once", async (t) => {
  const { root } = await fixture();
  const aliasRoot = await mkdtemp(join(tmpdir(), "worktree-cli-alias-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(aliasRoot, { recursive: true, force: true }));
  const runtimePath = fileURLToPath(new URL("./worktree.mjs", import.meta.url));
  const aliasDir = join(aliasRoot, "runtime");
  await symlink(dirname(runtimePath), aliasDir, "dir");
  const output = execFileSync(process.execPath, [
    join(aliasDir, "worktree.mjs"),
    "resolve-current",
    "--root", root,
  ], { encoding: "utf8" });
  assert.equal(output.trim().split("\n").filter((line) => line === "{").length, 1, "CLI emits one result");
  assert.equal(JSON.parse(output).status, "empty");
});

test("session bindings isolate exact plans by tool, repository, and session", async (t) => {
  const first = await fixture();
  const second = await fixture();
  const storeRoot = await mkdtemp(join(tmpdir(), "session-bindings-"));
  t.after(() => Promise.all([
    rm(first.root, { recursive: true, force: true }),
    rm(second.root, { recursive: true, force: true }),
    rm(storeRoot, { recursive: true, force: true }),
  ]));

  const planA = await mappedPlan(first.root, "session-plan-a");
  const planB = await mappedPlan(first.root, "session-plan-b");
  const planC = await mappedPlan(second.root, "session-plan-c");
  await writeFile(join(first.root, ".agents", "state", "current.txt"), `${planB.plan}\n`);
  await writeFile(join(second.root, ".agents", "state", "current.txt"), `${planC.plan}\n`);

  await bindSession({ root: first.root, tool: "claude", sessionId: "shared/session", plan: planA.plan, storeRoot });
  await bindSession({ root: first.root, tool: "claude", sessionId: "session-b", plan: planB.plan, storeRoot });
  await bindSession({ root: first.root, tool: "codex", sessionId: "shared/session", plan: planB.plan, storeRoot });
  await bindSession({ root: second.root, tool: "claude", sessionId: "shared/session", plan: planC.plan, storeRoot });

  assert.equal((await resolveSession({ root: first.root, tool: "claude", sessionId: "shared/session", storeRoot })).plan, planA.plan);
  assert.equal((await resolveSession({ root: first.root, tool: "claude", sessionId: "session-b", storeRoot })).plan, planB.plan);
  assert.equal((await resolveSession({ root: first.root, tool: "codex", sessionId: "shared/session", storeRoot })).plan, planB.plan);
  assert.equal((await resolveSession({ root: second.root, tool: "claude", sessionId: "shared/session", storeRoot })).plan, planC.plan);

  const firstPaths = sessionBindingPaths({ root: first.root, tool: "claude", sessionId: "shared/session", storeRoot });
  const secondPaths = sessionBindingPaths({ root: second.root, tool: "claude", sessionId: "shared/session", storeRoot });
  assert.notEqual(firstPaths.binding, secondPaths.binding, "repository digest partitions identical tool/session ids");
  assert.notEqual(firstPaths.lock, secondPaths.lock, "repository digest also partitions locks");

  await bindSession({ root: first.root, tool: "claude", sessionId: "shared/session", plan: planB.plan, storeRoot });
  assert.equal((await resolveSession({ root: first.root, tool: "claude", sessionId: "shared/session", storeRoot })).plan, planB.plan);
  assert.equal((await resolveSession({ root: second.root, tool: "claude", sessionId: "shared/session", storeRoot })).plan, planC.plan, "rebind in repo A leaves repo B untouched");

  await unbindSession({ root: first.root, tool: "claude", sessionId: "shared/session", storeRoot });
  assert.equal((await resolveSession({ root: first.root, tool: "claude", sessionId: "shared/session", storeRoot })).status, "unbound");
  assert.equal((await resolveSession({ root: second.root, tool: "claude", sessionId: "shared/session", storeRoot })).plan, planC.plan, "unbind in repo A leaves repo B untouched");
});

test("unbound main is plan-free while an execution checkout keeps local routing", async (t) => {
  const { root } = await fixture();
  const storeRoot = await mkdtemp(join(tmpdir(), "session-bindings-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(storeRoot, { recursive: true, force: true })]));
  const local = await mappedPlan(root, "session-local");
  await writeFile(join(root, ".agents", "state", "current.txt"), `${local.plan}\n`);

  const unbound = await resolveSession({ root, tool: "claude", sessionId: "fresh", storeRoot });
  assert.deepEqual(
    Object.keys(unbound).filter((key) => ["plan", "title", "execution_root", "branch", "base_branch", "base_commit", "recovery"].includes(key)),
    [],
    "unbound main must not disclose launcher plan fields",
  );
  assert.deepEqual({ status: unbound.status, reason: unbound.reason }, { status: "unbound", reason: "missing_binding" });
  assert.equal((await resolveSession({ root, tool: "claude", sessionId: "", storeRoot })).reason, "missing_session_id");
  assert.equal((await resolveSession({ root, tool: "other", sessionId: "fresh", storeRoot })).reason, "invalid_tool");

  const rooted = await resolveSession({ root: local.execution_root, tool: "claude", sessionId: "fresh", storeRoot });
  assert.equal(rooted.status, "ok");
  assert.equal(rooted.plan, local.plan);
  assert.equal(rooted.binding_source, "checkout");
  assert.equal(rooted.route_required, false);
});

test("ensure-session prunes only its exact stale binding", async (t) => {
  const { root } = await fixture();
  const foreign = await fixture();
  const storeRoot = await mkdtemp(join(tmpdir(), "session-bindings-"));
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(foreign.root, { recursive: true, force: true }),
    rm(storeRoot, { recursive: true, force: true }),
  ]));
  const stale = await mappedPlan(root, "session-stale");
  const live = await mappedPlan(root, "session-live");
  await bindSession({ root, tool: "codex", sessionId: "stale", plan: stale.plan, storeRoot });
  await bindSession({ root, tool: "codex", sessionId: "live", plan: live.plan, storeRoot });
  await writeFile(join(root, stale.plan), (await readFile(join(root, stale.plan), "utf8")).replace("status: draft", "status: done"));

  const terminal = await ensureSession({ root, tool: "codex", sessionId: "stale", storeRoot });
  assert.equal(terminal.status, "terminal");
  assert.equal(terminal.binding_pruned, true);
  assert.equal((await resolveSession({ root, tool: "codex", sessionId: "live", storeRoot })).plan, live.plan);

  for (const [sessionId, payload, expected] of [
    ["missing", { main_root: root, plan: ".agents/plans/missing.md" }, "missing_plan"],
    ["wrong-root", { main_root: foreign.root, plan: stale.plan }, "binding_root_mismatch"],
  ]) {
    const paths = sessionBindingPaths({ root, tool: "codex", sessionId, storeRoot });
    await mkdir(paths.root_dir, { recursive: true, mode: 0o700 });
    await writeFile(paths.binding, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
    const result = await ensureSession({ root, tool: "codex", sessionId, storeRoot });
    assert.equal(result.status, expected);
    assert.equal(result.binding_pruned, true);
    await assert.rejects(readFile(paths.binding), { code: "ENOENT" });
  }
});

test("session binding storage is private and rejects symlink redirection", async (t) => {
  const { root } = await fixture();
  const storeRoot = await mkdtemp(join(tmpdir(), "session-bindings-"));
  const redirectedRoot = await mkdtemp(join(tmpdir(), "session-redirect-"));
  const overrideLink = join(tmpdir(), `session-bindings-link-${process.pid}-${Date.now()}`);
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(storeRoot, { recursive: true, force: true }),
    rm(redirectedRoot, { recursive: true, force: true }),
    rm(overrideLink, { recursive: true, force: true }),
  ]));
  const mapped = await mappedPlan(root, "session-private");
  const paths = sessionBindingPaths({ root, tool: "claude", sessionId: "private", storeRoot });
  await bindSession({ root, tool: "claude", sessionId: "private", plan: mapped.plan, storeRoot });
  assert.equal((await stat(paths.managed_root)).mode & 0o777, 0o700);
  assert.equal((await stat(paths.binding)).mode & 0o777, 0o600);

  await unbindSession({ root, tool: "claude", sessionId: "private", storeRoot });
  const victim = join(redirectedRoot, "victim.json");
  await writeFile(victim, "keep\n");
  await symlink(victim, paths.binding);
  assert.equal((await bindSession({ root, tool: "claude", sessionId: "private", plan: mapped.plan, storeRoot })).status, "binding_store_unsafe");
  assert.equal(await readFile(victim, "utf8"), "keep\n");

  await symlink(redirectedRoot, overrideLink);
  assert.equal((await bindSession({ root, tool: "claude", sessionId: "override", plan: mapped.plan, storeRoot: overrideLink })).status, "binding_store_unsafe");
});

test("concurrent rebinds leave one complete binding", async (t) => {
  const { root } = await fixture();
  const storeRoot = await mkdtemp(join(tmpdir(), "session-bindings-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(storeRoot, { recursive: true, force: true })]));
  const planA = await mappedPlan(root, "session-race-a");
  const planB = await mappedPlan(root, "session-race-b");
  await Promise.all([
    bindSession({ root, tool: "codex", sessionId: "race", plan: planA.plan, storeRoot }),
    bindSession({ root, tool: "codex", sessionId: "race", plan: planB.plan, storeRoot }),
  ]);
  const resolved = await resolveSession({ root, tool: "codex", sessionId: "race", storeRoot });
  assert.equal(resolved.status, "ok");
  assert.equal([planA.plan, planB.plan].includes(resolved.plan), true);
  const paths = sessionBindingPaths({ root, tool: "codex", sessionId: "race", storeRoot });
  assert.equal([planA.plan, planB.plan].includes(JSON.parse(await readFile(paths.binding, "utf8")).plan), true);
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

test("pointer CAS is a physical no-op when the value is unchanged", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const pointer = join(root, ".agents", "state", "current.txt");
  await writeFile(pointer, "same.md\n");
  const before = await stat(pointer);
  await new Promise((resolve) => setTimeout(resolve, 20));

  const result = await writeCurrentCAS(root, "same.md", "same.md");

  assert.deepEqual(result, { updated: false, current: "same.md", reason: "unchanged" });
  assert.equal((await stat(pointer)).mtimeMs, before.mtimeMs);
});

test("ordered current locks serialize callers that request the same checkouts in inverse order", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const ensured = await ensureManagedWorktree({ root, id: "inverse-current-locks", base: "main" });
  const events = [];
  let enterFirst;
  const firstEntered = new Promise((resolve) => { enterFirst = resolve; });
  let releaseFirst;
  const firstMayExit = new Promise((resolve) => { releaseFirst = resolve; });

  const first = withCurrentLocks([root, ensured.execution_root], async () => {
    events.push("first-enter");
    enterFirst();
    await firstMayExit;
    events.push("first-exit");
  });
  await firstEntered;
  const second = withCurrentLocks([ensured.execution_root, root], async () => {
    events.push("second-enter");
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(events, ["first-enter"], "inverse-order contender waits instead of acquiring a partial lock set");
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first-enter", "first-exit", "second-enter"]);
});

test("ensure-current transparently reuses one legacy candidate with inferred base", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const planRel = ".agents/plans/2026-07-13-auto-reuse.md";
  await writeFile(join(root, planRel), "---\nid: auto-reuse\ntitle: Auto reuse\nstatus: draft\nbase_branch: main\nbranch: feature/auto-reuse\n---\n");
  const candidate = await createCandidate(root, "feature/auto-reuse", "auto-reuse-existing", planRel);
  await writeFile(join(root, ".agents", "state", "current.txt"), `${planRel}\n`);
  const planBeforeResolve = await readFile(join(root, planRel), "utf8");
  const topologyBeforeResolve = git(root, "worktree", "list", "--porcelain");

  const readOnly = await resolveCurrent(root);
  assert.equal(readOnly.status, "legacy_unmapped");
  assert.equal(await readFile(join(root, planRel), "utf8"), planBeforeResolve);
  assert.equal(git(root, "worktree", "list", "--porcelain"), topologyBeforeResolve);

  const result = await ensureCurrent({ root });
  assert.equal(result.status, "ok");
  assert.equal(result.execution_root, candidate);
  assert.equal(result.auto_adoption.source_kind, "candidate");
  assert.equal(result.auto_adoption.topology, "reused");
  assert.equal(result.auto_adoption.outcome, "adopted_selected");
  assert.equal(result.base_branch, "main");
  assert.equal(git(candidate, "branch", "--show-current"), "feature/auto-reuse");
  assert.equal(git(root, "worktree", "list", "--porcelain"), topologyBeforeResolve);
  assert.doesNotMatch(await readFile(join(root, planRel), "utf8"), /legacy_unmapped/);
});

test("automatic base inference covers commit-only and fully specified historical inputs", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const head = git(root, "rev-parse", "main");

  const commitOnly = ".agents/plans/2026-07-13-auto-commit-only.md";
  await writeFile(join(root, commitOnly), `---\nid: auto-commit-only\nstatus: draft\nbase_commit: ${head}\n---\n`);
  await createCandidate(root, "feature/auto-commit-only", "auto-commit-only", commitOnly);
  await writeFile(join(root, ".agents", "state", "current.txt"), `${commitOnly}\n`);
  const commitOnlyResult = await ensureCurrent({ root });
  assert.equal(commitOnlyResult.status, "ok");
  assert.equal(commitOnlyResult.base_branch, "main");
  assert.equal(commitOnlyResult.base_commit, head);

  const completeBase = ".agents/plans/2026-07-13-auto-complete-base.md";
  await writeFile(join(root, completeBase), `---\nid: auto-complete-base\nstatus: draft\nbase_branch: main\nbase_commit: ${head}\n---\n`);
  await createCandidate(root, "feature/auto-complete-base", "auto-complete-base", completeBase);
  await writeFile(join(root, ".agents", "state", "current.txt"), `${completeBase}\n`);
  const completeBaseResult = await ensureCurrent({ root });
  assert.equal(completeBaseResult.status, "ok");
  assert.equal(completeBaseResult.base_branch, "main");
  assert.equal(completeBaseResult.base_commit, head);
});

test("ensure-current creates a safe zero-candidate mapping once without rewriting main selection", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const planRel = await writeLegacyPlan(root, "auto-create");
  const mainPointer = join(root, ".agents", "state", "current.txt");
  await writeFile(mainPointer, `${planRel}\n`);
  const mainPointerBefore = await stat(mainPointer);

  const first = await ensureCurrent({ root });
  assert.equal(first.status, "ok");
  assert.equal(first.auto_adoption.source_kind, "main_checkout");
  assert.equal(first.auto_adoption.topology, "created");
  assert.equal(first.auto_adoption.outcome, "adopted_selected");
  assert.equal(await readFile(mainPointer, "utf8"), `${planRel}\n`);
  assert.equal((await stat(mainPointer)).mtimeMs, mainPointerBefore.mtimeMs);
  const targetPointer = join(first.execution_root, ".agents", "state", "current.txt");
  const targetBefore = await stat(targetPointer);
  const topologyBefore = git(root, "worktree", "list", "--porcelain");
  await new Promise((resolve) => setTimeout(resolve, 20));

  const second = await ensureCurrent({ root });
  assert.equal(second.status, "ok");
  assert.equal(second.auto_adoption, undefined);
  assert.equal((await stat(targetPointer)).mtimeMs, targetBefore.mtimeMs);
  assert.equal(git(root, "worktree", "list", "--porcelain"), topologyBefore);
  assert.equal(await readFile(reservationPaths(root, "auto-create").json, "utf8").catch(() => ""), "");
});

test("ensure-current fails closed for ambiguous candidates and partial topology mismatch", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const ambiguous = await writeLegacyPlan(root, "auto-ambiguous");
  await createCandidate(root, "feature/auto-ambiguous-a", "auto-ambiguous-a", ambiguous);
  await createCandidate(root, "feature/auto-ambiguous-b", "auto-ambiguous-b", ambiguous);
  await writeFile(join(root, ".agents", "state", "current.txt"), `${ambiguous}\n`);
  const ambiguousBefore = await readFile(join(root, ambiguous), "utf8");
  const topologyBefore = git(root, "worktree", "list", "--porcelain");

  const ambiguousResult = await ensureCurrent({ root });
  assert.equal(ambiguousResult.status, "legacy_unmapped");
  assert.equal(ambiguousResult.failure_code, "candidate_ambiguous");
  assert.equal(await readFile(join(root, ambiguous), "utf8"), ambiguousBefore);
  assert.equal(git(root, "worktree", "list", "--porcelain"), topologyBefore);

  const mismatch = ".agents/plans/2026-07-13-auto-mismatch.md";
  await writeFile(join(root, mismatch), "---\nid: auto-mismatch\nstatus: draft\nbranch: feature/not-the-candidate\n---\n");
  await createCandidate(root, "feature/auto-mismatch", "auto-mismatch", mismatch);
  await writeFile(join(root, ".agents", "state", "current.txt"), `${mismatch}\n`);
  const mismatchBefore = await readFile(join(root, mismatch), "utf8");
  const mismatchResult = await ensureCurrent({ root });
  assert.equal(mismatchResult.status, "legacy_unmapped");
  assert.equal(mismatchResult.failure_code, "topology_constraint_mismatch");
  assert.equal(await readFile(join(root, mismatch), "utf8"), mismatchBefore);
});

test("ensure-current returns typed no-write failures for dirty main and blocked main selection", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const dirtyPlan = await writeLegacyPlan(root, "auto-dirty");
  await writeFile(join(root, ".agents", "state", "current.txt"), `${dirtyPlan}\n`);
  await writeFile(join(root, "README.md"), "dirty\n");
  const dirtyTopology = git(root, "worktree", "list", "--porcelain");
  const dirtyResult = await ensureCurrent({ root });
  assert.equal(dirtyResult.status, "legacy_unmapped");
  assert.equal(dirtyResult.failure_code, "main_dirty");
  assert.equal(git(root, "worktree", "list", "--porcelain"), dirtyTopology);

  git(root, "checkout", "--", "README.md");
  const blockedPlan = await writeLegacyPlan(root, "auto-main-lock");
  await writeFile(join(root, ".agents", "state", "current.txt"), `${blockedPlan}\n`);
  const mainLock = await acquireOwnerLock(join(root, ".agents", "state", "current.lock"), { operation: "test-main-lock", retries: 0 });
  const blockedTopology = git(root, "worktree", "list", "--porcelain");
  const blockedResult = await ensureCurrent({ root });
  await releaseOwnerLock(mainLock);
  assert.equal(blockedResult.status, "legacy_unmapped");
  assert.equal(blockedResult.failure_code, "main_lock_blocked");
  assert.equal(git(root, "worktree", "list", "--porcelain"), blockedTopology);
  assert.equal(await readFile(reservationPaths(root, "auto-main-lock").json, "utf8").catch(() => ""), "");
});

test("a contender waiting beyond the old lock budget reclassifies zero to one candidate", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const planRel = await writeLegacyPlan(root, "auto-zero-one");
  await writeFile(join(root, ".agents", "state", "current.txt"), `${planRel}\n`);
  const lockPath = reservationPaths(root, "auto-zero-one").lock;
  const firstOwner = await acquireOwnerLock(lockPath, { operation: "test-first-owner", retries: 0 });
  const contender = ensureCurrent({ root });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const candidate = await createCandidate(root, "feature/auto-zero-one", "auto-zero-one-existing", planRel);
  await new Promise((resolve) => setTimeout(resolve, 2600));
  await releaseOwnerLock(firstOwner);

  const result = await contender;
  assert.equal(result.status, "ok");
  assert.equal(result.execution_root, candidate);
  assert.equal(result.auto_adoption.topology, "reused");
  assert.equal(listCount(root), 2);
  assert.equal(await readFile(reservationPaths(root, "auto-zero-one").json, "utf8").catch(() => ""), "");
});

test("ensure-current reconciles only stage-free exact mapped reservations", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const exactPlan = await writeLegacyPlan(root, "auto-residual-exact");
  const exact = await ensureManagedWorktree({ root, id: "auto-residual-exact", base: "main" });
  const exactSource = await readFile(join(root, exactPlan), "utf8");
  await writeFile(join(root, exactPlan), setMappedPlan(exactSource, exact));
  await writeFile(join(root, ".agents", "state", "current.txt"), `${exactPlan}\n`);
  await writeFile(join(exact.execution_root, ".agents", "state", "current.txt"), `${exactPlan}\n`);

  const reconciled = await ensureCurrent({ root });
  assert.equal(reconciled.status, "ok");
  assert.equal(reconciled.auto_adoption.topology, "reconciled");
  assert.equal(await readFile(reservationPaths(root, "auto-residual-exact").json, "utf8").catch(() => ""), "");

  const stagedPlan = await writeLegacyPlan(root, "auto-residual-staged");
  const staged = await ensureManagedWorktree({ root, id: "auto-residual-staged", base: "main" });
  const stagedSource = await readFile(join(root, stagedPlan), "utf8");
  await writeFile(join(root, stagedPlan), setMappedPlan(stagedSource, staged));
  await writeFile(join(root, ".agents", "state", "current.txt"), `${stagedPlan}\n`);
  await writeFile(join(staged.execution_root, ".agents", "state", "current.txt"), `${stagedPlan}\n`);
  const reservationPath = reservationPaths(root, "auto-residual-staged");
  const reservation = JSON.parse(await readFile(reservationPath.json, "utf8"));
  reservation.stage_sha256 = "0".repeat(64);
  await writeFile(reservationPath.json, `${JSON.stringify(reservation, null, 2)}\n`);
  await writeFile(reservationPath.stage, "pending staged content\n");
  const reservationBefore = await readFile(reservationPath.json, "utf8");

  const blocked = await ensureCurrent({ root });
  assert.equal(blocked.status, "legacy_unmapped");
  assert.equal(blocked.failure_code, "residual_stage_pending");
  assert.equal(await readFile(reservationPath.json, "utf8"), reservationBefore);
  assert.equal(await readFile(reservationPath.stage, "utf8"), "pending staged content\n");
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

test("legacy adoption preserves a historical base while starting a new branch at a newer commit", async (t) => {
  const { root, baseCommit: historicalBase } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, "checkout", "release/test");
  await writeFile(join(root, "NEXT.txt"), "newer source\n");
  git(root, "add", "NEXT.txt");
  git(root, "commit", "-m", "advance source");
  const startCommit = git(root, "rev-parse", "HEAD");
  git(root, "checkout", "main");
  const planRel = await writeLegacyPlan(root, "adopt-split");

  const adopted = await adoptPlan({
    root,
    plan: planRel,
    base: "release/test",
    baseCommit: historicalBase,
    start: "release/test",
    select: true,
  });
  const markdown = await readFile(join(root, planRel), "utf8");
  assert.equal(adopted.status, "created");
  assert.equal(adopted.outcome, "adopted_selected");
  assert.equal(git(adopted.execution_root, "rev-parse", "HEAD"), startCommit);
  assert.match(markdown, new RegExp(`base_commit: ${historicalBase}`));
  assert.equal(await readFile(reservationPaths(root, "adopt-split").json, "utf8").catch(() => ""), "");
  assert.equal(await readFile(reservationPaths(root, "adopt-split").stage, "utf8").catch(() => ""), "");
  assert.equal((await validateManagedWorktrees(root, { all: true })).ok, true);
});

test("legacy adoption reuses the one exact current-bearing worktree despite unrelated dirty main", async (t) => {
  const { root, baseCommit } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const planRel = await writeLegacyPlan(root, "adopt-existing");
  const candidate = await createCandidate(root, "feature/adopt-existing", "adopt-existing-checkout", planRel, "release/test");
  const beforeCount = listCount(root);
  const beforeHead = git(candidate, "rev-parse", "HEAD");
  await writeFile(join(root, "README.md"), "unrelated dirty main\n");

  const adopted = await adoptPlan({ root, plan: planRel, base: "release/test", baseCommit, select: false });
  assert.equal(adopted.status, "reused");
  assert.equal(adopted.outcome, "adopted_parked");
  assert.equal(adopted.execution_root, candidate);
  assert.equal(listCount(root), beforeCount);
  assert.equal(git(candidate, "rev-parse", "HEAD"), beforeHead);
  assert.equal(git(candidate, "branch", "--show-current"), "feature/adopt-existing");
  assert.equal(await readFile(reservationPaths(root, "adopt-existing").json, "utf8").catch(() => ""), "");
});

test("raw adopt CLI forwards an explicit historical base commit for candidate reuse", async (t) => {
  const { root, baseCommit: historicalBase } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const planRel = await writeLegacyPlan(root, "adopt-cli-historical");
  const candidate = await createCandidate(
    root,
    "feature/adopt-cli-historical",
    "adopt-cli-historical",
    planRel,
    "release/test",
  );
  const candidateHead = git(candidate, "rev-parse", "HEAD");
  git(root, "checkout", "release/test");
  await writeFile(join(root, "LATER.txt"), "base advanced after candidate\n");
  git(root, "add", "LATER.txt");
  git(root, "commit", "-m", "advance base after candidate");
  git(root, "checkout", "main");

  const output = execFileSync(process.execPath, [
    fileURLToPath(new URL("./worktree.mjs", import.meta.url)),
    "adopt",
    "--root", root,
    "--plan", planRel,
    "--base", "release/test",
    "--base-commit", historicalBase,
  ], { encoding: "utf8" });
  const adopted = JSON.parse(output);
  assert.equal(adopted.status, "reused");
  assert.equal(adopted.base_commit, historicalBase);
  assert.equal(adopted.execution_root, candidate);
  assert.equal(git(candidate, "rev-parse", "HEAD"), candidateHead);
});

test("legacy adoption rejects ambiguous candidates and pointerless occupied topology before writes", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const ambiguousPlan = await writeLegacyPlan(root, "adopt-ambiguous");
  const original = await readFile(join(root, ambiguousPlan), "utf8");
  await createCandidate(root, "feature/adopt-ambiguous-a", "adopt-ambiguous-a", ambiguousPlan);
  await createCandidate(root, "feature/adopt-ambiguous-b", "adopt-ambiguous-b", ambiguousPlan);
  const beforeCount = listCount(root);
  await assert.rejects(adoptPlan({ root, plan: ambiguousPlan, base: "main" }), /multiple adoption candidates/);
  assert.equal(await readFile(join(root, ambiguousPlan), "utf8"), original);
  assert.equal(listCount(root), beforeCount);
  assert.equal(await readFile(reservationPaths(root, "adopt-ambiguous").json, "utf8").catch(() => ""), "");

  const occupiedPlan = await writeLegacyPlan(root, "adopt-occupied");
  const occupiedPath = join(root, ".agents", "worktrees", "occupied-checkout");
  git(root, "worktree", "add", "-b", "feature/occupied-checkout", occupiedPath, "main");
  await assert.rejects(
    adoptPlan({ root, plan: occupiedPlan, base: "main", branch: "feature/occupied-checkout", worktree: occupiedPath }),
    /occupied topology has no exact adoption reservation/,
  );
  assert.equal(await readFile(reservationPaths(root, "adopt-occupied").json, "utf8").catch(() => ""), "");
});

test("adoption reservations track start_commit for cancellation and park on stale main selection", async (t) => {
  const { root, baseCommit: historicalBase } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const startCommit = git(root, "rev-parse", "release/test");
  const cancellable = await ensureManagedWorktree({
    root,
    id: "cancel-start",
    base: "release/test",
    baseCommit: historicalBase,
    start: "release/test",
  });
  const reservation = JSON.parse(await readFile(reservationPaths(root, "cancel-start").json, "utf8"));
  assert.equal(reservation.base_commit, historicalBase);
  assert.equal(reservation.start_commit, startCommit);
  assert.equal(git(cancellable.execution_root, "rev-parse", "HEAD"), startCommit);
  assert.equal((await cancelProvisional({ root, id: "cancel-start" })).reason, "cancelled");

  await writeFile(join(root, ".agents", "state", "current.txt"), "older-selection.md\n");
  const planRel = await writeLegacyPlan(root, "adopt-parked");
  const prepared = await ensureManagedWorktree({ root, id: "adopt-parked", base: "main" });
  await writeFile(join(root, ".agents", "state", "current.txt"), "newer-selection.md\n");
  const adopted = await adoptPlan({ root, plan: planRel, base: "main", select: true });
  assert.equal(adopted.execution_root, prepared.execution_root);
  assert.equal(adopted.outcome, "adopted_parked");
  assert.equal(await readFile(join(root, ".agents", "state", "current.txt"), "utf8"), "newer-selection.md\n");
  assert.equal(await readFile(join(prepared.execution_root, ".agents", "state", "current.txt"), "utf8"), `${planRel}\n`);
  assert.equal(await readFile(reservationPaths(root, "adopt-parked").json, "utf8").catch(() => ""), "");
});

test("adoption retry reconciles an exact mapped owner with residual handoff files", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const planRel = await writeLegacyPlan(root, "adopt-residual");
  const prepared = await ensureManagedWorktree({ root, id: "adopt-residual", base: "main" });
  const original = await readFile(join(root, planRel), "utf8");
  await writeFile(join(root, planRel), original.replace("---\n", `---\nbase_branch: main\nbase_commit: ${prepared.base_commit}\nbranch: ${prepared.branch}\nworktree: ${prepared.worktree}\n`));
  await writeFile(join(prepared.execution_root, ".agents", "state", "current.txt"), `${planRel}\n`);
  await writeFile(reservationPaths(root, "adopt-residual").stage, "residual-stage\n");

  const retried = await adoptPlan({ root, plan: planRel, base: "main", select: false });
  assert.equal(retried.status, "reused");
  assert.equal(retried.outcome, "adopted_parked");
  assert.equal(await readFile(reservationPaths(root, "adopt-residual").json, "utf8").catch(() => ""), "");
  assert.equal(await readFile(reservationPaths(root, "adopt-residual").stage, "utf8").catch(() => ""), "");
  assert.equal((await validateManagedWorktrees(root, { all: true })).ok, true);
});

test("legacy adoption rejects a candidate already mapped by another non-terminal plan", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const planRel = await writeLegacyPlan(root, "adopt-foreign-owner");
  const candidate = await createCandidate(root, "feature/adopt-foreign-owner", "adopt-foreign-owner", planRel);
  const foreignRel = ".agents/plans/2026-07-13-foreign-owner.md";
  await writeFile(join(root, foreignRel), `---\nid: foreign-owner\nstatus: active\nbase_branch: main\nbase_commit: ${git(root, "rev-parse", "main")}\nbranch: feature/adopt-foreign-owner\nworktree: ${candidate.slice(root.length + 1)}\n---\n`);
  const original = await readFile(join(root, planRel), "utf8");

  await assert.rejects(adoptPlan({ root, plan: planRel, base: "main" }), /target already owned by.*foreign-owner/);
  assert.equal(await readFile(join(root, planRel), "utf8"), original);
  assert.equal(await readFile(reservationPaths(root, "adopt-foreign-owner").json, "utf8").catch(() => ""), "");
});

test("adoption holds the shared PM-store lock while waiting for target ownership", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const planRel = await writeLegacyPlan(root, "adopt-store-chain");
  const prepared = await ensureManagedWorktree({ root, id: "adopt-store-chain", base: "main" });
  const currentBarrier = await acquireOwnerLock(join(prepared.execution_root, ".agents", "state", "current.lock"), {
    operation: "test-current-barrier",
    retries: 0,
  });
  const adoption = adoptPlan({ root, plan: planRel, base: "main", select: false });
  const storeLock = join(root, ".agents", "tasks", ".lock");
  let observed;
  for (let attempt = 0; attempt < 400; attempt++) {
    observed = await inspectOwnerLock(storeLock).catch(() => null);
    if (observed?.state === "owned" && observed.owner.operation === "adopt:adopt-store-chain") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(observed?.owner?.operation, "adopt:adopt-store-chain", "adoption reached the PM-store critical section");

  const writer = ops.itemAdd(root, { inbox: true }, { id: "blocked-writer", title: "Blocked until adoption exits" });
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.equal(await readFile(join(root, ".agents", "tasks", "_inbox.md"), "utf8").catch(() => ""), "");

  await releaseOwnerLock(currentBarrier);
  const [adopted] = await Promise.all([adoption, writer]);
  assert.equal(adopted.outcome, "adopted_parked");
  assert.match(await readFile(join(root, ".agents", "tasks", "_inbox.md"), "utf8"), /blocked-writer/);
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
  const testBarrier = await acquireLock(root, "test-barrier", { retries: 0 });
  const cancellation = cancelProvisional({ root, id: "cancel-race" });
  const planRel = ".agents/plans/2026-07-13-cancel-race.md";
  await writeFile(join(root, planRel), `---\nid: cancel-race\nstatus: draft\nbase_branch: main\nbase_commit: ${ensured.base_commit}\nbranch: ${ensured.branch}\nworktree: ${ensured.worktree}\n---\n`);
  await releaseLock(testBarrier);
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

async function writeLegacyPlan(root, id) {
  const planRel = `.agents/plans/2026-07-13-${id}.md`;
  await writeFile(join(root, planRel), `---\nid: ${id}\ntitle: Adopt legacy\nstatus: draft\n---\n`);
  return planRel;
}

async function createCandidate(root, branch, directory, planRel, ref = "main") {
  const target = join(root, ".agents", "worktrees", directory);
  git(root, "worktree", "add", "-b", branch, target, ref);
  await wireManagedStore(root, target);
  await writeFile(join(target, ".agents", "state", "current.txt"), `${planRel}\n`);
  return target;
}

function setMappedPlan(markdown, topology) {
  return markdown.replace("---\n", `---\nbase_branch: ${topology.base_branch}\nbase_commit: ${topology.base_commit}\nbranch: ${topology.branch}\nworktree: ${topology.worktree}\n`);
}
