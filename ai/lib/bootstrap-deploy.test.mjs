import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
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
  const run = (prelude = "", extraEnv = {}) => {
    // Direct bootstrap calls must create native symlinks without a Windows wrapper.
    const result = spawnSync("bash", ["-c", `${prelude}\nexec bash "$1"`, "_", join(root, tool, "scripts", "bootstrap.sh")], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, CODEX_DISABLE_SYSTEM_SKILLS: "0", MSYS: "", PATH: `${join(root, "bin")}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`, ...extraEnv },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result;
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

  test(`${tool} redeploy preserves live link identity and prunes only retired repo skills`, async (t) => {
    const f = await fixture(tool);
    f.run();
    const skills = join(f.skillHome, "skills");
    await mkdir(join(f.root, tool, "skills", "demo"), { recursive: true });
    await writeFile(join(f.root, tool, "skills", "demo", "SKILL.md"), "Native overlay\n");
    await mkdir(join(f.root, "ai", "skills", "private", "demo"), { recursive: true });
    await writeFile(join(f.root, "ai", "skills", "private", "demo", "SKILL.md"), "Private overlay\n");
    f.run();
    const link = join(skills, "demo");
    // Older bootstraps stored the trailing slash from their directory glob.
    await unlink(link);
    await symlink(join(f.root, tool, "skills", "demo") + "/", link, "dir");
    const before = await lstat(link, { bigint: true });
    await symlink(join(f.root, "ai", "skills", "retired"), join(skills, "retired"), "dir");
    const outside = await mkdtemp(join(tmpdir(), "external-skill-"));
    t.after(() => rm(outside, { recursive: true, force: true }));
    await writeFile(join(outside, "SKILL.md"), "External skill\n");
    await symlink(outside, join(skills, "external"), "dir");

    f.run();

    const after = await lstat(link, { bigint: true });
    assert.deepEqual([after.ino, after.mtimeNs], [before.ino, before.mtimeNs], "an unchanged winning overlay must never be unlinked or replaced");
    assert.equal(await readFile(join(link, "SKILL.md"), "utf8"), "Native overlay\n");
    assert.equal(await readFile(join(skills, "external", "SKILL.md"), "utf8"), "External skill\n");
    await assert.rejects(lstat(join(skills, "retired")), { code: "ENOENT" });
  });

  for (const mode of ["native", "bsd-fallback", "failure"]) {
    test(`${tool} replaces a readable live skill (${mode})`, {
      skip: mode === "bsd-fallback" && process.platform !== "linux" && "BSD option fallback is emulated using Linux mv; native platforms run the native case",
    }, async () => {
      const f = await fixture(tool);
      f.run();
      const link = join(f.skillHome, "skills", "demo");
      const old = join(f.root, "ai", "skills", "old-demo");
      await mkdir(old);
      await writeFile(join(old, "SKILL.md"), "Previous target\n");
      await unlink(link);
      await symlink(old, link, "dir");
      // Exported shell functions also work when a Git for Windows launcher
      // prepends its own tool directories ahead of PATH.
      const result = f.run(`
mv() {
    local last arg
    for arg in "$@"; do last="$arg"; done
    if [[ "$last" == */skills/demo ]]; then
        [[ -r "$last/SKILL.md" ]] || return 71
        printf 'Replacing a readable live skill\\n'
        ${mode === "failure" ? "return 72" : ""}
        ${mode === "bsd-fallback" ? `
        # Simulate BSD rejecting -T, then translate its -h for the Linux host.
        [[ "$1" != -Tf ]] || return 1
        [[ "$1" == -fh ]] || return 73
        shift
        command mv -Tf "$@"
        return $?
        ` : ""}
    fi
    command mv "$@"
}
export -f mv
`);
      assert.match(result.stdout, /Replacing a readable live skill/, "replacement must use rename while the destination still exists");
      assert.equal(await readFile(join(link, "SKILL.md"), "utf8"), mode === "failure" ? "Previous target\n" : await readFile(join(f.root, "ai", "skills", "demo", "SKILL.md"), "utf8"));
      if (mode === "failure") assert.match(result.stderr, /warn: cannot link/);
    });
  }
}

test("Codex deploy includes local private memory once with token expansion and no frontmatter", async (t) => {
  const f = await fixture("codex");
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const memory = join(f.root, "ai", "memory", "private");
  await mkdir(memory, { recursive: true });
  await writeFile(join(memory, "local rule.md"), "---\nname: Local rule\n---\nPrivate rule for {{TOOL_NAME}} at {{TOOL_HOME}}\n");
  await writeFile(join(memory, "listed.md"), "Listed private rule\n");
  await writeFile(join(memory, "notes.txt"), "Not an instruction\n");
  await mkdir(join(memory, "directory.md"));
  await writeFile(join(f.root, "ai", "AGENTS.manifest"), "PERSONAL.md\nmemory/private/listed.md\n");
  await writeFile(join(f.root, "codex", "DEVGUARD.md"), "Native addendum\n");
  f.run();
  const agents = await readFile(join(f.home, ".codex", "AGENTS.md"), "utf8");
  assert.ok(agents.includes(`Private rule for Codex CLI at ${f.home}/.codex`));
  assert.equal(agents.split("Listed private rule").length - 1, 1);
  assert.doesNotMatch(agents, /name: Local rule|Not an instruction|directory\.md|\{\{TOOL_/);
  assert.ok(agents.indexOf("Fixture instructions") < agents.indexOf("Private rule for"));
  assert.ok(agents.indexOf("Private rule for") < agents.indexOf("Native addendum"));
  f.run();
  assert.equal(await readFile(join(f.home, ".codex", "AGENTS.md"), "utf8"), agents);
  await rm(memory, { recursive: true });
  await writeFile(join(f.root, "ai", "AGENTS.manifest"), "PERSONAL.md\n");
  f.run();
  assert.doesNotMatch(await readFile(join(f.home, ".codex", "AGENTS.md"), "utf8"), /Private rule for|memory\/private\/|Listed private rule/);
});

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
