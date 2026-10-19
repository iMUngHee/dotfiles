import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

async function fixture(tool) {
  const root = await mkdtemp(join(tmpdir(), "bootstrap-deploy-"));
  const home = join(root, "home");
  const skillHome = join(home, tool === "codex" ? ".agents" : ".claude");
  const put = async (path, text) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  };
  await put("ai/AGENTS.manifest", "PERSONAL.md\n");
  await put("ai/PERSONAL.md", "Fixture instructions\n");
  await put("ai/skills/demo/SKILL.md", "---\nname: demo\n---\nCurrent skill\n");
  await mkdir(join(root, tool, "scripts"), { recursive: true });
  await copyFile(join(repo, tool, "scripts", "bootstrap.sh"), join(root, tool, "scripts", "bootstrap.sh"));
  if (tool === "codex") {
    await copyFile(join(repo, "codex", "config.toml.template"), join(root, "codex", "config.toml.template"));
    await put("home/.codex/config.toml", 'model = "local-choice"\nmodel_reasoning_effort = "high"\n[experimental_network.unix_sockets]\n"/tmp/old.sock" = "allow"\n[mcp_servers.local_fixture]\ncommand = "fixture-server"\n');
  } else {
    await put("claude/CLAUDE.md", "Fixture\n");
    await put("claude/settings.json", '{"permissions":{"allow":[],"deny":[]},"env":{"CLAUDE_CODE_PLUGIN_DIRS":""}}\n');
    // Keep the real Claude CLI out of this fixture's MCP registration step.
    await put("bin/claude", "#!/bin/bash\nexit 0\n");
    await chmod(join(root, "bin", "claude"), 0o755);
  }
  await mkdir(join(skillHome, "skills", "demo"), { recursive: true });
  await writeFile(join(skillHome, "skills", "demo", "SKILL.md"), "User changes in old copy\n");
  await mkdir(join(skillHome, "skills", "demo.stale.123"));
  await writeFile(join(skillHome, "skills", "demo.stale.123", "SKILL.md"), "Earlier backup\n");
  await mkdir(join(skillHome, "skills", "removed.stale.456"));
  await writeFile(join(skillHome, "skills", "removed.stale.456", "SKILL.md"), "Removed skill backup\n");
  await mkdir(join(skillHome, "skills", "user-added"));
  await writeFile(join(skillHome, "skills", "user-added", "SKILL.md"), "Keep user skill\n");
  const run = () => {
    // Direct bootstrap calls must create native symlinks without a Windows wrapper.
    const result = spawnSync("bash", [join(root, tool, "scripts", "bootstrap.sh")], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, CODEX_DISABLE_SYSTEM_SKILLS: "0", MSYS: "", PATH: `${join(root, "bin")}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}` },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  };
  return { root, home, skillHome, run };
}

for (const tool of ["codex", "claude"]) {
  test(`${tool} deploy archives skill copies outside discovery and stays idempotent`, async () => {
    const f = await fixture(tool);
    f.run();
    assert.ok((await lstat(join(f.skillHome, "skills", "demo"))).isSymbolicLink(), "managed skill is a real symlink");
    assert.deepEqual((await readdir(join(f.skillHome, "skills"))).sort(), ["demo", "user-added"]);
    assert.match(await readFile(join(f.skillHome, "skills", "demo", "SKILL.md"), "utf8"), /Current skill/);
    assert.equal(await readFile(join(f.skillHome, "skills", "user-added", "SKILL.md"), "utf8"), "Keep user skill\n");
    const backups = join(f.skillHome, "skill-backups");
    const saved = await readdir(backups, { recursive: true });
    const contents = await Promise.all(saved.filter((p) => p.endsWith("SKILL.md")).map((p) => readFile(join(backups, p), "utf8")));
    assert.deepEqual(contents.sort(), ["Earlier backup\n", "Removed skill backup\n", "User changes in old copy\n"]);
    f.run();
    assert.deepEqual((await readdir(backups, { recursive: true })).sort(), saved.sort());
    assert.deepEqual((await readdir(join(f.skillHome, "skills"))).sort(), ["demo", "user-added"]);
  });
}

test("Codex deploy removes retired network config while preserving local MCP servers", async () => {
  const f = await fixture("codex");
  for (let i = 0; i < 2; i++) {
    f.run();
    const config = await readFile(join(f.home, ".codex", "config.toml"), "utf8");
    assert.doesNotMatch(config, /experimental_network/);
    assert.match(config, /\[mcp_servers.local_fixture\]/);
    assert.match(config, /command = "fixture-server"/);
    assert.match(config, /^model = "local-choice"$/m);
    assert.match(config, /^model_reasoning_effort = "high"$/m);
  }
});

test("Codex deploy prepares an opt-in socket profile with this machine's UID", async () => {
  const f = await fixture("codex");
  f.run();
  const config = await readFile(join(f.home, ".codex", "config.toml"), "utf8");
  const uid = spawnSync("bash", ["-c", "id -u"], { encoding: "utf8" });
  assert.equal(uid.status, 0, uid.stderr);
  assert.match(config, /\[permissions.workspace-local-sockets\]/);
  assert.match(config, /extends = ":workspace"/);
  assert.match(config, /"\/tmp\/agent-notifier.sock" = "allow"/);
  assert.ok(config.includes(`"/private/tmp/tmux-${uid.stdout.trim()}/default" = "allow"`));
  assert.ok(config.includes(`"/tmp/tmux-${uid.stdout.trim()}/default" = "allow"`));
  assert.doesNotMatch(config, /__UID__/);
  assert.doesNotMatch(config, /^default_permissions\s*=/m);
  assert.match(config, /^sandbox_mode = "danger-full-access"$/m);
});
