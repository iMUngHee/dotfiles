import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";

// Every fixture root this file creates, removed once all tests have run.
const tempDirs = [];
after(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

// claude/scripts/sync-back.sh copies repo-tracked settings back from the deployed
// ~/.claude/settings.json. An entry the repo added but never deployed is not in
// the deployed file yet; bootstrap's record of what the repo contributed
// (~/.claude/.settings-repo-managed.json) tells it apart from an entry that was
// deployed and then removed in the UI.

const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const json = (value) => JSON.stringify(value, null, 2) + "\n";

async function fixture({ repoSettings, deployed, record }) {
  const root = await mkdtemp(join(tmpdir(), "sync-back-settings-"));
  tempDirs.push(root);
  const home = join(root, "home");
  for (const path of ["claude/scripts/sync-back.sh", "ai/scripts/sync-back.sh", "githooks/pre-commit"]) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await copyFile(join(repo, path), join(root, path));
    await chmod(join(root, path), 0o755);
  }
  await writeFile(join(root, "claude", "settings.json"), json(repoSettings));
  await mkdir(join(home, ".claude"), { recursive: true });
  await writeFile(join(home, ".claude", "settings.json"), json(deployed));
  if (record) await writeFile(join(home, ".claude", ".settings-repo-managed.json"), json(record));
  const env = { ...process.env, HOME: home };
  // Do not inherit Git's hook/rebase repository selection into the fixture.
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) delete env[key];
  const settingsPath = join(root, "claude", "settings.json");
  const sync = async () => {
    const r = spawnSync("bash", [join(root, "claude", "scripts", "sync-back.sh")], { cwd: root, env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return JSON.parse(await readFile(settingsPath, "utf8"));
  };
  const git = (...args) => execFileSync("git", args, { cwd: root, env, encoding: "utf8" }).trim();
  const gitOutput = (...args) => {
    const r = spawnSync("git", args, { cwd: root, env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return r.stdout + r.stderr;
  };
  return { root, home, settingsPath, sync, git, gitOutput };
}

const record = (allow, deny = [], env = []) => ({ allow, deny, ask: [], env });

test("(1) allow and deny entries the repo added and never deployed are kept", async () => {
  const f = await fixture({
    repoSettings: { permissions: { allow: ["Bash(a*)", "Bash(new*)"], deny: ["Bash(rm*)"] } },
    deployed: { permissions: { allow: ["Bash(a*)"], deny: [] } },
    record: record(["Bash(a*)"]),
  });
  const synced = await f.sync();
  assert.deepEqual(synced.permissions.allow, ["Bash(a*)", "Bash(new*)"]);
  assert.deepEqual(synced.permissions.deny, ["Bash(rm*)"]);
});

test("(2) an env key the repo added and never deployed is kept with the repo value", async () => {
  const f = await fixture({
    repoSettings: { permissions: { allow: [], deny: [] }, env: { KEEP: "repo", ADDED: "repo-value" } },
    deployed: { permissions: { allow: [], deny: [] }, env: { KEEP: "deployed" } },
    record: record([], [], ["KEEP"]),
  });
  assert.deepEqual((await f.sync()).env, { ADDED: "repo-value", KEEP: "deployed" });
});

test("(3) an entry deployed earlier and removed in the UI is dropped", async () => {
  const f = await fixture({
    repoSettings: { permissions: { allow: ["Bash(a*)", "Bash(gone*)"], deny: ["Bash(x*)", "Bash(y*)"] } },
    deployed: { permissions: { allow: ["Bash(a*)"], deny: ["Bash(x*)"] } },
    record: record(["Bash(a*)", "Bash(gone*)"], ["Bash(x*)", "Bash(y*)"]),
  });
  const synced = await f.sync();
  assert.deepEqual(synced.permissions.allow, ["Bash(a*)"]);
  assert.deepEqual(synced.permissions.deny, ["Bash(x*)"]);
});

test("(4) an entry deleted from the repo stays deleted while it is still deployed", async () => {
  const f = await fixture({
    repoSettings: { permissions: { allow: ["Bash(a*)"], deny: [] } },
    deployed: { permissions: { allow: ["Bash(a*)", "Bash(b*)"], deny: [] } },
    record: record(["Bash(a*)", "Bash(b*)"]),
  });
  assert.deepEqual((await f.sync()).permissions.allow, ["Bash(a*)"]);
});

test("(5) an env key deployed earlier and removed from the deployed file is dropped", async () => {
  const f = await fixture({
    repoSettings: { permissions: { allow: [], deny: [] }, env: { KEEP: "repo", GONE: "repo" } },
    deployed: { permissions: { allow: [], deny: [] }, env: { KEEP: "deployed" } },
    record: record([], [], ["GONE", "KEEP"]),
  });
  assert.deepEqual((await f.sync()).env, { KEEP: "deployed" });
});

test("(6) without a record every undeployed repo entry counts as an addition", async () => {
  const f = await fixture({
    repoSettings: { permissions: { allow: ["Bash(a*)", "Bash(new*)"], deny: [] } },
    deployed: { permissions: { allow: ["Bash(a*)"], deny: [] } },
  });
  assert.deepEqual((await f.sync()).permissions.allow, ["Bash(a*)", "Bash(new*)"]);
});

test("(7) with nothing added the deployed order is kept as before", async () => {
  const f = await fixture({
    repoSettings: { permissions: { allow: ["Bash(a*)", "Bash(b*)"], deny: [] } },
    deployed: { permissions: { allow: ["Bash(b*)", "Bash(a*)"], deny: [] } },
    record: record(["Bash(a*)", "Bash(b*)"]),
  });
  assert.deepEqual((await f.sync()).permissions.allow, ["Bash(b*)", "Bash(a*)"]);
});

test("(8) a repo value holding a __TOKEN__ is restored over the deployed expansion", async () => {
  const f = await fixture({
    repoSettings: { permissions: { allow: [], deny: [] }, env: { DIRS: "a__PATH_LIST_SEP__b" } },
    deployed: { permissions: { allow: [], deny: [] }, env: { DIRS: "a:b" } },
    record: record([], [], ["DIRS"]),
  });
  assert.deepEqual((await f.sync()).env, { DIRS: "a__PATH_LIST_SEP__b" });
});

test("(9) a record with mistyped fields reads as empty instead of failing", async () => {
  const f = await fixture({
    repoSettings: { permissions: { allow: ["Bash(a*)", "Bash(new*)"], deny: [] } },
    deployed: { permissions: { allow: ["Bash(a*)"], deny: [] } },
    record: { allow: "Bash(new*)", deny: null, env: 3 },
  });
  assert.deepEqual((await f.sync()).permissions.allow, ["Bash(a*)", "Bash(new*)"]);
});

const hook = (command) => ({ type: "command", command });
const hooks = (...commands) => ({ Stop: [{ matcher: "", hooks: commands.map(hook) }] });
const noPerms = { allow: [], deny: [] };

test("(10) a hook the repo added and never deployed is kept", async () => {
  const deployed = hooks("pager hook");
  const f = await fixture({
    repoSettings: { permissions: noPerms, hooks: hooks("pager hook", "gaebu hook claude") },
    deployed: { permissions: noPerms, hooks: deployed },
    record: { ...record([]), hooks: deployed },
  });
  assert.deepEqual((await f.sync()).hooks, hooks("pager hook", "gaebu hook claude"));
});

test("(11) a hook changed in the UI since the last deploy is synced back", async () => {
  const f = await fixture({
    repoSettings: { permissions: noPerms, hooks: hooks("pager hook") },
    deployed: { permissions: noPerms, hooks: hooks("pager hook", "added in the UI") },
    record: { ...record([]), hooks: hooks("pager hook") },
  });
  assert.deepEqual((await f.sync()).hooks, hooks("pager hook", "added in the UI"));
});

test("(12) a record without hooks keeps the deployed hooks, as before", async () => {
  const f = await fixture({
    repoSettings: { permissions: noPerms, hooks: hooks("pager hook", "gaebu hook claude") },
    deployed: { permissions: noPerms, hooks: hooks("pager hook") },
    record: record([]),
  });
  assert.deepEqual((await f.sync()).hooks, hooks("pager hook"));
});

test("(C2) a commit and an amend through githooks/pre-commit keep an undeployed addition", async () => {
  const f = await fixture({
    repoSettings: { permissions: { allow: ["Bash(a*)"], deny: [] } },
    deployed: { permissions: { allow: ["Bash(a*)"], deny: [] } },
    record: record(["Bash(a*)"]),
  });
  f.git("init", "-q", "-b", "main");
  f.git("config", "user.email", "fixture@example.com");
  f.git("config", "user.name", "Fixture");
  f.git("config", "core.hooksPath", "githooks");
  f.git("add", "-A");
  f.git("commit", "-qm", "fixture");
  await writeFile(f.settingsPath, json({ permissions: { allow: ["Bash(a*)", "Bash(new*)"], deny: [] } }));
  f.git("add", "claude/settings.json");
  f.git("commit", "-qm", "allow new");
  const committed = () => JSON.parse(f.git("show", "HEAD:claude/settings.json")).permissions.allow;
  assert.deepEqual(committed(), ["Bash(a*)", "Bash(new*)"], "the commit kept the addition");
  // githooks/pre-commit only syncs when something under ai/, claude/ or codex/
  // is staged, so the amend stages a claude/ file to make the hook run.
  await writeFile(join(f.root, "claude", "note.md"), "amend\n");
  f.git("add", "claude/note.md");
  const amend = f.gitOutput("commit", "--amend", "--no-edit");
  assert.match(amend, /Nothing to sync\.|Synced: settings\.json/, "sync-back ran during the amend");
  assert.deepEqual(committed(), ["Bash(a*)", "Bash(new*)"], "the amend kept the addition");
});
