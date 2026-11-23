import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const asset = new URL("../skills/project-bootstrap/assets/agents-build.mjs", import.meta.url);

function fixture(t) {
  const root = fs.mkdtempSync(path.join(tmpdir(), "project-bootstrap-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const at = (name) => path.join(root, name);
  const put = (name, data) => {
    fs.mkdirSync(path.dirname(at(name)), { recursive: true });
    fs.writeFileSync(at(name), data);
  };
  put(".ai/PROJECT.md", "# Local conventions\n");
  fs.mkdirSync(at("scripts"));
  fs.copyFileSync(asset, at("scripts/agents-build.mjs"));
  const run = (...args) => spawnSync(process.execPath, [at("scripts/agents-build.mjs"), ...args], { encoding: "utf8" });
  return { root, at, put, run };
}

function snapshot(dir) {
  return fs.readdirSync(dir, { recursive: true }).sort().map((name) => {
    const full = path.join(dir, name);
    const st = fs.lstatSync(full, { bigint: true });
    const content = st.isSymbolicLink() ? fs.readlinkSync(full) : st.isFile() ? fs.readFileSync(full, "base64") : null;
    return [name, st.mtimeNs, content];
  });
}

test("project-only build, no-op rerun and read-only checks for missing, current and stale outputs", (t) => {
  const f = fixture(t);
  for (const state of ["missing", "current", "stale"]) {
    if (state === "stale") f.put(".ai/PROJECT.md", "# Updated\n");
    const before = snapshot(f.root);
    assert.equal(f.run("--check").status, state === "current" ? 0 : 1);
    assert.deepEqual(snapshot(f.root), before);
    assert.equal(f.run().status, 0);
    if (state === "current") assert.deepEqual(snapshot(f.root), before);
  }
  assert.match(fs.readFileSync(f.at("AGENTS.md"), "utf8"), /# Updated/);
});

test("scope, discovery, exact stale link pruning and preserved foreign links", (t) => {
  const f = fixture(t);
  f.put(".ai/rules/cli.md", '---\npaths:\n  - "cli/**"\n---\n# Terminal\n');
  f.put(".ai/skills/release/SKILL.md", "# Release\n");
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(f.at("AGENTS.md"), "utf8"), /cli\/\*\*/);
  for (const dir of [".agents/skills", ".claude/skills"]) {
    assert.equal(fs.realpathSync(f.at(dir + "/release")), f.at(".ai/skills/release"));
  }
  fs.symlinkSync("../../.ai/PROJECT.md", f.at(".claude/rules/user.md"));
  fs.rmSync(f.at(".ai/skills/release"), { recursive: true });
  fs.unlinkSync(f.at(".ai/rules/cli.md"));
  assert.equal(f.run().status, 0);
  assert.equal(fs.lstatSync(f.at(".claude/rules/cli.md"), { throwIfNoEntry: false }), undefined);
  assert.equal(fs.lstatSync(f.at(".agents/skills/release"), { throwIfNoEntry: false }), undefined);
  assert.ok(fs.lstatSync(f.at(".claude/rules/user.md")).isSymbolicLink());
});

test("handwritten collision leaves whole tree intact; incomplete prior build is recoverable", (t) => {
  const f = fixture(t);
  f.put("CLAUDE.md", "Handwritten\n");
  const before = snapshot(f.root);
  for (const args of [["--check"], []]) {
    assert.equal(f.run(...args).status, 1);
    assert.deepEqual(snapshot(f.root), before);
  }
  fs.unlinkSync(f.at("CLAUDE.md"));
  assert.equal(f.run().status, 0);
  fs.unlinkSync(f.at("AGENTS.md"));
  assert.equal(f.run().status, 0);
  assert.equal(f.run("--check").status, 0);
});

test("symlinked destination parent and input file are rejected before writes", (t) => {
  const f = fixture(t);
  const elsewhere = fs.mkdtempSync(path.join(tmpdir(), "bootstrap-user-"));
  t.after(() => fs.rmSync(elsewhere, { recursive: true, force: true }));
  f.put(".ai/rules/main.md", "# Main\n");
  fs.symlinkSync(elsewhere, f.at(".claude"), "dir");
  const before = snapshot(f.root);
  assert.equal(f.run().status, 1);
  assert.deepEqual(snapshot(f.root), before);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
  fs.unlinkSync(f.at(".claude"));
  fs.writeFileSync(path.join(elsewhere, "user.md"), "Private\n");
  fs.symlinkSync(path.join(elsewhere, "user.md"), f.at(".ai/rules/other.md"));
  assert.equal(f.run().status, 1);
  assert.equal(fs.existsSync(f.at("AGENTS.md")), false);
});
