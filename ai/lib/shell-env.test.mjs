import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";

const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const shellEnv = join(repo, "lib", "shell-env.sh");
const zshenv = join(repo, "zsh", ".zshenv");
// Like git-filter-machine-local.test.mjs: a checkout carrying ai/ without the
// root lib/ and zsh/ reports these cases as skipped.
const absent = !(existsSync(shellEnv) && existsSync(zshenv)) && "lib/shell-env.sh or zsh/.zshenv is not in this checkout";
const isWindows = process.platform === "win32";
// Windows: a bare "bash" can resolve to WSL's System32 launcher, so take Git's
// bash.exe the way git-filter-machine-local.test.mjs does.
const msysBin = isWindows
  ? (spawnSync("bash", ["-c", 'cygpath -w "$(dirname "$BASH")"'], { encoding: "utf8" }).stdout ?? "").trim()
  : "";
const bash = msysBin ? join(msysBin, "bash.exe") : "bash";
const zsh = spawnSync(bash, ["-c", "command -v zsh"], { encoding: "utf8" }).stdout?.trim();
const root = mkdtempSync(join(tmpdir(), "shell-env-"));
after(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
const scratch = () => {
  const home = join(root, `home${n++}`);
  mkdirSync(home);
  return home;
};

const BEGIN = "# >>> config-bootstrap >>>";
const END = "# <<< config-bootstrap <<<";
const CURRENT = `${BEGIN}
export ZDOTDIR="$HOME/.config/zsh"
export ZSHRC_PATH="$ZDOTDIR/.zshrc"
if [ -f "$ZDOTDIR/.zshenv" ]; then . "$ZDOTDIR/.zshenv"; fi
${END}`;
const OLD = `${BEGIN}
export ZDOTDIR="$HOME/.config/zsh"
export ZSHRC_PATH="$ZDOTDIR/.zshrc"
${END}`;

const ensure = (home) =>
  spawnSync(bash, ["-c", '. "$1"; ensure_zshenv', "_", shellEnv], { env: { ...process.env, HOME: home }, encoding: "utf8" });
const backups = (home) => readdirSync(home).filter((f) => f.startsWith(".zshenv.bak."));
const read = (home) => readFileSync(join(home, ".zshenv"), "utf8");

test("ensure_zshenv creates the managed block when ~/.zshenv is missing", { skip: absent }, () => {
  const home = scratch();
  const r = ensure(home);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(home), `${CURRENT}\n`);
});

test("ensure_zshenv rewrites an outdated block in place and keeps the lines around it", { skip: absent }, () => {
  const home = scratch();
  writeFileSync(join(home, ".zshenv"), `export FOO=1\n${OLD}\nexport BAR=2\n`);
  const r = ensure(home);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(home), `export FOO=1\n${CURRENT}\nexport BAR=2\n`);
  assert.equal(backups(home).length, 1);
  assert.equal(ensure(home).status, 0);
  assert.equal(backups(home).length, 1, "a current block is left alone, with no new backup");
});

test("ensure_zshenv keeps the mode and the symlink of a rewritten ~/.zshenv", { skip: absent || (isWindows && "no mode bits or user symlinks") }, () => {
  const home = scratch();
  const target = join(home, "dotfiles-zshenv");
  writeFileSync(target, `${OLD}\n`);
  chmodSync(target, 0o600);
  symlinkSync(target, join(home, ".zshenv"));
  const r = ensure(home);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(lstatSync(join(home, ".zshenv")).isSymbolicLink(), "still a symlink");
  assert.equal(readFileSync(target, "utf8"), `${CURRENT}\n`);
  assert.equal(statSync(target).mode & 0o777, 0o600);
});

test("ensure_zshenv leaves a block with no end marker untouched", { skip: absent }, () => {
  const home = scratch();
  const text = `${BEGIN}\nexport ZDOTDIR=old\nexport KEEP=1\n`;
  writeFileSync(join(home, ".zshenv"), text);
  const r = ensure(home);
  // Warn and carry on, like the other ensure_* steps: the bootstraps run set -e.
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /⚠ .*end marker/);
  assert.equal(read(home), text);
});

test("ensure_zshenv leaves a user-set ZDOTDIR alone and appends to an unrelated file", { skip: absent }, () => {
  const own = scratch();
  writeFileSync(join(own, ".zshenv"), "export ZDOTDIR=/x\n");
  assert.equal(ensure(own).status, 0);
  assert.equal(read(own), "export ZDOTDIR=/x\n");

  const other = scratch();
  writeFileSync(join(other, ".zshenv"), "export Q=1\n");
  assert.equal(ensure(other).status, 0);
  assert.equal(read(other), `export Q=1\n\n${CURRENT}\n`);
  assert.equal(backups(other).length, 1);
});

test("ensure_zshenv reports a failed rewrite instead of claiming success", { skip: absent || (isWindows && "no mode bits") || (process.getuid?.() === 0 && "root ignores mode bits") }, () => {
  const home = scratch();
  writeFileSync(join(home, ".zshenv"), `${OLD}\n`);
  chmodSync(home, 0o500);
  try {
    const r = ensure(home);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /⚠ .*backup failed/);
    assert.doesNotMatch(r.stdout, /refreshed/);
  } finally {
    chmodSync(home, 0o700);
  }
  assert.equal(read(home), `${OLD}\n`);
});

// zsh/.zshenv's PATH placement, run under a scratch MISE_DATA_DIR.
const placed = (pathBefore, { shims = true } = {}) => {
  const data = join(scratch(), "mise");
  mkdirSync(join(data, "command-wrappers", "bin"), { recursive: true });
  if (shims) mkdirSync(join(data, "shims"));
  const p = (list) => list.map((d) => d.replace("<w>", join(data, "command-wrappers", "bin")).replace("<s>", join(data, "shims"))).join(":");
  const r = spawnSync(zsh, ["-fc", 'source "$1"; print -rl -- $path', "_", zshenv], {
    env: { HOME: root, MISE_DATA_DIR: data, PATH: p(pathBefore) },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return { got: r.stdout.trim().split("\n"), want: (list) => p(list).split(":") };
};
const zshSkip = absent || (!zsh && "no zsh on PATH");

test("zsh/.zshenv puts the shims right after first-place command-wrappers", { skip: zshSkip }, () => {
  const { got, want } = placed(["<w>", "/usr/bin", "<s>"]);
  assert.deepEqual(got, want(["<w>", "<s>", "/usr/bin"]));
});

test("zsh/.zshenv keeps the shims behind command-wrappers that are not first", { skip: zshSkip }, () => {
  // git prepends its exec-path when it runs a hook; the wrappers must still win.
  const { got, want } = placed(["/usr/lib/git-core", "<w>", "/usr/bin"]);
  assert.deepEqual(got, want(["/usr/lib/git-core", "<w>", "<s>", "/usr/bin"]));
});

test("zsh/.zshenv puts the shims first without command-wrappers", { skip: zshSkip }, () => {
  const { got, want } = placed(["/usr/bin", "<s>"]);
  assert.deepEqual(got, want(["<s>", "/usr/bin"]));
});

test("zsh/.zshenv leaves PATH alone without a mise shims directory", { skip: zshSkip }, () => {
  const { got, want } = placed(["/usr/bin", "<w>"], { shims: false });
  assert.deepEqual(got, want(["/usr/bin", "<w>"]));
});
