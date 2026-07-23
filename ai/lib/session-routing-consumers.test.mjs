import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { bindSession, ensureManagedWorktree } from "./worktree.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = dirname(dirname(here));
const statusline = join(repo, "claude", "extensions", "statusline.sh");
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "session-consumers-"));
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  await writeFile(join(root, "README.md"), "fixture\n");
  git(root, "add", "README.md");
  git(root, "commit", "-m", "fixture");
  await mkdir(join(root, ".agents", "tasks"), { recursive: true });
  await mkdir(join(root, ".agents", "plans"), { recursive: true });
  await mkdir(join(root, ".agents", "state"), { recursive: true });
  const createPlan = async (id, status) => {
    const ensured = await ensureManagedWorktree({ root, id, base: "main" });
    const plan = `.agents/plans/2026-07-22-${id}.md`;
    await writeFile(join(root, plan), `---\nid: ${id}\ntitle: ${id}\nstatus: ${status}\nbase_branch: main\nbase_commit: ${ensured.base_commit}\nbranch: ${ensured.branch}\nworktree: ${ensured.worktree}\n---\n`);
    await writeFile(join(ensured.execution_root, ".agents", "state", "current.txt"), `${plan}\n`);
    return { ...ensured, plan };
  };
  return { root, planA: await createPlan("consumer-a", "draft"), planB: await createPlan("consumer-b", "active") };
}

function runStatusline({ root, home, storeRoot, sessionId }) {
  const input = JSON.stringify({
    session_id: sessionId,
    model: { display_name: "Claude Test", id: "claude-test" },
    context_window: {
      used_percentage: 1,
      current_usage: { cache_read_input_tokens: 0, cache_creation_input_tokens: 0, input_tokens: 1 },
    },
    cost: { total_cost_usd: 0 },
  });
  const result = spawnSync("bash", [statusline], {
    cwd: root,
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      AI_CONFIG_ROOT: repo,
      PM_SESSION_BINDINGS_ROOT: storeRoot,
      ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
      CLAUDE_CONFIG_DIR: "",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test("statusline uses the exact raw session binding and ignores launcher changes", async (t) => {
  const { root, planA, planB } = await fixture();
  const home = await mkdtemp(join(tmpdir(), "session-consumers-home-"));
  const storeRoot = await mkdtemp(join(tmpdir(), "session-consumers-bindings-"));
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(home, { recursive: true, force: true }),
    rm(storeRoot, { recursive: true, force: true }),
  ]));
  await bindSession({ root, tool: "claude", sessionId: "same/a", plan: planA.plan, storeRoot });
  await bindSession({ root, tool: "claude", sessionId: "same?a", plan: planB.plan, storeRoot });

  await writeFile(join(root, ".agents", "state", "current.txt"), `${planA.plan}\n`);
  assert.match(runStatusline({ root, home, storeRoot, sessionId: "same/a" }), /draft/);
  await writeFile(join(root, ".agents", "state", "current.txt"), `${planB.plan}\n`);
  const sessionA = runStatusline({ root, home, storeRoot, sessionId: "same/a" });
  const sessionB = runStatusline({ root, home, storeRoot, sessionId: "same?a" });
  assert.match(sessionA, /draft/);
  assert.doesNotMatch(sessionA, /active/);
  assert.match(sessionB, /active/);
});

test("statusline and pre-commit contracts contain no checkout-current rediscovery", async () => {
  const statuslineSource = await readFile(statusline, "utf8");
  const verifier = await readFile(join(repo, "claude", "agents", "pre-commit-verifier.md"), "utf8");
  const invocation = await readFile(join(repo, "claude", "memory", "claude-feedback_pre_commit_scan_invoke.md"), "utf8");
  assert.match(statuslineSource, /session_id_raw/);
  assert.match(statuslineSource, /resolve-session/);
  assert.doesNotMatch(statuslineSource, /\.agents\/state\/current\.txt/);
  assert.match(verifier, /validated_plan_path/);
  assert.match(verifier, /validated_plan_status/);
  assert.doesNotMatch(verifier, /current\.txt/);
  assert.match(invocation, /validated_plan_path/);
  assert.match(invocation, /session-routing block/);
  assert.doesNotMatch(invocation, /current\.txt/);
});

test("every interactive current-plan consumer declares session-aware routing or launcher exemption", async () => {
  const sessionAware = [
    "ai/skills/plan-review/SKILL.md",
    "ai/skills/verify/SKILL.md",
    "ai/skills/retro/SKILL.md",
    "ai/skills/pm-context/SKILL.md",
    "ai/skills/grill/SKILL.md",
  ];
  for (const path of sessionAware) {
    assert.match(await readFile(join(repo, path), "utf8"), /resolve-session/, `${path} must resolve the originating session`);
  }

  const pmContext = await readFile(join(repo, "ai/skills/pm-context/SKILL.md"), "utf8");
  const listSection = pmContext.match(/### list\n([\s\S]*?)(?=\n### manage)/)?.[1] ?? "";
  assert.match(listSection, /resolve-session/, "pm-context list must derive its marker from the session plan");
  assert.doesNotMatch(listSection, /pm current-task/, "pm-context list must not consume launcher state");

  const worktree = await readFile(join(repo, "ai/skills/worktree/SKILL.md"), "utf8");
  assert.match(worktree, /bind-session/);
  assert.match(worktree, /ensure-session/);
  assert.match(worktree, /unbound main/);

  const roadmap = await readFile(join(repo, "ai/skills/pm-roadmap/SKILL.md"), "utf8");
  assert.match(roadmap, /launcher\/dashboard/);
  assert.match(roadmap, /session-routing block/);

  for (const path of ["claude/DEVGUARD.md", "codex/DEVGUARD.md", "claude/README.md", "codex/README.md"]) {
    const source = await readFile(join(repo, path), "utf8");
    assert.match(source, /session binding|session-bound|session routing/i, `${path} must document session routing`);
    assert.match(source, /launcher-only/, `${path} must document main launcher semantics`);
  }

  const guardrails = await readFile(join(repo, "ai/guardrails.md"), "utf8");
  assert.match(guardrails, /restored or compacted summaries are context only/i);
  assert.match(guardrails, /Explicit non-plan task wording/);
  assert.match(guardrails, /plan execution or lifecycle action requires a validated session binding/i);

  const selfReview = await readFile(join(repo, "ai/skills/self-review/SKILL.md"), "utf8");
  assert.match(selfReview, /Restored Context Authority/, "self-review must mirror the shared guardrail");

  for (const path of ["claude/DEVGUARD.md", "codex/DEVGUARD.md"]) {
    assert.doesNotMatch(
      await readFile(join(repo, path), "utf8"),
      /restored or compacted summaries are context only/,
      `${path} must not duplicate shared continuation policy`,
    );
  }

  for (const path of ["claude/README.md", "codex/README.md"]) {
    const source = await readFile(join(repo, path), "utf8");
    assert.match(source, /restored|compacted|summary-only/i, `${path} must document continuation-guard delivery`);
  }

  const audit = await readFile(join(repo, "ai/skills/config-audit/SKILL.md"), "utf8");
  assert.match(audit, /ensure-session/);
  assert.match(audit, /unbound main/);
  assert.match(audit, /session_id/);
  assert.match(audit, /continuation guard/);
  assert.match(audit, /every\s+branch without a validated/);
});
