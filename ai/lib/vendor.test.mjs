import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const script = join(repo, "ai", "scripts", "vendor.sh");

// Every fixture gets its own HOME, vendor root, manifest, and an empty global git
// config, so neither the real tool homes nor the user's git settings are touched.
// Git's repository-locating variables are dropped too: run from a git hook, the suite
// would otherwise aim fixture commits at the repository that ran the hook.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "vendor-"));
  const home = join(root, "home");
  const vendor = join(root, "vendor");
  mkdirSync(home, { recursive: true });
  const gitconfig = join(root, "gitconfig");
  writeFileSync(gitconfig, "");
  const env = {
    HOME: home,
    AI_VENDOR_DIR: vendor,
    AI_VENDOR_MANIFEST: join(root, "vendor.manifest"),
    AI_VENDOR_TIMEOUT: "2",
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
    GIT_DIR: null,
    GIT_WORK_TREE: null,
    GIT_INDEX_FILE: null,
    GIT_OBJECT_DIRECTORY: null,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: null,
    GIT_COMMON_DIR: null,
    GIT_NAMESPACE: null,
    GIT_PREFIX: null,
  };
  const f = {
    root,
    home,
    vendor,
    env,
    manifest(lines) {
      writeFileSync(env.AI_VENDOR_MANIFEST, lines.join("\n") + "\n");
    },
    privateManifest(lines) {
      mkdirSync(vendor, { recursive: true });
      writeFileSync(join(vendor, "private.manifest"), lines.join("\n") + "\n");
    },
    // A null in extra removes that variable, so a test can run without one the caller exported.
    envFor(extra = {}) {
      const merged = { ...process.env, ...env, ...extra };
      for (const key of Object.keys(merged)) if (merged[key] === null) delete merged[key];
      return merged;
    },
    run(args, extra = {}, scriptPath = script) {
      return spawnSync("bash", [scriptPath, ...args], { encoding: "utf8", env: f.envFor(extra) });
    },
    git(cwd, ...args) {
      const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: f.envFor() });
      assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
      return r.stdout.trim();
    },
    // A local upstream repo reached over file:// so shallow fetches behave as they do remotely.
    upstream(name, steps) {
      const dir = join(root, "up", name);
      mkdirSync(dir, { recursive: true });
      f.git(dir, "init", "-q", "-b", "main");
      for (const step of steps) f.commit(dir, step);
      return { dir, url: pathToFileURL(dir).href };
    },
    commit(dir, { file = "file.txt", content, tag }) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), content ?? `${tag ?? "change"}\n`);
      f.git(dir, "add", "-A");
      f.git(dir, "commit", "-q", "-m", tag ?? "change");
      if (tag) f.git(dir, "tag", tag);
      return f.git(dir, "rev-parse", "HEAD");
    },
  };
  return f;
}

// check prints one row per entry: name kind installed upstream status...
function row(stdout, name) {
  const line = stdout.split("\n").find((l) => l.split(/\s+/)[0] === name);
  assert.ok(line, `no row for ${name} in:\n${stdout}`);
  const [, kind, installed, upstream, ...status] = line.trim().split(/\s+/);
  return { kind, installed, upstream, status: status.join(" ") };
}

function ok(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result;
}

test("release follows the newest non-prerelease tag and is idempotent", () => {
  const f = fixture();
  const up = f.upstream("eng", [{ tag: "v1.0.0" }, { tag: "v1.2.0" }, { tag: "v1.10.0" }, { tag: "v2.0.0-rc.1" }]);
  f.manifest([`eng release ${up.url} v* - printf ran > post-ran.txt`]);

  let r = row(ok(f.run(["check"])).stdout, "eng");
  assert.equal(r.installed, "-");
  assert.equal(r.upstream, "v1.10.0");
  assert.equal(r.status, "missing");

  ok(f.run(["sync", "eng"]));
  const dest = join(f.vendor, "eng");
  assert.equal(f.git(dest, "describe", "--tags", "--exact-match"), "v1.10.0");
  assert.equal(readFileSync(join(dest, "post-ran.txt"), "utf8"), "ran");

  r = row(ok(f.run([])).stdout, "eng");
  assert.equal(r.installed, "v1.10.0");
  assert.equal(r.status, "ok");

  ok(f.run(["sync", "eng"]));
  assert.equal(f.git(dest, "describe", "--tags", "--exact-match"), "v1.10.0");
});

test("release pins an exact tag and reports the newer one only as information", () => {
  const f = fixture();
  const up = f.upstream("eng", [{ tag: "v1.0.0" }, { tag: "v1.2.0" }, { tag: "v1.10.0" }]);
  f.manifest([`eng release ${up.url} v1.2.0 - -`]);
  ok(f.run(["sync", "eng"]));
  const r = row(ok(f.run(["check", "eng"])).stdout, "eng");
  assert.equal(r.installed, "v1.2.0");
  assert.equal(r.status, "ok (pinned), latest v1.10.0");
});

test("release switches a shallow tag install to a pinned SHA it lacks and reports upstream movement", () => {
  const f = fixture();
  const up = f.upstream("eng", [{ tag: "v1.0.0" }]);
  const pinned = f.commit(up.dir, { tag: "v1.2.0" });
  f.manifest([`eng release ${up.url} v1.0.0 - -`]);
  ok(f.run(["sync", "eng"]));
  const dest = join(f.vendor, "eng");
  assert.equal(f.git(dest, "rev-parse", "--is-shallow-repository"), "true");

  f.manifest([`eng release ${up.url} ${pinned} - -`]);
  ok(f.run(["sync", "eng"]));
  assert.equal(f.git(dest, "rev-parse", "HEAD"), pinned);

  let r = row(ok(f.run(["check", "eng"])).stdout, "eng");
  assert.equal(r.status, "ok (pinned)");
  const moved = f.commit(up.dir, {});
  r = row(ok(f.run(["check", "eng"])).stdout, "eng");
  assert.equal(r.installed, pinned.slice(0, 12));
  assert.equal(r.status, `ok (pinned), upstream moved ${moved.slice(0, 12)}`);
});

test("name@ref overrides the manifest ref for one sync", () => {
  const f = fixture();
  const up = f.upstream("eng", [{ tag: "v1.0.0" }, { tag: "v1.2.0" }]);
  f.manifest([`eng release ${up.url} v* - -`]);
  ok(f.run(["sync", "eng@v1.0.0"]));
  const r = row(ok(f.run(["check"])).stdout, "eng");
  assert.equal(r.installed, "v1.0.0");
  assert.equal(r.upstream, "v1.2.0");
  assert.equal(r.status, "update");
});

test("skill links both tool dirs, relinks idempotently, and refuses a target it does not own", () => {
  const f = fixture();
  const up = f.upstream("demo", [{ file: "skills/demo/SKILL.md", content: "---\nname: demo\n---\nbody\n", tag: "v1.0.0" }]);
  f.manifest([`demo skill ${up.url} v* skills/demo -`, `other skill ${up.url} v* skills/demo -`]);

  ok(f.run(["sync", "demo"]));
  for (const tool of [".claude", ".agents"]) {
    const link = join(f.home, tool, "skills", "demo");
    assert.ok(lstatSync(link).isSymbolicLink(), `${link} is a symlink`);
    assert.equal(readFileSync(join(link, "SKILL.md"), "utf8"), "---\nname: demo\n---\nbody\n");
  }
  assert.equal(row(ok(f.run(["check", "demo"])).stdout, "demo").status, "ok");
  ok(f.run(["sync", "demo"]));

  unlinkSync(join(f.home, ".claude", "skills", "demo"));
  assert.equal(row(ok(f.run(["check", "demo"])).stdout, "demo").status, "ok, unlinked: claude");
  ok(f.run(["sync", "demo"]));
  assert.ok(lstatSync(join(f.home, ".claude", "skills", "demo")).isSymbolicLink());

  const theirs = join(f.home, ".claude", "skills", "other");
  mkdirSync(theirs, { recursive: true });
  writeFileSync(join(theirs, "keep.txt"), "theirs\n");
  const r = f.run(["sync", "other"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(readFileSync(join(theirs, "keep.txt"), "utf8"), "theirs\n");
  assert.ok(!lstatSync(theirs).isSymbolicLink());
  assert.ok(lstatSync(join(f.home, ".agents", "skills", "other")).isSymbolicLink());
  assert.equal(row(ok(f.run(["check", "other"])).stdout, "other").status, "ok, conflict: claude");
});

test("npm substitutes the resolved version, records it, and strips carriage returns", () => {
  const f = fixture();
  const shims = join(f.root, "shims");
  mkdirSync(shims);
  const versionFile = join(f.root, "npm-version");
  writeFileSync(versionFile, "2.0.0");
  // Windows npm output can carry \r; the shim reproduces it.
  writeFileSync(join(shims, "npm"), `#!/bin/bash\n[ "$1" = view ] && printf '%s\\r\\n' "$(cat '${versionFile}')"\n`, { mode: 0o755 });
  const extra = { PATH: shims + delimiter + process.env.PATH };
  f.manifest(["pkg npm some-pkg latest - printf '%s' {ver} > npm-post.txt"]);

  let r = row(ok(f.run(["check"], extra)).stdout, "pkg");
  assert.deepEqual([r.installed, r.upstream, r.status], ["-", "2.0.0", "missing"]);

  ok(f.run(["sync", "pkg"], extra));
  assert.equal(readFileSync(join(f.home, "npm-post.txt"), "utf8"), "2.0.0");
  assert.equal(readFileSync(join(f.vendor, "pkg", "VERSION"), "utf8"), "2.0.0\n");
  assert.equal(row(ok(f.run(["check"], extra)).stdout, "pkg").status, "ok");

  writeFileSync(versionFile, "2.1.0");
  r = row(ok(f.run(["check"], extra)).stdout, "pkg");
  assert.deepEqual([r.installed, r.upstream, r.status], ["2.0.0", "2.1.0", "update"]);

  ok(f.run(["sync", "pkg@1.5.0"], extra));
  assert.equal(readFileSync(join(f.home, "npm-post.txt"), "utf8"), "1.5.0");

  f.manifest(["pkg npm some-pkg 1.5.0 - printf '%s' {ver} > npm-post.txt"]);
  r = row(ok(f.run(["check"], extra)).stdout, "pkg");
  assert.deepEqual([r.installed, r.upstream, r.status], ["1.5.0", "1.5.0", "ok (pinned), latest 2.1.0"]);
});

test("source clones once, then only builds, keeping local work", () => {
  const f = fixture();
  const up = f.upstream("src", [{ file: "a.txt", content: "a\n" }]);
  f.manifest([`src source ${up.url} main ~/work/src printf built > built.txt`]);

  ok(f.run(["sync", "src"]));
  const dest = join(f.home, "work", "src");
  assert.ok(existsSync(join(dest, ".git")));
  assert.equal(readFileSync(join(dest, "built.txt"), "utf8"), "built");
  const head = f.git(dest, "rev-parse", "HEAD");

  writeFileSync(join(dest, "a.txt"), "local edit\n");
  writeFileSync(join(dest, "untracked.txt"), "mine\n");
  rmSync(join(dest, "built.txt"));
  ok(f.run(["sync", "src"]));
  assert.equal(readFileSync(join(dest, "built.txt"), "utf8"), "built");
  assert.equal(readFileSync(join(dest, "a.txt"), "utf8"), "local edit\n");
  assert.equal(readFileSync(join(dest, "untracked.txt"), "utf8"), "mine\n");
  assert.equal(f.git(dest, "rev-parse", "HEAD"), head);

  let r = row(ok(f.run(["check", "src"])).stdout, "src");
  assert.equal(r.installed, head.slice(0, 12));
  assert.equal(r.status, "dirty 3");

  f.commit(up.dir, { file: "b.txt" });
  r = row(ok(f.run(["check", "src"])).stdout, "src");
  assert.equal(r.status, "dirty 3, remote differs");
});

test("source refuses a missing local-only, non-git, or foreign-origin checkout without changing it", () => {
  const f = fixture();
  const up = f.upstream("src", [{ file: "a.txt" }]);
  const elsewhere = f.upstream("elsewhere", [{ file: "a.txt" }]);
  f.manifest([
    "loc source - - ~/work/loc printf x > made.txt",
    `nogit source ${up.url} main ~/work/nogit printf x > made.txt`,
    `wrong source ${up.url} main ~/work/wrong printf x > made.txt`,
  ]);

  let r = f.run(["sync", "loc"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(!existsSync(join(f.home, "work", "loc")));
  assert.equal(row(ok(f.run(["check", "loc"])).stdout, "loc").status, "missing");

  mkdirSync(join(f.home, "work", "loc"), { recursive: true });
  assert.equal(row(ok(f.run(["check", "loc"])).stdout, "loc").status, "local");

  const nogit = join(f.home, "work", "nogit");
  mkdirSync(nogit, { recursive: true });
  writeFileSync(join(nogit, "keep.txt"), "keep\n");
  r = f.run(["sync", "nogit"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(!existsSync(join(nogit, "made.txt")));
  assert.ok(!existsSync(join(nogit, ".git")));
  assert.match(row(ok(f.run(["check", "nogit"])).stdout, "nogit").status, /^foreign/);

  const wrong = join(f.home, "work", "wrong");
  spawnSync("git", ["clone", "-q", elsewhere.url, wrong], { env: f.envFor() });
  r = f.run(["sync", "wrong"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(!existsSync(join(wrong, "made.txt")));
  assert.match(row(ok(f.run(["check", "wrong"])).stdout, "wrong").status, /^foreign/);
});

test("manifests are validated and read with CRLF endings and no final newline", () => {
  const f = fixture();
  const up = f.upstream("eng", [{ tag: "v1.0.0" }]);

  f.manifest([`a release ${up.url} v* - -`]);
  f.privateManifest(["a npm pkg latest - echo"]);
  let r = f.run(["check"]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /duplicate/);
  rmSync(join(f.vendor, "private.manifest"));

  for (const bad of [`a bogus ${up.url} v* - -`, `a release ${up.url} v*`, `A_bad release ${up.url} v* - -`]) {
    f.manifest([bad]);
    r = f.run(["check"]);
    assert.equal(r.status, 2, `${bad}\n${r.stdout}${r.stderr}`);
  }

  // Names are compared literally: a dot is not a regex wildcard.
  f.manifest([`axb release ${up.url} v* - -`, `a.b release ${up.url} v* - -`]);
  ok(f.run(["check"]));

  writeFileSync(f.env.AI_VENDOR_MANIFEST, `# comment\r\none release ${up.url} v* - -\r\n\r\ntwo release ${up.url} v* - -`);
  r = ok(f.run(["check"]));
  assert.equal(row(r.stdout, "one").upstream, "v1.0.0");
  assert.equal(row(r.stdout, "two").upstream, "v1.0.0");
  assert.equal(row(r.stdout, "two").status, "missing");
});

test("a hanging or missing remote is reported unreachable within the timeout and the next entry is still checked", () => {
  const f = fixture();
  const up = f.upstream("eng", [{ tag: "v1.0.0" }]);
  const realGit = spawnSync("bash", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  const shims = join(f.root, "shims");
  mkdirSync(shims);
  // For a URL containing "hang", keep running past the timeout and leave a child
  // holding stdout open; anything else goes to the real git.
  writeFileSync(
    join(shims, "git"),
    `#!/bin/bash\nfor a in "$@"; do case "$a" in *hang*) sleep 30 & sleep 30; exit 0;; esac; done\nexec '${realGit}' "$@"\n`,
    { mode: 0o755 },
  );
  f.manifest([
    "slow release file:///nowhere/hang v* - -",
    `gone release ${pathToFileURL(join(f.root, "absent")).href} v* - -`,
    `good release ${up.url} v* - -`,
  ]);
  const started = Date.now();
  const r = ok(f.run(["check"], { PATH: shims + delimiter + process.env.PATH, AI_VENDOR_TIMEOUT: "1" }));
  assert.ok(Date.now() - started < 15000, `check took ${Date.now() - started} ms`);
  assert.equal(row(r.stdout, "slow").status, "missing, unreachable");
  assert.equal(row(r.stdout, "gone").status, "missing, unreachable");
  assert.equal(row(r.stdout, "good").upstream, "v1.0.0");
});

test("sync needs names or --all, rejects unknown names, continues past a failure, and exits 1", () => {
  const f = fixture();
  const up = f.upstream("eng", [{ tag: "v1.0.0" }]);
  f.manifest(["bad source - - ~/work/missing -", `good release ${up.url} v* - -`]);

  for (const args of [["sync"], ["sync", "--all", "good"], ["sync", "nope"], ["check", "nope"]]) {
    const r = f.run(args);
    assert.equal(r.status, 2, `${args.join(" ")}\n${r.stdout}${r.stderr}`);
  }

  const r = f.run(["sync", "--all"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(f.git(join(f.vendor, "good"), "describe", "--tags", "--exact-match"), "v1.0.0");
});

// ── Regressions from the first independent verification round (2026-10-19) ──

function shim(dir, name, body) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  return dir;
}
const withPath = (dir) => ({ PATH: dir + delimiter + process.env.PATH });
const realGit = () => spawnSync("bash", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

test("origin checks ignore url.insteadOf rewriting (H1)", () => {
  const f = fixture();
  f.upstream("eng", [{ tag: "v1.0.0" }]);
  f.upstream("src", [{ file: "a.txt" }]);
  writeFileSync(f.env.GIT_CONFIG_GLOBAL, `[url "${pathToFileURL(join(f.root, "up")).href}/"]\n\tinsteadOf = https://example.invalid/\n`);
  f.manifest(["eng release https://example.invalid/eng v* - -", "src source https://example.invalid/src main ~/work/src -"]);
  ok(f.run(["sync", "eng", "src"]));
  ok(f.run(["sync", "eng", "src"]));
  const r = ok(f.run(["check"]));
  assert.equal(row(r.stdout, "eng").status, "ok");
  assert.doesNotMatch(row(r.stdout, "src").status, /foreign/);
});

test("an exported GIT_DIR or GIT_WORK_TREE cannot redirect sync into another repository (H2)", () => {
  const f = fixture();
  const eng = f.upstream("eng", [{ tag: "v1.0.0" }]);
  const other = join(f.root, "other");
  mkdirSync(other);
  f.git(other, "init", "-q", "-b", "main");
  writeFileSync(join(other, "precious.txt"), "keep\n");
  f.git(other, "add", "-A");
  f.git(other, "commit", "-q", "-m", "other");
  f.manifest([`eng release ${eng.url} v1.0.0 - -`]);
  ok(f.run(["sync", "eng"], { GIT_DIR: join(other, ".git"), GIT_WORK_TREE: other }));
  assert.equal(f.git(join(f.vendor, "eng"), "describe", "--tags", "--exact-match"), "v1.0.0");
  assert.equal(readFileSync(join(other, "precious.txt"), "utf8"), "keep\n");
  assert.equal(f.git(other, "remote"), "");
});

test("a configured SSH command is honoured; otherwise lookups run ssh in batch mode (M1)", () => {
  const f = fixture();
  const bin = shim(join(f.root, "bin"), "ssh", `echo "$*" >> '${join(f.root, "ssh.log")}'; exit 255`);
  shim(bin, "myssh", `echo "$*" >> '${join(f.root, "myssh.log")}'; exit 255`);
  f.manifest(["far release ssh://example.invalid/x.git v* - -"]);
  const clean = { ...withPath(bin), GIT_SSH_COMMAND: null, GIT_SSH: null };
  assert.equal(row(ok(f.run(["check"], clean)).stdout, "far").status, "missing, unreachable");
  assert.match(readFileSync(join(f.root, "ssh.log"), "utf8"), /BatchMode=yes/);

  writeFileSync(f.env.GIT_CONFIG_GLOBAL, `[core]\n\tsshCommand = ${join(bin, "myssh")}\n`);
  rmSync(join(f.root, "ssh.log"));
  ok(f.run(["check"], clean));
  assert.ok(existsSync(join(f.root, "myssh.log")), "core.sshCommand was used");
  assert.ok(!existsSync(join(f.root, "ssh.log")), "plain ssh was not used");

  writeFileSync(f.env.GIT_CONFIG_GLOBAL, "");
  rmSync(join(f.root, "myssh.log"));
  ok(f.run(["check"], { ...clean, GIT_SSH: join(bin, "myssh") }));
  assert.ok(existsSync(join(f.root, "myssh.log")), "GIT_SSH was used");
  assert.ok(!existsSync(join(f.root, "ssh.log")), "plain ssh was not used");

  // Batch mode is for the time-limited lookups only: sync's own git (a clone with a
  // repo-local core.sshCommand, an includeIf block) and its post command see none of it.
  f.manifest(["pkg npm some-pkg 1.0.0 - env > post-env.txt"]);
  ok(f.run(["sync", "pkg"], clean));
  const postEnv = readFileSync(join(f.home, "post-env.txt"), "utf8");
  assert.doesNotMatch(postEnv, /^GIT_SSH_COMMAND=/m);
  assert.doesNotMatch(postEnv, /^GIT_TERMINAL_PROMPT=/m);
});

test(
  "an unreadable manifest is an error, not an empty one (M2)",
  { skip: (isRoot || process.platform === "win32") && "mode 000 does not stop this user from reading" },
  () => {
    const f = fixture();
    const eng = f.upstream("eng", [{ tag: "v1.0.0" }]);
    f.manifest([`eng release ${eng.url} v* - -`]);
    f.privateManifest([`p release ${eng.url} v* - -`]);
    chmodSync(join(f.vendor, "private.manifest"), 0o000);
    try {
      const r = f.run(["check"]);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /cannot read/);
    } finally {
      chmodSync(join(f.vendor, "private.manifest"), 0o600);
    }
  },
);

test("check flags a release dest that sync would refuse (M3)", () => {
  const f = fixture();
  const eng = f.upstream("eng", [{ tag: "v1.0.0" }]);
  const elsewhere = f.upstream("elsewhere", [{ tag: "v1.0.0" }]);
  f.manifest([`eng release ${eng.url} v* - -`, `two release ${eng.url} v* - -`]);
  mkdirSync(join(f.vendor, "eng"), { recursive: true });
  writeFileSync(join(f.vendor, "eng", "keep.txt"), "x\n");
  spawnSync("git", ["clone", "-q", elsewhere.url, join(f.vendor, "two")], { env: f.envFor() });
  const r = ok(f.run(["check"]));
  assert.match(row(r.stdout, "eng").status, /^foreign/);
  assert.match(row(r.stdout, "two").status, /^foreign/);
});

test("a force-moved tag is detected and re-synced, even after switching away and back (M4)", () => {
  const f = fixture();
  const up = f.upstream("eng", [{ tag: "v1.0.0" }, { tag: "v1.1.0" }]);
  f.manifest([`eng release ${up.url} v1.0.0 - -`]);
  ok(f.run(["sync", "eng"]));
  const dest = join(f.vendor, "eng");
  const moved = f.commit(up.dir, { file: "moved.txt" });
  f.git(up.dir, "tag", "-f", "v1.0.0");
  assert.equal(row(ok(f.run(["check", "eng"])).stdout, "eng").status, "update (tag moved)");
  ok(f.run(["sync", "eng"]));
  assert.equal(f.git(dest, "rev-parse", "HEAD"), moved);

  ok(f.run(["sync", "eng@v1.1.0"]));
  const movedAgain = f.commit(up.dir, { file: "again.txt" });
  f.git(up.dir, "tag", "-f", "v1.0.0");
  ok(f.run(["sync", "eng"]));
  assert.equal(f.git(dest, "rev-parse", "HEAD"), movedAgain);
  assert.match(row(ok(f.run(["check", "eng"])).stdout, "eng").status, /^ok \(pinned\)/);
});

test("sync refuses a tag that lacks the skill dir, and check reports links whose target is gone (M5)", () => {
  const f = fixture();
  const up = f.upstream("demo", [{ file: "skills/demo/SKILL.md", content: "s\n", tag: "v1.0.0" }]);
  f.git(up.dir, "rm", "-rq", "skills");
  f.commit(up.dir, { file: "other.txt", tag: "v1.1.0" });
  f.manifest([`demo skill ${up.url} v1.0.0 skills/demo -`]);
  ok(f.run(["sync", "demo"]));
  const dest = join(f.vendor, "demo");
  const before = f.git(dest, "rev-parse", "HEAD");
  const r = f.run(["sync", "demo@v1.1.0"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(f.git(dest, "rev-parse", "HEAD"), before);
  assert.ok(existsSync(join(f.home, ".claude", "skills", "demo", "SKILL.md")));

  f.commit(up.dir, { file: "skills/demo", content: "now a file\n", tag: "v1.2.0" });
  const asFile = f.run(["sync", "demo@v1.2.0"]);
  assert.equal(asFile.status, 1, asFile.stdout + asFile.stderr);
  assert.equal(f.git(dest, "rev-parse", "HEAD"), before);

  rmSync(join(dest, "skills"), { recursive: true });
  assert.match(row(ok(f.run(["check", "demo"])).stdout, "demo").status, /broken: claude agents$/);
});

test("globs handle dated tags, suffix globs and namespaced tags (M6)", () => {
  const f = fixture();
  const dated = f.upstream("dated", [{ tag: "release-2024-01" }, { tag: "release-2024-02" }]);
  const stable = f.upstream("stable", [{ tag: "v1.0.0-stable" }, { tag: "v1.1.0-stable" }, { tag: "v1.2.0-rc.1-stable" }]);
  const mixed = f.upstream("mixed", [{ tag: "v1.0.0" }, { tag: "release/v9.9.9" }]);
  const nested = f.upstream("nested", [{ tag: "release/v1.0.0" }, { tag: "release/v1.1.0" }]);
  f.manifest([
    `dated release ${dated.url} release-* - -`,
    `stable release ${stable.url} v*-stable - -`,
    `mixed release ${mixed.url} v* - -`,
    `nested release ${nested.url} release/v* - -`,
  ]);
  const r = ok(f.run(["check"]));
  assert.equal(row(r.stdout, "dated").upstream, "release-2024-02");
  assert.equal(row(r.stdout, "stable").upstream, "v1.1.0-stable");
  assert.equal(row(r.stdout, "mixed").upstream, "v1.0.0");
  assert.equal(row(r.stdout, "nested").upstream, "release/v1.1.0");
  ok(f.run(["sync", "--all"]));
  assert.equal(f.git(join(f.vendor, "nested"), "describe", "--tags", "--exact-match"), "release/v1.1.0");
  assert.equal(f.git(join(f.vendor, "mixed"), "describe", "--tags", "--exact-match"), "v1.0.0");

  // Globs take * and ? only. Git refs cannot contain [, so a [class] could only be a
  // glob, and half-supporting one silently dropped real tags; it is rejected instead.
  f.manifest([`bracket release ${stable.url} v*-[s]table - -`]);
  const bracket = f.run(["check"]);
  assert.equal(bracket.status, 2, bracket.stdout + bracket.stderr);
  assert.match(bracket.stderr, /\[/);
  f.manifest([`mixed release ${mixed.url} v* - -`]);
  assert.equal(f.run(["sync", "mixed@v[1].0.0"]).status, 2);
});

test("a lookup that ignores SIGTERM is still ended near the timeout", () => {
  const f = fixture();
  const bin = shim(
    join(f.root, "bin"),
    "git",
    `for a in "$@"; do case "$a" in *stubborn*) trap '' TERM; sleep 30; exit 0;; esac; done\nexec '${realGit()}' "$@"`,
  );
  f.manifest(["slow release file:///nowhere/stubborn v* - -"]);
  const started = Date.now();
  const r = ok(f.run(["check"], { ...withPath(bin), AI_VENDOR_TIMEOUT: "1" }));
  assert.ok(Date.now() - started < 6000, `check took ${Date.now() - started} ms`);
  assert.equal(row(r.stdout, "slow").status, "missing, unreachable");
});

test("Ctrl-C ends the lookup in flight, even one that ignores SIGTERM (L3)", { skip: process.platform === "win32" && "no POSIX process groups" }, async () => {
  const f = fixture();
  const pidFile = join(f.root, "lookup.pid");
  const bin = shim(
    join(f.root, "bin"),
    "git",
    `for a in "$@"; do case "$a" in *hang*) echo $$ > '${pidFile}'; trap '' TERM; exec sleep 30;; esac; done\nexec '${realGit()}' "$@"`,
  );
  f.manifest(["slow release file:///nowhere/hang v* - -"]);
  const child = spawn("bash", [script, "check"], {
    env: f.envFor({ ...withPath(bin), AI_VENDOR_TIMEOUT: "60" }),
    detached: true,
    stdio: "ignore",
  });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  let lookup = 0;
  let deadline;
  try {
    for (let i = 0; i < 200 && !existsSync(pidFile); i++) await sleep(50);
    assert.ok(existsSync(pidFile), "lookup started");
    lookup = Number(readFileSync(pidFile, "utf8"));
    process.kill(-child.pid, "SIGINT");
    // Cleared below: a pending 10 s timer would keep node alive after the last test.
    const stuck = new Promise((resolve) => {
      deadline = setTimeout(() => resolve("stuck"), 10000);
    });
    const outcome = await Promise.race([exited.then(() => "exited"), stuck]);
    assert.equal(outcome, "exited", "vendor.sh did not exit within 10s of Ctrl-C");
    for (let i = 0; i < 40 && alive(lookup); i++) await sleep(50);
    assert.equal(alive(lookup), false, "the lookup survived Ctrl-C");
  } finally {
    clearTimeout(deadline);
    if (lookup && alive(lookup)) process.kill(lookup, "SIGKILL");
    if (child.exitCode === null && child.signalCode === null) process.kill(-child.pid, "SIGKILL");
  }
});

test("AI_VENDOR_DIR must be absolute and AI_VENDOR_TIMEOUT a positive integer (L1, L2)", () => {
  const f = fixture();
  const eng = f.upstream("eng", [{ tag: "v1.0.0" }]);
  f.manifest([`eng release ${eng.url} v* - -`]);
  for (const extra of [
    { AI_VENDOR_DIR: "relative/vendor" },
    { AI_VENDOR_TIMEOUT: "0" },
    { AI_VENDOR_TIMEOUT: "abc" },
    { AI_VENDOR_TIMEOUT: "08" },
    { AI_VENDOR_TIMEOUT: "1.5" },
  ]) {
    const r = f.run(["check"], extra);
    assert.equal(r.status, 2, `${JSON.stringify(extra)}\n${r.stdout}${r.stderr}`);
  }
  ok(f.run(["sync", "eng"], { AI_VENDOR_DIR: "~/tilde-vendor" }));
  assert.ok(existsSync(join(f.home, "tilde-vendor", "eng", ".git")));
});

test("duplicate names are caught in a large manifest (L4)", () => {
  const f = fixture();
  const lines = ["a release file:///x v* - -"];
  for (let i = 0; i < 400; i++) lines.push(`n${i}${"x".repeat(200)} release file:///x v* - -`);
  lines.push("a release file:///x v* - -");
  f.manifest(lines);
  const r = f.run(["check", "a"]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /duplicate/);
});

test("check agrees with sync when only prereleases exist, and pinned hints use the version prefix (L5)", () => {
  const f = fixture();
  const pre = f.upstream("pre", [{ tag: "v1.0.0-rc.1" }]);
  const py = f.upstream("py", [{ tag: "py3-v1.0" }, { tag: "py3-v1.1" }]);
  const bare = f.upstream("bare", [{ tag: "1.0.0" }, { tag: "1.1.0" }, { tag: "nightly" }]);
  const suffixed = f.upstream("suffixed", [{ tag: "v1.0.0-stable" }, { tag: "v1.1.0-stable" }]);
  f.manifest([
    `pre release ${pre.url} v* - -`,
    `py release ${py.url} py3-v1.0 - -`,
    `bare release ${bare.url} 1.0.0 - -`,
    `suffixed release ${suffixed.url} v1.0.0-stable - -`,
  ]);
  ok(f.run(["sync", "pre@v1.0.0-rc.1", "py", "bare", "suffixed"]));
  const r = ok(f.run(["check"]));
  assert.equal(row(r.stdout, "suffixed").status, "ok (pinned), latest v1.1.0-stable");
  assert.equal(row(r.stdout, "pre").status, "no matching tag");
  assert.equal(row(r.stdout, "py").status, "ok (pinned), latest py3-v1.1");
  assert.equal(row(r.stdout, "bare").status, "ok (pinned), latest 1.1.0");
});

test("npm versions are trimmed and validated (L6)", () => {
  const f = fixture();
  const versionFile = join(f.root, "npm-version");
  const bin = shim(join(f.root, "bin"), "npm", `[ "$1" = view ] && cat '${versionFile}'`);
  f.manifest(["pkg npm some-pkg latest - printf '%s' {ver} > npm-post.txt"]);
  writeFileSync(versionFile, "  2.0.0  \n");
  ok(f.run(["sync", "pkg"], withPath(bin)));
  assert.equal(readFileSync(join(f.home, "npm-post.txt"), "utf8"), "2.0.0");
  assert.equal(readFileSync(join(f.vendor, "pkg", "VERSION"), "utf8"), "2.0.0\n");

  writeFileSync(versionFile, "npm notice something went sideways\n");
  const r = f.run(["sync", "pkg"], withPath(bin));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(readFileSync(join(f.vendor, "pkg", "VERSION"), "utf8"), "2.0.0\n");
  assert.equal(row(ok(f.run(["check"], withPath(bin))).stdout, "pkg").status, "unreachable");
});

test("the script finds its own manifest through a symlink and with CDPATH exported (L7)", () => {
  const f = fixture();
  const eng = f.upstream("eng", [{ tag: "v1.0.0" }]);
  const scripts = join(f.root, "copy", "scripts");
  mkdirSync(scripts, { recursive: true });
  copyFileSync(script, join(scripts, "vendor.sh"));
  writeFileSync(join(scripts, "vendor.manifest"), `eng release ${eng.url} v* - -\n`);
  const link = join(f.root, "bin", "vendor");
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(join(scripts, "vendor.sh"), link);
  const noOverride = { AI_VENDOR_MANIFEST: null };
  assert.equal(row(ok(f.run(["check"], noOverride, link)).stdout, "eng").upstream, "v1.0.0");
  const r = spawnSync("bash", ["scripts/vendor.sh", "check"], {
    cwd: join(f.root, "copy"),
    encoding: "utf8",
    env: f.envFor({ ...noOverride, CDPATH: `${f.root}:.` }),
  });
  ok(r);
  assert.equal(row(r.stdout, "eng").upstream, "v1.0.0");
});

test("a UTF-8 BOM is ignored and names stay ASCII in any locale (L8, L9)", () => {
  const f = fixture();
  const eng = f.upstream("eng", [{ tag: "v1.0.0" }]);
  writeFileSync(f.env.AI_VENDOR_MANIFEST, `\uFEFFeng release ${eng.url} v* - -\n`);
  assert.equal(row(ok(f.run(["check"])).stdout, "eng").upstream, "v1.0.0");
  f.manifest([`café release ${eng.url} v* - -`]);
  for (const locale of ["C", "en_US.UTF-8", "C.UTF-8"]) {
    const r = f.run(["check"], { LC_ALL: locale, LANG: locale });
    assert.equal(r.status, 2, `${locale}\n${r.stdout}${r.stderr}`);
  }
});

test("odd states give readable rows and vendor messages (L10)", () => {
  const f = fixture();
  const up = f.upstream("eng", [{ tag: "v1.0.0-rc.1" }]);
  f.git(up.dir, "tag", "v1.0.0");
  const src = f.upstream("src", [{ file: "a.txt" }]);
  const empty = join(f.home, "work", "empty");
  mkdirSync(empty, { recursive: true });
  f.git(empty, "init", "-q", "-b", "main");
  f.git(empty, "remote", "add", "origin", src.url);
  spawnSync("git", ["clone", "-q", src.url, join(f.home, "work", "gone")], { env: f.envFor() });
  mkdirSync(f.vendor, { recursive: true });
  symlinkSync(join(f.root, "nowhere"), join(f.vendor, "dangle"));
  const lines = [
    `eng release ${up.url} v* - -`,
    `empty source ${src.url} main ~/work/empty -`,
    `gone source ${src.url} nobranch ~/work/gone -`,
    `dangle release ${up.url} v* - -`,
  ];
  f.manifest(lines);

  ok(f.run(["sync", "eng"]));
  const r = ok(f.run(["check"]));
  assert.equal(row(r.stdout, "eng").installed, "v1.0.0");
  assert.equal(row(r.stdout, "empty").installed, "-");
  assert.match(row(r.stdout, "empty").status, /no commits/);
  assert.equal(row(r.stdout, "gone").status, "remote branch missing");

  const d = f.run(["sync", "dangle"]);
  assert.equal(d.status, 1, d.stdout + d.stderr);
  assert.match(d.stderr, /^dangle: /m);

  if (process.platform !== "win32") {
    f.manifest([...lines, "win source - - C:/tools/eng -"]);
    assert.equal(f.run(["check"]).status, 2);
  }
});
