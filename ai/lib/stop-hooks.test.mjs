import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, delimiter } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test, { describe } from "node:test";

const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function fixture(tool) {
  const home = mkdtempSync(join(tmpdir(), "stop-hook-"));
  const root = join(home, ".config");
  const hookName = tool === "codex" ? "stop-gate.sh" : "stop-handler.sh";
  const hookDir = join(root, tool, "hooks");
  const bin = join(home, "bin");
  for (const dir of [join(hookDir, "lib"), bin, join(root, "ai", "lib")]) mkdirSync(dir, { recursive: true });
  copyFileSync(join(repo, tool, "hooks", hookName), join(hookDir, hookName));
  copyFileSync(join(repo, tool, "hooks", "lib", "detect-project.sh"), join(hookDir, "lib", "detect-project.sh"));
  const putExecutable = (path, text) => { writeFileSync(path, text); chmodSync(path, 0o755); };
  putExecutable(join(hookDir, "notify.sh"), "#!/bin/bash\nexit 0\n");
  putExecutable(join(bin, "node"), '#!/bin/bash\necho "$*" >> "$STOP_AUDIT_CALLS"\ncase "$*" in *session-routing*) sleep 1 ;; esac\nexit "${STOP_AUDIT_EXIT:-0}"\n');
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
    input: JSON.stringify({ session_id: `stop-${tool}-${home.split(/[\\/]/).at(-1)}`, cwd: root }),
  });
  return { home, root, hook: join(hookDir, hookName), run, env };
}

for (const tool of ["codex", "claude"]) {
  test(`${tool} Stop runs contract and untracked tests with a shared suite budget`, () => {
    const f = fixture(tool);
    const r = f.run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const calls = readFileSync(f.env.STOP_AUDIT_CALLS, "utf8").trim().split(/\r?\n/);
    assert.equal(calls.length, 2, "tracked instructions and an untracked ai/lib test both trigger suites");
    assert.match(calls[0], /session-routing-consumers/);
    assert.match(calls[1], /untracked.test.mjs/);
    const budgets = readFileSync(f.env.STOP_AUDIT_BUDGETS, "utf8").trim().split(/\r?\n/).map(Number);
    assert.ok(budgets.every((n) => n > 0 && n <= 300));
    assert.ok(budgets[1] < budgets[0], "later suites consume the remaining budget");
  });

  test(`${tool} Stop blocks a failing suite`, () => {
    const f = fixture(tool);
    const r = f.run({ STOP_AUDIT_EXIT: "17" });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /contract tests failed/);
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
}

test("Stop hook registrations outlive the suite and checker budgets", () => {
  const template = readFileSync(join(repo, "codex", "config.toml.template"), "utf8");
  const codex = template.split("[[hooks.Stop.hooks]]")[1].split("[[hooks.PermissionRequest]]")[0];
  const settings = JSON.parse(readFileSync(join(repo, "claude", "settings.json"), "utf8"));
  const claude = settings.hooks.Stop.flatMap((group) => group.hooks).find((hook) => hook.command.endsWith("stop-handler.sh"));
  // Both products specify command-hook timeout in seconds, not milliseconds.
  for (const [tool, seconds] of [["codex", Number(codex.match(/timeout = (\d+)/)[1])], ["claude", claude.timeout]]) {
    const source = readFileSync(join(repo, tool, "hooks", tool === "codex" ? "stop-gate.sh" : "stop-handler.sh"), "utf8");
    const budget = Number(source.match(/SUITE_TIMEOUT=(\d+)/)[1]) + Number(source.match(/CHECKER_TIMEOUT=(\d+)/)[1]);
    assert.ok(seconds >= budget + 10, `${tool} registration must allow the bounded checks to finish`);
    assert.ok(seconds <= budget + 60, `${tool} registration must remain bounded, not hours long`);
  }
});

test("codex Stop formats a tracked Unicode filename", () => {
  const f = fixture("codex");
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
  assert.deepEqual(JSON.parse(result.stdout), {
    systemMessage: "[codex final-gate] auto-formatted 1 file(s)",
  });
});

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

// ── portable_timeout and the Rust checker (plan rust-agent-harness, C2a/C2c) ──
// Both detect-project.sh copies carry the same portable_timeout and .rs block;
// each consumer sources them under its own shell options.
const isWindows = process.platform === "win32";
const libOf = (tool) => join(repo, tool, "hooks", "lib", "detect-project.sh");
const shellOpts = { codex: "set -euo pipefail", claude: "" };
const which = (name) => spawnSync("bash", ["-c", `command -v ${name}`], { encoding: "utf8" }).stdout.trim();
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
  const home = mkdtempSync(join(tmpdir(), "portable-timeout-"));
  writeFileSync(join(home, "fixture.sh"), FIXTURE);
  chmodSync(join(home, "fixture.sh"), 0o755);
  return home;
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const loopPid = (hb) => (existsSync(`${hb}.pid`) ? Number(readFileSync(`${hb}.pid`, "utf8").trim()) : 0);
const killLoop = (hb) => { const pid = loopPid(hb); if (pid && alive(pid)) process.kill(pid, "SIGKILL"); };

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

// Runs portable_timeout under a wrapper that survives the signal (a trap, not
// an ignore, so the helper's children start with default dispositions), sends
// `signal` to the wrapper's process group — the wrapper and the supervisor, not
// the command's own group — after delayMs, and returns the supervisor's status.
async function signalled(tool, PATH, home, secs, args, signal, delayMs) {
  const rcFile = join(home, `rc-${signal}-${delayMs}-${Math.random()}`);
  const script = `trap : TERM INT HUP\n${shellOpts[tool]}\n. "$1"; shift; rc=0; portable_timeout "$@" || rc=$?; echo "$rc" > "${rcFile}"`;
  const child = spawn(bashPath, ["-c", script, "_", libOf(tool), String(secs), ...args],
    { env: { ...process.env, PATH }, detached: true, stdio: "ignore" });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  await sleep(delayMs);
  const t0 = Date.now();
  try { process.kill(-child.pid, signal); } catch {}
  const finished = await Promise.race([exited.then(() => true), sleep(HANG_MS / 2).then(() => false)]);
  const afterSignal = (Date.now() - t0) / 1000;
  if (!finished) { try { process.kill(-child.pid, "SIGKILL"); } catch {} await exited; }
  return { rc: existsSync(rcFile) ? Number(readFileSync(rcFile, "utf8").trim()) : null, afterSignal };
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
            const r = await signalled(tool, PATH, home, 30, [fx, hb, "plain"], "SIGTERM", 0);
            if (r.rc !== null) assert.equal(r.rc, 143, `run ${i}`);
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

// detect_checker ends with the status of `command -v <formatter> && FMT_CMD=...`
// unless it returns explicitly; under the Codex consumers' `set -e` a missing
// formatter then aborted the hook before any check ran.
for (const tool of ["claude", "codex"]) {
  test(`${tool} detect_checker leaves the caller running when a formatter is missing`, { skip: isWindows && "curated PATH needs symlinks" }, () => {
    const home = mkdtempSync(join(tmpdir(), "rust-check-"));
    const bin = curatedBin(join(home, "bin"), {});
    writeFileSync(join(home, "go.mod"), "");
    writeFileSync(join(home, "Cargo.toml"), "");
    writeFileSync(join(bin, "cargo"), "#!/bin/bash\nexit 0\n");
    chmodSync(join(bin, "cargo"), 0o755);
    for (const file of ["x.go", "x.rs", "x.lua"]) {
      const r = spawnSync(bashPath, ["-c", `${shellOpts[tool]}\n. "$1"; detect_checker "$2/${file}" "$2"; echo reached`, "_", libOf(tool), home],
        { env: { ...process.env, PATH: bin }, encoding: "utf8", timeout: HANG_MS });
      assert.equal(r.status, 0, `${file}: ${r.stderr}`);
      assert.equal(r.stdout.trim(), "reached", file);
    }
  });
}

// cargo shim for the .rs checker: logs argv and RUSTUP_AUTO_INSTALL; the probe
// (`cargo clippy --version`) answers ok, fails, or hangs; any other call exits
// CARGO_SHIM_RUN_EXIT.
const CARGO_SHIM = `#!/bin/bash
echo "$* | RUSTUP_AUTO_INSTALL=\${RUSTUP_AUTO_INSTALL-unset}" >> "$CARGO_SHIM_LOG"
if [ "$1 $2" = "clippy --version" ]; then
  case "\${CARGO_SHIM_PROBE:-ok}" in
    ok) echo "clippy 0.1.0"; exit 0 ;;
    fail) echo "error: 'cargo-clippy' is not installed" >&2; exit 1 ;;
    hang) echo "$$" > "$CARGO_SHIM_LOG.probe.pid"; exec sleep 30 ;;
  esac
fi
exit "\${CARGO_SHIM_RUN_EXIT:-0}"
`;

function rustCheck(tool, PATH, home, roots, extraEnv = {}) {
  const log = join(home, `cargo-${Math.random()}.log`);
  const script = `${shellOpts[tool]}
. "$1"; shift
for root in "$@"; do mkdir -p "$root/src"; : > "$root/Cargo.toml"; detect_checker "$root/src/x.rs" "$root"; done
printf 'label=%s\\n' "$LANG_LABEL"
cd "$root"; rc=0; portable_timeout 5 bash -c "$CHECK_CMD" || rc=$?
echo "rc=$rc"`;
  const t0 = Date.now();
  const r = spawnSync(bashPath, ["-c", script, "_", libOf(tool), ...roots],
    { env: { ...process.env, PATH, CARGO_SHIM_LOG: log, ...extraEnv }, encoding: "utf8", timeout: HANG_MS, killSignal: "SIGKILL" });
  const lines = existsSync(log) ? readFileSync(log, "utf8").trim().split(/\r?\n/) : [];
  return { status: r.status, out: r.stdout, err: r.stderr, elapsed: (Date.now() - t0) / 1000, lines, log,
    probes: lines.filter((l) => l.startsWith("clippy --version")) };
}

for (const tool of ["claude", "codex"]) {
  describe(`${tool} .rs checker`, { concurrency: true }, () => {
    const home = mkdtempSync(join(tmpdir(), "rust-check-"));
    const root = (name) => join(home, name);
    const withShim = (bin) => {
      writeFileSync(join(bin, "cargo"), CARGO_SHIM);
      chmodSync(join(bin, "cargo"), 0o755);
      return bin;
    };
    const ambient = (() => { const b = join(home, "shim-bin"); mkdirSync(b); withShim(b); return b + delimiter + process.env.PATH; })();

    test("(1) a working clippy runs clippy over all targets", () => {
      const r = rustCheck(tool, ambient, home, [root("ok")]);
      assert.equal(r.status, 0, r.out + r.err);
      assert.match(r.out, /label=cargo clippy/);
      assert.equal(r.probes.length, 1, r.lines.join("\n"));
      assert.ok(r.lines.some((l) => l.startsWith("clippy --all-targets --message-format short")), r.lines.join("\n"));
    });

    test("(2) a failing probe falls back to check without aborting the shell", () => {
      const r = rustCheck(tool, ambient, home, [root("fail")], { CARGO_SHIM_PROBE: "fail" });
      assert.equal(r.status, 0, r.out + r.err);
      assert.match(r.out, /label=cargo check/);
      assert.ok(r.lines.some((l) => l.startsWith("check --all-targets --message-format short")), r.lines.join("\n"));
    });

    test("(3) the checker's exit status comes through bash -c", () => {
      const r = rustCheck(tool, ambient, home, [root("exit3")], { CARGO_SHIM_RUN_EXIT: "3" });
      assert.match(r.out, /rc=3/);
    });

    test("(5) the probe cannot trigger a toolchain download", () => {
      const r = rustCheck(tool, ambient, home, [root("noinstall")]);
      assert.equal(r.probes.length, 1, r.lines.join("\n"));
      assert.match(r.probes[0], /RUSTUP_AUTO_INSTALL=0$/);
    });

    test("(6) the probe runs once per root; a new root probes again", () => {
      assert.equal(rustCheck(tool, ambient, home, [root("A"), root("A")]).probes.length, 1);
      assert.equal(rustCheck(tool, ambient, home, [root("A"), root("B"), root("A")]).probes.length, 3);
    });

    for (const p of timeoutPaths) {
      test(`(4) a hanging probe is bounded and falls back, ${p.name} path`, { skip: p.skip }, () => {
        const PATH = isWindows ? ambient : withShim(p.bin(join(home, `hang-${p.name}`)));
        const r = rustCheck(tool, PATH, home, [root(`hang-${p.name}`)], { CARGO_SHIM_PROBE: "hang" });
        const pidFile = `${r.log}.probe.pid`;
        const probePid = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8")) : 0;
        try {
          assert.equal(r.status, 0, r.out + r.err);
          assert.equal(r.probes.length, 1, "the probe must have run");
          assert.match(r.out, /label=cargo check/);
          assert.ok(r.elapsed >= 4.5 && r.elapsed < 8, `took ${r.elapsed}s`);
          assert.ok(!(probePid && alive(probePid)), "hung probe survived");
        } finally {
          if (probePid && alive(probePid)) process.kill(probePid, "SIGKILL");
        }
      });
    }
  });
}
