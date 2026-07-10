// Hard end-to-end collaboration-mode test.
// Runs the real CLI process and a live pm-context HTTP server against throwaway git roots.
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PM_CONTEXT = join(HERE, "..", "pm-context");
const TSX = join(HERE, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
const CLI = join(HERE, "pm-roadmap.ts");
const SERVER = join(PM_CONTEXT, "server.ts");

type RunResult = { code: number | null; out: string; err: string };

function cleanEnv(root: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.PM_ACTOR;
  env.PM_ROOT = root;
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_CONFIG_SYSTEM = "/dev/null";
  for (const [k, v] of Object.entries(extra)) env[k] = v;
  return env;
}

function pm(root: string, args: string[], opts: { env?: Record<string, string>; fail?: boolean } = {}): RunResult {
  const r = spawnSync(TSX, [CLI, ...args], {
    cwd: HERE,
    env: cleanEnv(root, opts.env),
    encoding: "utf8",
  });
  const res = { code: r.status, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
  const detail = `\n$ pm ${args.join(" ")}\nstdout:\n${res.out}\nstderr:\n${res.err}`;
  if (opts.fail) assert.notEqual(res.code, 0, detail);
  else assert.equal(res.code, 0, detail);
  return res;
}

async function makeRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  execFileSync("git", ["init", "-q"], { cwd: root, env: cleanEnv(root) });
  return root;
}

async function linkSharedTasks(sharedRoot: string, userRoot: string): Promise<void> {
  await mkdir(join(userRoot, ".agents", "state"), { recursive: true });
  await symlink(join(sharedRoot, ".agents", "tasks"), join(userRoot, ".agents", "tasks"), "dir");
}

async function makePlan(root: string, rel: string, id: string, status = "draft"): Promise<void> {
  await mkdir(join(root, ".agents", "plans"), { recursive: true });
  await writeFile(join(root, rel), `---\nid: ${id}\nstatus: ${status}\npm_loop: true\n---\n# ${id}\n\n## Deferred\n\n`);
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function block(content: string, id: string): string {
  return content.match(new RegExp(`- \\*\\*${esc(id)}\\*\\*[\\s\\S]*?(?=\\n- \\*\\*|\\n*$)`))?.[0] ?? "";
}

async function taskFile(root: string, key: string, file: string): Promise<string> {
  return readFile(join(root, ".agents", "tasks", key, file), "utf8");
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (typeof addr !== "object" || !addr) return reject(new Error("no port"));
      srv.close(() => resolve(addr.port));
    });
  });
}

async function startDashboard(root: string): Promise<{ port: number; child: ChildProcessWithoutNullStreams; stop: () => Promise<void> }> {
  const port = await freePort();
  const child = spawn(TSX, [SERVER], {
    cwd: PM_CONTEXT,
    env: cleanEnv(root, { TASK_CONTEXT_ROOT: root, TASK_CONTEXT_PORT: String(port) }),
  });
  let log = "";
  child.stdout.on("data", (b) => { log += b.toString(); });
  child.stderr.on("data", (b) => { log += b.toString(); });

  const url = `http://127.0.0.1:${port}/api/tasks`;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${log}`);
    try {
      const r = await fetch(url);
      if (r.ok) {
        return {
          port,
          child,
          stop: () => new Promise((resolve) => {
            if (child.exitCode !== null) return resolve();
            child.once("exit", () => resolve());
            child.kill("SIGTERM");
          }),
        };
      }
    } catch {
      // server not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill("SIGTERM");
  throw new Error(`server did not start:\n${log}`);
}

async function main() {
  const root = await makeRoot("collab-e2e-");
  try {
    // D1: task create --mode writes the mode field.
    pm(root, ["task", "create", "COLLAB", "--title", "Collab", "--mode", "collab"]);
    assert.match(await taskFile(root, "COLLAB", "task.md"), /^mode: collab$/m, "create --mode collab writes task.md");

    // D4: assign/claim/unassign, double-claim guard, solo-task gate.
    pm(root, ["add", "collab-1", "--task", "COLLAB", "--title", "Collab item"]);
    pm(root, ["assign", "COLLAB", "collab-1", "carol", "--note", "handoff"]);
    let bl = await taskFile(root, "COLLAB", "backlog.md");
    assert.match(block(bl, "collab-1"), /^  - Owner: carol$/m);
    assert.match(block(bl, "collab-1"), /^  - OwnerNote: handoff$/m);
    pm(root, ["claim", "COLLAB", "collab-1", "--actor", "dave"], { fail: true });
    pm(root, ["claim", "COLLAB", "collab-1", "--actor", "dave", "--force"]);
    pm(root, ["assign", "COLLAB", "collab-1", "-"]);
    bl = await taskFile(root, "COLLAB", "backlog.md");
    assert.doesNotMatch(block(bl, "collab-1"), /^  - Owner:/m);
    assert.doesNotMatch(block(bl, "collab-1"), /^  - OwnerNote:/m);

    pm(root, ["task", "create", "SOLO", "--title", "Solo"]);
    pm(root, ["add", "solo-1", "--task", "SOLO", "--title", "Solo item"]);
    pm(root, ["claim", "SOLO", "solo-1", "--actor", "x"], { fail: true });

    // D2: solo -> collab bulk-assigns open/draft/active; collab -> solo keeps attribution.
    pm(root, ["task", "create", "SW", "--title", "Switch"]);
    pm(root, ["add", "sw-open", "--task", "SW", "--title", "Open"]);
    pm(root, ["add", "sw-draft", "--task", "SW", "--title", "Draft"]);
    pm(root, ["add", "sw-active", "--task", "SW", "--title", "Active"]);
    const draftPlan = ".agents/plans/2026-06-30-sw-draft.md";
    await makePlan(root, draftPlan, "sw-draft");
    pm(root, ["plan", "SW", "sw-draft", draftPlan]);
    const activePlan = ".agents/plans/2026-06-30-sw-active.md";
    await makePlan(root, activePlan, "sw-active", "active");
    pm(root, ["plan", "SW", "sw-active", activePlan]);
    pm(root, ["approve", "SW", "sw-active"]);
    const swOut = pm(root, ["task", "set-mode", "SW", "collab", "--actor", "alice"]).out;
    assert.match(swOut, /assigned 3 unowned items to alice/);
    const swBacklog = await taskFile(root, "SW", "backlog.md");
    for (const id of ["sw-open", "sw-draft", "sw-active"]) assert.match(block(swBacklog, id), /^  - Owner: alice$/m, `${id} owner`);
    const swSolo = pm(root, ["task", "set-mode", "SW", "solo", "--actor", "alice"]).out;
    assert.match(swSolo, /mode/);
    assert.match(await taskFile(root, "SW", "backlog.md"), /^  - Owner: alice$/m, "collab -> solo keeps owners");

    // D3/D8: actor precedence and whoami round-trip.
    pm(root, ["add", "prec-flag", "--task", "COLLAB", "--title", "Flag"]);
    pm(root, ["claim", "COLLAB", "prec-flag", "--actor", "flag-actor"], { env: { PM_ACTOR: "env-actor" } });
    assert.match(block(await taskFile(root, "COLLAB", "backlog.md"), "prec-flag"), /^  - Owner: flag-actor$/m);

    pm(root, ["add", "prec-env", "--task", "COLLAB", "--title", "Env"]);
    pm(root, ["claim", "COLLAB", "prec-env"], { env: { PM_ACTOR: "env-actor" } });
    assert.match(block(await taskFile(root, "COLLAB", "backlog.md"), "prec-env"), /^  - Owner: env-actor$/m);

    pm(root, ["whoami", "state-actor"]);
    assert.match(pm(root, ["whoami"]).out, /state-actor\s+\(source: state\/actor\.txt\)/);
    pm(root, ["add", "prec-state", "--task", "COLLAB", "--title", "State"]);
    pm(root, ["claim", "COLLAB", "prec-state"]);
    assert.match(block(await taskFile(root, "COLLAB", "backlog.md"), "prec-state"), /^  - Owner: state-actor$/m);

    const noId = await makeRoot("collab-noid-");
    try {
      pm(noId, ["task", "create", "NOID", "--title", "No identity", "--mode", "collab"]);
      pm(noId, ["add", "noid-1", "--task", "NOID", "--title", "No identity item"]);
      const r = pm(noId, ["claim", "NOID", "noid-1"], { fail: true });
      assert.match(`${r.out}\n${r.err}`, /requires an actor identity/);
    } finally {
      await rm(noId, { recursive: true, force: true });
    }

    const gitFb = await makeRoot("collab-gitfb-");
    try {
      execFileSync("git", ["config", "user.email", "personal@gmail.com"], { cwd: gitFb, env: cleanEnv(gitFb) });
      pm(gitFb, ["task", "create", "GF", "--title", "Git fallback"]);
      pm(gitFb, ["add", "gf-1", "--task", "GF", "--title", "Git fallback item"]);
      const out = pm(gitFb, ["task", "set-mode", "GF", "collab"]).out;
      assert.match(out, /git user\.email/);
      assert.match(out, /personal@gmail\.com/);
      assert.match(block(await taskFile(gitFb, "GF", "backlog.md"), "gf-1"), /^  - Owner: personal@gmail\.com$/m);
    } finally {
      await rm(gitFb, { recursive: true, force: true });
    }

    // D5: By on collab memory/links.
    pm(root, ["memory", "COLLAB", "add", "decision", "--note", "keep", "--actor", "alice"]);
    pm(root, ["links", "COLLAB", "add", "spec", "--url", "https://example.com/spec", "--actor", "bob"]);
    assert.match(block(await taskFile(root, "COLLAB", "memory.md"), "decision"), /^  - By: alice$/m);
    assert.match(block(await taskFile(root, "COLLAB", "links.md"), "spec"), /^  - By: bob$/m);

    // D6: ClosedBy on drop, close, and retro-complete.
    pm(root, ["add", "drop-1", "--task", "COLLAB", "--title", "Drop"]);
    pm(root, ["drop", "COLLAB", "drop-1", "--reason", "no", "--actor", "carol"]);
    assert.match(block(await taskFile(root, "COLLAB", "closed.md"), "drop-1"), /^  - ClosedBy: carol$/m);

    pm(root, ["add", "close-drop-1", "--task", "COLLAB", "--title", "Close drop"]);
    pm(root, ["close", "COLLAB", "close-drop-1", "--status", "dropped", "--reason", "no", "--actor", "dana"]);
    assert.match(block(await taskFile(root, "COLLAB", "closed.md"), "close-drop-1"), /^  - ClosedBy: dana$/m);

    pm(root, ["add", "complete-1", "--task", "COLLAB", "--title", "Complete"]);
    const completePlan = ".agents/plans/2026-06-30-complete-1.md";
    await makePlan(root, completePlan, "complete-1");
    pm(root, ["plan", "COLLAB", "complete-1", completePlan]);
    pm(root, ["complete", "COLLAB", "complete-1", "--plan", completePlan, "--status", "done", "--actor", "erin"]);
    assert.match(block(await taskFile(root, "COLLAB", "closed.md"), "complete-1"), /^  - ClosedBy: erin$/m);

    // D7/D9/D11: owner badges, filters, explicit-id bypass, mine, who.
    pm(root, ["task", "create", "VIEW", "--title", "View", "--mode", "collab"]);
    pm(root, ["add", "view-mine", "--task", "VIEW", "--title", "Mine"]);
    pm(root, ["add", "view-other", "--task", "VIEW", "--title", "Other"]);
    pm(root, ["add", "view-free", "--task", "VIEW", "--title", "Free"]);
    pm(root, ["assign", "VIEW", "view-mine", "carol"]);
    pm(root, ["assign", "VIEW", "view-other", "dave"]);
    const carolList = pm(root, ["list"], { env: { PM_ACTOR: "carol" } }).out;
    assert.match(carolList, /VIEW\/view-mine/);
    assert.match(carolList, /VIEW\/view-free/);
    assert.doesNotMatch(carolList, /VIEW\/view-other/);
    assert.match(pm(root, ["list", "--owner", "dave"]).out, /VIEW\/view-other/);
    assert.match(pm(root, ["list", "--all"]).out, /@dave/);
    const tree = pm(root, ["tree"]).out;
    assert.match(tree, /VIEW \(3 open\)\s+\[collab\]/);
    assert.match(tree, /view-free.*\(unassigned\)/);
    assert.match(pm(root, ["next", "view-other"], { env: { PM_ACTOR: "carol" } }).out, /# Next: view-other/);
    const mine = pm(root, ["mine", "--actor", "carol"]).out;
    assert.match(mine, /VIEW\/view-mine/);
    assert.doesNotMatch(mine, /VIEW\/view-other/);
    const who = pm(root, ["who"]).out;
    assert.match(who, /carol \(1\)/);
    assert.match(who, /dave \(1\)/);
    assert.match(who, /\(unassigned\) \(\d+\)/);
    assert.match(who, /VIEW\/view-free/);

    // Multi-person checkout model: shared tasks, separate per-person state roots.
    const sharedRoot = await makeRoot("collab-shared-");
    const aliceRoot = await makeRoot("collab-alice-");
    const bobRoot = await makeRoot("collab-bob-");
    try {
      pm(sharedRoot, ["task", "create", "TEAM", "--title", "Team task", "--mode", "collab"]);
      pm(sharedRoot, ["add", "team-alice", "--task", "TEAM", "--title", "Alice work"]);
      pm(sharedRoot, ["add", "team-bob", "--task", "TEAM", "--title", "Bob work"]);
      pm(sharedRoot, ["add", "team-free", "--task", "TEAM", "--title", "Unassigned work"]);
      await linkSharedTasks(sharedRoot, aliceRoot);
      await linkSharedTasks(sharedRoot, bobRoot);

      pm(aliceRoot, ["whoami", "alice"]);
      pm(bobRoot, ["whoami", "bob"]);
      assert.match(pm(aliceRoot, ["whoami"]).out, /alice\s+\(source: state\/actor\.txt\)/);
      assert.match(pm(bobRoot, ["whoami"]).out, /bob\s+\(source: state\/actor\.txt\)/);

      pm(aliceRoot, ["claim", "TEAM", "team-alice"]);
      pm(bobRoot, ["claim", "TEAM", "team-bob"]);
      pm(bobRoot, ["claim", "TEAM", "team-alice"], { fail: true });
      const teamBacklog = await taskFile(sharedRoot, "TEAM", "backlog.md");
      assert.match(block(teamBacklog, "team-alice"), /^  - Owner: alice$/m);
      assert.match(block(teamBacklog, "team-bob"), /^  - Owner: bob$/m);

      const aliceTeamList = pm(aliceRoot, ["list"]).out;
      assert.match(aliceTeamList, /TEAM\/team-alice/);
      assert.match(aliceTeamList, /TEAM\/team-free/);
      assert.doesNotMatch(aliceTeamList, /TEAM\/team-bob/);
      const bobTeamList = pm(bobRoot, ["list"]).out;
      assert.match(bobTeamList, /TEAM\/team-bob/);
      assert.match(bobTeamList, /TEAM\/team-free/);
      assert.doesNotMatch(bobTeamList, /TEAM\/team-alice/);
      assert.match(pm(aliceRoot, ["next"]).out, /TEAM\/team-alice/);
      assert.doesNotMatch(pm(aliceRoot, ["next"]).out, /TEAM\/team-bob/);
      assert.match(pm(aliceRoot, ["next", "team-bob"]).out, /# Next: team-bob/);
      assert.match(pm(aliceRoot, ["mine"]).out, /TEAM\/team-alice/);
      assert.match(pm(bobRoot, ["mine"]).out, /TEAM\/team-bob/);
      assert.match(pm(aliceRoot, ["who"]).out, /alice \(1\)[\s\S]*bob \(1\)/);

      pm(aliceRoot, ["memory", "TEAM", "add", "alice-decision", "--note", "from alice checkout"]);
      pm(bobRoot, ["links", "TEAM", "add", "bob-doc", "--url", "https://example.com/bob"]);
      assert.match(block(await taskFile(sharedRoot, "TEAM", "memory.md"), "alice-decision"), /^  - By: alice$/m);
      assert.match(block(await taskFile(sharedRoot, "TEAM", "links.md"), "bob-doc"), /^  - By: bob$/m);
      pm(bobRoot, ["drop", "TEAM", "team-bob", "--reason", "done elsewhere"]);
      assert.match(block(await taskFile(sharedRoot, "TEAM", "closed.md"), "team-bob"), /^  - ClosedBy: bob$/m);
    } finally {
      await rm(sharedRoot, { recursive: true, force: true });
      await rm(aliceRoot, { recursive: true, force: true });
      await rm(bobRoot, { recursive: true, force: true });
    }

    // D10/C13 and coerceMode: roster warning is opt-in; blank/absent mode are solo-compatible.
    pm(root, ["task", "collaborators", "VIEW", "carol"]);
    assert.match(pm(root, ["validate"]).out, /C13/);
    pm(root, ["task", "collaborators", "VIEW"]);
    assert.doesNotMatch(pm(root, ["validate"]).out, /C13/);

    pm(root, ["task", "create", "BLANK", "--title", "Blank"]);
    const blankMeta = await taskFile(root, "BLANK", "task.md");
    await writeFile(join(root, ".agents/tasks/BLANK/task.md"), blankMeta.replace(/^mode: .*$/m, "mode: "));
    pm(root, ["task", "create", "ABSENT", "--title", "Absent"]);
    const absentMeta = await taskFile(root, "ABSENT", "task.md");
    await writeFile(join(root, ".agents/tasks/ABSENT/task.md"), absentMeta.replace(/^mode: .*$\n/m, ""));
    assert.doesNotMatch(pm(root, ["validate"]).out, /C12/);

    // D7a: live pm-context HTTP GET -> PUT round trip must not erase collab By fields.
    pm(root, ["task", "create", "LIVE", "--title", "Live", "--mode", "collab"]);
    pm(root, ["links", "LIVE", "add", "live-spec", "--url", "https://example.com/live", "--actor", "alice"]);
    pm(root, ["memory", "LIVE", "add", "live-decision", "--note", "n", "--actor", "bob"]);
    const dash = await startDashboard(root);
    try {
      const base = `http://127.0.0.1:${dash.port}`;
      const got = await fetch(`${base}/api/tasks/LIVE`);
      assert.equal(got.status, 200);
      const payload = await got.json() as any;
      assert.equal(payload.links[0].label, "live-spec");
      assert.equal(payload.memory[0].title, "live-decision");
      const put = await fetch(`${base}/api/tasks/LIVE`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.equal(put.status, 200);
    } finally {
      await dash.stop();
    }
    assert.match(block(await taskFile(root, "LIVE", "links.md"), "live-spec"), /^  - By: alice$/m);
    assert.match(block(await taskFile(root, "LIVE", "memory.md"), "live-decision"), /^  - By: bob$/m);

    console.log("collab-e2e.test.ts OK");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
