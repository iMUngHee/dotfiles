import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test("bootstrap backs up settings while excluding runtime locks and scratch directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "bootstrap-backup-"));
  const home = join(root, "home");
  await mkdir(join(root, "ai", "scripts"), { recursive: true });
  await copyFile(join(repo, "ai", "scripts", "bootstrap.sh"), join(root, "ai", "scripts", "bootstrap.sh"));
  // Stub deploy steps so the fixture never touches the real tool homes.
  // The notifier builds run only on their own platform (macOS with swiftc,
  // Linux with go), so a stub missing here fails on that platform alone.
  for (const file of [
    "claude/scripts/bootstrap.sh",
    "codex/scripts/bootstrap.sh",
    "ai/lib/verify-no-residual-tokens.sh",
    "ai/lib/verify-agents-md-size.sh",
    "notifier/macos/build.sh",
    "notifier/linux/build.sh",
  ]) {
    const target = join(root, file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, "#!/bin/bash\nexit 0\n", { mode: 0o755 });
  }
  for (const tool of [".claude", ".codex"]) {
    const source = join(home, tool);
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "settings.json"), "fixture settings\n");
    await writeFile(join(source, ".hidden-setting"), "fixture hidden setting\n");
    await writeFile(join(source, ".sqlite-maintenance.lock"), "runtime only\n");
    await writeFile(join(source, "session.lock"), "runtime only\n");
    for (const runtime of ["tmp", ".tmp", "thread-writer-locks", "project-metadata-locks"]) {
      await mkdir(join(source, runtime));
      await writeFile(join(source, runtime, "session.lock"), "runtime only\n");
    }
  }
  const result = spawnSync("bash", [join(root, "ai", "scripts", "bootstrap.sh"), "--no-cleanup-backups"], {
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const tool of [".claude", ".codex"]) {
    const backup = (await readdir(home)).find((name) => name.startsWith(`${tool}.bak.`));
    assert.ok(backup, `${tool} backup created`);
    const saved = join(home, backup);
    assert.deepEqual((await readdir(saved)).sort(), [".hidden-setting", "settings.json"]);
    assert.equal(await readFile(join(saved, "settings.json"), "utf8"), "fixture settings\n");
    assert.equal(await readFile(join(saved, ".hidden-setting"), "utf8"), "fixture hidden setting\n");
  }
});
