import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { ensureManagedWorktree } from "./worktree.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = dirname(dirname(here));
const hooks = {
  claude: join(repo, "claude", "hooks", "inject-context.sh"),
  codex: join(repo, "codex", "hooks", "inject-context.sh"),
};
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "inject-context-hooks-"));
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  await writeFile(join(root, "README.md"), "fixture\n");
  git(root, "add", "README.md");
  git(root, "commit", "-m", "fixture");
  await mkdir(join(root, ".agents", "tasks"), { recursive: true });
  await mkdir(join(root, ".agents", "plans"), { recursive: true });
  await mkdir(join(root, ".agents", "state"), { recursive: true });
  const ensured = await ensureManagedWorktree({ root, id: "hook-plan", base: "main" });
  const plan = ".agents/plans/2026-07-13-hook-plan.md";
  await writeFile(join(root, plan), `---
id: hook-plan
title: Hook plan
status: active
base_branch: main
base_commit: ${ensured.base_commit}
branch: ${ensured.branch}
worktree: ${ensured.worktree}
---
`);
  await writeFile(join(root, ".agents", "state", "current.txt"), `${plan}\n`);
  await writeFile(join(ensured.execution_root, ".agents", "state", "current.txt"), `${plan}\n`);
  return { root, ensured, plan };
}

function runHook(kind, projectDir) {
  const input = kind === "codex" ? JSON.stringify({ project_dir: projectDir }) : "{}";
  const env = { ...process.env, AI_CONFIG_ROOT: repo, CLAUDE_PROJECT_DIR: projectDir };
  const result = spawnSync("bash", [hooks[kind]], { cwd: projectDir, env, input, encoding: "utf8" });
  assert.equal(result.status, 0, `${kind} hook failed: ${result.stderr}`);
  return result.stdout.trim() ? JSON.parse(result.stdout).hookSpecificOutput.additionalContext : "";
}

for (const kind of ["claude", "codex"]) {
  test(`${kind} adapter injects one shared rooted context from main and execution worktree`, async (t) => {
    const { root, ensured } = await fixture();
    t.after(() => rm(root, { recursive: true, force: true }));

    const fromMain = runHook(kind, root);
    assert.match(fromMain, /active: Hook plan/);
    assert.match(fromMain, new RegExp(`execution root: ${ensured.execution_root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(fromMain, new RegExp(`branch: ${ensured.branch.replace("/", "\\/")}`));
    assert.match(fromMain, /route: switch to the execution root/);

    const fromWorktree = runHook(kind, ensured.execution_root);
    assert.match(fromWorktree, /route: already at the execution root/);
  });

  test(`${kind} adapter surfaces legacy mapping errors and skips an empty pointer`, async (t) => {
    const { root } = await fixture();
    t.after(() => rm(root, { recursive: true, force: true }));
    const legacy = ".agents/plans/2026-07-13-legacy.md";
    await writeFile(join(root, legacy), "---\nid: legacy\ntitle: Legacy\nstatus: draft\n---\n");
    await writeFile(join(root, ".agents", "state", "current.txt"), `${legacy}\n`);
    assert.match(runHook(kind, root), /plan routing error: legacy_unmapped/);

    await writeFile(join(root, ".agents", "state", "current.txt"), "");
    assert.equal(runHook(kind, root), "");
  });
}

test("hook adapters contain no topology or lifecycle mutation commands", async () => {
  for (const path of Object.values(hooks)) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, /\b(?:git\s+worktree\s+(?:add|remove|move)|ln\s+-s|mkdir|rm|mv|cp)\b/);
    assert.doesNotMatch(source, /pm-roadmap\.ts\s+(?:persist|approve|complete|plan-step|select)/);
  }
});
