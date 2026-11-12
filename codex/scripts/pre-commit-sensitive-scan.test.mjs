import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scanner = join(dirname(fileURLToPath(import.meta.url)), "pre-commit-sensitive-scan.sh").replaceAll("\\", "/");
const bash = process.platform === "win32" ? join(process.env.ProgramFiles, "Git", "bin", "bash.exe") : "bash";
const ticket = "TASK" + "-123";

async function fixture(t, content, filename = "notes.md") {
  const root = await mkdtemp(join(tmpdir(), "sensitive-scan-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "ignore" });
  if (content !== undefined) {
    await writeFile(join(root, filename), content);
    execFileSync("git", ["add", "--", filename], { cwd: root });
  }
  return {
    root,
    run: () => spawnSync(bash, [scanner], { cwd: root, encoding: "utf8" }),
  };
}

test("SHA-256 in content and filenames is a hash algorithm, not a ticket", async (t) => {
  const f = await fixture(t, "Verify the SHA-256 digest.\n", "SHA-256-notes.md");
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS SensitiveInfo: 1 staged file/);
});

test("a real ticket after SHA-256 is still reported", async (t) => {
  const f = await fixture(t, `SHA-256 ${ticket}\n`);
  const result = f.run();
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.ok(result.stdout.includes(`ticket-like identifier (${ticket})`));
});

test("the algorithm exception matches exactly", async (t) => {
  const candidate = "SHA-" + "2567";
  const f = await fixture(t, `${candidate}\n`);
  const result = f.run();
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.ok(result.stdout.includes(`ticket-like identifier (${candidate})`));
});

test("token detection remains fatal after an allowed hash algorithm", async (t) => {
  const f = await fixture(t, "SHA-256 " + "AKIA" + "A".repeat(16) + "\n");
  const result = f.run();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /token-like secret/);
});

for (const filename of ["검증.md", 'quote"notes.md', "line\nnotes.md"]) {
  test(`token detection reads a quoted staged path: ${JSON.stringify(filename)}`, {
    skip: process.platform === "win32" && /["\n]/.test(filename) && "filename is not supported on Windows",
  }, async (t) => {
    const f = await fixture(t, "AKIA" + "A".repeat(16) + "\n", filename);
    const result = f.run();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /token-like secret/);
  });
}

test("ticket detection reads the index rather than unstaged content", async (t) => {
  const f = await fixture(t, `${ticket}\n`);
  await writeFile(join(f.root, "notes.md"), "SHA-256\n");
  const result = f.run();
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.ok(result.stdout.includes(`ticket-like identifier (${ticket})`));
});

test("ticket identifiers in staged filenames remain warnings", async (t) => {
  const f = await fixture(t, "plain text\n", `${ticket}.md`);
  const result = f.run();
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.ok(result.stdout.includes(`ticket-like identifier (${ticket})`));
});

test("an empty index passes", async (t) => {
  const result = (await fixture(t)).run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS SensitiveInfo: no staged files/);
});
