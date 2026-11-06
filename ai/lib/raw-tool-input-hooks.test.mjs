import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";

const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const root = mkdtempSync(join(tmpdir(), "raw-tool-input-hooks-"));
// Session ids this run hands the hooks as feedback-<mkdtemp> dir names.
const feedbackIds = [];
after(() => {
  rmSync(root, { recursive: true, force: true });
  // The post-edit hooks keep a debounce stamp (and checker output) at fixed
  // /tmp paths keyed by session id, outside tmpdir(). Only this run's fixture
  // session ids are removed: input-regression, this run's root name and its
  // -field variants, and this run's feedback dirs — never another run's, which
  // may still be using its files, and never a real session's (a UUID).
  const rootName = root.split(/[\\/]/).at(-1);
  const ids = ["input-regression", `${rootName}(-.*)?`, ...feedbackIds];
  const ours = new RegExp(`^(codex|claude)-pipeline-(last|check-output|typecheck-output)-(${ids.join("|")})$`);
  let names = [];
  try { names = readdirSync("/tmp"); } catch {} // no /tmp to sweep (Windows)
  for (const name of names) {
    if (!ours.test(name)) continue;
    // A same-named file another user owns in sticky /tmp must not fail the run.
    try { rmSync(join("/tmp", name), { force: true }); } catch {}
  }
});
const run = (hook, tool, toolInput, env = process.env, runtime = "codex") => spawnSync("bash", [join(repo, runtime, "hooks", hook)], {
  cwd: root,
  input: JSON.stringify({ session_id: "input-regression", tool_name: tool, tool_input: toolInput }),
  encoding: "utf8",
  env,
});
// macOS and Linux awk keep a CR before the newline; MSYS gawk drops it unless
// BINMODE is set. This shim gives every platform the Unix behavior.
const unixAwk = join(root, "unix-awk");
mkdirSync(unixAwk);
writeFileSync(join(unixAwk, "awk"), '#!/bin/bash\nexec /usr/bin/awk -v BINMODE=3 "$@"\n', { mode: 0o755 });

for (const input of ["text(1)", { command: "printf ok" }]) {
  test(`protect-files accepts benign ${typeof input} tool input`, () => {
    const result = run("protect-files.sh", "functions.exec", input);
    assert.equal(result.status, 0, result.stderr);
  });
}

test("post-edit accepts a raw patch string", () => {
  const result = run("post-edit-pipeline.sh", "apply_patch", "*** Begin Patch\n*** Update File: demo.md\n*** End Patch");
  assert.equal(result.status, 0, result.stderr);
});

for (const [label, format] of [
  ["formatter only", true],
  ["no feedback", false],
]) {
  test(`post-edit emits one JSON context for ${label}`, () => {
    const dir = mkdtempSync(join(root, "feedback-"));
    feedbackIds.push(dir.split(/[\\/]/).at(-1));
    mkdirSync(join(dir, "lib"));
    writeFileSync(join(dir, "pipeline.sh"), readFileSync(join(repo, "codex", "hooks", "post-edit-pipeline.sh")));
    writeFileSync(join(dir, "lib", "detect-project.sh"), `
detect_project_root() { pwd; }
detect_formatter() { FMT_CMD="$HOOK_TEST_FORMAT"; }
file_checksum() { cksum "$1"; }
portable_timeout() { shift; "$@"; }
`);
    writeFileSync(join(dir, "format.sh"), '#!/bin/bash\nprintf formatted > "$1"\n');
    // Two files, so the formatter lines need their separator as well.
    const names = ["한글 file.go", "second.go"];
    for (const one of names) writeFileSync(join(dir, one), "unformatted\n");
    const result = spawnSync("bash", [join(dir, "pipeline.sh")], {
      cwd: dir, encoding: "utf8",
      input: JSON.stringify({
        session_id: dir.split(/[\\/]/).at(-1), tool_name: "apply_patch",
        tool_input: { command: `*** Begin Patch\n${names.map(one => `*** Update File: ${one}`).join("\n")}\n*** End Patch` },
        tool_response: "Success",
      }),
      env: { ...process["env"], HOOK_TEST_FORMAT: format ? "bash ./format.sh" : "" },
    });
    assert.equal(result.status, 0, result.stderr);
    for (const one of names) assert.equal(readFileSync(join(dir, one), "utf8"), format ? "formatted" : "unformatted\n");
    if (!format) {
      assert.equal(result.stdout, "");
      return;
    }
    assert.deepEqual(JSON.parse(result.stdout), {
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: names.map(one => `[codex auto-format] bash formatted ${one}`).join("\n") },
    });
  });
}

test("post-edit passes a CRLF patch path to its formatter lookup without a trailing CR", () => {
  const hooks = join(root, "pipeline-fixture");
  mkdirSync(join(hooks, "lib"), { recursive: true });
  writeFileSync(join(hooks, "post-edit-pipeline.sh"), readFileSync(join(repo, "codex", "hooks", "post-edit-pipeline.sh")));
  writeFileSync(join(hooks, "lib", "detect-project.sh"), 'detect_project_root() { pwd; }\ndetect_formatter() { printf "<%s>" "$1" >> "$HOOK_PATH_LOG"; FMT_CMD=""; }\n');
  const log = join(root, "pipeline-paths.log");
  const result = spawnSync("bash", [join(hooks, "post-edit-pipeline.sh")], {
    cwd: root, encoding: "utf8",
    input: JSON.stringify({ session_id: root.split(/[\\/]/).at(-1), tool_name: "apply_patch", tool_input: "*** Begin Patch\r\n*** Update File: demo.md\r\n*** End Patch\r\n" }),
    env: { ...process.env, PATH: unixAwk + delimiter + process.env.PATH, HOOK_PATH_LOG: log },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(log, "utf8"), "<demo.md>");
});

test("object input still blocks a protected file", () => {
  const result = run("protect-files.sh", "Edit", { file_path: ".env", new_string: "fixture" });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /Blocked/);
});

for (const runtime of ["codex", "claude"]) test(`${runtime} native Windows paths retain filename and secret-directory protection`, () => {
  for (const path of ["C:\\fixture\\deploy.pem", "C:\\fixture\\secrets\\note.txt", "\\\\server\\share\\deploy.pem", "C:\\fixture\\.ENV", "C:\\fixture\\Credentials\\note.txt"]) {
    const result = run("protect-files.sh", "Edit", { file_path: path, new_string: "fixture" }, process.env, runtime);
    assert.equal(result.status, 2, `${path}: ${result.stderr}`);
    assert.match(result.stderr, /Blocked/);
  }
});

// On macOS and Linux a backslash is an ordinary filename character, so turning it into
// a separator must not be the only reading: this name is an .env.* file there.
// On Windows the same string is a file b inside a folder .env.a, which MSYS basename
// agrees with, so there is nothing to block.
const unixOnly = { skip: process.platform === "win32" && "a backslash is a separator on Windows" };
for (const runtime of ["codex", "claude"]) test(`${runtime} keeps a backslash inside a Unix filename`, unixOnly, () => {
  const result = run("protect-files.sh", "Edit", { file_path: "dir/.env.a\\b", new_string: "fixture" }, process.env, runtime);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /Blocked/);
});

test("a CRLF raw patch cannot bypass protected-file checks", () => {
  const result = run("protect-files.sh", "apply_patch", "*** Begin Patch\r\n*** Update File: .env\r\n*** End Patch\r\n", {
    ...process.env,
    PATH: unixAwk + delimiter + process.env.PATH,
  });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /Blocked/);
});

test("raw patches cannot bypass generated-file protection", () => {
  writeFileSync(join(root, "generated.md"), "<!-- AUTO-GENERATED by fixture -->\n");
  const result = run("protect-files.sh", "apply_patch", "*** Begin Patch\n*** Update File: generated.md\n*** End Patch");
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /declares itself generated/);
});

for (const field of ["patch", "input", "diff"]) {
  test(`object ${field} patches protect generated move destinations with CRLF`, () => {
    writeFileSync(join(root, "generated move.md"), "# AUTO-GENERATED fixture\n");
    const patch = "*** Begin Patch\r\n*** Update File: source.md\r\n*** Move to: generated move.md\r\n*** End Patch\r\n";
    const result = run("protect-files.sh", "functions.apply_patch", { [field]: patch });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /declares itself generated/);
  });

  test(`object ${field} patches protect sensitive paths`, () => {
    const result = run("protect-files.sh", "functions.apply_patch", { [field]: "*** Begin Patch\n*** Add File: app/.env\n+X=1\n*** End Patch\n" });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /Blocked/);
  });

  test(`post-edit extracts CRLF paths from object ${field} patches`, () => {
    const hooks = join(root, `pipeline-${field}`);
    mkdirSync(join(hooks, "lib"), { recursive: true });
    writeFileSync(join(hooks, "post-edit-pipeline.sh"), readFileSync(join(repo, "codex/hooks/post-edit-pipeline.sh")));
    writeFileSync(join(hooks, "lib/detect-project.sh"), 'detect_project_root() { pwd; }\ndetect_formatter() { printf "<%s>" "$1" >> "$HOOK_PATH_LOG"; FMT_CMD=""; }\n');
    const log = join(root, `paths-${field}.log`);
    const result = spawnSync("bash", [join(hooks, "post-edit-pipeline.sh")], {
      cwd: root, encoding: "utf8",
      input: JSON.stringify({ session_id: `${root.split(/[\\/]/).at(-1)}-${field}`, tool_name: "functions.apply_patch", tool_input: { [field]: "*** Begin Patch\r\n*** Update File: source file.md\r\n*** End Patch\r\n" } }),
      env: { ...process.env, HOOK_PATH_LOG: log },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(log, "utf8"), "<source file.md>");
  });
}

test("namespaced shell commands retain sensitive command checks", () => {
  for (const tool of ["functions.exec_command", "mcp__host__exec_command"]) {
    const result = run("protect-files.sh", tool, { command: "cat .env" });
    assert.equal(result.status, 2, tool + result.stderr);
  }
});

for (const tool of ["functions.exec_command", "mcp__host__exec_command"]) {
  test(`${tool} accepts code identifiers that contain extension prefixes`, () => {
    for (const command of [
      "python3 -c \"import os; print(os.environ.get('LANG'))\"",
      "node -p 'Object.keys({a: 1})'",
      "printf '%s' example.pem_format example.key_count",
    ]) {
      const result = run("protect-files.sh", tool, { command });
      assert.equal(result.status, 0, result.stderr);
    }
  });

  test(`${tool} still blocks real extensions, variants and other protected paths`, () => {
    for (const command of [
      "cat .env",
      "cat app/.env.production",
      "cat settings.env",
      "cat 'private key.pem'",
      'cat "C:\\Users\\me\\PRIVATE.KEY"',
      "cat ./bundle.p12",
      "cat ./bundle.pfx;",
      "cat credentials/token",
      "cat secrets/token",
      "cat service-secret.txt",
    ]) {
      const result = run("protect-files.sh", tool, { command });
      assert.equal(result.status, 2, command + result.stderr);
    }
  });
}

// Lockfiles are written by their package managers and hold no secrets, so they
// are deliberately not protected: go.sum since 2026-10-28, the rest since
// 2026-11-04. Blocking every command that names one made a dependency or
// version change impossible to stage. Pin that, so no entry is quietly added back.
const LOCKFILES = ["go.sum", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Cargo.lock", "bun.lock", "bun.lockb"];
for (const [runtime, tool, input] of [
  ["claude", "Bash", { command: `git add ${LOCKFILES.join(" ")}` }],
  ["claude", "Bash", { command: "git grep -n version -- ':!Cargo.lock'" }],
  ...LOCKFILES.map((name) => ["claude", "Edit", { file_path: `mod/${name}`, old_string: "a", new_string: "b" }]),
  ["claude", "Read", { file_path: "Cargo.lock" }],
  ["codex", "functions.exec_command", { command: `git add ${LOCKFILES.join(" ")}` }],
  ["codex", "apply_patch", { command: "*** Begin Patch\n*** Update File: Cargo.lock\n@@\n-a\n+b\n*** End Patch\n" }],
]) {
  test(`${runtime} ${tool} lets lockfiles through: ${JSON.stringify(input).slice(0, 60)}`, () => {
    const result = run("protect-files.sh", tool, input, process.env, runtime);
    assert.equal(result.status, 0, result.stderr);
  });
}

// The Claude pipeline compared checksums with BSD `md5 -q`, which Linux does
// not have: the checksum came back empty and the formatter never ran after an
// edit (found in kope's d-72 review). This runs the real hook, its real lib and
// a real gofmt on whatever checksum tool the host has.
const gofmt = spawnSync("bash", ["-c", "command -v gofmt"], { encoding: "utf8" }).stdout.trim();
test("claude post-edit formats the edited file on this host", { skip: !gofmt && "no gofmt on PATH" }, () => {
  const dir = mkdtempSync(join(root, "feedback-"));
  const sid = dir.split(/[\\/]/).at(-1);
  feedbackIds.push(sid);
  mkdirSync(join(dir, "hooks", "lib"), { recursive: true });
  for (const name of ["post-edit-pipeline.sh", "lib/detect-project.sh"]) {
    writeFileSync(join(dir, "hooks", name), readFileSync(join(repo, "claude", "hooks", name)));
  }
  const project = join(dir, "project");
  mkdirSync(project);
  spawnSync("git", ["init", "-q"], { cwd: project });
  const file = join(project, "main.go");
  writeFileSync(file, "package main\nfunc main(){\nx:=1\n_=x}\n");
  const result = spawnSync("bash", [join(dir, "hooks", "post-edit-pipeline.sh")], {
    cwd: project, encoding: "utf8",
    input: JSON.stringify({ session_id: sid, tool_name: "Edit", tool_input: { file_path: file } }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(file, "utf8"), "package main\n\nfunc main() {\n\tx := 1\n\t_ = x\n}\n");
  assert.equal(result.stdout.trim(), "[auto-format] gofmt formatted main.go");
});

test("post-edit registration accepts namespaced edit tools without matching reads", () => {
  const template = readFileSync(join(repo, "codex/config.toml.template"), "utf8");
  const matcher = new RegExp(template.split("[[hooks.PostToolUse]]")[1].match(/matcher = "(.*)"/)[1]);
  for (const tool of ["apply_patch", "functions.apply_patch", "mcp__host__Edit"]) assert.ok(matcher.test(tool), tool);
  for (const tool of ["Read", "functions.exec_command", "editor_view"]) assert.equal(matcher.test(tool), false, tool);
});
