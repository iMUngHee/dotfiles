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
  assert.equal(g.run(["--passed"], { ...today, CHECK_BASE: "HEAD~1" }).status, 1);
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
