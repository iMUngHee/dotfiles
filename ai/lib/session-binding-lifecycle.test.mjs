import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ensureManagedWorktree, ensureSession, resolveSession, stagePlan } from "./worktree.mjs";
import { runCli } from "../skills/pm-roadmap/pm-roadmap.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repo = dirname(dirname(here));
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "session-lifecycle-"));
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  await writeFile(join(root, "README.md"), "fixture\n");
  git(root, "add", "README.md");
  git(root, "commit", "-m", "fixture");
  await mkdir(join(root, ".agents", "tasks"), { recursive: true });
  await mkdir(join(root, ".agents", "plans"), { recursive: true });
  await mkdir(join(root, ".agents", "state"), { recursive: true });
  return root;
}

async function stageMappedPlan(root, id) {
  const ensured = await ensureManagedWorktree({ root, id, base: "main" });
  const plan = `.agents/plans/2026-07-22-${id}.md`;
  const content = `---
id: ${id}
title: ${id}
status: draft
pm_loop: true
base_branch: main
base_commit: ${ensured.base_commit}
branch: ${ensured.branch}
worktree: ${ensured.worktree}
---
# ${id}

## Post-Implementation Notes

<!-- test -->
`;
  await stagePlan({ root, id, content });
  return { ...ensured, plan };
}

async function withSessionEnv({ tool, sessionId, storeRoot }, fn) {
  const saved = {
    PM_SESSION_TOOL: process.env.PM_SESSION_TOOL,
    PM_SESSION_ID: process.env.PM_SESSION_ID,
    PM_SESSION_BINDINGS_ROOT: process.env.PM_SESSION_BINDINGS_ROOT,
  };
  process.env.PM_SESSION_TOOL = tool;
  process.env.PM_SESSION_ID = sessionId;
  process.env.PM_SESSION_BINDINGS_ROOT = storeRoot;
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("persisted selected, parked, and explicit select bind before the next prompt", async (t) => {
  const root = await fixture();
  const storeRoot = await mkdtemp(join(tmpdir(), "session-lifecycle-bindings-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(storeRoot, { recursive: true, force: true })]));
  assert.equal((await runCli(root, ["task", "create", "SESSION", "--title", "Session"])).code, 0);

  const planA = await stageMappedPlan(root, "lifecycle-a");
  const selected = await withSessionEnv({ tool: "codex", sessionId: "session-a", storeRoot }, () =>
    runCli(planA.execution_root, ["persist", "SESSION", "lifecycle-a", planA.plan, "--title", "A"]));
  assert.match(selected.out, /^persisted_selected /);
  assert.equal(selected.out.split("\n").at(-1), "session_binding: bound");
  assert.equal(selected.code, 0);
  assert.equal((await resolveSession({ root, tool: "codex", sessionId: "session-a", storeRoot })).plan, planA.plan);

  const planB = await stageMappedPlan(root, "lifecycle-b");
  await writeFile(join(root, ".agents", "state", "current.txt"), ".agents/plans/newer-launcher.md\n");
  const parked = await withSessionEnv({ tool: "codex", sessionId: "session-b", storeRoot }, () =>
    runCli(planB.execution_root, ["persist", "SESSION", "lifecycle-b", planB.plan, "--title", "B"]));
  assert.match(parked.out, /^persisted_parked /);
  assert.equal(parked.out.split("\n").at(-1), "session_binding: bound");
  assert.equal(parked.code, 0);

  await writeFile(join(root, ".agents", "state", "current.txt"), `${planB.plan}\n`);
  assert.equal((await resolveSession({ root, tool: "codex", sessionId: "session-a", storeRoot })).plan, planA.plan, "next prompt for A ignores B launcher");
  assert.equal((await resolveSession({ root, tool: "codex", sessionId: "session-b", storeRoot })).plan, planB.plan, "next prompt for B resolves B");

  const selectedAgain = await withSessionEnv({ tool: "codex", sessionId: "session-select", storeRoot }, () =>
    runCli(planA.execution_root, ["select", "--plan", planA.plan]));
  assert.equal(selectedAgain.out.split("\n").at(-1), "session_binding: bound");
  assert.equal((await resolveSession({ root, tool: "codex", sessionId: "session-select", storeRoot })).plan, planA.plan);

  assert.equal((await runCli(planA.execution_root, ["approve", "SESSION", "lifecycle-a"])).code, 0);
  assert.equal((await runCli(planA.execution_root, ["complete", "SESSION", "lifecycle-a", "--plan", planA.plan, "--status", "done"])).code, 0);
  assert.equal((await readFile(join(root, ".agents", "state", "current.txt"), "utf8")).trim(), "", "terminal completion clears matching launcher");
  assert.equal((await readFile(join(planA.execution_root, ".agents", "state", "current.txt"), "utf8")).trim(), "", "terminal completion clears matching execution pointer");
  assert.equal((await readFile(join(planB.execution_root, ".agents", "state", "current.txt"), "utf8")).trim(), planB.plan, "other plan execution pointer survives");
  assert.equal((await resolveSession({ root, tool: "codex", sessionId: "session-b", storeRoot })).plan, planB.plan, "other session binding survives completion");
  const terminalA = await ensureSession({ root, tool: "codex", sessionId: "session-a", storeRoot });
  assert.equal(terminalA.status, "terminal");
  assert.equal(terminalA.binding_pruned, true, "terminal plan binding is pruned only when that exact session resolves");
  assert.equal((await resolveSession({ root, tool: "codex", sessionId: "session-b", storeRoot })).plan, planB.plan, "pruning terminal A leaves session B bound");
});

test("post-persist binding failure is typed, non-retriable, and never falls back to main", async (t) => {
  const root = await fixture();
  const redirected = await mkdtemp(join(tmpdir(), "session-lifecycle-redirect-"));
  const storeRoot = join(tmpdir(), `session-lifecycle-link-${process.pid}-${Date.now()}`);
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(redirected, { recursive: true, force: true }),
    rm(storeRoot, { recursive: true, force: true }),
  ]));
  await symlink(redirected, storeRoot);
  assert.equal((await runCli(root, ["task", "create", "SESSION", "--title", "Session"])).code, 0);
  const plan = await stageMappedPlan(root, "lifecycle-failure");

  const result = await withSessionEnv({ tool: "claude", sessionId: "broken", storeRoot }, () =>
    runCli(plan.execution_root, ["persist", "SESSION", "lifecycle-failure", plan.plan, "--title", "Failure"]));
  assert.match(result.out, /^persisted_selected /, "the PM transaction committed before binding failed");
  assert.equal(result.out.split("\n").at(-1), "session_binding: unbound (binding_store_unsafe); do not retry persist");
  assert.equal(result.code, 2, "partial lifecycle uses the frozen non-retry exit code");
  assert.match(await readFile(join(root, ".agents", "tasks", "SESSION", "backlog.md"), "utf8"), /lifecycle-failure/);

  await rm(storeRoot);
  await mkdir(storeRoot, { mode: 0o700 });
  const next = await resolveSession({ root, tool: "claude", sessionId: "broken", storeRoot });
  assert.deepEqual({ status: next.status, reason: next.reason }, { status: "unbound", reason: "missing_binding" });
  assert.equal("plan" in next, false, "the selected main launcher is not a recovery fallback");
});

test("PM skill contracts forward pre-prompt session metadata for persist and select", async () => {
  const design = await readFile(join(repo, "ai", "skills", "design", "SKILL.md"), "utf8");
  const roadmap = await readFile(join(repo, "ai", "skills", "pm-roadmap", "SKILL.md"), "utf8");
  for (const source of [design, roadmap]) {
    assert.match(source, /PM_SESSION_TOOL/);
    assert.match(source, /PM_SESSION_ID/);
  }
  assert.match(design, /PM_SESSION_TOOL[^\n]*PM_SESSION_ID[^\n]*pm persist/);
  assert.match(roadmap, /PM_SESSION_TOOL[^\n]*PM_SESSION_ID[^\n]*pm select/);
  assert.match(roadmap, /session_binding: unbound \(<typed reason>\); do not retry (?:persist|select)/);
});
