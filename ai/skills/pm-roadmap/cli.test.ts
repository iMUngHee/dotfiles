// Tests for pm-roadmap.ts CLI. Run: ./node_modules/.bin/tsx cli.test.ts
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { runCli } from "./pm-roadmap.ts";

async function makePlan(root: string, rel: string, status = "draft", id = "p"): Promise<void> {
  await mkdir(join(root, ".agents", "plans"), { recursive: true });
  await writeFile(join(root, rel), `---\nid: ${id}\nstatus: ${status}\npm_loop: true\n---\n# ${id}\n\n## Post-Implementation Notes\n\n-\n`);
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "cli-test-"));
  const cli = (...a: string[]) => runCli(root, a);
  try {
    assert.equal((await cli("task", "create", "ALPHA", "--title", "Alpha")).code, 0);
    assert.equal((await cli("add", "a-1", "--task", "ALPHA", "--title", "One")).code, 0);
    assert.equal((await cli("add", "inb-1", "--inbox", "--title", "I")).code, 0);

    // add --note forwards the note to itemAdd (regression: the CLI add case previously dropped it)
    assert.equal((await cli("add", "noted-1", "--task", "ALPHA", "--title", "N", "--note", "hello note")).code, 0);
    assert.ok((await readFile(join(root, ".agents/tasks/ALPHA/backlog.md"), "utf8")).includes("Note: hello note"), "add --note written to backlog.md");

    let r = await cli("list");
    assert.ok(r.out.includes("ALPHA/a-1") && r.out.includes("inbox: 1"), "list shows item + inbox");
    r = await cli("tree");
    assert.ok(r.out.includes("a-1"), "tree shows backlog");
    assert.equal((await cli("validate")).code, 0, "clean validate");

    // triage inbox → task
    assert.equal((await cli("task", "create", "BETA", "--title", "Beta")).code, 0);
    assert.equal((await cli("triage", "inb-1", "BETA")).code, 0);
    assert.ok((await cli("tree")).out.includes("inb-1"), "triaged item under BETA");

    // Removed selector command is rejected; no-id next requires an explicit candidate choice.
    assert.equal((await cli("focus", "a-1")).code, 1);
    assert.ok((await cli("next")).out.includes("Choose a candidate"));

    // explicit next
    assert.ok((await cli("next", "a-1")).out.includes("# Next: a-1"));

    // plan link + get + validate stays clean (draft↔draft mirror)
    await makePlan(root, ".agents/plans/2026-06-22-a-1.md", "draft");
    assert.equal((await cli("plan", "ALPHA", "a-1", ".agents/plans/2026-06-22-a-1.md")).code, 0);
    assert.ok((await cli("get", "a-1")).out.includes("a-1"));
    assert.equal((await cli("validate")).code, 0, "validate clean after plan link");

    // reprioritize via CLI: success path wiring + output (bad-enum is covered at op level in ops.test)
    assert.equal((await cli("reprioritize", "ALPHA", "a-1", "P0")).code, 0);
    assert.ok((await cli("get", "a-1")).out.includes("\"priority\": \"P0\""), "priority changed to P0");
    await assert.rejects(() => cli("reprioritize", "ALPHA", "a-1", "P9"), /P0\|P1\|P2\|P3/, "CLI surfaces bad-enum throw");

    // reorder via CLI: success path wiring (raw string → Order field written); bad input surfaces throw, no lossy parse
    assert.equal((await cli("reorder", "ALPHA", "a-1", "5")).code, 0);
    assert.ok((await readFile(join(root, ".agents/tasks/ALPHA/backlog.md"), "utf8")).includes("Order: 5"), "Order field written to backlog.md");
    await assert.rejects(() => cli("reorder", "ALPHA", "a-1", "0"), /positive integer/, "CLI rejects zero");
    await assert.rejects(() => cli("reorder", "ALPHA", "a-1", "1.5"), /positive integer/, "CLI rejects non-integer (no parseInt truncation)");

    // close done → recent
    assert.equal((await cli("close", "ALPHA", "a-1", "--status", "done")).code, 0);
    assert.ok((await cli("recent")).out.includes("a-1"), "closed item in recent");

    // drop (with reason)
    assert.equal((await cli("add", "b-1", "--task", "BETA", "--title", "B1")).code, 0);
    assert.equal((await cli("drop", "BETA", "b-1", "--reason", "nope")).code, 0);

    // unknown command → nonzero
    assert.equal((await cli("bogus")).code, 1);

    // design persist hook + retro complete hook (with ## Deferred harvest)
    await mkdir(join(root, ".agents", "plans"), { recursive: true });
    await writeFile(join(root, ".agents/plans/2026-06-22-pi.md"), "---\nid: p\nstatus: draft\npm_loop: true\n---\n# p\n\n## Deferred\n\n- **followup-x** — Follow up\n  - Priority: P2\n  - Note: later\n");
    assert.equal((await cli("persist", "ALPHA", "pi-item", ".agents/plans/2026-06-22-pi.md", "--title", "PI")).code, 0);
    assert.ok((await cli("get", "pi-item")).out.includes("pi-item"), "persist created+linked the item");
    assert.equal((await cli("complete", "ALPHA", "pi-item", "--plan", ".agents/plans/2026-06-22-pi.md", "--status", "done")).code, 0);
    assert.ok((await cli("recent")).out.includes("pi-item"), "completed item lands in recent");
    assert.ok((await cli("tree")).out.includes("followup-x"), "## Deferred harvested into backlog");

    // terminal reclassification CLI: changed vs unchanged output + strict Reason contract
    assert.equal((await cli("task", "create", "RECLASS", "--title", "Reclass")).code, 0);
    assert.equal((await cli("add", "reclass-cli", "--task", "RECLASS", "--title", "Reclass CLI")).code, 0);
    const reclassPlan = ".agents/plans/2026-06-22-reclass-cli.md";
    await makePlan(root, reclassPlan, "draft", "reclass-cli");
    assert.equal((await cli("plan", "RECLASS", "reclass-cli", reclassPlan)).code, 0);
    assert.equal((await cli("approve", "RECLASS", "reclass-cli")).code, 0);
    assert.equal((await cli("complete", "RECLASS", "reclass-cli", "--plan", reclassPlan, "--status", "done")).code, 0);
    const changedDrop = await cli("reclassify", "RECLASS", "reclass-cli", "--plan", reclassPlan, "--status", "dropped", "--reason", "  evidence changed  ");
    assert.equal(changedDrop.code, 0);
    assert.equal(changedDrop.out, "reclassified reclass-cli (plan done→dropped, item done→dropped)");
    const unchangedDrop = await cli("reclassify", "RECLASS", "reclass-cli", "--plan", reclassPlan, "--status", "dropped", "--reason", "evidence changed");
    assert.equal(unchangedDrop.out, "unchanged reclass-cli (dropped)");
    const changedDone = await cli("reclassify", "RECLASS", "reclass-cli", "--plan", reclassPlan, "--status", "done");
    assert.equal(changedDone.out, "reclassified reclass-cli (plan dropped→done, item dropped→done)");
    const missingReclassPlan = await cli("reclassify", "RECLASS", "reclass-cli", "--status", "done");
    assert.equal(missingReclassPlan.code, 1, "reclassify requires --plan");
    assert.ok(missingReclassPlan.out.includes("[--reason <text>]"), "reclassify usage exposes the conditional Reason option");
    assert.equal((await cli("reclassify", "RECLASS", "reclass-cli", "--plan", reclassPlan, "--status", "bogus")).code, 1, "reclassify validates status");
    assert.equal((await cli("reclassify", "RECLASS", "reclass-cli", "--plan", reclassPlan, "--status", "done", "--reason", "x")).code, 1, "done rejects --reason");
    assert.equal((await cli("reclassify", "RECLASS", "reclass-cli", "--plan", reclassPlan, "--status", "dropped", "--reason", "   ")).code, 1, "dropped rejects whitespace Reason");
    assert.ok((await cli("bogus")).out.includes("reclassify"), "default usage lists reclassify");

    // retro durable-decision sink: memory <KEY> add → upsert a note via ops (lock+CAS)
    assert.equal((await cli("memory", "ALPHA", "add", "lock-policy", "--note", "writes go through ops", "--date", "2026-06-22")).code, 0);
    let mem = await readFile(join(root, ".agents/tasks/ALPHA/memory.md"), "utf8");
    assert.ok(mem.includes("- **lock-policy**") && mem.includes("Note: writes go through ops") && mem.includes("Date: 2026-06-22"), "memory note written");
    assert.equal((await cli("memory", "ALPHA", "add", "lock-policy", "--note", "updated note")).code, 0); // same title
    mem = await readFile(join(root, ".agents/tasks/ALPHA/memory.md"), "utf8");
    assert.equal((mem.match(/- \*\*lock-policy\*\*/g) ?? []).length, 1, "upsert by title: no duplicate note");
    assert.ok(mem.includes("Note: updated note"), "upsert updated the note in place");
    assert.equal((await cli("validate")).code, 0, "validate clean after memory write");
    assert.equal((await cli("memory", "ALPHA", "bogus")).code, 1, "unknown memory subcmd rejected");

    // pm-context link writes route through ops (single write path; upsert by label)
    assert.equal((await cli("links", "ALPHA", "add", "wiki", "--url", "https://wiki.example.com/x", "--triggers", "alpha,beta", "--summary", "Spec page")).code, 0);
    let lk = await readFile(join(root, ".agents/tasks/ALPHA/links.md"), "utf8");
    assert.ok(lk.includes("- **wiki**") && lk.includes("URL: https://wiki.example.com/x") && lk.includes("Triggers: alpha,beta") && lk.includes("Summary: Spec page"), "link written");
    assert.equal((await cli("links", "ALPHA", "add", "wiki", "--url", "https://wiki.example.com/y")).code, 0); // same label → upsert
    lk = await readFile(join(root, ".agents/tasks/ALPHA/links.md"), "utf8");
    assert.equal((lk.match(/- \*\*wiki\*\*/g) ?? []).length, 1, "upsert by label: single block");
    assert.ok(lk.includes("https://wiki.example.com/y"), "upsert updated the URL");
    await assert.rejects(() => cli("links", "ALPHA", "add", "bad", "--url", "ftp://nope"), /http/); // non-http URL rejected (ops throws)
    assert.equal((await cli("links", "ALPHA", "remove", "wiki")).code, 0);
    assert.ok(!(await readFile(join(root, ".agents/tasks/ALPHA/links.md"), "utf8")).includes("wiki"), "link removed");
    await assert.rejects(() => cli("links", "ALPHA", "remove", "wiki"), /no link/); // removing a missing link errors (ops throws)

    // current-task resolves only the Task linked to the selected current plan.
    const currentTaskPlan = ".agents/plans/2026-06-22-followup-x.md";
    await writeFile(join(root, currentTaskPlan), `---
id: followup-x
title: Follow up
status: draft
pm_loop: true
base_branch: main
base_commit: 0123456789012345678901234567890123456789
branch: agent/followup-x
worktree: .agents/worktrees/followup-x
---
# followup-x
`);
    assert.equal((await cli("plan", "ALPHA", "followup-x", currentTaskPlan)).code, 0);
    await mkdir(join(root, ".agents", "state"), { recursive: true });
    await writeFile(join(root, ".agents", "state", "current.txt"), `${currentTaskPlan}\n`);
    assert.equal((await cli("current-task")).out.trim(), "ALPHA", "current-task = linked current plan's Task");
    await writeFile(join(root, ".agents", "state", "current.txt"), "");
    assert.equal((await cli("current-task")).out.trim(), "", "empty current plan → empty current-task");

    // path-traversal guard: a malformed / path-bearing task KEY is rejected at the taskDir chokepoint
    await assert.rejects(() => cli("get", "anything", "--task", "../evil"), /invalid task key/);
    await assert.rejects(() => cli("links", "../evil", "add", "x", "--url", "https://x.example.com"), /invalid task key/);

    // --status validation: close/complete reject a non-{done,dropped} status (code 1, before any write)
    assert.equal((await cli("close", "ALPHA", "whatever", "--status", "bogus")).code, 1, "close rejects bad --status");
    assert.equal((await cli("complete", "ALPHA", "whatever", "--plan", ".agents/plans/x.md", "--status", "bogus")).code, 1, "complete rejects bad --status");

    // ── collaboration mode CLI ──
    const cbBacklog = () => readFile(join(root, ".agents/tasks/CB/backlog.md"), "utf8");
    assert.equal((await cli("task", "create", "CB", "--mode", "collab")).code, 0);
    assert.ok((await readFile(join(root, ".agents/tasks/CB/task.md"), "utf8")).includes("mode: collab"), "create --mode collab");
    assert.equal((await cli("add", "cb-1", "--task", "CB", "--title", "One")).code, 0);
    // assign + note, double-claim guard, force, unassign
    assert.equal((await cli("assign", "CB", "cb-1", "carol", "--note", "ctx")).code, 0);
    assert.ok((await cbBacklog()).includes("Owner: carol") && (await cbBacklog()).includes("OwnerNote: ctx"), "assign + note");
    await assert.rejects(() => cli("claim", "CB", "cb-1", "--actor", "dave"), /already owned/); // double-claim guard (ops throws)
    assert.equal((await cli("claim", "CB", "cb-1", "--actor", "dave", "--force")).code, 0, "force reassign");
    assert.equal((await cli("assign", "CB", "cb-1", "-")).code, 0);
    assert.ok(!(await cbBacklog()).includes("Owner:"), "unassign drops Owner");
    // solo-task gate (ops throws)
    await assert.rejects(() => cli("claim", "ALPHA", "a-1", "--actor", "x"), /solo/);
    // whoami round-trip (state/actor.txt)
    assert.equal((await cli("whoami", "bob")).code, 0);
    assert.ok((await cli("whoami")).out.includes("bob"), "whoami reads actor.txt");
    // By stamped on collab memory via --actor; solo task gets no By
    assert.equal((await cli("memory", "CB", "add", "dec", "--note", "n", "--actor", "alice")).code, 0);
    assert.ok((await readFile(join(root, ".agents/tasks/CB/memory.md"), "utf8")).includes("By: alice"), "collab memory stamped By");
    assert.equal((await cli("memory", "ALPHA", "add", "sdec", "--note", "n", "--actor", "alice")).code, 0);
    assert.ok(!(await readFile(join(root, ".agents/tasks/ALPHA/memory.md"), "utf8")).includes("By:"), "solo memory has no By");
    // owner filter + badges + who/mine
    assert.equal((await cli("assign", "CB", "cb-1", "carol")).code, 0);
    assert.ok((await cli("list", "--owner", "carol")).out.includes("cb-1"), "list --owner filters");
    assert.ok((await cli("list", "--all")).out.includes("@carol"), "list --all shows @owner badge");
    assert.ok((await cli("who")).out.includes("carol"), "who board");
    assert.ok((await cli("mine", "--actor", "carol")).out.includes("cb-1"), "mine = my items");
    // roster + collaborators set
    assert.equal((await cli("task", "collaborators", "CB", "carol,dave")).code, 0);
    assert.ok((await readFile(join(root, ".agents/tasks/CB/task.md"), "utf8")).includes("collaborators: carol, dave"), "roster set");

    // set-mode collab: output surfaces assigned count + owner; explicit --actor → NO git-fallback warning
    assert.equal((await cli("task", "create", "SM", "--title", "SM")).code, 0);
    assert.equal((await cli("add", "sm-1", "--task", "SM", "--title", "X")).code, 0);
    assert.equal((await cli("add", "sm-2", "--task", "SM", "--title", "Y")).code, 0);
    const smOut = (await cli("task", "set-mode", "SM", "collab", "--actor", "alice")).out;
    assert.ok(smOut.includes("assigned 2 unowned items to alice"), "set-mode surfaces assigned count + owner");
    assert.ok(!smOut.includes("⚠"), "explicit --actor → no git-fallback warning");
    const smSolo = (await cli("task", "set-mode", "SM", "solo", "--actor", "alice")).out;
    assert.ok(smSolo.includes("mode → solo") && !smSolo.includes("assigned") && !smSolo.includes("⚠"), "collab→solo is quiet");
    // zero-unowned collab switch (items already owned from the prior collab pass) is also quiet
    const smReco = (await cli("task", "set-mode", "SM", "collab", "--actor", "alice")).out;
    assert.ok(smReco.includes("mode → collab") && !smReco.includes("assigned") && !smReco.includes("⚠"), "zero-unowned collab switch is quiet");

    // git-fallback warning, ISOLATED so the fallback rung actually reaches `git config user.email`
    // (fresh root: no actor.txt, PM_ACTOR cleared, no --actor, GIT_CONFIG_*=/dev/null + local user.email)
    {
      const groot = await mkdtemp(join(tmpdir(), "cli-gitfb-"));
      const savedActor = process.env.PM_ACTOR, savedGCG = process.env.GIT_CONFIG_GLOBAL, savedGCS = process.env.GIT_CONFIG_SYSTEM;
      delete process.env.PM_ACTOR;
      process.env.GIT_CONFIG_GLOBAL = "/dev/null"; process.env.GIT_CONFIG_SYSTEM = "/dev/null";
      try {
        execFileSync("git", ["init", "-q"], { cwd: groot });
        execFileSync("git", ["config", "user.email", "personal@gmail.com"], { cwd: groot });
        const g = (...a: string[]) => runCli(groot, a);
        assert.equal((await g("task", "create", "GF", "--title", "GF")).code, 0);
        assert.equal((await g("add", "gf-1", "--task", "GF", "--title", "X")).code, 0);
        const gOut = (await g("task", "set-mode", "GF", "collab")).out; // no --actor / PM_ACTOR / actor.txt → git fallback
        assert.ok(gOut.includes("⚠") && gOut.includes("git user.email"), "git-fallback owner triggers warning");
        assert.ok(gOut.includes("personal@gmail.com"), "warning names the fallback owner");
      } finally {
        if (savedActor === undefined) delete process.env.PM_ACTOR; else process.env.PM_ACTOR = savedActor;
        if (savedGCG === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = savedGCG;
        if (savedGCS === undefined) delete process.env.GIT_CONFIG_SYSTEM; else process.env.GIT_CONFIG_SYSTEM = savedGCS;
        await rm(groot, { recursive: true, force: true });
      }
    }

    // legacy detection + migrate subcmd on a separate legacy repo
    const leg = await mkdtemp(join(tmpdir(), "cli-legacy-"));
    await mkdir(join(leg, ".agents"), { recursive: true });
    await writeFile(join(leg, ".agents", "ROADMAP.md"), "---\nproject: t\n---\n# t — Backlog\n\n## Open\n\n## Recently Closed\n");
    assert.ok((await runCli(leg, ["list"])).out.includes("legacy roadmap detected"), "legacy detected on read");
    assert.ok((await runCli(leg, ["migrate"])).out.includes("DRY-RUN"), "migrate subcmd dry-runs");
    await rm(leg, { recursive: true, force: true });

    // ── depend via CLI: deduped csv set, '-' clear, dangling throw, missing-arg usage ──
    assert.equal((await cli("task", "create", "DPT", "--title", "Dep")).code, 0);
    assert.equal((await cli("add", "dpt-a", "--task", "DPT", "--title", "A")).code, 0);
    assert.equal((await cli("add", "dpt-b", "--task", "DPT", "--title", "B")).code, 0);
    assert.equal((await cli("depend", "DPT", "dpt-a", "dpt-b,dpt-b")).code, 0);
    const dbl = await readFile(join(root, ".agents/tasks/DPT/backlog.md"), "utf8");
    assert.ok(dbl.includes("DependsOn: dpt-b") && !dbl.includes("dpt-b, dpt-b"), "depend writes deduped DependsOn");
    assert.equal((await cli("depend", "DPT", "dpt-a", "-")).code, 0);
    assert.ok(!(await readFile(join(root, ".agents/tasks/DPT/backlog.md"), "utf8")).includes("DependsOn:"), "'-' clears DependsOn");
    await assert.rejects(() => cli("depend", "DPT", "dpt-a", "ghost-x"), /not a known item id/, "CLI surfaces dangling throw");
    assert.equal((await cli("depend", "DPT", "dpt-a")).code, 1, "missing target → usage exit 1");
    const validateAfterDepend = await cli("validate");
    assert.equal(validateAfterDepend.code, 0, `validate clean after depend\n${validateAfterDepend.out}`);

    // worktree adopt forwards historical base/source options and preserves the engine outcome JSON.
    const worktreeRoot = await mkdtemp(join(tmpdir(), "cli-worktree-"));
    try {
      const git = (...args: string[]) => execFileSync("git", args, { cwd: worktreeRoot, encoding: "utf8" }).trim();
      git("init", "-b", "main");
      git("config", "user.email", "test@example.com");
      git("config", "user.name", "Test");
      await writeFile(join(worktreeRoot, "README.md"), "main\n");
      git("add", "README.md");
      git("commit", "-m", "main");
      git("checkout", "-b", "release/test");
      await writeFile(join(worktreeRoot, "BASE.txt"), "historical\n");
      git("add", "BASE.txt");
      git("commit", "-m", "historical base");
      const historicalBase = git("rev-parse", "HEAD");
      await writeFile(join(worktreeRoot, "START.txt"), "newer\n");
      git("add", "START.txt");
      git("commit", "-m", "newer start");
      const startCommit = git("rev-parse", "HEAD");
      git("checkout", "main");
      await mkdir(join(worktreeRoot, ".agents", "tasks"), { recursive: true });
      await mkdir(join(worktreeRoot, ".agents", "plans"), { recursive: true });
      await mkdir(join(worktreeRoot, ".agents", "state"), { recursive: true });
      const planRel = ".agents/plans/2026-07-15-wrapper-adopt.md";
      await writeFile(join(worktreeRoot, planRel), "---\nid: wrapper-adopt\nstatus: draft\n---\n");

      const result = await runCli(worktreeRoot, [
        "worktree", "adopt",
        "--plan", planRel,
        "--base", "release/test",
        "--base-commit", historicalBase,
        "--start", "release/test",
      ]);
      assert.equal(result.code, 0);
      const adopted = JSON.parse(result.out);
      assert.equal(adopted.outcome, "adopted_parked");
      assert.equal(adopted.base_commit, historicalBase);
      assert.equal(adopted.start_commit, startCommit);
      assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: adopted.execution_root, encoding: "utf8" }).trim(), startCommit);
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true });
    }

    console.log("cli.test.ts OK");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
