import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// claude/scripts/sync-back.sh derives its repo root from its own location, so each
// fixture gets a copy of the script under <root>/claude/scripts/ and runs that copy.
const here = dirname(fileURLToPath(import.meta.url));
const repo = dirname(dirname(here));
const script = join(repo, "claude", "scripts", "sync-back.sh");
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "sync-back-manifest-"));
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  await mkdir(join(root, "ai", "memory", "private"), { recursive: true });
  await mkdir(join(root, "claude", "scripts"), { recursive: true });
  await copyFile(script, join(root, "claude", "scripts", "sync-back.sh"));
  await writeFile(join(root, "ai", "memory", "shared.md"), "shared\n");
  await writeFile(join(root, "ai", "memory", "private", "secret.md"), "private, gitignored\n");
  await writeFile(join(root, "ai", "AGENTS.manifest"), "memory/shared.md\nmemory/private/secret.md\n");
  await writeFile(join(root, ".gitignore"), "ai/memory/private/\n");
  git(root, "add", "-A");
  git(root, "commit", "-m", "fixture");
  const worktree = join(root, "wt");
  git(root, "worktree", "add", "-q", "-b", "agent/fixture", worktree);
  // An empty HOME keeps the settings.json half of the script inert.
  const home = await mkdtemp(join(tmpdir(), "sync-back-home-"));
  return { root, worktree, home };
}

const run = (checkout, home) =>
  spawnSync("bash", [join(checkout, "claude", "scripts", "sync-back.sh"), "--strict"], {
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });

// Lines indented under "WARN: AGENTS.manifest references missing files:".
function staleEntries(stdout) {
  const lines = stdout.split("\n");
  const start = lines.findIndex((line) => line.startsWith("WARN: AGENTS.manifest references missing files:"));
  if (start === -1) return [];
  const entries = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("  ")) break;
    entries.push(line.trim());
  }
  return entries;
}

test("a linked worktree resolves gitignored private manifest entries against the main checkout", async () => {
  const { worktree, home } = await fixture();
  const result = run(worktree, home);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /INFO: private manifest entries resolved against the main checkout/);
  assert.match(result.stdout, /^ {2}memory\/private\/secret\.md$/m);
  assert.doesNotMatch(result.stdout, /FAIL/);
  assert.deepEqual(staleEntries(result.stdout), []);
});

test("genuine drift still fails in strict mode, including a private entry missing everywhere", async () => {
  const { worktree, home } = await fixture();
  await writeFile(
    join(worktree, "ai", "AGENTS.manifest"),
    "memory/shared.md\nmemory/private/secret.md\nmemory/private/never-created.md\nmemory/gone.md\n",
  );
  const result = run(worktree, home);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.deepEqual(staleEntries(result.stdout).sort(), ["memory/gone.md", "memory/private/never-created.md"]);
  assert.match(result.stdout, /FAIL: --strict/);
});

test("a Windows ';' plugin-dir list syncs back to the repo as ':'", async () => {
  const { root, home } = await fixture();
  const settings = (dirs) =>
    `${JSON.stringify({ env: { CLAUDE_CODE_PLUGIN_DIRS: dirs }, permissions: { allow: [], deny: [] } }, null, 2)}\n`;
  const repoDirs = "~/.claude/mods/pm-band:~/.claude/mods/pager-view";
  await writeFile(join(root, "claude", "settings.json"), settings(repoDirs));
  await mkdir(join(home, ".claude"), { recursive: true });
  // What claude/scripts/bootstrap.sh deploys on Windows.
  await writeFile(join(home, ".claude", "settings.json"), settings(repoDirs.replace(":", ";")));

  const result = run(root, home);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /Synced: settings\.json/);
  const synced = JSON.parse(await readFile(join(root, "claude", "settings.json"), "utf8"));
  assert.equal(synced.env.CLAUDE_CODE_PLUGIN_DIRS, repoDirs);
});

test("env keys the Windows fragment deploys are not reported as untracked", async () => {
  const { root, home } = await fixture();
  const settings = (env) => `${JSON.stringify({ env, permissions: { allow: [], deny: [] } }, null, 2)}\n`;
  await writeFile(join(root, "claude", "settings.json"), settings({ TRACKED: "1" }));
  await mkdir(join(root, "windows"), { recursive: true });
  await writeFile(join(root, "windows", "claude-settings.windows.json"), settings({ CLAUDE_CODE_GIT_BASH_PATH: "__GIT_BASH_PATH__" }));
  await mkdir(join(home, ".claude"), { recursive: true });
  // What windows/scripts/deploy-ai.ps1 leaves, plus one key set by hand in a session.
  await writeFile(
    join(home, ".claude", "settings.json"),
    settings({ TRACKED: "1", CLAUDE_CODE_GIT_BASH_PATH: "C:\\Git\\bin\\bash.exe", HAND_SET: "1" }),
  );

  const result = run(root, home);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /not tracked in the repo[\s\S]*HAND_SET/);
  assert.doesNotMatch(result.stdout, /CLAUDE_CODE_GIT_BASH_PATH/);
});

test("the main checkout is unaffected: nothing is stale and no INFO line is printed", async () => {
  const { root, home } = await fixture();
  const result = run(root, home);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /INFO: private manifest entries/);
  assert.deepEqual(staleEntries(result.stdout), []);
});
