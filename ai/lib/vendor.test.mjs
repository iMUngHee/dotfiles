import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const script = join(repo, "ai", "scripts", "vendor.sh");

// Every fixture gets its own HOME, vendor root, manifest, and an empty global git
// config, so neither the real tool homes nor the user's git settings are touched.
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
    run(args, extra = {}) {
      return spawnSync("bash", [script, ...args], { encoding: "utf8", env: { ...process.env, ...env, ...extra } });
    },
    git(cwd, ...args) {
      const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
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
  spawnSync("git", ["clone", "-q", elsewhere.url, wrong], { env: { ...process.env, ...f.env } });
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
