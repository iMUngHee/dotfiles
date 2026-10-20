import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function fixture(tool) {
  const home = mkdtempSync(join(tmpdir(), "stop-hook-"));
  const root = join(home, ".config");
  const hookName = tool === "codex" ? "stop-gate.sh" : "stop-handler.sh";
  const hookDir = join(root, tool, "hooks");
  const bin = join(home, "bin");
  for (const dir of [join(hookDir, "lib"), bin, join(root, "ai", "lib")]) mkdirSync(dir, { recursive: true });
  copyFileSync(join(repo, tool, "hooks", hookName), join(hookDir, hookName));
  copyFileSync(join(repo, tool, "hooks", "lib", "detect-project.sh"), join(hookDir, "lib", "detect-project.sh"));
  const putExecutable = (path, text) => { writeFileSync(path, text); chmodSync(path, 0o755); };
  putExecutable(join(hookDir, "notify.sh"), "#!/bin/bash\nexit 0\n");
  putExecutable(join(bin, "node"), '#!/bin/bash\necho "$*" >> "$STOP_AUDIT_CALLS"\ncase "$*" in *session-routing*) sleep 1 ;; esac\nexit "${STOP_AUDIT_EXIT:-0}"\n');
  putExecutable(join(bin, "timeout"), '#!/bin/bash\necho "$1" >> "$STOP_AUDIT_BUDGETS"\nshift\n"$@"\n');
  const env = { ...process.env, HOME: home, PATH: bin + delimiter + process.env.PATH,
    STOP_AUDIT_CALLS: join(home, "calls"), STOP_AUDIT_BUDGETS: join(home, "budgets") };
  // Do not inherit Git's hook/rebase repository selection into the fixture.
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) delete env[key];
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: root, env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  };
  git("init", "-q");
  git("config", "user.email", "fixture@example.com");
  git("config", "user.name", "Fixture");
  writeFileSync(join(root, "ai", "rule.md"), "before\n");
  git("add", "ai/rule.md"); git("commit", "-qm", "fixture");
  writeFileSync(join(root, "ai", "rule.md"), "after\n");
  writeFileSync(join(root, "ai", "lib", "untracked.test.mjs"), "fixture\n");
  const run = (extra = {}) => spawnSync("bash", [join(hookDir, hookName)], {
    cwd: root, env: { ...env, ...extra }, encoding: "utf8",
    input: JSON.stringify({ session_id: `stop-${tool}-${home.split(/[\\/]/).at(-1)}`, cwd: root }),
  });
  return { home, root, hook: join(hookDir, hookName), run, env };
}

for (const tool of ["codex", "claude"]) {
  test(`${tool} Stop runs contract and untracked tests with a shared suite budget`, () => {
    const f = fixture(tool);
    const r = f.run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const calls = readFileSync(f.env.STOP_AUDIT_CALLS, "utf8").trim().split(/\r?\n/);
    assert.equal(calls.length, 2, "tracked instructions and an untracked ai/lib test both trigger suites");
    assert.match(calls[0], /session-routing-consumers/);
    assert.match(calls[1], /untracked.test.mjs/);
    const budgets = readFileSync(f.env.STOP_AUDIT_BUDGETS, "utf8").trim().split(/\r?\n/).map(Number);
    assert.ok(budgets.every((n) => n > 0 && n <= 300));
    assert.ok(budgets[1] < budgets[0], "later suites consume the remaining budget");
  });

  test(`${tool} Stop blocks a failing suite`, () => {
    const f = fixture(tool);
    const r = f.run({ STOP_AUDIT_EXIT: "17" });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /contract tests failed/);
  });

  test(`${tool} Stop leaves untracked formatter-supported files untouched`, () => {
    const f = fixture(tool);
    const scratch = join(f.root, "scratch.json");
    writeFileSync(scratch, '{ "user": "scratch" }\n');
    mkdirSync(join(f.root, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(f.root, "node_modules", ".bin", "prettier"), "fixture\n");
    const npx = join(f.home, "bin", "npx");
    writeFileSync(npx, '#!/bin/bash\nprintf formatted > "$3"\n');
    chmodSync(npx, 0o755);
    const r = f.run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(readFileSync(scratch, "utf8"), '{ "user": "scratch" }\n');
  });

  test(`${tool} Stop blocks when earlier suites exhaust the shared budget`, () => {
    const f = fixture(tool);
    writeFileSync(f.hook, readFileSync(f.hook, "utf8").replace("SUITE_TIMEOUT=300", "SUITE_TIMEOUT=1"));
    const r = f.run();
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /suite budget exhausted/);
  });
}

test("Stop hook registrations outlive the suite and checker budgets", () => {
  const template = readFileSync(join(repo, "codex", "config.toml.template"), "utf8");
  const codex = template.split("[[hooks.Stop.hooks]]")[1].split("[[hooks.PermissionRequest]]")[0];
  const settings = JSON.parse(readFileSync(join(repo, "claude", "settings.json"), "utf8"));
  const claude = settings.hooks.Stop.flatMap((group) => group.hooks).find((hook) => hook.command.endsWith("stop-handler.sh"));
  // Both products specify command-hook timeout in seconds, not milliseconds.
  for (const [tool, seconds] of [["codex", Number(codex.match(/timeout = (\d+)/)[1])], ["claude", claude.timeout]]) {
    const source = readFileSync(join(repo, tool, "hooks", tool === "codex" ? "stop-gate.sh" : "stop-handler.sh"), "utf8");
    const budget = Number(source.match(/SUITE_TIMEOUT=(\d+)/)[1]) + Number(source.match(/CHECKER_TIMEOUT=(\d+)/)[1]);
    assert.ok(seconds >= budget + 10, `${tool} registration must allow the bounded checks to finish`);
    assert.ok(seconds <= budget + 60, `${tool} registration must remain bounded, not hours long`);
  }
});

test("codex Stop formats a tracked Unicode filename", () => {
  const f = fixture("codex");
  const name = "한글.lua";
  const file = join(f.root, name);
  writeFileSync(file, "before\n");
  for (const args of [["add", name], ["commit", "-qm", "unicode fixture"]]) {
    const r = spawnSync("git", args, { cwd: f.root, env: f.env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  }
  writeFileSync(file, "after\n");
  const stylua = join(f.home, "bin", "stylua");
  writeFileSync(stylua, '#!/bin/bash\nprintf formatted > "$1"\n');
  chmodSync(stylua, 0o755);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(file, "utf8"), "formatted");
});
