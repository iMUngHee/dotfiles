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
  f.put(".ai/skills/.DS_Store", "");
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(f.at("AGENTS.md"), "utf8"), /cli\/\*\*/);
  for (const dir of [".agents/skills", ".claude/skills"]) {
    assert.equal(fs.realpathSync(f.at(dir + "/release")), fs.realpathSync(f.at(".ai/skills/release")));
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

test("AGENTS.md over Codex's 32 KiB default fails before any write", (t) => {
  const f = fixture(t);
  f.put(".ai/rules/long.md", "x".repeat(32768));
  const before = snapshot(f.root);
  for (const args of [["--check"], []]) {
    const result = f.run(...args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /AGENTS\.md would be \d+ bytes; Codex reads 32768/);
    assert.deepEqual(snapshot(f.root), before);
  }
  f.put(".ai/rules/long.md", "x".repeat(32000));
  assert.equal(f.run().status, 0);
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

// ── gate (assets/check.sh, assets/pre-push) ──

const gateAsset = new URL("../skills/project-bootstrap/assets/check.sh", import.meta.url);
const hookAsset = new URL("../skills/project-bootstrap/assets/pre-push", import.meta.url);
// /bin/bash is 3.2 on macOS; the assets must run there.
const BASH = "/bin/bash";
const gitVars = {
  GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
};
const vars = (extra = {}) => ({ ...process.env, ...gitVars, ...extra });

const PASSING_CONFIG = `tool_versions() { echo fixture-tools; }
register_checks() {
  check lint fast "run the linter" -- true
}
`;

function gateRepo(t, { config = PASSING_CONFIG, files = {}, branch = "main" } = {}) {
  const root = fs.mkdtempSync(path.join(tmpdir(), "gate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const at = (name) => path.join(root, name);
  const put = (name, data) => {
    fs.mkdirSync(path.dirname(at(name)), { recursive: true });
    fs.writeFileSync(at(name), data);
  };
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: root, env: vars(), encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git("init", "-q", "-b", branch);
  put("scripts/check.sh", fs.readFileSync(gateAsset));
  put(".githooks/pre-push", fs.readFileSync(hookAsset));
  fs.chmodSync(at("scripts/check.sh"), 0o755);
  fs.chmodSync(at(".githooks/pre-push"), 0o755);
  put("scripts/check-config.sh", config);
  for (const [name, data] of Object.entries(files)) put(name, data);
  git("add", "-A");
  git("commit", "-qm", "init");
  const run = (args = [], extra = {}) =>
    spawnSync(BASH, [at("scripts/check.sh"), ...args], { cwd: root, env: vars(extra), encoding: "utf8" });
  const commit = (message) => { git("add", "-A"); git("commit", "-qm", message); };
  return { root, at, put, git, run, commit };
}

const out = (r) => r.stdout + r.stderr;
const esc = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

test("gate collects every failure with its hint, selects fast checks and lists without running", (t) => {
  const g = gateRepo(t, {
    config: `tool_versions() { :; }
register_checks() {
  check alpha fast "fix alpha like this" -- false
  check beta fast "fix beta like that" -- false
  check gamma full "gamma hint" -- touch ran-full
}
`,
  });
  const fast = g.run(["--fast"]);
  assert.equal(fast.status, 1);
  for (const s of ["alpha", "fix alpha like this", "beta", "fix beta like that"]) assert.match(out(fast), esc(s));
  assert.equal(fs.existsSync(g.at("ran-full")), false);
  const list = g.run(["--list"]);
  assert.equal(list.status, 0, out(list));
  assert.deepEqual(list.stdout.trim().split("\n"), ["alpha", "beta", "gamma"]);
  assert.equal(fs.existsSync(g.at("ran-full")), false);
});

test("pass record needs a clean tree and is keyed by commit, base and date", (t) => {
  const g = gateRepo(t);
  g.put("a.txt", "one\n");
  g.commit("second");
  g.put("dirt.txt", "x");
  assert.equal(g.run().status, 0);
  assert.equal(g.run(["--passed"]).status, 1);
  fs.unlinkSync(g.at("dirt.txt"));
  const today = { CHECK_TODAY: "2030-01-01" };
  assert.equal(g.run([], today).status, 0);
  assert.equal(g.run(["--passed"], today).status, 0);
  assert.equal(g.run(["--passed"], { CHECK_TODAY: "2030-01-02" }).status, 1);
  assert.equal(g.run(["--passed"], { ...today, CHECK_BASE: "HEAD" }).status, 1);
  // The body differs from the commit recorded above, so the amended commit
  // cannot coincide with it even when both are made within one second.
  g.git("commit", "-q", "--amend", "-m", "second\n\nbody\n\nRatchet-Reset: x y");
  assert.equal(g.run([], today).status, 0);
  g.git("commit", "-q", "--amend", "-m", "second\n\nbody");
  assert.equal(g.run(["--passed"], today).status, 1);
});

const TSV_HEAD = "# id\tere\tallow\tmode\tdeadline\treason\tfix\n";
const tsv = (...rows) => TSV_HEAD + rows.map((r) => r.join("\t")).join("\n") + "\n";

test("an inline exception passes before its date and fails after it on the same HEAD", (t) => {
  const g = gateRepo(t, {
    files: {
      "scripts/check-data/banned-patterns.tsv": tsv(["todo", "TODO", "-", "ban", "-", "no loose ends", "finish it"]),
      "src/a.txt": "TODO check-allow(todo): waiting on upstream until=2030-01-01\n",
    },
  });
  assert.equal(g.run([], { CHECK_TODAY: "2029-12-31" }).status, 0);
  const after = { CHECK_TODAY: "2030-01-02" };
  assert.equal(g.run(["--passed"], after).status, 1);
  assert.equal(g.run([], after).status, 1);
});

test("banned patterns report path, id, reason and fix and honour allow globs", (t) => {
  const g = gateRepo(t, {
    files: {
      "scripts/check-data/banned-patterns.tsv": tsv(["effect", "useEffect\\(", "src/framework/*", "ban", "-", "needs nuance", "use the framework hook"]),
      "src/framework/deep/hook.ts": "useEffect(() => {})\n",
    },
  });
  let r = g.run();
  assert.equal(r.status, 0, out(r));
  g.put("src/app/view.ts", "x\nuseEffect(() => {})\n");
  r = g.run();
  assert.equal(r.status, 1);
  for (const s of ["src/app/view.ts:2", "effect", "needs nuance", "use the framework hook"]) assert.match(out(r), esc(s));
});

test("banned patterns keep a path that contains a colon whole", (t) => {
  const g = gateRepo(t, {
    files: {
      "scripts/check-data/banned-patterns.tsv": tsv(["effect", "useEffect", "keep:*", "ban", "-", "r", "f"]),
      "keep:a.ts": "useEffect\n",
      "bad:b.ts": "x\nuseEffect\n",
    },
  });
  const r = g.run();
  assert.equal(r.status, 1);
  assert.match(out(r), /bad:b\.ts:2: \[effect\]/);
  assert.doesNotMatch(out(r), /keep:a\.ts/);
});

test("allow, deadline, inline exception and ratchet are decided in that order", (t) => {
  const rows = tsv(
    ["eff", "EFF", "lib/*", "ban", "-", "r", "f"],
    ["old", "OLD", "-", "ratchet", "2020-01-01", "r", "f"],
    ["leg", "LEG", "-", "ratchet", "-", "r", "f"],
  );
  const g = gateRepo(t, { files: { "scripts/check-data/banned-patterns.tsv": rows } });
  // An expired inline exception inside an allow path only warns.
  g.put("lib/a.txt", "EFF check-allow(eff): stale until=2000-01-01\n");
  let r = g.run(["--fast"]);
  assert.equal(r.status, 0, out(r));
  assert.match(out(r), /redundant check-allow/);
  // Past the deadline, a valid inline exception does not help.
  g.put("src/b.txt", "OLD check-allow(old): later until=2099-01-01\n");
  assert.equal(g.run(["--fast"]).status, 1);
  fs.unlinkSync(g.at("src/b.txt"));
  // A baselined violation that gains an inline exception needs the baseline lowered.
  g.put("src/c.txt", "LEG one\n");
  assert.equal(g.run(["--write-baselines"]).status, 0);
  g.commit("baseline");
  g.put("src/c.txt", "LEG one check-allow(leg): migrating until=2099-01-01\n");
  r = g.run(["--fast"]);
  assert.equal(r.status, 1);
  assert.match(out(r), /lower the baseline/);
  assert.equal(g.run(["--write-baselines"]).status, 0);
  r = g.run(["--fast"]);
  assert.equal(r.status, 0, out(r));
  // A reasonless or expired inline exception fails.
  g.put("src/d.txt", "LEG two check-allow(leg): until=2099-01-01\n");
  assert.equal(g.run(["--fast"]).status, 1);
  g.put("src/d.txt", "LEG two check-allow(leg): gone until=2000-01-01\n");
  assert.equal(g.run(["--fast"]).status, 1);
});

function ratchetRepo(t) {
  const g = gateRepo(t, {
    files: {
      "scripts/check-data/banned-patterns.tsv": tsv(["leg", "LEGACY", "-", "ratchet", "-", "old style", "use the new API"]),
      "src/a.txt": "LEGACY(a,b)\n",
      "src/b.txt": "LEGACY(c)\n",
    },
  });
  assert.equal(g.run(["--write-baselines"]).status, 0);
  g.commit("baseline");
  g.git("checkout", "-q", "-b", "feat");
  return g;
}

test("ratchet identifies violations by content and only moves one way", async (t) => {
  await t.test("within the baseline", (t) => {
    const r = ratchetRepo(t).run();
    assert.equal(r.status, 0, out(r));
  });
  await t.test("replacing one violation with another", (t) => {
    const g = ratchetRepo(t);
    g.put("src/b.txt", "LEGACY(d)\n");
    const r = g.run();
    assert.equal(r.status, 1);
    for (const s of ["src/b.txt:1", "old style", "use the new API"]) assert.match(out(r), esc(s));
  });
  await t.test("duplicating a baselined line", (t) => {
    const g = ratchetRepo(t);
    g.put("src/c.txt", "LEGACY(c)\n");
    const r = g.run();
    assert.equal(r.status, 1);
    // Both copies are listed because content is the identity; the counts say
    // how many are over the baseline.
    assert.match(out(r), /2 lines where the baseline allows 1/);
  });
  await t.test("fewer violations need a lower baseline", (t) => {
    const g = ratchetRepo(t);
    fs.unlinkSync(g.at("src/b.txt"));
    const r = g.run();
    assert.equal(r.status, 1);
    assert.match(out(r), /lower the baseline/);
    assert.equal(g.run(["--write-baselines"]).status, 0);
    assert.equal(g.run().status, 0);
  });
  await t.test("the baseline cannot grow relative to the base", (t) => {
    const g = ratchetRepo(t);
    g.put("src/c.txt", "LEGACY(c)\n");
    assert.equal(g.run(["--write-baselines"]).status, 0);
    assert.equal(g.run().status, 1);
  });
  await t.test("moving a file passes", (t) => {
    const g = ratchetRepo(t);
    g.git("mv", "src/b.txt", "src/moved.txt");
    const r = g.run();
    assert.equal(r.status, 0, out(r));
  });
  await t.test("a first baseline passes", (t) => {
    const g = gateRepo(t, {
      files: {
        "scripts/check-data/banned-patterns.tsv": tsv(["leg", "LEGACY", "-", "ratchet", "-", "r", "f"]),
        "src/a.txt": "LEGACY(a)\n",
      },
    });
    g.git("checkout", "-q", "-b", "feat");
    assert.equal(g.run(["--write-baselines"]).status, 0);
    const r = g.run();
    assert.equal(r.status, 0, out(r));
  });
  await t.test("an unresolvable base fails and names CHECK_BASE", (t) => {
    const g = gateRepo(t, {
      branch: "trunk",
      files: {
        "scripts/check-data/banned-patterns.tsv": tsv(["leg", "LEGACY", "-", "ratchet", "-", "r", "f"]),
        "src/a.txt": "LEGACY(a)\n",
      },
    });
    const r = g.run();
    assert.equal(r.status, 1);
    assert.match(out(r), /CHECK_BASE/);
  });
  await t.test("a reformat needs a Ratchet-Reset trailer and cannot add violations", (t) => {
    const g = ratchetRepo(t);
    g.put("src/a.txt", "LEGACY(a, b)\n");
    g.run(["--write-baselines"]);
    g.commit("reformat");
    assert.equal(g.run().status, 1);
    g.git("commit", "-q", "--amend", "-m", "reformat\n\nRatchet-Reset: leg spacing after the formatter upgrade");
    const r = g.run();
    assert.equal(r.status, 0, out(r));
    g.put("src/c.txt", "LEGACY(e)\n");
    g.run(["--write-baselines"]);
    g.commit("more");
    assert.equal(g.run().status, 1);
  });
  await t.test("a passed deadline fails baselined lines", (t) => {
    const g = gateRepo(t, {
      files: {
        "scripts/check-data/banned-patterns.tsv": tsv(["old", "OLDAPI", "-", "ratchet", "2020-01-01", "deprecated", "call newApi"]),
        "src/a.txt": "OLDAPI()\n",
      },
    });
    g.run(["--write-baselines"]);
    g.commit("baseline");
    assert.equal(g.run().status, 1);
  });
});

const LEG_PATTERNS = tsv(["leg", "LEGACY", "-", "ratchet", "-", "old style", "use the new API"]);

// A repository whose ratchet is adopted in a second commit on its default branch.
function adoptedRatchet(t, opts = {}) {
  const g = gateRepo(t, { files: { "src/a.txt": "LEGACY(a)\n" }, ...opts });
  g.put("scripts/check-data/banned-patterns.tsv", LEG_PATTERNS);
  assert.equal(g.run(["--write-baselines"]).status, 0);
  g.commit("adopt the ratchet");
  return g;
}

// Commits a larger baseline, as a contributor who rewrote it would.
function growBaseline(g) {
  g.put("src/c.txt", "LEGACY(c)\n");
  assert.equal(g.run(["--write-baselines"]).status, 0);
  g.commit("grow the baseline");
}

test("base on the default branch", async (t) => {
  await t.test("a committed baseline increase on main fails without a remote", (t) => {
    const g = adoptedRatchet(t);
    growBaseline(g);
    const r = g.run();
    assert.equal(r.status, 1);
    assert.match(out(r), /the baseline grew relative to the base/);
  });
  await t.test("a detached HEAD at the default branch compares with its first parent", (t) => {
    const g = adoptedRatchet(t);
    growBaseline(g);
    g.git("checkout", "-q", "--detach");
    const r = g.run();
    assert.equal(r.status, 1);
    assert.match(out(r), /the baseline grew relative to the base/);
  });
  await t.test("a default branch whose name has a slash is recognized through origin/HEAD", (t) => {
    const g = adoptedRatchet(t, { branch: "dev/main" });
    growBaseline(g);
    g.git("update-ref", "refs/remotes/origin/dev/main", "HEAD");
    g.git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/dev/main");
    const r = g.run();
    assert.equal(r.status, 1);
    assert.match(out(r), /the baseline grew relative to the base/);
  });
  await t.test("a parent that cannot be read fails and says to fetch or set CHECK_BASE", (t) => {
    const g = adoptedRatchet(t);
    growBaseline(g);
    const clone = fs.mkdtempSync(path.join(tmpdir(), "gate-shallow-"));
    t.after(() => fs.rmSync(clone, { recursive: true, force: true }));
    const c = spawnSync("git", ["clone", "-q", "--depth", "1", `file://${g.root}`, clone], { env: vars(), encoding: "utf8" });
    assert.equal(c.status, 0, c.stderr);
    const r = spawnSync(BASH, [path.join(clone, "scripts/check.sh")], { cwd: clone, env: vars(), encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.match(out(r), /fetch/);
    assert.match(out(r), /CHECK_BASE/);
  });
  await t.test("--base prints the base alone", (t) => {
    const g = gateRepo(t);
    let r = g.run(["--base"]);
    assert.equal(r.status, 0, out(r));
    assert.equal(r.stdout, "root\n");
    g.put("a.txt", "a\n");
    g.commit("second");
    r = g.run(["--base"]);
    assert.equal(r.stdout, g.git("rev-parse", "HEAD~1") + "\n");
    g.git("checkout", "-q", "-b", "feat");
    r = g.run(["--base"]);
    assert.equal(r.stdout, g.git("rev-parse", "HEAD") + "\n");
    const trunk = gateRepo(t, { branch: "trunk" });
    r = trunk.run(["--base"]);
    assert.notEqual(r.status, 0);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /CHECK_BASE/);
  });
  await t.test("an unresolved base never counts as passed", (t) => {
    const g = gateRepo(t, { branch: "trunk" });
    const today = { CHECK_TODAY: "2030-01-01" };
    assert.equal(g.run([], today).status, 0);
    assert.equal(g.run(["--passed"], today).status, 1);
  });
  await t.test("a commit header that cannot be read is not a first adoption", (t) => {
    const g = adoptedRatchet(t);
    growBaseline(g);
    const bin = path.join(g.root, "..", `${path.basename(g.root)}-bin`);
    fs.mkdirSync(bin);
    t.after(() => fs.rmSync(bin, { recursive: true, force: true }));
    const real = spawnSync("sh", ["-c", "command -v git"], { env: vars(), encoding: "utf8" }).stdout.trim();
    fs.writeFileSync(path.join(bin, "git"), `#!/bin/sh\n[ "$1 $2" = "cat-file commit" ] && exit 1\nexec "${real}" "$@"\n`, { mode: 0o755 });
    const r = g.run([], { PATH: `${bin}:${vars().PATH}` });
    assert.equal(r.status, 1);
    assert.match(out(r), /cannot read the commit HEAD/);
  });
  await t.test("a CHECK_BASE set by check-config.sh is honored", (t) => {
    const g = gateRepo(t, {
      branch: "trunk",
      config: `CHECK_BASE=$(git rev-parse HEAD)\n${PASSING_CONFIG}`,
      files: { "scripts/check-data/banned-patterns.tsv": LEG_PATTERNS, "src/a.txt": "LEGACY(a)\n" },
    });
    assert.equal(g.run(["--write-baselines"]).status, 0);
    const r = g.run();
    assert.equal(r.status, 0, out(r));
    assert.equal(g.run(["--base"]).stdout, g.git("rev-parse", "HEAD") + "\n");
  });
  await t.test("a baseline that exists at the base but cannot be read fails", (t) => {
    const g = adoptedRatchet(t);
    growBaseline(g);
    const bin = path.join(g.root, "..", `${path.basename(g.root)}-bin`);
    fs.mkdirSync(bin);
    t.after(() => fs.rmSync(bin, { recursive: true, force: true }));
    const real = spawnSync("sh", ["-c", "command -v git"], { env: vars(), encoding: "utf8" }).stdout.trim();
    fs.writeFileSync(path.join(bin, "git"), `#!/bin/sh\n[ "$1" = show ] && exit 128\nexec "${real}" "$@"\n`, { mode: 0o755 });
    const r = g.run([], { PATH: `${bin}:${vars().PATH}` });
    assert.equal(r.status, 1);
    assert.match(out(r), /cannot read scripts\/check-data\/ratchet\/leg\.txt at/);
  });
  await t.test("--base prints only the base when check-config.sh writes to stdout", (t) => {
    const g = gateRepo(t, { config: `echo Loading toolchain\n${PASSING_CONFIG}` });
    const r = g.run(["--base"]);
    assert.equal(r.stdout, "root\n");
  });
  await t.test("control: a baseline in the root commit is a first adoption", (t) => {
    const g = gateRepo(t, { files: { "scripts/check-data/banned-patterns.tsv": LEG_PATTERNS, "src/a.txt": "LEGACY(a)\n" } });
    assert.equal(g.run(["--write-baselines"]).status, 0);
    g.git("add", "-A");
    g.git("commit", "-q", "--amend", "--no-edit");
    const r = g.run();
    assert.equal(r.status, 0, out(r));
  });
  await t.test("control: a pass on main is recorded", (t) => {
    const g = adoptedRatchet(t);
    const today = { CHECK_TODAY: "2030-01-01" };
    assert.equal(g.run([], today).status, 0);
    assert.equal(g.run(["--passed"], today).status, 0);
  });
});

test("rule tags", async (t) => {
  const rules = (t, body) => {
    const g = gateRepo(t, {
      files: {
        "scripts/check-data/banned-patterns.tsv": tsv(["leg", "LEGACY", "-", "ban", "-", "r", "f"]),
        ".ai/rules/main.md": body,
      },
    });
    return g.run(["--fast"]);
  };
  const fails = {
    "missing": "- Do the thing\n",
    "unknown name": "- Do the thing [check: nope]\n",
    "empty reason": "- Do the thing [unchecked: ]\n",
    "empty check list": "- Do the thing [check: ]\n",
    "two tags": "- Do the thing [check: lint] [unchecked: why]\n",
  };
  for (const [name, body] of Object.entries(fails)) {
    await t.test(`fails: ${name}`, (t) => assert.equal(rules(t, body).status, 1));
  }
  const passes = {
    "check name": "- Lint everything [check: lint]\n",
    "banned id": "- No legacy calls [check: banned:leg]\n",
    "unchecked with reason": "- Name things well [unchecked: needs judgment]\n",
    "fenced example": "---\npaths:\n  - \"src/**\"\n---\n- Rule [check: lint]\n\n```md\n- not a rule\n```\n",
    "multi-line item": "- A long rule that\n  continues here [check: lint]\n",
    "CRLF": "- Rule [check: lint]\r\n- Other [unchecked: judgment]\r\n",
  };
  for (const [name, body] of Object.entries(passes)) {
    await t.test(`passes: ${name}`, (t) => {
      const r = rules(t, body);
      assert.equal(r.status, 0, out(r));
    });
  }
});

test("pre-push skips a passed HEAD and refuses other commits and dirty trees", (t) => {
  const remote = fs.mkdtempSync(path.join(tmpdir(), "gate-remote-"));
  t.after(() => fs.rmSync(remote, { recursive: true, force: true }));
  spawnSync("git", ["init", "-q", "--bare", "-b", "main", remote], { env: vars() });
  const g = gateRepo(t, {
    config: `tool_versions() { echo t; }
register_checks() {
  check marker fast "none" -- touch "$PWD/../fast-ran-$(basename "$PWD")"
}
`,
  });
  g.git("config", "core.hooksPath", ".githooks");
  g.git("remote", "add", "origin", remote);
  const marker = path.join(path.dirname(g.root), `fast-ran-${path.basename(g.root)}`);
  t.after(() => fs.rmSync(marker, { force: true }));
  const push = (cwd, ...args) => spawnSync("git", ["push", "origin", ...args], { cwd, env: vars(), encoding: "utf8" });

  assert.equal(g.run().status, 0);
  fs.rmSync(marker, { force: true });
  let r = push(g.root, "main");
  assert.equal(r.status, 0, out(r));
  assert.match(out(r), /already passed/);
  assert.equal(fs.existsSync(marker), false);

  g.git("checkout", "-q", "-b", "other");
  g.put("o.txt", "o\n");
  g.commit("other");
  g.git("checkout", "-q", "main");
  r = push(g.root, "other");
  assert.notEqual(r.status, 0);
  assert.match(out(r), /check it out/);
  assert.equal(fs.existsSync(marker), false);

  g.put("scripts/check-config.sh", fs.readFileSync(g.at("scripts/check-config.sh"), "utf8") + "\n");
  r = push(g.root, "main");
  assert.notEqual(r.status, 0);
  assert.match(out(r), /uncommitted changes/);
  g.git("checkout", "--", ".");

  const state = () => [
    g.git("for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/tags"),
    g.git("config", "--local", "--list"),
  ];
  const wt = path.join(path.dirname(g.root), `${path.basename(g.root)}-wt`);
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));
  g.git("worktree", "add", "-q", wt, "-b", "wtb");
  const before = state();
  r = push(wt, "wtb");
  assert.equal(r.status, 0, out(r));
  assert.deepEqual(state(), before);
});

const FORMAL_HEAD = "# name\tcommand\tcovers\tsynced\ttier\tproperty\n";

// A repository whose formal.tsv row covers src/queue/* and is synced at the
// commit that created the covered code.
function formalRepo(t, { tier = "manual", command = "true", covers = "src/queue/*" } = {}) {
  const g = gateRepo(t, { files: { "src/queue/queue.js": "export const q = [];\n", "src/other.js": "x\n" } });
  const synced = g.git("rev-parse", "HEAD");
  const row = (sha, extra = {}) =>
    FORMAL_HEAD + [extra.name ?? "queue", extra.command ?? command, extra.covers ?? covers, sha, extra.tier ?? tier, "no item is lost"].join("\t") + "\n";
  g.put("scripts/check-data/formal.tsv", row(synced));
  g.commit("record formal check");
  return { ...g, synced, row };
}

test("formal drift fails when covered code changes after the synced commit", async (t) => {
  await t.test("a committed change", (t) => {
    const g = formalRepo(t);
    g.put("src/queue/queue.js", "export const q = [1];\n");
    g.commit("change queue");
    const r = g.run(["--fast"]);
    assert.equal(r.status, 1);
    for (const s of ["queue", "true", "src/queue/queue.js"]) assert.match(out(r), esc(s));
    assert.match(out(r), new RegExp(g.synced.slice(0, 12)));
  });
  await t.test("a working-tree change", (t) => {
    const g = formalRepo(t);
    g.put("src/queue/queue.js", "export const q = [2];\n");
    assert.equal(g.run(["--fast"]).status, 1);
  });
  await t.test("an untracked file", (t) => {
    const g = formalRepo(t);
    g.put("src/queue/new.js", "x\n");
    assert.equal(g.run(["--fast"]).status, 1);
  });
  await t.test("a rename out of the covered paths", (t) => {
    const g = formalRepo(t);
    g.git("mv", "src/queue/queue.js", "src/moved.js");
    g.commit("move");
    assert.equal(g.run(["--fast"]).status, 1);
  });
  await t.test("a deletion", (t) => {
    const g = formalRepo(t);
    g.git("rm", "-q", "src/queue/queue.js");
    g.commit("delete");
    assert.equal(g.run(["--fast"]).status, 1);
  });
  await t.test("a covered path with a space", (t) => {
    const g = formalRepo(t, { covers: "src/my queue/*" });
    g.put("src/my queue/a.js", "x\n");
    assert.equal(g.run(["--fast"]).status, 1);
  });
});

test("formal drift passes unrelated changes, reverted edits and a synced update", async (t) => {
  await t.test("an unrelated change", (t) => {
    const g = formalRepo(t);
    g.put("src/other.js", "y\n");
    g.commit("other");
    const r = g.run(["--fast"]);
    assert.equal(r.status, 0, out(r));
  });
  await t.test("a staged change reverted in the working tree", (t) => {
    const g = formalRepo(t);
    g.put("src/queue/queue.js", "export const q = [3];\n");
    g.git("add", "src/queue/queue.js");
    g.put("src/queue/queue.js", "export const q = [];\n");
    const r = g.run(["--fast"]);
    assert.equal(r.status, 0, out(r));
  });
  await t.test("updating synced after the covered change", (t) => {
    const g = formalRepo(t);
    g.put("src/queue/queue.js", "export const q = [4];\n");
    g.commit("change queue");
    g.put("scripts/check-data/formal.tsv", g.row(g.git("rev-parse", "HEAD")));
    g.commit("resync");
    const r = g.run(["--fast"]);
    assert.equal(r.status, 0, out(r));
  });
});

test("formal.tsv rows are validated", async (t) => {
  const bad = (t, text) => {
    const g = formalRepo(t);
    g.put("scripts/check-data/formal.tsv", text(g));
    return g.run(["--fast"]);
  };
  await t.test("an unknown synced commit", (t) => assert.equal(bad(t, (g) => g.row("0".repeat(40))).status, 1));
  await t.test("a synced commit that is not an ancestor", (t) => {
    const g = formalRepo(t);
    g.git("checkout", "-q", "-b", "side");
    g.put("side.txt", "s\n");
    g.commit("side");
    const side = g.git("rev-parse", "HEAD");
    g.git("checkout", "-q", "main");
    g.put("scripts/check-data/formal.tsv", g.row(side));
    assert.equal(g.run(["--fast"]).status, 1);
  });
  await t.test("a short synced value", (t) => assert.equal(bad(t, (g) => g.row(g.synced.slice(0, 7))).status, 1));
  await t.test("a repeated name", (t) => assert.equal(bad(t, (g) => g.row(g.synced) + g.row(g.synced).split("\n")[1] + "\n").status, 1));
  await t.test("an empty field", (t) => {
    const r = bad(t, (g) => g.row(g.synced, { command: "" }));
    assert.equal(r.status, 1);
    assert.match(out(r), /formal\.tsv:2: expected a unique name/);
    assert.doesNotMatch(out(r), /does not exist/);
  });
  await t.test("a bad tier", (t) => assert.equal(bad(t, (g) => g.row(g.synced, { tier: "often" })).status, 1));
  await t.test("covers of - (a row that can never drift)", (t) => assert.equal(bad(t, (g) => g.row(g.synced, { covers: "-" })).status, 1));
  await t.test("CRLF lines are fine", (t) => {
    const r = bad(t, (g) => g.row(g.synced).replaceAll("\n", "\r\n"));
    assert.equal(r.status, 0, out(r));
  });
});

test("a full-tier formal row becomes a full check that rule tags can name", (t) => {
  const g = formalRepo(t, { tier: "full", command: "touch formal-ran" });
  g.put(".ai/rules/main.md", "- Keep the queue invariant [check: formal:queue]\n");
  g.commit("rule");
  const list = g.run(["--list"]);
  assert.match(list.stdout, /^formal:queue$/m);
  assert.match(list.stdout, /^formal drift$/m);
  let r = g.run(["--fast"]);
  assert.equal(r.status, 0, out(r));
  assert.equal(fs.existsSync(g.at("formal-ran")), false);
  r = g.run();
  assert.equal(fs.existsSync(g.at("formal-ran")), true, out(r));
  const manual = formalRepo(t);
  assert.doesNotMatch(manual.run(["--list"]).stdout, /formal:queue/);
});

// ── rule_files: CONVENTIONS and other registered rule documents ──

const RULES_CONFIG = (ruleFiles) => `tool_versions() { echo fixture-tools; }
register_checks() {
  check lint fast "run the linter" -- true
}
${ruleFiles === undefined ? "" : `rule_files() {\n${ruleFiles}\n}\n`}`;

test("rule tags: registration and legacy compatibility", async (t) => {
  const listed = (g) => g.run(["--list"]).stdout.split("\n");
  await t.test("(a) .ai/rules only keeps the legacy behaviour", (t) => {
    const g = gateRepo(t, { files: { ".ai/rules/main.md": "- Rule [check: lint]\n* untagged legacy list\n" } });
    assert.ok(listed(g).includes("rule tags"));
    const r = g.run(["--fast"]);
    assert.equal(r.status, 0, out(r));
  });
  await t.test("(b) an empty .ai/rules still registers", (t) => {
    const g = gateRepo(t, { files: { ".ai/rules/.keep": "" } });
    assert.ok(listed(g).includes("rule tags"));
  });
  await t.test("(c) neither source registers nothing", (t) => {
    const g = gateRepo(t);
    assert.ok(!listed(g).includes("rule tags"));
  });
  await t.test("(d) rule_files alone registers and checks", (t) => {
    const g = gateRepo(t, { config: RULES_CONFIG("  echo CONVENTIONS.md"), files: { "CONVENTIONS.md": "# Conventions\n\n- Owned rule\n" } });
    assert.ok(listed(g).includes("rule tags"));
    const r = g.run(["--fast"]);
    assert.equal(r.status, 1);
    assert.match(out(r), /CONVENTIONS\.md:3/);
  });
  await t.test("(e) both sources are checked once each", (t) => {
    const g = gateRepo(t, {
      config: RULES_CONFIG("  echo CONVENTIONS.md\n  echo CONVENTIONS.md"),
      files: { ".ai/rules/main.md": "- Legacy [check: lint]\n", "CONVENTIONS.md": "- Owned [unchecked: judgment]\n" },
    });
    const r = g.run(["--fast"]);
    assert.equal(r.status, 0, out(r));
    g.put(".ai/rules/main.md", "- Legacy untagged\n");
    g.commit("break legacy");
    const bad = g.run(["--fast"]);
    assert.equal(bad.status, 1);
    assert.equal(out(bad).match(/main\.md:1/g).length, 1);
    g.put("CONVENTIONS.md", "- Owned untagged\n");
    g.commit("break strict");
    const twice = g.run(["--fast"]);
    assert.equal(out(twice).match(/CONVENTIONS\.md:1/g).length, 1);
  });
  await t.test("(f) a failing function or a missing path fails by name", async (t) => {
    const fn = gateRepo(t, { config: RULES_CONFIG("  return 3") });
    const r1 = fn.run(["--fast"]);
    assert.equal(r1.status, 1);
    assert.match(out(r1), /rule_files.*3/);
    const missing = gateRepo(t, { config: RULES_CONFIG("  echo NOPE.md") });
    const r2 = missing.run(["--fast"]);
    assert.equal(r2.status, 1);
    assert.match(out(r2), /NOPE\.md/);
  });
  await t.test("(i) the legacy grammar is unchanged under .ai/rules", (t) => {
    const g = gateRepo(t, { files: { ".ai/rules/main.md": "* untagged star item\n1. untagged ordered item\n" } });
    const r = g.run(["--fast"]);
    assert.equal(r.status, 0, out(r));
  });
  await t.test("(q) --list prints rule tags without running a failing rule_files", (t) => {
    const g = gateRepo(t, { config: RULES_CONFIG("  touch rule-files-ran\n  return 1") });
    const r = g.run(["--list"]);
    assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /^rule tags$/m);
    assert.equal(fs.existsSync(g.at("rule-files-ran")), false);
  });
});

test("rule tags: the closed grammar for registered documents", async (t) => {
  const doc = (t, body, extraFiles = {}) => {
    const g = gateRepo(t, { config: RULES_CONFIG("  echo CONVENTIONS.md"), files: { "CONVENTIONS.md": body, ...extraFiles } });
    return g.run(["--fast"]);
  };
  const fails = {
    "(g) untagged star item": "# C\n\nGuides: see below.\n\n* Owned rule\n",
    "(g) untagged 2. item": "2. Owned rule\n",
    "(g) untagged 1) item": "1) Owned rule\n",
    "(j) one-space indented item": " - Indented rule\n",
    "(j) tab after the marker": "-\tTabbed rule\n",
    "(l) a marker-only item": "-\n  Rule on the next line\n",
    "(n) an indented marker right after an item": "- Parent [check: lint]\n  - Child\n",
    "(n) an indented marker after a blank line": "- Parent [check: lint]\n\n    - Child\n",
    "(n) a column-0 item right after a paragraph": "Some paragraph\n- Untagged rule\n",
    "(x) an unterminated fence": "- Rule [check: lint]\n```\n- Swallowed rule [check: lint]\n",
    "(z) a list inside a block quote": "> - Quoted rule with no tag\n",
  };
  for (const [name, body] of Object.entries(fails)) {
    await t.test(`fails: ${name}`, (t) => assert.equal(doc(t, body).status, 1));
  }
  const passes = {
    "(g) paragraphs, tables and link paragraphs": "# C\n\nFollows [Google](https://example.com).\n\n| Area | Guide |\n| --- | --- |\n| x | y |\n\nScoped rules live in [.ai/rules](.ai/rules/main.md).\n\n- Owned rule [unchecked: judgment]\n",
    "(h) four-backtick fence holding three backticks": "````md\n```\n- not a rule\n```\n````\n- Rule [check: lint]\n",
    "(l) a wrapped item tagged on its continuation": "- A long rule that\n  continues here [check: lint]\n",
  };
  for (const [name, body] of Object.entries(passes)) {
    await t.test(`passes: ${name}`, (t) => {
      const r = doc(t, body);
      assert.equal(r.status, 0, out(r));
    });
  }
  await t.test("(j) a backtick fence with a backtick in its info string does not hide a rule", (t) => {
    const r = doc(t, "``` a`b\n- Hidden rule\n");
    assert.match(out(r), /CONVENTIONS\.md:2: end the rule/);
    assert.doesNotMatch(out(r), /close this fence/);
  });
  await t.test("an HTML comment cannot hide a rule", (t) => {
    const r = doc(t, "<!--\n~~~\n-->\n- Untagged rule\n~~~\n");
    assert.equal(r.status, 1);
    assert.match(out(r), /CONVENTIONS\.md:1: rule files take no HTML comments/);
  });
  await t.test("(h) a closing fence with trailing text does not close", (t) => {
    const r = doc(t, "```\nexample\n``` more\n- After rule [check: lint]\n");
    assert.equal(r.status, 1);
    assert.match(out(r), /CONVENTIONS\.md:1: close this fence/);
  });
  await t.test("(x) the legacy grammar keeps its own fence handling", (t) => {
    const g = gateRepo(t, { files: { ".ai/rules/main.md": "- Rule [check: lint]\n```\n- Swallowed\n" } });
    const r = g.run(["--fast"]);
    assert.equal(r.status, 0, out(r));
  });
  await t.test("(p) the item after an indented fence is checked", (t) => {
    const r = doc(t, "- Parent\n  ~~~\n  code [check: lint]\n- Untagged rule\n");
    assert.equal(r.status, 1);
    assert.match(out(r), /CONVENTIONS\.md:4: end the rule/);
    assert.doesNotMatch(out(r), /CONVENTIONS\.md:1:/);
  });
  await t.test("(p) a two-space closing fence closes a column-0 fence", (t) => {
    const r = doc(t, "~~~\nexample\n  ~~~\n- Untagged rule\n");
    assert.match(out(r), /CONVENTIONS\.md:4: end the rule/);
  });
  await t.test("frontmatter is not skipped in a registered document", (t) => {
    const r = doc(t, "---\n- Untagged\n");
    assert.match(out(r), /CONVENTIONS\.md:2: end the rule/);
  });
  await t.test("a number of ten digits is not a list marker", (t) => {
    const r = doc(t, "1234567890. prose\n\n- Rule [check: lint]\n");
    assert.equal(r.status, 0, out(r));
  });
  await t.test("(x) an unterminated fence names its opening line", (t) => {
    const r = doc(t, "- Rule [check: lint]\n```\n- Swallowed\n");
    assert.match(out(r), /CONVENTIONS\.md:2/);
  });
  await t.test("(n) the nested-list failure explains itself", (t) => {
    const r = doc(t, "- Parent [check: lint]\n  - Child\n");
    assert.match(out(r), /nested/i);
  });
});

test("rule tags: registered paths are canonical, tracked and not aliased", async (t) => {
  const withPath = (t, emit, files = {}, setup) => {
    const g = gateRepo(t, { config: RULES_CONFIG(`  echo '${emit}'`), files: { ".ai/rules/x.md": "* legacy untagged\n", ...files } });
    if (setup) { setup(g); g.commit("setup"); }
    return g.run(["--fast"]);
  };
  await t.test("(k) ./.ai/rules/x.md is checked once with the legacy grammar", (t) => {
    const r = withPath(t, "./.ai/rules/x.md");
    assert.equal(r.status, 0, out(r));
    const g = gateRepo(t, { config: RULES_CONFIG("  echo ./.ai/rules/x.md\n  echo .ai/rules/x.md"), files: { ".ai/rules/x.md": "- untagged\n" } });
    const twice = g.run(["--fast"]);
    assert.equal(twice.status, 1);
    assert.equal(out(twice).match(/x\.md:1/g).length, 1);
  });
  await t.test("(k) .//CONVENTIONS.md normalizes to CONVENTIONS.md", (t) => {
    const g = gateRepo(t, { config: RULES_CONFIG("  echo './/CONVENTIONS.md'"), files: { "CONVENTIONS.md": "- Rule [check: lint]\n" } });
    const r = g.run(["--fast"]);
    assert.equal(r.status, 0, out(r));
  });
  await t.test("a file named like an awk assignment is still checked", (t) => {
    const g = gateRepo(t, { config: RULES_CONFIG("  echo 'guide=rules.md'"), files: { "guide=rules.md": "- Untagged\n" } });
    const r = g.run(["--fast"]);
    assert.equal(r.status, 1);
    assert.match(out(r), /guide=rules\.md:1/);
  });
  for (const bad of ["/etc/passwd", "../x.md", ".ai/./rules/x.md", ".ai/rules/../rules/x.md"]) {
    await t.test(`(k) rejects ${bad}`, (t) => {
      const r = withPath(t, bad);
      assert.equal(r.status, 1);
      assert.match(out(r), esc(bad));
    });
  }
  await t.test("(q) a symlinked file is rejected", (t) => {
    const r = withPath(t, ".claude/rules/x.md", {}, (g) => {
      fs.mkdirSync(g.at(".claude/rules"), { recursive: true });
      fs.symlinkSync("../../.ai/rules/x.md", g.at(".claude/rules/x.md"));
    });
    assert.equal(r.status, 1);
    assert.match(out(r), /\.claude\/rules\/x\.md/);
  });
  await t.test("(s) a path through a symlinked directory is rejected", (t) => {
    const r = withPath(t, "alias/x.md", {}, (g) => fs.symlinkSync(".ai/rules", g.at("alias")));
    assert.equal(r.status, 1);
    assert.match(out(r), /alias\/x\.md: alias is a symlink/);
  });
  await t.test("a path Git records as a symlink is rejected even when checked out as a file", (t) => {
    const g = gateRepo(t, { config: RULES_CONFIG("  echo CONVENTIONS.md"), files: { "docs/rules.md": "- Untagged\n" } });
    const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: g.root, env: vars(), input: "docs/rules.md", encoding: "utf8" }).stdout.trim();
    g.git("update-index", "--add", "--cacheinfo", `120000,${blob},CONVENTIONS.md`);
    g.git("commit", "-qm", "symlink entry");
    g.put("CONVENTIONS.md", "docs/rules.md");
    const r = g.run(["--fast"]);
    assert.equal(r.status, 1);
    assert.match(out(r), /CONVENTIONS\.md: git records it as a symlink/);
  });
  await t.test("(t) CONVENTIONS outside .ai/rules is strict; the same text under .ai/rules is legacy", (t) => {
    const strict = withPath(t, "CONVENTIONS.md", { "CONVENTIONS.md": "* untagged\n" });
    assert.equal(strict.status, 1);
    const legacy = withPath(t, ".ai/rules/x.md");
    assert.equal(legacy.status, 0, out(legacy));
  });
  await t.test("(v) a case alias of a tracked path is rejected", (t) => {
    const r = withPath(t, ".AI/RULES/x.md");
    assert.equal(r.status, 1);
    assert.match(out(r), /\.AI\/RULES\/x\.md/);
  });
  await t.test("(v) a tracked non-ASCII path is accepted with git's default quotePath", (t) => {
    const g = gateRepo(t, { config: RULES_CONFIG("  echo '규칙.md'"), files: { "규칙.md": "- Rule [check: lint]\n" } });
    const r = g.run(["--fast"]);
    assert.equal(r.status, 0, out(r));
  });
  await t.test("(o) an untracked path is rejected by name", (t) => {
    const g = gateRepo(t, { config: RULES_CONFIG("  echo NEW.md") });
    g.put("NEW.md", "- Rule [check: lint]\n");
    const r = g.run(["--fast"]);
    assert.equal(r.status, 1);
    assert.match(out(r), /NEW\.md/);
  });
});

// ── layer policy (assets/check-layers.sh) ──

const layersAsset = new URL("../skills/project-bootstrap/assets/check-layers.sh", import.meta.url);

// Prints `from<TAB>to` for each import in src/**/*.js: a relative import is
// resolved to a canonical repository path, anything else becomes ext:<name>.
const EDGES = `#!/bin/bash
set -euo pipefail
[ -z "\${EDGES_FAIL:-}" ] || exit 7
git ls-files 'src/*.js' | while IFS= read -r f; do
  { grep -oE 'from "[^"]+"' "$f" || true; } | sed -E 's/from "(.*)"/\\1/' | while IFS= read -r spec; do
    case "$spec" in
      ./*|../*) printf '%s\\t%s\\n' "$f" "$(awk -v d="$(dirname "$f")" -v s="$spec" 'BEGIN { n = split(d "/" s, p, "/"); o = 0; for (i = 1; i <= n; i++) { if (p[i] == "." || p[i] == "") continue; if (p[i] == "..") { o--; continue }; q[++o] = p[i] }; out = q[1]; for (i = 2; i <= o; i++) out = out "/" q[i]; print out }')" ;;
      *) printf '%s\\text:%s\\n' "$f" "$spec" ;;
    esac
  done
done
`;

const LAYERS_CONFIG = `tool_versions() { echo fixture-tools; }
register_checks() {
  check lint fast "run the linter" -- true
  check layers fast "move the import or change the layer policy" -- bash scripts/check-layers.sh --doc ARCHITECTURE.md -- bash scripts/edges.sh
}
rule_files() {
  echo CONVENTIONS.md
}
`;

const LAYER_POLICY = "layer\tdomain\tsrc/domain/*\nlayer\thttp\tsrc/http/*\nallow\thttp\tdomain\n";

function layerRepo(t, { policy = LAYER_POLICY, files = {}, branch = "main" } = {}) {
  return gateRepo(t, {
    branch,
    config: LAYERS_CONFIG,
    files: {
      "scripts/check-layers.sh": fs.readFileSync(layersAsset),
      "scripts/edges.sh": EDGES,
      ...(policy === null ? {} : { "scripts/check-data/layers.tsv": policy }),
      "src/domain/model.js": "export const x = 1;\n",
      "src/http/handler.js": 'import { x } from "../domain/model.js";\n',
      "ARCHITECTURE.md": "# Architecture\n\nTwo layers: domain and http. The allowed directions are in [the layer policy](scripts/check-data/layers.tsv).\n",
      "CONVENTIONS.md": "# Conventions\n\nLayer dependencies are owned by [the layer policy](scripts/check-data/layers.tsv) and enforced by the `layers` check.\n\n- Domain functions return typed errors and never build HTTP responses. [unchecked: judged in review]\n",
      "AGENTS.md": "# Agents\n\nStructure: [ARCHITECTURE.md](ARCHITECTURE.md). Rules: [CONVENTIONS.md](CONVENTIONS.md).\n",
      ...files,
    },
  });
}

test("checkout example: the documented layer policy rejects a real forbidden import", async (t) => {
  await t.test("the allowed import passes and the documents link up", (t) => {
    const g = layerRepo(t);
    const r = g.run(["--fast"]);
    assert.equal(r.status, 0, out(r));
    for (const [doc, target] of [["AGENTS.md", "ARCHITECTURE.md"], ["AGENTS.md", "CONVENTIONS.md"], ["CONVENTIONS.md", "scripts/check-data/layers.tsv"], ["ARCHITECTURE.md", "scripts/check-data/layers.tsv"]]) {
      assert.match(fs.readFileSync(g.at(doc), "utf8"), esc(`](${target})`));
      assert.ok(fs.existsSync(g.at(target)), `${doc} -> ${target}`);
    }
    assert.doesNotMatch(fs.readFileSync(g.at("CONVENTIONS.md"), "utf8"), /allow\t|src\/http\/\*|src\/domain\/\*/);
  });
  await t.test("a forbidden import fails with a hint naming ARCHITECTURE.md", (t) => {
    const g = layerRepo(t);
    g.put("src/domain/model.js", 'import { h } from "../http/handler.js";\nexport const x = 1;\n');
    g.commit("forbidden");
    const r = g.run(["--fast"]);
    assert.equal(r.status, 1);
    assert.match(out(r), /src\/domain\/model\.js \(domain\) depends on src\/http\/handler\.js \(http\).*described in ARCHITECTURE\.md/);
  });
  await t.test("an extractor failure cannot pass", (t) => {
    const g = layerRepo(t);
    const r = g.run(["--fast"], { EDGES_FAIL: "1" });
    assert.equal(r.status, 1);
    assert.match(out(r), /the extractor exited with status 7/);
  });
  await t.test("removing an owned rule's tag fails rule tags", (t) => {
    const g = layerRepo(t);
    g.put("CONVENTIONS.md", fs.readFileSync(g.at("CONVENTIONS.md"), "utf8").replace(" [unchecked: judged in review]", ""));
    g.commit("drop tag");
    const r = g.run(["--fast"]);
    assert.equal(r.status, 1);
    assert.match(out(r), /-- rule tags: FAILED/);
    assert.match(out(r), /CONVENTIONS\.md:5: end the rule/);
  });
});

test("layer policy outcomes", async (t) => {
  const fails = (name, opts, edit, why) => t.test(`fails: ${name}`, (t) => {
    const g = layerRepo(t, opts);
    if (edit) { edit(g); g.commit("edit"); }
    const r = g.run(["--fast"]);
    assert.equal(r.status, 1);
    assert.match(out(r), why);
  });
  const passes = (name, opts, edit) => t.test(`passes: ${name}`, (t) => {
    const g = layerRepo(t, opts);
    if (edit) { edit(g); g.commit("edit"); }
    const r = g.run(["--fast"]);
    assert.equal(r.status, 0, out(r));
  });
  await fails("unclassified internal file", {}, (g) => g.put("src/util/u.js", 'import { x } from "../domain/model.js";\n'), /src\/util\/u\.js belongs to no layer/);
  await fails("ambiguous internal file", { policy: LAYER_POLICY + "layer\tall\tsrc/*\n" }, undefined, /matches more than one layer/);
  await fails("(m) unclassified file importing only an external package", {}, (g) => g.put("src/unowned/client.js", 'import k from "kafka";\n'), /src\/unowned\/client\.js belongs to no layer/);
  await passes("an external import from a classified file", {}, (g) => g.put("src/http/client.js", 'import k from "kafka";\n'));
  await fails("(m) malformed policy row", { policy: LAYER_POLICY + "layer\tbroken\n" }, undefined, /not a layer, allow, debt or empty-ok row/);
  await fails("(m) unknown layer in allow", { policy: LAYER_POLICY + "allow\thttp\tnowhere\n" }, undefined, /allow names an unknown layer/);
  await fails("(m) external-only output without empty-ok", { files: { "src/http/handler.js": 'import k from "kafka";\n' } }, undefined, /no dependency between internal files/);
  const silent = (g) => g.put("scripts/edges.sh", "#!/bin/bash\n");
  await fails("(m) an allow row naming an unknown layer is reported even with no edges", { policy: LAYER_POLICY + "empty-ok\nallow\thttp\tnowhere\n" }, silent, /allow names an unknown layer/);
  await fails("an empty extractor run without empty-ok", {}, silent, /no dependency between internal files/);
  await passes("an empty extractor run with empty-ok", { policy: LAYER_POLICY + "empty-ok\n" }, silent);
  await fails("a tab-only extractor record", { policy: LAYER_POLICY + "empty-ok\n" }, (g) => g.put("scripts/edges.sh", "#!/bin/bash\nprintf '\\t\\n'\n"), /neither ext:<name> nor a canonical repository path/);
  await fails("a nameless ext: endpoint", { policy: LAYER_POLICY + "empty-ok\n" }, (g) => g.put("scripts/edges.sh", "#!/bin/bash\nprintf 'src/http/handler.js\\text:\\n'\n"), /neither ext:<name> nor a canonical repository path/);
  await fails("a control byte in an extractor endpoint", {}, (g) => g.put("scripts/edges.sh", "#!/bin/bash\nprintf 'src/domain/a\\tsrc/http/b\\034src/http/z\\n'\n"), /neither ext:<name> nor a canonical repository path/);
  await fails("a control byte in a debt row", { policy: LAYER_POLICY + "debt\tsrc/domain/a\x1csrc/http/b\tsrc/http/z\n" }, undefined, /not a layer, allow, debt or empty-ok row/);
  await fails("a NUL byte in the extractor output", {}, (g) => g.put("scripts/edges.sh", "#!/bin/bash\nprintf 'src/http/handler.js\\tsrc/domain/model.js\\000\\textra\\n'\n"), /holds a NUL byte/);
  await fails("a DEL byte in an extractor endpoint", {}, (g) => g.put("scripts/edges.sh", "#!/bin/bash\nprintf 'src/http/handler.js\\tsrc/domain/model.js\\177\\n'\n"), /neither ext:<name> nor a canonical repository path/);
  await fails("an equivalence-class glob, even with no edges", { policy: "layer\tdomain\tsrc/[[=d=]]omain/*\nlayer\thttp\tsrc/http/*\nempty-ok\n" }, silent, /globs take only/);
  await fails("a control byte in a layer name", { policy: LAYER_POLICY + "layer\ta\x1cb\tsrc/x/*\n" }, undefined, /not a layer, allow, debt or empty-ok row/);
  await fails("a control byte in an allow field", { policy: LAYER_POLICY + "allow\thttp\tdomain\x1cx\n" }, undefined, /not a layer, allow, debt or empty-ok row/);
  await fails("an empty negated class, even with no edges", { policy: "layer\tdomain\tsrc/[!]/*\nlayer\thttp\tsrc/http/*\nempty-ok\n" }, silent, /globs take only/);
  await fails("a glob with a character class name", { policy: "layer\tdomain\tsrc/[[:alpha:]]omain/*\nlayer\thttp\tsrc/http/*\nallow\thttp\tdomain\n" }, undefined, /globs take only/);
  await fails("a glob with an escape", { policy: "layer\tdomain\tsrc/domain/\\*\nlayer\thttp\tsrc/http/*\nallow\thttp\tdomain\n" }, undefined, /globs take only/);
  await fails("a duplicated debt row", { policy: LAYER_POLICY + "debt\tsrc/domain/model.js\tsrc/http/handler.js\ndebt\tsrc/domain/model.js\tsrc/http/handler.js\n", files: { "src/domain/model.js": 'import { h } from "../http/handler.js";\n' } }, undefined, /repeats the debt row/);
  await fails("a noncanonical debt row", { policy: LAYER_POLICY + "debt\t./src/domain/model.js\tsrc/http/handler.js\n" }, undefined, /not a layer, allow, debt or empty-ok row/);
  await fails("an empty glob member", { policy: "layer\tdomain\tsrc/domain/*,\nlayer\thttp\tsrc/http/*\nallow\thttp\tdomain\n" }, undefined, /not a layer, allow, debt or empty-ok row/);
  await passes("a bracket glob classifies its files", { policy: "layer\tdomain\tsrc/[d]omain/*\nlayer\thttp\tsrc/http/*\nallow\thttp\tdomain\n" });
  await passes("(m) zero internal edges with empty-ok", { policy: LAYER_POLICY + "empty-ok\n", files: { "src/http/handler.js": 'import k from "kafka";\n' } });
  await t.test("(m) malformed extractor output fails", (t) => {
    const g = layerRepo(t);
    g.put("scripts/edges.sh", "#!/bin/bash\nprintf 'only-one-field\\n'\n");
    g.commit("bad extractor");
    const r = g.run(["--fast"]);
    assert.equal(r.status, 1);
    assert.match(out(r), /extractor line 1 is not from<TAB>to/);
  });
  await t.test("(w) a noncanonical endpoint fails by line; a real ../ import is resolved and checked", (t) => {
    const g = layerRepo(t);
    g.put("scripts/edges.sh", "#!/bin/bash\nprintf 'src/http/handler.js\\tsrc/http/../domain/model.js\\n'\n");
    g.commit("noncanonical");
    const r = g.run(["--fast"]);
    assert.equal(r.status, 1);
    assert.match(out(r), /src\/http\/\.\.\/domain\/model\.js/);
    const real = layerRepo(t);
    real.put("src/domain/deep/a.js", 'import { h } from "../../http/handler.js";\n');
    real.put("scripts/check-data/layers.tsv", "layer\tdomain\tsrc/domain/*\nlayer\thttp\tsrc/http/*\nallow\thttp\tdomain\n");
    real.commit("deep forbidden");
    const deep = real.run(["--fast"]);
    assert.equal(deep.status, 1);
    assert.match(out(deep), /src\/domain\/deep\/a\.js \(domain\) depends on src\/http\/handler\.js \(http\)/);
  });
});

test("layer debt only shrinks", async (t) => {
  const forbidden = 'import { h } from "../http/handler.js";\nexport const x = 1;\n';
  const debt = "debt\tsrc/domain/model.js\tsrc/http/handler.js\n";
  await t.test("(r) a debt row adopted with the policy passes", (t) => {
    const g = layerRepo(t, { policy: LAYER_POLICY + debt, files: { "src/domain/model.js": forbidden } });
    const r = g.run(["--fast"]);
    assert.equal(r.status, 0, out(r));
  });
  await t.test("(r) a debt row for a vanished edge fails", (t) => {
    const g = layerRepo(t, { policy: LAYER_POLICY + debt });
    const r = g.run(["--fast"]);
    assert.equal(r.status, 1);
    assert.match(out(r), /is resolved \(gone or now allowed\); delete the row/);
  });
  await t.test("(y) a debt row for an edge the policy now allows fails until deleted", (t) => {
    const g = layerRepo(t, { policy: LAYER_POLICY + debt, files: { "src/domain/model.js": forbidden } });
    g.put("scripts/check-data/layers.tsv", LAYER_POLICY + "allow\tdomain\thttp\n" + debt);
    g.commit("allow it");
    const stale = g.run(["--fast"]);
    assert.equal(stale.status, 1);
    assert.match(out(stale), /is resolved \(gone or now allowed\); delete the row/);
    g.put("scripts/check-data/layers.tsv", LAYER_POLICY + "allow\tdomain\thttp\n");
    g.commit("drop debt");
    const r = g.run(["--fast"]);
    assert.equal(r.status, 0, out(r));
  });
  await t.test("(u) a new forbidden import with a matching debt row on a branch fails", (t) => {
    const g = layerRepo(t);
    g.git("checkout", "-q", "-b", "feat");
    g.put("src/domain/model.js", forbidden);
    g.put("scripts/check-data/layers.tsv", LAYER_POLICY + debt);
    g.commit("sneak debt");
    const r = g.run(["--fast"]);
    assert.equal(r.status, 1);
    assert.match(out(r), /debt grew/);
  });
});

test("layer debt grown in a commit on main fails in the gate and in the helper", (t) => {
  const g = layerRepo(t);
  g.put("src/domain/model.js", 'import { h } from "../http/handler.js";\nexport const x = 1;\n');
  g.put("scripts/check-data/layers.tsv", LAYER_POLICY + "debt\tsrc/domain/model.js\tsrc/http/handler.js\n");
  g.commit("sneak debt on main");
  const r = g.run(["--fast"]);
  assert.equal(r.status, 1);
  assert.match(out(r), /debt grew/);
  const alone = spawnSync(BASH, [g.at("scripts/check-layers.sh"), "--doc", "ARCHITECTURE.md", "--", "bash", "scripts/edges.sh"], { cwd: g.root, env: vars(), encoding: "utf8" });
  assert.equal(alone.status, 1);
  assert.match(out(alone), /debt grew/);
});

test("check-layers.sh resolves the base itself beside a repository's own gate", (t) => {
  const g = layerRepo(t);
  g.put("scripts/check.sh", "#!/bin/bash\nexec bash scripts/check-layers.sh --doc ARCHITECTURE.md -- bash scripts/edges.sh\n");
  g.put("src/domain/model.js", 'import { h } from "../http/handler.js";\nexport const x = 1;\n');
  g.put("scripts/check-data/layers.tsv", LAYER_POLICY + "debt\tsrc/domain/model.js\tsrc/http/handler.js\n");
  g.commit("own gate, sneak debt");
  const r = spawnSync(BASH, [g.at("scripts/check.sh")], { cwd: g.root, env: vars(), encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 1);
  assert.match(out(r), /debt grew/);
});

test("check-layers.sh run alone honors a CHECK_BASE set by check-config.sh", (t) => {
  const debt = "debt\tsrc/domain/model.js\tsrc/http/handler.js\n";
  const g = layerRepo(t, { policy: LAYER_POLICY + debt, files: { "src/domain/model.js": 'import { h } from "../http/handler.js";\nexport const x = 1;\n' } });
  g.git("checkout", "-q", "-b", "feat");
  g.put("src/domain/model.js", "export const x = 1;\n");
  g.put("scripts/check-data/layers.tsv", LAYER_POLICY);
  g.commit("pay the debt");
  const paid = g.git("rev-parse", "HEAD");
  g.put("src/domain/model.js", 'import { h } from "../http/handler.js";\nexport const x = 1;\n');
  g.put("scripts/check-data/layers.tsv", LAYER_POLICY + debt);
  g.put("scripts/check-config.sh", `CHECK_BASE=${paid}\n${LAYERS_CONFIG}`);
  g.commit("bring it back");
  const alone = spawnSync(BASH, [g.at("scripts/check-layers.sh"), "--doc", "ARCHITECTURE.md", "--", "bash", "scripts/edges.sh"], { cwd: g.root, env: vars(), encoding: "utf8" });
  assert.equal(alone.status, 1);
  assert.match(out(alone), /debt grew/);
  assert.match(out(g.run(["--fast"])), /debt grew/);
});

test("the base resolver is the same text in check.sh and check-layers.sh", () => {
  const block = (url) => {
    const text = fs.readFileSync(url, "utf8");
    const start = text.indexOf("# True when HEAD is detached");
    const end = text.indexOf("# End of the base resolver");
    assert.ok(start >= 0 && end > start, url.pathname);
    return text.slice(start, end);
  };
  assert.equal(block(layersAsset), block(gateAsset));
});

test("an unresolved base in the layer check shows why", (t) => {
  const g = layerRepo(t);
  g.put("a.txt", "a\n");
  g.commit("second");
  const clone = fs.mkdtempSync(path.join(tmpdir(), "gate-shallow-"));
  t.after(() => fs.rmSync(clone, { recursive: true, force: true }));
  const c = spawnSync("git", ["clone", "-q", "--depth", "1", `file://${g.root}`, clone], { env: vars(), encoding: "utf8" });
  assert.equal(c.status, 0, c.stderr);
  const r = spawnSync(BASH, [path.join(clone, "scripts/check.sh")], { cwd: clone, env: vars(), encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(out(r), /check-layers: .*fetch more history/);
});

test("layer debt: first adoption against a base without the policy", (t) => {
  const g = layerRepo(t, { policy: null });
  g.git("checkout", "-q", "-b", "feat");
  g.put("src/domain/model.js", 'import { h } from "../http/handler.js";\nexport const x = 1;\n');
  g.put("scripts/check-data/layers.tsv", LAYER_POLICY + "debt\tsrc/domain/model.js\tsrc/http/handler.js\n");
  g.commit("adopt with debt");
  const r = g.run(["--fast"]);
  assert.equal(r.status, 0, out(r));
});

test("check-layers.sh keeps a --doc path with a backslash literal", (t) => {
  const g = layerRepo(t);
  g.put("src/domain/model.js", 'import { h } from "../http/handler.js";\n');
  g.commit("forbidden");
  const doc = "docs\\tarch.md";
  const r = spawnSync(BASH, [g.at("scripts/check-layers.sh"), "--doc", doc, "--", "bash", "scripts/edges.sh"], { cwd: g.root, env: vars(), encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.ok(out(r).includes("described in " + doc), out(r));
});

test("check-layers.sh stops when it cannot create a temporary directory", (t) => {
  const g = layerRepo(t);
  const bin = path.join(g.root, "fake-bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "mktemp"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const r = spawnSync(BASH, [g.at("scripts/check-layers.sh"), "--doc", "ARCHITECTURE.md", "--", "true"], { cwd: g.root, env: vars({ PATH: `${bin}:${vars().PATH}` }), encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(out(r), /cannot create a temporary directory/);
});

test("check-layers.sh rejects a missing --doc value instead of looping", (t) => {
  const g = layerRepo(t);
  const r = spawnSync(BASH, [g.at("scripts/check-layers.sh"), "--doc"], { cwd: g.root, env: vars(), encoding: "utf8", timeout: 10000 });
  assert.equal(r.status, 2);
});

test("generated entry points resolve the normative documents", (t) => {
  const f = fixture(t);
  f.put(".ai/PROJECT.md", "# Project\n\nStructure: [ARCHITECTURE.md](ARCHITECTURE.md). Rules: [CONVENTIONS.md](CONVENTIONS.md).\n");
  f.put("ARCHITECTURE.md", "# Architecture\n");
  f.put("CONVENTIONS.md", "# Conventions\n");
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  for (const entry of ["AGENTS.md", "CLAUDE.md"]) {
    const text = fs.readFileSync(f.at(entry), "utf8");
    for (const target of ["ARCHITECTURE.md", "CONVENTIONS.md"]) {
      assert.match(text, esc(`](${target})`));
      assert.ok(fs.existsSync(path.join(path.dirname(f.at(entry)), target)), `${entry} -> ${target}`);
    }
  }
});
