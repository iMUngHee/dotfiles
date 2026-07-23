import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { bindSession, ensureManagedWorktree, resolveCurrent } from "./worktree.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = dirname(dirname(here));
const hooks = {
  claude: join(repo, "claude", "hooks", "inject-context.sh"),
  codex: join(repo, "codex", "hooks", "inject-context.sh"),
};
const UNBOUND_GUARD = `task authority: no validated session-bound plan
continuation guard: restored or compacted summaries are context only. If the latest prompt is shorthand and its task target appears only in a synthesized summary, ask which task to continue before any task read, edit, command, or lifecycle action. Explicit non-plan task wording or an unambiguous target in verbatim user messages may proceed; plan execution or lifecycle action requires a validated session binding.`;
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function assertCanonicalGuard(context, label) {
  assert.ok(context.includes(UNBOUND_GUARD), `${label} must contain the exact canonical unbound guard`);
}

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
  const createPlan = async (id, title) => {
    const ensured = await ensureManagedWorktree({ root, id, base: "main" });
    const plan = `.agents/plans/2026-07-22-${id}.md`;
    await writeFile(join(root, plan), `---
id: ${id}
title: ${title}
status: active
base_branch: main
base_commit: ${ensured.base_commit}
branch: ${ensured.branch}
worktree: ${ensured.worktree}
---
`);
    await writeFile(join(ensured.execution_root, ".agents", "state", "current.txt"), `${plan}\n`);
    return { ensured, plan, title };
  };
  const planA = await createPlan("hook-plan-a", "Hook plan A");
  const planB = await createPlan("hook-plan-b", "Hook plan B");
  await writeFile(join(root, ".agents", "state", "current.txt"), `${planA.plan}\n`);
  return { root, planA, planB };
}

async function legacyFixture() {
  const { root, planA, planB } = await fixture();
  const ensured = await ensureManagedWorktree({ root, id: "legacy-candidate", base: "main" });
  const plan = ".agents/plans/2026-07-22-legacy.md";
  await writeFile(join(root, plan), `---
id: legacy
title: Legacy
status: draft
---
`);
  await writeFile(join(ensured.execution_root, ".agents", "state", "current.txt"), `${plan}\n`);
  return { root, planA, planB, ensured, plan };
}

function runHook(kind, projectDir, { configRoot = repo, sessionId = "session-a", storeRoot } = {}) {
  const input = JSON.stringify({ project_dir: projectDir, cwd: projectDir, session_id: sessionId });
  const env = {
    ...process.env,
    AI_CONFIG_ROOT: configRoot,
    CLAUDE_PROJECT_DIR: projectDir,
    ...(storeRoot ? { PM_SESSION_BINDINGS_ROOT: storeRoot } : {}),
  };
  const result = spawnSync("bash", [hooks[kind]], { cwd: projectDir, env, input, encoding: "utf8" });
  assert.equal(result.status, 0, `${kind} hook failed: ${result.stderr}`);
  return result.stdout.trim() ? JSON.parse(result.stdout).hookSpecificOutput.additionalContext : "";
}

for (const kind of ["claude", "codex"]) {
  test(`${kind} adapter keeps unexpected ensure-current failures visible`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "inject-context-failure-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const configRoot = join(root, "config");
    await mkdir(join(configRoot, "ai", "lib"), { recursive: true });
    await writeFile(join(configRoot, "ai", "lib", "worktree.mjs"), "process.exit(1);\n");

    const context = runHook(kind, root, { configRoot });
    assert.match(context, /session plan routing error: ensure-session failed/);
    assert.match(context, /resolve-session --root/);
    assertCanonicalGuard(context, `${kind} internal_error`);
  });
}

for (const kind of ["claude", "codex"]) {
  test(`${kind} adapter guards every resolver payload without a validated binding`, async (t) => {
    const cases = [
      {
        name: "legacy_unmapped",
        payload: {
          status: "legacy_unmapped",
          plan: ".agents/plans/legacy.md",
          recovery: { plan: ".agents/plans/legacy.md", candidate_count: 0 },
        },
        marker: /session plan routing error: legacy_unmapped/,
      },
      {
        name: "malformed ok",
        payload: { status: "ok", plan_status: "done" },
        marker: /session plan routing error: invalid_bound_payload/,
      },
      {
        name: "unexpected status",
        payload: { status: "mystery_status" },
        marker: /session plan routing error: mystery_status/,
      },
    ];

    for (const entry of cases) {
      const root = await mkdtemp(join(tmpdir(), `inject-context-${entry.name.replaceAll(" ", "-")}-`));
      t.after(() => rm(root, { recursive: true, force: true }));
      const configRoot = join(root, "config");
      await mkdir(join(configRoot, "ai", "lib"), { recursive: true });
      await writeFile(
        join(configRoot, "ai", "lib", "worktree.mjs"),
        `process.stdout.write(${JSON.stringify(JSON.stringify(entry.payload))});\n`,
      );

      const context = runHook(kind, root, { configRoot });
      assert.match(context, entry.marker);
      assertCanonicalGuard(context, `${kind} ${entry.name}`);
    }
  });
}

for (const kind of ["claude", "codex"]) {
  test(`${kind} adapter keeps S1 on A and S2 on B when the launcher changes`, async (t) => {
    const { root, planA, planB } = await fixture();
    const storeRoot = await mkdtemp(join(tmpdir(), "inject-context-bindings-"));
    t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(storeRoot, { recursive: true, force: true })]));
    await bindSession({ root, tool: kind, sessionId: "session/one", plan: planA.plan, storeRoot });
    await bindSession({ root, tool: kind, sessionId: "session/two", plan: planB.plan, storeRoot });

    const s1Before = runHook(kind, root, { sessionId: "session/one", storeRoot });
    const s2Before = runHook(kind, root, { sessionId: "session/two", storeRoot });
    assert.match(s1Before, /active: Hook plan A/);
    assert.doesNotMatch(s1Before, /Hook plan B/);
    assert.match(s2Before, /active: Hook plan B/);
    assert.doesNotMatch(s2Before, /Hook plan A/);

    await writeFile(join(root, ".agents", "state", "current.txt"), `${planB.plan}\n`);
    const s1After = runHook(kind, root, { sessionId: "session/one", storeRoot });
    const s2After = runHook(kind, root, { sessionId: "session/two", storeRoot });
    assert.match(s1After, /active: Hook plan A/);
    assert.doesNotMatch(s1After, /Hook plan B/);
    assert.doesNotMatch(s1After, /continuation guard:/);
    assert.match(s2After, /active: Hook plan B/);
    assert.match(s1After, new RegExp(`execution root: ${planA.ensured.execution_root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(s1After, /session tool: (?:claude|codex)/);
    assert.match(s1After, /session id: session\/one/);

    const rooted = runHook(kind, planA.ensured.execution_root, { sessionId: "session/one", storeRoot });
    assert.match(rooted, /route: already at the execution root/);
  });

  test(`${kind} adapter keeps unbound main plan-free and preserves local legacy normalization`, async (t) => {
    const { root, planA, ensured, plan } = await legacyFixture();
    const storeRoot = await mkdtemp(join(tmpdir(), "inject-context-bindings-"));
    t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(storeRoot, { recursive: true, force: true })]));

    const unbound = runHook(kind, root, { sessionId: "fresh", storeRoot });
    assert.match(unbound, /session plan: unbound/);
    assert.match(unbound, /main current: launcher-only/);
    assertCanonicalGuard(unbound, `${kind} normal unbound`);
    assert.doesNotMatch(unbound, /Hook plan A|execution root:|branch:|base:|recovery:/);
    assert.equal((await readFile(join(root, ".agents", "state", "current.txt"), "utf8")).trim(), planA.plan, "unbound main launcher is not normalized or consumed");

    const resolved = await resolveCurrent(ensured.execution_root);
    assert.equal(resolved.status, "legacy_unmapped");
    const context = runHook(kind, ensured.execution_root, { sessionId: "local", storeRoot });
    assert.match(context, /draft: Legacy/);
    assert.doesNotMatch(context, /legacy_unmapped|recovery: pm worktree adopt/);
    const mapped = await resolveCurrent(ensured.execution_root);
    assert.equal(mapped.status, "ok");
    assert.equal(mapped.id, "legacy");
    assert.equal(mapped.plan, plan);
  });
}

test("hook adapters contain no topology or lifecycle mutation commands", async () => {
  for (const path of Object.values(hooks)) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, /\b(?:git\s+worktree\s+(?:add|remove|move)|ln\s+-s|mkdir|rm|mv|cp)\b/);
    assert.doesNotMatch(source, /pm-roadmap\.ts\s+(?:persist|approve|complete|plan-step|select)/);
    assert.doesNotMatch(source, /^\s*(?:node\s+[^\n]*\s+adopt|[^#\n]*pm-roadmap\.ts\s+worktree\s+adopt)(?:\s|$)/m);
    assert.match(source, /ensure-session --root/);
    assert.doesNotMatch(source, /ensure-current --root/);
    assert.doesNotMatch(source, /(?:\bdefault\b|\$PPID)/);
  }
});

test("paired injection configurations allow exactly thirty seconds", async () => {
  const claude = JSON.parse(await readFile(join(repo, "claude", "settings.json"), "utf8"));
  const claudeInject = claude.hooks.UserPromptSubmit
    .flatMap((group) => group.hooks)
    .find((hook) => hook.command.includes("inject-context.sh"));
  assert.equal(claudeInject.timeout, 30000);

  const codex = await readFile(join(repo, "codex", "config.toml.template"), "utf8");
  assert.match(codex, /command = "\$HOME\/\.config\/codex\/hooks\/inject-context\.sh"\ntimeout = 30\b/);
});

test("codex hook template and audit contract target the active Crux tools", async () => {
  const template = await readFile(join(repo, "codex", "config.toml.template"), "utf8");
  const audit = await readFile(join(repo, "ai", "skills", "config-audit", "SKILL.md"), "utf8");
  const injectIndex = template.indexOf("codex/hooks/inject-context.sh");
  const captureIndex = template.indexOf("codex/hooks/crux-hook.sh userpromptsubmit");

  assert.ok(injectIndex >= 0 && captureIndex > injectIndex, "context injection precedes Crux prompt capture");
  assert.match(template, /mcp__crux__cx_execute\(_file\)\?/);
  assert.doesNotMatch(template, /mcp__crux__ctx_execute/);
  assert.match(audit, /crux-hook\.sh userpromptsubmit/);
  assert.match(audit, /mcp__crux__cx_execute\(_file\)\?/);
  assert.doesNotMatch(audit, /context-mode\.sh userpromptsubmit|mcp__context_mode__ctx_execute/);
});
