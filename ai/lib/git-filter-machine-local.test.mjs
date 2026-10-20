import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";

const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const filter = join(repo, "lib", "git-filter-machine-local.sh");
const root = mkdtempSync(join(tmpdir(), "git-filter-machine-local-"));
after(() => rmSync(root, { recursive: true, force: true }));

// Windows: a bare "bash" can resolve to WSL's System32 launcher, and Node cannot
// spawn the /usr/bin/bash path MSYS reports, so take Git's bash.exe the way
// vendor.test.mjs does.
const msysBin =
  process.platform === "win32"
    ? (spawnSync("bash", ["-c", 'cygpath -w "$(dirname "$BASH")"'], { encoding: "utf8" }).stdout ?? "").trim()
    : "";
// Absolute either way: the fixtures' PATH holds no bash.
const bash = msysBin
  ? join(msysBin, "bash.exe")
  : spawnSync("bash", ["-c", "command -v bash"], { encoding: "utf8" }).stdout.trim();
const which = (cmd) => spawnSync(bash, ["-c", `command -v ${cmd}`], { encoding: "utf8" }).stdout.trim();

// term_pt_for as omarchy-display-text-size ships it (Omarchy 4.0.6).
const omarchyScript = (formula = `'BEGIN { printf "%d", int(s * p / b + 0.5) }'`) => `#!/bin/bash
TERM_DEFAULT_PT=9
SHELL_DEFAULT_PX=12
term_pt_for() {
  awk -v s="$1" -v p="$TERM_DEFAULT_PT" -v b="$SHELL_DEFAULT_PX" \\
    ${formula}
}
`;

// On Omarchy the real slider sits in /usr/bin beside every other tool, so a
// machine "without Omarchy" gets a PATH holding only what the filter runs.
// Wrapper scripts, not symlinks: Windows refuses symlinks without Developer Mode.
const tools = join(root, "tools");
mkdirSync(tools);
for (const cmd of ["awk", "sed", "grep", "cat"]) {
  writeFileSync(join(tools, cmd), `#!/bin/bash\nexec "${which(cmd)}" "$@"\n`, { mode: 0o755 });
}

// Run from a git hook, the suite inherits the variables that locate that hook's
// repository; left in place they would point the stash fixture at it.
const baseEnv = { ...process.env };
for (const name of [
  "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_NAMESPACE", "GIT_PREFIX",
]) delete baseEnv[name];

let fixtures = 0;
// A HOME with an optional shell.toml, and a PATH whose omarchy-display-text-size
// is the given script (none when null).
function machine({ baseSize, script = omarchyScript() } = {}) {
  const dir = join(root, `machine-${fixtures++}`);
  const bin = join(dir, "bin");
  mkdirSync(join(dir, ".config", "omarchy"), { recursive: true });
  mkdirSync(bin);
  if (baseSize !== undefined) {
    writeFileSync(join(dir, ".config", "omarchy", "shell.toml"), `[font]\nbase-size = ${baseSize}\n`);
  }
  if (script !== null) writeFileSync(join(bin, "omarchy-display-text-size"), script, { mode: 0o755 });
  return { ...baseEnv, HOME: dir, PATH: `${bin}${delimiter}${tools}` };
}

const run = (args, input, env = baseEnv) =>
  spawnSync(bash, [filter, ...args], { input, encoding: "utf8", env });

const ghostty = (size) => `font-family = "FiraCode Nerd Font"\nfont-size = ${size}\ncursor-style = block\n`;

test("clean stores the canonical size and drops a machine-local block", () => {
  const result = run([], `${ghostty(9)}# >>> machine-local\nsecret\n# <<< machine-local\n`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, ghostty(16));
});

test("clean refuses an unterminated machine-local block", () => {
  const result = run([], "a\n# >>> machine-local\nsecret\n");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /never closed/);
});

for (const [px, pt] of [[12, 9], [16, 12], [13, 10], [9, 7]]) {
  test(`smudge restores ${pt}pt from a ${px}px slider setting`, () => {
    const result = run(["smudge"], ghostty(16), machine({ baseSize: px }));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, ghostty(pt));
    assert.equal(result.stderr, "");
  });
}

test("smudge passes the file through where the slider was never used", () => {
  for (const env of [machine(), machine({ baseSize: undefined, script: null })]) {
    const result = run(["smudge"], ghostty(16), env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, ghostty(16));
    assert.equal(result.stderr, "");
  }
});

test("smudge leaves the size alone and says why when Omarchy's formula changes", () => {
  const changed = omarchyScript(`'BEGIN { printf "%.1f", s * p / b }'`);
  const result = run(["smudge"], ghostty(16), machine({ baseSize: 12, script: changed }));
  assert.equal(result.status, 0, "a failing smudge would abort the checkout");
  assert.equal(result.stdout, ghostty(16));
  assert.match(result.stderr, /formula .* changed/);
});

test("smudge never fails on a bad shell.toml or a missing Omarchy script", () => {
  for (const env of [machine({ baseSize: "big" }), machine({ baseSize: 12, script: null })]) {
    const result = run(["smudge"], ghostty(16), env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, ghostty(16));
    assert.match(result.stderr, /left as stored/);
  }
});

test("smudge leaves files without a font-size line untouched", () => {
  const block = "a = 1\n# >>> machine-local\nkept in the working tree\n# <<< machine-local\n";
  const result = run(["smudge"], block, machine({ baseSize: 12 }));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, block);
});

test("an unknown mode is a usage error", () => {
  assert.equal(run(["bogus"], "x\n").status, 2);
});

// The drift alarm: the installed slider must still convert px to pt the way the
// smudge reads it. The constants are read live, so only a changed formula (or a
// script the smudge cannot parse) fails this. Skipped where Omarchy is absent.
const installed = which("omarchy-display-text-size");
test("the installed omarchy-display-text-size still uses the formula smudge reads", { skip: installed === "" && "Omarchy not installed" }, () => {
  const env = { ...machine({ baseSize: 16, script: null }), PATH: baseEnv.PATH };
  const result = run(["smudge"], ghostty(99), env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "", `smudge rejected ${installed}: ${result.stderr}`);
  assert.match(result.stdout, /^font-size = [1-9][0-9]*$/m);
  assert.doesNotMatch(result.stdout, /^font-size = 99$/m, "the size was not restored");
});

test("git stash keeps the slider's size, with the filter registered as bootstrap does", () => {
  // A space and a ' in the script's path, a space in the repository's: bootstrap
  // writes the command as '<path>' and '<path>' smudge with ' as '\'', and git
  // runs it through sh -c.
  const scriptDir = join(root, "O'Brien dot files", "lib");
  mkdirSync(scriptDir, { recursive: true });
  const script = join(scriptDir, "git-filter-machine-local.sh");
  copyFileSync(filter, script);
  const posix = (p) => (msysBin ? spawnSync(bash, ["-c", 'cygpath -u "$1"', "_", p], { encoding: "utf8" }).stdout.trim() : p);
  const work = join(root, "stash repo");
  mkdirSync(work);
  const slider = machine({ baseSize: 12 });
  const env = {
    ...slider,
    // git, sh and bash come from the real PATH; the fake slider still wins.
    PATH: `${join(slider.HOME, "bin")}${delimiter}${baseEnv.PATH}`,
    GIT_CONFIG_GLOBAL: join(root, "empty-gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
  };
  writeFileSync(env.GIT_CONFIG_GLOBAL, "");
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: work, encoding: "utf8", env });
    assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout;
  };
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  const command = `'${posix(script).replace(/'/g, "'\\''")}'`;
  git("config", "filter.machine-local.clean", command);
  git("config", "filter.machine-local.smudge", `${command} smudge`);
  git("config", "filter.machine-local.required", "true");
  writeFileSync(join(work, ".gitattributes"), "config filter=machine-local\n");
  writeFileSync(join(work, "config"), ghostty(9));
  git("add", ".");
  git("commit", "-q", "-m", "init");
  assert.equal(git("show", "HEAD:config"), ghostty(16), "the index holds the canonical size");

  // An unrelated local edit forces stash to rewrite the file from the index.
  writeFileSync(join(work, "config"), `${ghostty(9)}window-padding-x = 4\n`);
  git("stash", "-q");
  assert.equal(readFileSync(join(work, "config"), "utf8"), ghostty(9));
  git("stash", "pop", "-q");
  assert.equal(readFileSync(join(work, "config"), "utf8"), `${ghostty(9)}window-padding-x = 4\n`);
});
