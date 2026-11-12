import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, delimiter } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test, { after, describe } from "node:test";

// Every scratch home this file creates, removed once all tests have run.
const tempDirs = [];
const tempDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function fixture(tool) {
  const home = tempDir("stop-hook-");
  // The hooks keep their retry counter and checker output at fixed /tmp paths
  // keyed by session id (stop-handler.sh:26/94, stop-gate.sh:18-19), outside
  // tmpdir(), so the run's session id is registered for removal as well.
  const sid = `stop-${tool}-${home.split(/[\\/]/).at(-1)}`;
  for (const kind of ["", "output-"]) tempDirs.push(join("/tmp", `${tool}-final-gate-${kind}${sid}`));
  const root = join(home, ".config");
  const hookName = tool === "codex" ? "stop-gate.sh" : "stop-handler.sh";
  const hookDir = join(root, tool, "hooks");
  const bin = join(home, "bin");
  for (const dir of [join(hookDir, "lib"), bin, join(root, "ai", "lib"), join(root, "ai", "skills", "config-audit", "scripts")]) mkdirSync(dir, { recursive: true });
  copyFileSync(join(repo, tool, "hooks", hookName), join(hookDir, hookName));
  copyFileSync(join(repo, tool, "hooks", "lib", "detect-project.sh"), join(hookDir, "lib", "detect-project.sh"));
  const putExecutable = (path, text) => { writeFileSync(path, text); chmodSync(path, 0o755); };
  putExecutable(join(hookDir, "notify.sh"), "#!/bin/bash\nexit 0\n");
  putExecutable(join(bin, "node"), '#!/bin/bash\necho "$*" >> "$STOP_AUDIT_CALLS"\ncase "$*" in *session-routing*) sleep 1 ;; esac\nexit "${STOP_AUDIT_EXIT:-0}"\n');
  // A changed .md also selects the config-audit Go suite (frontmatter parse).
  putExecutable(join(bin, "go"), '#!/bin/bash\necho "go $*" >> "$STOP_AUDIT_CALLS"\nexit "${STOP_AUDIT_EXIT:-0}"\n');
  // Budget recorders for both portable_timeout branches: GNU `timeout -k N secs
  // cmd...` (Windows, perl-less hosts) and the perl supervisor `perl -e SCRIPT
  // secs cmd...` (Unix). Each records secs and runs the command unbounded.
  putExecutable(join(bin, "timeout"), '#!/bin/bash\n[ "$1" = -k ] && shift 2\necho "$1" >> "$STOP_AUDIT_BUDGETS"\nshift\n"$@"\n');
  putExecutable(join(bin, "perl"), '#!/bin/bash\n[ "$1" = -e ] || { echo "perl shim: unexpected $*" >&2; exit 99; }\nshift 2\necho "$1" >> "$STOP_AUDIT_BUDGETS"\nshift\n"$@"\n');
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
    input: JSON.stringify({ session_id: sid, cwd: root }),
  });
  return { home, root, hook: join(hookDir, hookName), run, env };
}

for (const tool of ["codex", "claude"]) {
  test(`${tool} Stop runs contract and untracked tests with a shared suite budget`, () => {
    const f = fixture(tool);
    const r = f.run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const calls = readFileSync(f.env.STOP_AUDIT_CALLS, "utf8").trim().split(/\r?\n/);
    assert.equal(calls.length, 3, "tracked instructions, an untracked ai/lib test and a changed .md each trigger a suite");
    assert.match(calls[0], /session-routing-consumers/);
    assert.match(calls[1], /untracked.test.mjs/);
    assert.equal(calls[2], "go test ./...");
    const budgets = readFileSync(f.env.STOP_AUDIT_BUDGETS, "utf8").trim().split(/\r?\n/).map(Number);
    assert.ok(budgets.every((n) => n > 0 && n <= 300));
    assert.ok(budgets[1] < budgets[0], "later suites consume the remaining budget");
  });

  test(`${tool} Stop blocks a failing suite`, () => {
    const f = fixture(tool);
    const r = f.run({ STOP_AUDIT_EXIT: "17" });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    // A blocking Stop hook reaches the model through stderr alone; on stdout
    // the reason was dropped and the session saw only "No stderr output".
    assert.match(r.stderr, /contract tests failed/);
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

  // The format stage counted changes with BSD `md5 -q`, which Linux lacks, so
  // the count stayed 0 and the notice never showed. Real gofmt, real checksum.
  const gofmt = spawnSync("bash", ["-c", "command -v gofmt"], { encoding: "utf8" }).stdout.trim();
  test(`${tool} Stop formats a tracked file and says so`, { skip: !gofmt && "no gofmt on PATH" }, () => {
    const f = fixture(tool);
    const file = join(f.root, "main.go");
    const gitEnv = f["env"];
    writeFileSync(file, "package main\n");
    for (const args of [["add", "main.go"], ["commit", "-qm", "go"]]) {
      const g = spawnSync("git", args, { cwd: f.root, env: gitEnv, encoding: "utf8" });
      assert.equal(g.status, 0, g.stderr);
    }
    writeFileSync(file, "package main\nfunc main(){}\n");
    const r = f.run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(readFileSync(file, "utf8"), "package main\n\nfunc main() {}\n");
    assert.match(r.stdout + r.stderr, /formatted 1 file/);
  });
}

test("Stop hook registrations outlive the suite budget", () => {
  const template = readFileSync(join(repo, "codex", "config.toml.template"), "utf8");
  const codex = template.split("[[hooks.Stop.hooks]]")[1].split("[[hooks.PermissionRequest]]")[0];
  const settings = JSON.parse(readFileSync(join(repo, "claude", "settings.json"), "utf8"));
  const claude = settings.hooks.Stop.flatMap((group) => group.hooks).find((hook) => hook.command.endsWith("stop-handler.sh"));
  // Both products specify command-hook timeout in seconds, not milliseconds.
  for (const [tool, seconds] of [["codex", Number(codex.match(/timeout = (\d+)/)[1])], ["claude", claude.timeout]]) {
    const source = readFileSync(join(repo, tool, "hooks", tool === "codex" ? "stop-gate.sh" : "stop-handler.sh"), "utf8");
    const budget = Number(source.match(/SUITE_TIMEOUT=(\d+)/)[1]);
    assert.ok(seconds >= budget + 10, `${tool} registration must allow the bounded suites to finish`);
    assert.ok(seconds <= budget + 60, `${tool} registration must remain bounded, not hours long`);
  }
});

for (const tool of ["codex", "claude"]) {
  test(`${tool} Stop formats a tracked Unicode filename`, () => {
    const f = fixture(tool);
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
    if (tool === "codex") {
      assert.deepEqual(JSON.parse(result.stdout), {
        systemMessage: "[codex final-gate] auto-formatted 1 file(s)",
      });
    } else {
      assert.match(result.stdout, /\[final-gate\] auto-formatted 1 file\(s\)/);
    }
  });
}

test("codex Stop preserves stderr blocking and allows stop after two retries", () => {
  const f = fixture("codex");
  for (const attempt of [1, 2]) {
    const result = f.run({ STOP_AUDIT_EXIT: "17" });
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, new RegExp(`contract tests failed \\(attempt ${attempt}/2\\)`));
  }
  const result = f.run({ STOP_AUDIT_EXIT: "17" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /failed after 2 retries\. Allowing stop/);
});

// ── portable_timeout and detect_formatter ──────────────────────────────────────
// Both detect-project.sh copies carry the same portable_timeout and checkers;
// each consumer sources them under its own shell options.
const isWindows = process.platform === "win32";
const libOf = (tool) => join(repo, tool, "hooks", "lib", "detect-project.sh");
const shellOpts = { codex: "set -euo pipefail", claude: "" };
// Native Windows Node cannot spawn Git Bash's /usr/bin paths.
const which = (name) => spawnSync("bash", ["-c", isWindows
  ? 'p=$(command -v "$1") && cygpath -m "$p"'
  : 'command -v "$1"', "_", name], { encoding: "utf8" }).stdout.trim();
const bashPath = which("bash");
const gnuTimeout = (() => {
  const path = which("timeout");
  if (!path) return "";
  const r = spawnSync(path, ["--version"], { encoding: "utf8" });
  return /GNU coreutils/.test(r.stdout) ? path : "";
})();

// A bin directory holding only what the helper and the fixtures run, so the
// helper's `command -v perl` / `command -v timeout` see exactly this choice.
function curatedBin(dir, { perl, timeout }) {
  mkdirSync(dir, { recursive: true });
  for (const name of ["bash", "sh", "sleep", "uname", "cat", "mkdir"]) symlinkSync(which(name), join(dir, name));
  if (perl) symlinkSync(which("perl"), join(dir, "perl"));
  if (timeout) symlinkSync(gnuTimeout, join(dir, "timeout"));
  return dir;
}

// Path selection mirrors the helper: on Unix the supervisor (perl, no timeout
// on PATH — the base helper's Perl branch) and the GNU fallback (perl hidden);
// on Windows Git Bash only GNU, through the ambient PATH.
const timeoutPaths = isWindows
  ? [{ name: "gnu", supervisor: false, bin: () => process.env.PATH }]
  : [
      { name: "supervisor", supervisor: true, bin: (home) => curatedBin(join(home, "sup-bin"), { perl: true }) },
      gnuTimeout
        ? { name: "gnu", supervisor: false, bin: (home) => curatedBin(join(home, "gnu-bin"), { timeout: true }) }
        : { name: "gnu", skip: "no GNU timeout on this host" },
    ];

// The heartbeat loop is a background subshell — a grandchild of the command
// portable_timeout runs. It records its PID, then appends a line every 0.1 s.
// Its stdio is detached so a surviving loop cannot hold the test's pipes open
// (a regression must fail an assertion, not hang the suite).
//   plain:    parent sleeps; everything obeys TERM
//   stubborn: parent and loop ignore TERM/INT/HUP; the parent stays and waits
//   orphan:   parent dies on TERM, the loop ignores it (R4)
// The loop is its own process and the parent records \`$!\` the moment it
// forks, so the PID file exists however slowly the loop starts under load.
const FIXTURE = `#!/bin/bash
hb="$1"
loop='while :; do echo x >> "$1"; sleep 0.1; done'
case "$2" in
  plain) bash -c "$loop" _ "$hb" </dev/null >/dev/null 2>&1 & echo $! > "$hb.pid"; sleep 30 ;;
  stubborn) trap '' TERM INT HUP; bash -c "$loop" _ "$hb" </dev/null >/dev/null 2>&1 & echo $! > "$hb.pid"; wait ;;
  orphan) bash -c "trap '' TERM INT HUP; $loop" _ "$hb" </dev/null >/dev/null 2>&1 & echo $! > "$hb.pid"; sleep 30 ;;
esac
`;
// Ceiling for one bounded run; every case expects far less. The per-case time
// bounds below are the design value (1 s deadline + 2 s grace) plus ~1.5 s
// for load from the concurrent cases — far from the base helper's failures
// (a hang, or processes left running).
const HANG_MS = 20000;

function timeoutHome() {
  const home = tempDir("portable-timeout-");
  writeFileSync(join(home, "fixture.sh"), FIXTURE);
  chmodSync(join(home, "fixture.sh"), 0o755);
  return home;
}

function signalFixtureProcess(pid, signal) {
  // Fixture PIDs come from MSYS $$/$!, not the native Windows PID namespace.
  if (isWindows) {
    const r = spawnSync(bashPath, ["-c", 'kill -s "$1" -- "$2"', "_", String(signal), String(pid)], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr || "fixture process unavailable");
  } else process.kill(pid, signal);
}
const alive = (pid) => { try { signalFixtureProcess(pid, 0); return true; } catch { return false; } };
const loopPid = (hb) => (existsSync(`${hb}.pid`) ? Number(readFileSync(`${hb}.pid`, "utf8").trim()) : 0);
const killLoop = (hb) => { const pid = loopPid(hb); if (pid && alive(pid)) signalFixtureProcess(pid, "SIGKILL"); };

// True when the heartbeat has stopped and its loop process is gone.
async function stopped(hb) {
  assert.ok(loopPid(hb) > 0, "the heartbeat loop never started, so its stopping proves nothing");
  const size = () => (existsSync(hb) ? statSync(hb).size : 0);
  const before = size();
  await sleep(600);
  const pid = loopPid(hb);
  return size() === before && !(pid && alive(pid));
}

function bounded(tool, PATH, secs, args, extra = {}) {
  const script = `${shellOpts[tool]}\n. "$1"; shift; portable_timeout "$@"`;
  const t0 = Date.now();
  const r = spawnSync(bashPath, ["-c", script, "_", libOf(tool), String(secs), ...args],
    { env: { ...process.env, PATH }, encoding: "utf8", timeout: HANG_MS, killSignal: "SIGKILL", ...extra });
  return { status: r.status, stdout: r.stdout, elapsed: (Date.now() - t0) / 1000 };
}

// The supervisor (perl) the wrapper bash has started, once it exists.
function supervisorPid(wrapperPid) {
  const r = spawnSync("pgrep", ["-l", "-P", String(wrapperPid)], { encoding: "utf8" });
  const line = (r.stdout || "").split("\n").find((l) => /^\d+\s+perl/.test(l));
  return line ? Number(line.split(/\s+/)[0]) : 0;
}

// Runs portable_timeout under a wrapper that survives the signal (a trap, not
// an ignore, so the helper's children start with default dispositions) and
// returns the supervisor's status. target "group" sends `signal` to the
// wrapper's process group — the wrapper and the supervisor, not the command's
// own group — after delayMs. target "supervisor" sends it to the supervisor
// alone, the moment it appears: a group signal that lands before perl exists
// (bash still evaluating portable_timeout) would be taken by the wrapper's
// trap and never reach a supervisor, which is not what the case is about.
async function signalled(tool, PATH, home, secs, args, signal, delayMs, target = "group") {
  const rcFile = join(home, `rc-${signal}-${delayMs}-${Math.random()}`);
  const script = `trap : TERM INT HUP\n${shellOpts[tool]}\n. "$1"; shift; rc=0; portable_timeout "$@" || rc=$?; echo "$rc" > "${rcFile}"`;
  const child = spawn(bashPath, ["-c", script, "_", libOf(tool), String(secs), ...args],
    { env: { ...process.env, PATH }, detached: true, stdio: "ignore" });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  await sleep(delayMs);
  let signalledSupervisor = false;
  if (target === "supervisor") {
    for (const deadline = Date.now() + 5000; Date.now() < deadline && !signalledSupervisor;) {
      const pid = supervisorPid(child.pid);
      if (pid) { try { process.kill(pid, signal); signalledSupervisor = true; } catch {} }
    }
  }
  const t0 = Date.now();
  if (target === "group") { try { process.kill(-child.pid, signal); } catch {} }
  const finished = await Promise.race([exited.then(() => true), sleep(HANG_MS / 2).then(() => false)]);
  const afterSignal = (Date.now() - t0) / 1000;
  if (!finished) { try { process.kill(-child.pid, "SIGKILL"); } catch {} await exited; }
  return { rc: existsSync(rcFile) ? Number(readFileSync(rcFile, "utf8").trim()) : null, afterSignal, signalledSupervisor };
}

for (const tool of ["claude", "codex"]) {
  for (const p of timeoutPaths) {
    describe(`${tool} portable_timeout, ${p.name} path`, { concurrency: true, skip: p.skip }, () => {
      const home = p.skip ? "" : timeoutHome();
      const PATH = p.skip ? "" : p.bin(home);
      const fx = join(home, "fixture.sh");
      const supervisorOnly = p.supervisor ? {} : { skip: "supervisor-only case; this path is GNU timeout" };

      test("(a) a grandchild stops with its command at the deadline", async () => {
        const hb = join(home, "a");
        try {
          const r = bounded(tool, PATH, 1, [fx, hb, "plain"]);
          assert.equal(r.status, 124);
          assert.ok(await stopped(hb), "heartbeat still running");
        } finally { killLoop(hb); }
      });

      test("(b) a TERM-ignoring grandchild under a waiting parent is killed", async () => {
        const hb = join(home, "b");
        try {
          const r = bounded(tool, PATH, 1, [fx, hb, "stubborn"]);
          assert.notEqual(r.status, 0);
          assert.ok(r.elapsed < 5, `took ${r.elapsed}s`);
          assert.ok(await stopped(hb), "heartbeat still running");
        } finally { killLoop(hb); }
      });

      test("(c) a TERM-ignoring orphan of a parent that died on TERM is killed", supervisorOnly, async () => {
        const hb = join(home, "c");
        try {
          const r = bounded(tool, PATH, 1, [fx, hb, "orphan"]);
          assert.equal(r.status, 124);
          assert.ok(r.elapsed < 5, `took ${r.elapsed}s`);
          assert.ok(await stopped(hb), "orphaned heartbeat still running");
        } finally { killLoop(hb); }
      });

      for (const [signal, rc] of [["SIGTERM", 143], ["SIGINT", 130], ["SIGHUP", 129]]) {
        test(`(d) ${signal} to the supervisor ends the command's group with ${rc}`, supervisorOnly, async () => {
          const hb = join(home, `d-${signal}`);
          try {
            const r = await signalled(tool, PATH, home, 30, [fx, hb, "stubborn"], signal, 500);
            assert.equal(r.rc, rc);
            assert.ok(r.afterSignal < 3.5, `took ${r.afterSignal}s after the signal`);
            assert.ok(await stopped(hb), "heartbeat still running");
          } finally { killLoop(hb); }
        });
      }

      test("(e) TERM during a pending deadline keeps the first reason", supervisorOnly, async () => {
        const hb = join(home, "e");
        try {
          const r = await signalled(tool, PATH, home, 1, [fx, hb, "stubborn"], "SIGTERM", 800);
          assert.equal(r.rc, 143);
          assert.ok(r.afterSignal < 3.7, `took ${r.afterSignal}s after the signal`);
          assert.ok(await stopped(hb), "heartbeat still running");
        } finally { killLoop(hb); }
      });

      test("(f) TERM the instant the supervisor starts leaks nothing (20 runs)", supervisorOnly, async () => {
        for (let i = 0; i < 20; i++) {
          const hb = join(home, `f-${i}`);
          try {
            const r = await signalled(tool, PATH, home, 30, [fx, hb, "plain"], "SIGTERM", 0, "supervisor");
            assert.ok(r.signalledSupervisor, `run ${i}: the supervisor never appeared`);
            // 143 either way: TERM before perl blocks signals kills it outright
            // (128 + 15), after that the supervisor exits 143 itself.
            assert.equal(r.rc, 143, `run ${i}`);
            assert.ok(r.afterSignal < 4, `run ${i} took ${r.afterSignal}s`);
            assert.ok(!loopPid(hb) || (await stopped(hb)), `run ${i} left a heartbeat running`);
          } finally { killLoop(hb); }
        }
      });

      test("(g)-(j) exit status, missing binary, prompt return, stdin", () => {
        assert.equal(bounded(tool, PATH, 5, ["bash", "-c", "exit 7"]).status, 7);
        assert.equal(bounded(tool, PATH, 5, [join(home, "no-such-binary")]).status, 127);
        const quick = bounded(tool, PATH, 5, ["bash", "-c", "exit 0"]);
        assert.equal(quick.status, 0);
        assert.ok(quick.elapsed < 1, `took ${quick.elapsed}s`);
        assert.equal(bounded(tool, PATH, 5, ["cat"], { input: "hello\n" }).stdout, "hello\n");
      });
    });
  }

  test(`${tool} portable_timeout prefers the supervisor when perl and GNU timeout are both on PATH`,
    { skip: isWindows ? "Windows always takes GNU timeout" : !gnuTimeout && "no GNU timeout on this host" }, async () => {
      const home = timeoutHome();
      const hb = join(home, "both");
      try {
        const r = bounded(tool, curatedBin(join(home, "both-bin"), { perl: true, timeout: true }), 1, [join(home, "fixture.sh"), hb, "orphan"]);
        assert.equal(r.status, 124);
        assert.ok(await stopped(hb), "GNU timeout leaves this orphan running; the supervisor must have been skipped");
      } finally { killLoop(hb); }
    });
}

// detect_formatter ends with the status of `command -v <formatter> && FMT_CMD=...`
// unless it returns explicitly; under the Codex consumers' `set -e` a missing
// formatter then aborted the hook before any check ran.
for (const tool of ["claude", "codex"]) {
  test(`${tool} detect_formatter leaves the caller running when a formatter is missing`, { skip: isWindows && "curated PATH needs symlinks" }, () => {
    const home = tempDir("rust-check-");
    const bin = curatedBin(join(home, "bin"), {});
    writeFileSync(join(home, "go.mod"), "");
    writeFileSync(join(home, "Cargo.toml"), "");
    writeFileSync(join(bin, "cargo"), "#!/bin/bash\nexit 0\n");
    chmodSync(join(bin, "cargo"), 0o755);
    for (const file of ["x.go", "x.rs", "x.lua"]) {
      const r = spawnSync(bashPath, ["-c", `${shellOpts[tool]}\n. "$1"; detect_formatter "$2/${file}" "$2"; echo reached`, "_", libOf(tool), home],
        { env: { ...process.env, PATH: bin }, encoding: "utf8", timeout: HANG_MS });
      assert.equal(r.status, 0, `${file}: ${r.stderr}`);
      assert.equal(r.stdout.trim(), "reached", file);
    }
  });
}

// Bare rustfmt formats as edition 2015, so on an edition-2024 crate it reflowed
// lines nobody touched. The formatter now carries the crate's edition as Cargo
// reads it: the nearest manifest with a [package] decides.
for (const tool of ["claude", "codex"]) {
  test(`${tool} rustfmt gets the edition of the file's crate`, () => {
    const home = tempDir("rust-edition-");
    const bin = join(home, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "rustfmt"), "#!/bin/bash\nexit 0\n");
    writeFileSync(join(bin, "cargo"), "#!/bin/bash\nexit 0\n");
    chmodSync(join(bin, "rustfmt"), 0o755);
    chmodSync(join(bin, "cargo"), 0o755);
    const crate = (dir, toml) => {
      mkdirSync(join(home, dir, "src"), { recursive: true });
      writeFileSync(join(home, dir, "Cargo.toml"), toml);
      return join(home, dir, "src", "x.rs");
    };
    const own = crate("own", '[package]\nname = "own"\nedition = "2024"\r\n');
    crate("ws", '[workspace]\nmembers = ["m", "n"]\n[workspace.package]\n  edition = "2021"\n');
    const member = crate("ws/m", '[package]\nname = "m"\nedition.workspace = true\n');
    const inline = crate("ws/n", "[package]\nname = 'n'\nedition = { workspace = true }\n");
    // A root package that is also the workspace, its [workspace.package] first.
    const root = crate("root", '[workspace.package]\nedition = "2021"\n[package]\nname = "root"\nedition = "2024"\n');
    const quoted = crate("quoted", "[package]\nname = 'quoted'\nedition = '2021'\n");
    // A crate with no edition is 2015 even inside a 2024 crate's tree.
    const nested = crate("own/fixtures/old", '[package]\nname = "old"\n');
    const bare = crate("bare", '[package]\nname = "bare"\n[package.metadata]\nedition = "2024"\n');
    const fmtOf = (file) => {
      const r = spawnSync(bashPath, ["-c", `${shellOpts[tool]}\n. "$1"; detect_formatter "$2" "$(dirname "$(dirname "$2")")"; printf '%s' "$FMT_CMD"`, "_", libOf(tool), file],
        { env: { ...process.env, PATH: bin + delimiter + process.env.PATH }, encoding: "utf8", timeout: HANG_MS });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout;
    };
    assert.equal(fmtOf(own), "rustfmt --edition 2024", "the crate's own edition, CRLF line");
    assert.equal(fmtOf(member), "rustfmt --edition 2021", "a member inherits the workspace's");
    assert.equal(fmtOf(inline), "rustfmt --edition 2021", "inline-table inheritance");
    assert.equal(fmtOf(root), "rustfmt --edition 2024", "[package] wins over [workspace.package]");
    assert.equal(fmtOf(quoted), "rustfmt --edition 2021", "a literal-string edition");
    // No edition in [package] itself: rustfmt's default, which is Cargo's (2015).
    assert.equal(fmtOf(nested), "rustfmt", "a nested crate does not take the outer one's");
    assert.equal(fmtOf(bare), "rustfmt", "an edition key in another section does not count");
    // No manifest at all: the climb ends at the root instead of looping.
    mkdirSync(join(home, "loose"));
    assert.equal(fmtOf(join(home, "loose", "x.rs")), "rustfmt", "no Cargo.toml above");
  });
}

// No language gets a type checker from the hooks: compiling, vetting and type
// checking belong to each project (its CI) and to the language skills. A file
// gets its formatter, and detect_formatter leaves CHECK_CMD/LANG_LABEL alone.
for (const tool of ["claude", "codex"]) {
  test(`${tool} detect_formatter sets a formatter and no checker`, () => {
    const home = tempDir("formatter-only-");
    mkdirSync(join(home, "src"));
    mkdirSync(join(home, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(home, "Cargo.toml"), '[package]\nname = "x"\nedition = "2021"\n');
    writeFileSync(join(home, "go.mod"), "module fixture\n");
    writeFileSync(join(home, "tsconfig.json"), "{}\n");
    writeFileSync(join(home, "node_modules", ".bin", "tsc"), "");
    for (const [file, fmt] of [["src/lib.rs", "rustfmt"], ["main.go", "gofmt"], ["a.ts", null]]) {
      const script = `${shellOpts[tool]}\nCHECK_CMD=sentinel LANG_LABEL=sentinel\n. "$1"; detect_formatter "$2/${file}" "$2"; printf '%s|%s|%s\\n' "$CHECK_CMD" "$LANG_LABEL" "$FMT_CMD"`;
      const r = spawnSync(bashPath, ["-c", script, "_", libOf(tool), home], { encoding: "utf8", timeout: HANG_MS });
      assert.equal(r.status, 0, `${file}: ${r.stderr}`);
      assert.match(r.stdout, /^sentinel\|sentinel\|/, `${file}: ${r.stdout}`);
      if (fmt && which(fmt)) assert.ok(r.stdout.split("|")[2].startsWith(fmt), `${file}: ${r.stdout}`);
    }
  });
}

// ── Stop runs no type checker ──────────────────────────────────────────────
// The fixture has everything the removed checkers keyed on (tsconfig.json with
// node_modules/.bin/tsc, go.mod); the npx and go shims log any tsc or vet run.
function checkerShimFixture(tool, files) {
  const f = fixture(tool);
  writeFileSync(join(f.root, "tsconfig.json"), "{}\n");
  writeFileSync(join(f.root, "go.mod"), "module fixture\n");
  mkdirSync(join(f.root, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(f.root, "node_modules", ".bin", "tsc"), "");
  const log = join(f.home, "checkers");
  for (const name of ["npx", "go"]) {
    writeFileSync(join(f.home, "bin", name),
      `#!/bin/bash\ncase "$1" in tsc|vet) echo "${name} $1" >> "$STOP_CHECKERS"; exit 1 ;; esac\nexit 0\n`);
    chmodSync(join(f.home, "bin", name), 0o755);
  }
  const gitEnv = f["env"];
  for (const name of files) writeFileSync(join(f.root, name), "before\n");
  for (const args of [["add", "."], ["commit", "-qm", "sources"]]) {
    const r = spawnSync("git", args, { cwd: f.root, env: gitEnv, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  }
  for (const name of files) writeFileSync(join(f.root, name), "after\n");
  return { ...f, log, runWith: () => f.run({ STOP_CHECKERS: log }) };
}

for (const tool of ["codex", "claude"]) {
  describe(`${tool} Stop runs no type checker`, { skip: isWindows && "checker shims are bash scripts" }, () => {
    for (const [lang, files] of [["TypeScript", ["a.ts", "b.tsx"]], ["Go", ["main.go"]]]) {
      test(`for a ${lang} change`, () => {
        const f = checkerShimFixture(tool, files);
        const r = f.runWith();
        assert.equal(r.status, 0, r.stdout + r.stderr);
        assert.equal(existsSync(f.log), false, existsSync(f.log) ? readFileSync(f.log, "utf8") : "");
      });
    }
  });
}
