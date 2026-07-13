#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function runGit(cwd, args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (allowFailure) return null;
    const detail = error?.stderr?.toString().trim() || error?.message || String(error);
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
}

async function exists(path) {
  return lstat(path).then(() => true).catch(() => false);
}

async function readText(path) {
  return readFile(path, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content);
  await rename(tmp, path);
}

async function withExclusiveFileLock(path, fn, { retries = 100, retryMs = 25 } = {}) {
  await mkdir(dirname(path), { recursive: true });
  let handle;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      handle = await open(path, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
      break;
    } catch (error) {
      if (error?.code !== "EEXIST" || attempt === retries) throw error;
      await sleep(retryMs);
    }
  }
  try {
    return await fn();
  } finally {
    await handle?.close().catch(() => {});
    await unlink(path).catch(() => {});
  }
}

export function parseFrontmatter(markdown) {
  const lines = markdown.split(/\r?\n/);
  if (lines[0] !== "---") return {};
  const result = {};
  for (let i = 1; i < lines.length && lines[i] !== "---"; i++) {
    const match = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (match) result[match[1]] = match[2].trim();
  }
  return result;
}

export function setFrontmatterFields(markdown, updates) {
  const lines = markdown.split(/\r?\n/);
  if (lines[0] !== "---") throw new Error("plan has no YAML frontmatter");
  const end = lines.indexOf("---", 1);
  if (end < 0) throw new Error("plan frontmatter is not closed");
  const pending = new Map(Object.entries(updates));
  for (let i = 1; i < end; i++) {
    const match = lines[i].match(/^([A-Za-z_][\w-]*):/);
    if (!match || !pending.has(match[1])) continue;
    lines[i] = `${match[1]}: ${pending.get(match[1])}`;
    pending.delete(match[1]);
  }
  lines.splice(end, 0, ...[...pending].map(([key, value]) => `${key}: ${value}`));
  return lines.join("\n");
}

export function mainCheckout(root = process.cwd()) {
  const top = runGit(root, ["rev-parse", "--show-toplevel"]);
  const common = runGit(top, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return dirname(common);
}

export function listGitWorktrees(root = process.cwd()) {
  const main = mainCheckout(root);
  const raw = runGit(main, ["worktree", "list", "--porcelain"]);
  const entries = [];
  let current = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice(9), branch: null, head: null };
      entries.push(current);
    } else if (current && line.startsWith("HEAD ")) current.head = line.slice(5);
    else if (current && line.startsWith("branch refs/heads/")) current.branch = line.slice("branch refs/heads/".length);
  }
  return entries;
}

function relativeManagedPath(main, absolutePath) {
  const rel = relative(main, absolutePath).split(sep).join("/");
  if (rel.startsWith("../") || rel === "..") throw new Error(`worktree escapes main checkout: ${absolutePath}`);
  return rel;
}

function assertManagedTarget(main, absolutePath) {
  const managedRoot = resolve(main, ".agents", "worktrees");
  const target = resolve(absolutePath);
  const rel = relative(managedRoot, target);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`managed worktree must be below ${managedRoot}: ${target}`);
  }
  return target;
}

async function isEmptyDirectory(path) {
  try {
    return (await readdir(path)).length === 0;
  } catch {
    return false;
  }
}

async function ensureDirectoryLink(target, linkPath) {
  const info = await lstat(linkPath).catch(() => null);
  if (info?.isSymbolicLink()) {
    const raw = await readlink(linkPath);
    const actual = resolve(dirname(linkPath), raw);
    if (actual === target) return;
    await unlink(linkPath);
  } else if (info?.isDirectory() && await isEmptyDirectory(linkPath)) {
    await rm(linkPath, { recursive: true });
  } else if (info) {
    throw new Error(`store conflict: ${linkPath} is a non-empty real path`);
  }
  await mkdir(dirname(linkPath), { recursive: true });
  await symlink(target, linkPath);
}

async function ensureCommonExcludes(main) {
  const common = runGit(main, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const path = join(common, "info", "exclude");
  const entries = [
    ".agents/tasks",
    ".agents/plans",
    ".agents/state/",
    ".agents/worktrees/",
    ".agents/worktree-reservations/",
  ];
  const current = await readText(path);
  const present = new Set(current.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const missing = entries.filter((entry) => !present.has(entry));
  if (missing.length) await atomicWrite(path, `${current && !current.endsWith("\n") ? `${current}\n` : current}${missing.join("\n")}\n`);
}

export async function wireManagedStore(main, executionRoot) {
  const mainAgents = join(main, ".agents");
  const targetAgents = join(executionRoot, ".agents");
  const legacy = join(mainAgents, "ROADMAP.md");
  if (await exists(legacy)) {
    const taskFiles = await readdir(join(mainAgents, "tasks"), { recursive: true }).catch(() => []);
    if (!taskFiles.some((path) => String(path).endsWith("task.md"))) {
      throw new Error("migration_required: legacy .agents/ROADMAP.md must be migrated before worktree wiring");
    }
    throw new Error("migration_conflict: legacy ROADMAP.md and task-first data both exist");
  }
  await mkdir(join(mainAgents, "tasks"), { recursive: true });
  await mkdir(join(mainAgents, "plans"), { recursive: true });
  await mkdir(targetAgents, { recursive: true });
  await ensureDirectoryLink(join(mainAgents, "tasks"), join(targetAgents, "tasks"));
  await ensureDirectoryLink(join(mainAgents, "plans"), join(targetAgents, "plans"));

  const statePath = join(targetAgents, "state");
  const stateInfo = await lstat(statePath).catch(() => null);
  if (stateInfo?.isSymbolicLink()) throw new Error(`state conflict: ${statePath} must be a real directory`);
  if (stateInfo && !stateInfo.isDirectory()) throw new Error(`state conflict: ${statePath} is not a directory`);
  await mkdir(statePath, { recursive: true });
  const sourceActor = join(mainAgents, "state", "actor.txt");
  const targetActor = join(statePath, "actor.txt");
  if (await exists(sourceActor) && !await exists(targetActor)) await cp(sourceActor, targetActor);
  await ensureCommonExcludes(main);
}

export function reservationPaths(main, id) {
  const dir = join(main, ".agents", "worktree-reservations");
  return { dir, lock: join(dir, ".lock"), json: join(dir, `${id}.json`), stage: join(dir, `${id}.plan.md`) };
}

export async function withReservationLock(root, id, fn) {
  const main = mainCheckout(root);
  const paths = reservationPaths(main, id);
  return withExclusiveFileLock(paths.lock, () => fn({ main, ...paths }));
}

export async function readReservation(root, id) {
  const main = mainCheckout(root);
  const paths = reservationPaths(main, id);
  const raw = await readText(paths.json);
  return raw ? { ...JSON.parse(raw), paths } : null;
}

export async function stagePlan({ root = process.cwd(), id, content }) {
  return withReservationLock(root, id, async ({ json, stage }) => {
    const raw = await readText(json);
    if (!raw) throw new Error(`reservation not found: ${id}`);
    const reservation = JSON.parse(raw);
    const sha256 = createHash("sha256").update(content).digest("hex");
    await atomicWrite(stage, content);
    reservation.stage_sha256 = sha256;
    await atomicWrite(json, `${JSON.stringify(reservation, null, 2)}\n`);
    return { id, stage, sha256 };
  });
}

export async function ensureManagedWorktree({ root = process.cwd(), id, base, branch, worktree } = {}) {
  if (!ID_RE.test(id || "")) throw new Error(`invalid worktree id '${id ?? ""}'`);
  if (!base) throw new Error("base ref is required");
  const main = mainCheckout(root);
  const paths = reservationPaths(main, id);
  return withExclusiveFileLock(paths.lock, async () => {
    const baseCommit = runGit(main, ["rev-parse", "--verify", `${base}^{commit}`]);
    const targetBranch = branch || `agent/${id}`;
    const targetAbs = worktree
      ? (isAbsolute(worktree) ? worktree : resolve(main, worktree))
      : join(main, ".agents", "worktrees", id);
    if (targetAbs === main) throw new Error("main checkout cannot be a plan execution worktree");
    assertManagedTarget(main, targetAbs);
    const managedRel = relativeManagedPath(main, targetAbs);
    const worktrees = listGitWorktrees(main);
    const byPath = worktrees.find((entry) => resolve(entry.path) === resolve(targetAbs));
    const byBranch = worktrees.find((entry) => entry.branch === targetBranch);
    if (byPath && byPath.branch !== targetBranch) throw new Error(`worktree path is occupied by branch ${byPath.branch}`);
    if (byBranch && resolve(byBranch.path) !== resolve(targetAbs)) throw new Error(`branch ${targetBranch} is already checked out at ${byBranch.path}`);

    await mkdir(paths.dir, { recursive: true });
    const mainCurrent = (await readText(join(main, ".agents", "state", "current.txt"))).trim();
    const reservation = {
      id,
      base_branch: base,
      base_commit: baseCommit,
      branch: targetBranch,
      worktree: managedRel,
      source_checkout: relativeManagedPath(main, runGit(root, ["rev-parse", "--show-toplevel"])),
      expected_main_current: mainCurrent,
      created_at: new Date().toISOString(),
    };
    const existingReservation = await readText(paths.json);
    if (existingReservation) {
      const parsed = JSON.parse(existingReservation);
      for (const key of ["id", "base_commit", "branch", "worktree"]) {
        if (parsed[key] !== reservation[key]) throw new Error(`reservation conflict for ${id}: ${key}`);
      }
    } else {
      await atomicWrite(paths.json, `${JSON.stringify(reservation, null, 2)}\n`);
    }

    if (!byPath) {
      await mkdir(dirname(targetAbs), { recursive: true });
      const branchCommit = runGit(main, ["rev-parse", "--verify", `refs/heads/${targetBranch}^{commit}`], { allowFailure: true });
      if (branchCommit) runGit(main, ["worktree", "add", targetAbs, targetBranch]);
      else runGit(main, ["worktree", "add", "-b", targetBranch, targetAbs, baseCommit]);
    }
    await wireManagedStore(main, targetAbs);
    return {
      status: byPath ? "reused" : "created",
      main_root: main,
      execution_root: targetAbs,
      base_branch: base,
      base_commit: baseCommit,
      branch: targetBranch,
      worktree: managedRel,
      reservation: relativeManagedPath(main, paths.json),
    };
  });
}

async function loadPlan(main, planRel) {
  if (!planRel || isAbsolute(planRel) || planRel.split(/[\\/]/).includes("..")) throw new Error(`invalid plan path '${planRel}'`);
  const planPath = join(main, planRel);
  const markdown = await readText(planPath);
  if (!markdown) throw new Error(`plan not found: ${planRel}`);
  return { path: planPath, markdown, fields: parseFrontmatter(markdown) };
}

function executionRootFor(main, fields) {
  if (!fields.worktree) return null;
  const target = resolve(main, fields.worktree);
  if (target === main) throw new Error("main checkout cannot be a plan execution worktree");
  relativeManagedPath(main, target);
  return assertManagedTarget(main, target);
}

async function findNonterminalPlanOwner(main, worktree) {
  const target = resolve(main, worktree);
  const plansDir = join(main, ".agents", "plans");
  for (const file of (await readdir(plansDir).catch(() => [])).filter((name) => name.endsWith(".md"))) {
    const fields = parseFrontmatter(await readText(join(plansDir, file)));
    if (["draft", "active"].includes(fields.status) && fields.worktree && resolve(main, fields.worktree) === target) {
      return `.agents/plans/${file}`;
    }
  }
  return null;
}

export async function resolveCurrent(root = process.cwd()) {
  const checkout = runGit(root, ["rev-parse", "--show-toplevel"]);
  const main = mainCheckout(checkout);
  const pointer = (await readText(join(checkout, ".agents", "state", "current.txt"))).trim();
  if (!pointer) return { status: "empty", checkout_root: checkout, main_root: main };
  let plan;
  try {
    plan = await loadPlan(main, pointer);
  } catch (error) {
    return { status: "missing_plan", plan: pointer, checkout_root: checkout, main_root: main, error: error.message };
  }
  const fields = plan.fields;
  if (["done", "dropped"].includes(fields.status)) {
    return { status: "terminal", plan: pointer, plan_status: fields.status, checkout_root: checkout, main_root: main };
  }
  if (!["draft", "active"].includes(fields.status)) {
    return { status: "invalid_plan_status", plan: pointer, plan_status: fields.status || null, checkout_root: checkout, main_root: main };
  }
  if (!fields.base_branch || !/^[0-9a-f]{40}$/i.test(fields.base_commit || "") || !fields.branch || !fields.worktree) {
    return { status: "legacy_unmapped", plan: pointer, plan_status: fields.status, checkout_root: checkout, main_root: main };
  }
  let executionRoot;
  try {
    executionRoot = executionRootFor(main, fields);
  } catch (error) {
    return { status: "invalid_mapping", plan: pointer, checkout_root: checkout, main_root: main, error: error.message };
  }
  const entry = listGitWorktrees(main).find((item) => resolve(item.path) === executionRoot);
  if (!entry) return { status: "missing_worktree", plan: pointer, execution_root: executionRoot, checkout_root: checkout, main_root: main };
  if (entry.branch !== fields.branch) {
    return { status: "branch_mismatch", plan: pointer, execution_root: executionRoot, expected_branch: fields.branch, actual_branch: entry.branch, checkout_root: checkout, main_root: main };
  }
  return {
    status: "ok",
    plan: pointer,
    plan_status: fields.status,
    id: fields.id,
    title: fields.title || fields.id,
    main_root: main,
    checkout_root: checkout,
    execution_root: executionRoot,
    base_branch: fields.base_branch,
    base_commit: fields.base_commit,
    branch: fields.branch,
    worktree: fields.worktree,
    route_required: resolve(checkout) !== executionRoot,
  };
}

export async function writeCurrentCAS(checkoutRoot, expected, next) {
  const state = join(checkoutRoot, ".agents", "state");
  const pointer = join(state, "current.txt");
  const lock = join(state, "current.lock");
  return withExclusiveFileLock(lock, async () => {
    const current = (await readText(pointer)).trim();
    if (current !== (expected || "").trim()) return { updated: false, current, reason: "cas_conflict" };
    await atomicWrite(pointer, next ? `${next.trim()}\n` : "");
    return { updated: true, current: next.trim(), reason: "updated" };
  });
}

async function withCurrentLock(checkoutRoot, fn) {
  const state = join(checkoutRoot, ".agents", "state");
  return withExclusiveFileLock(join(state, "current.lock"), async () => {
    const current = (await readText(join(state, "current.txt"))).trim();
    return fn(current);
  });
}

export async function syncPlanState({ root = process.cwd(), plan }) {
  const main = mainCheckout(root);
  const loaded = await loadPlan(main, plan);
  const target = executionRootFor(main, loaded.fields);
  if (!target) throw new Error("plan has no worktree mapping");
  const current = (await readText(join(target, ".agents", "state", "current.txt"))).trim();
  if (current && current !== plan) {
    const other = await loadPlan(main, current).catch(() => null);
    if (other && ["draft", "active"].includes(other.fields.status)) throw new Error(`target current conflict: ${current}`);
  }
  return writeCurrentCAS(target, current, plan);
}

export async function ensureCurrent({ root = process.cwd() } = {}) {
  const result = await resolveCurrent(root);
  if (result.status === "ok") {
    await syncPlanState({ root, plan: result.plan });
    if (result.route_required && resolve(result.checkout_root) !== resolve(result.main_root)) {
      await writeCurrentCAS(result.checkout_root, result.plan, "");
    }
  } else if (result.status === "terminal") {
    await writeCurrentCAS(result.checkout_root, result.plan, "");
  }
  return result;
}

export async function assertPlanRoot({ root = process.cwd(), plan }) {
  const main = mainCheckout(root);
  const loaded = await loadPlan(main, plan);
  const expected = executionRootFor(main, loaded.fields);
  const actual = runGit(root, ["rev-parse", "--show-toplevel"]);
  const branch = runGit(actual, ["branch", "--show-current"]);
  if (resolve(actual) !== expected || branch !== loaded.fields.branch) {
    throw new Error(`execution root mismatch: expected ${expected} (${loaded.fields.branch}), got ${actual} (${branch})`);
  }
  return { ok: true, execution_root: actual, branch };
}

export async function assertReservationRoot({ root = process.cwd(), id }) {
  const main = mainCheckout(root);
  const reservation = await readReservation(main, id);
  if (!reservation) throw new Error(`reservation not found: ${id}`);
  const expected = resolve(main, reservation.worktree);
  const actual = runGit(root, ["rev-parse", "--show-toplevel"]);
  const branch = runGit(actual, ["branch", "--show-current"]);
  if (resolve(actual) !== expected || branch !== reservation.branch) {
    throw new Error(`execution root mismatch: expected ${expected} (${reservation.branch}), got ${actual} (${branch})`);
  }
  return { ok: true, execution_root: actual, branch };
}

export async function adoptPlan({ root = process.cwd(), plan, base, branch, worktree, select = false }) {
  const main = mainCheckout(root);
  const dirty = runGit(main, ["status", "--porcelain", "--untracked-files=all", "--", ".", ":(exclude).agents/**"]);
  if (dirty) throw new Error("dirty main checkout: commit or stash project changes before legacy adoption");
  const ensured = await ensureManagedWorktree({ root: main, id: parseFrontmatter((await loadPlan(main, plan)).markdown).id, base, branch, worktree });
  const loaded = await loadPlan(main, plan);
  if (loaded.fields.worktree && loaded.fields.worktree !== ensured.worktree) throw new Error("plan already has a different worktree mapping");
  const updated = setFrontmatterFields(loaded.markdown, {
    base_branch: ensured.base_branch,
    base_commit: ensured.base_commit,
    branch: ensured.branch,
    worktree: ensured.worktree,
  });
  await atomicWrite(loaded.path, updated);
  await writeCurrentCAS(ensured.execution_root, "", plan);
  if (select) {
    const observed = (await readText(join(main, ".agents", "state", "current.txt"))).trim();
    await writeCurrentCAS(main, observed, plan);
  }
  return ensured;
}

export async function cancelProvisional({ root = process.cwd(), id }) {
  const main = mainCheckout(root);
  return withReservationLock(main, id, async ({ json, stage }) => {
    const { withLock } = await import("../skills/pm-roadmap/store.ts");
    return withLock(main, "cancelProvisional", async () => {
      const raw = await readText(json);
      if (!raw) return { removed: false, reason: "not_found" };
      const reservation = JSON.parse(raw);
      const owner = await findNonterminalPlanOwner(main, reservation.worktree);
      if (owner) return { removed: false, reason: "owned_by_plan", plan: owner };
      const target = resolve(main, reservation.worktree);
      const entry = listGitWorktrees(main).find((item) => resolve(item.path) === target);
      if (!entry) return { removed: false, reason: "missing_worktree" };
      const pointer = (await readText(join(target, ".agents", "state", "current.txt"))).trim();
      if (pointer) return { removed: false, reason: "current", plan: pointer };
      const dirty = runGit(target, ["status", "--porcelain"], { allowFailure: true });
      if (dirty) return { removed: false, reason: "dirty" };
      const head = runGit(target, ["rev-parse", "HEAD"], { allowFailure: true });
      if (head && head !== reservation.base_commit) return { removed: false, reason: "committed" };
      runGit(main, ["worktree", "remove", target]);
      await unlink(stage).catch(() => {});
      await unlink(json).catch(() => {});
      return { removed: true, reason: "cancelled" };
    });
  });
}

export async function pruneManagedWorktree({ root = process.cwd(), plan }) {
  if (!plan) throw new Error("terminal prune needs --plan");
  const main = mainCheckout(root);
  const { withLock } = await import("../skills/pm-roadmap/store.ts");
  return withLock(main, "pruneManagedWorktree", async () => {
    const loaded = await loadPlan(main, plan);
    if (!["done", "dropped"].includes(loaded.fields.status)) {
      throw new Error(`refusing to prune non-terminal plan ${plan} (${loaded.fields.status || "unknown"})`);
    }
    if (!loaded.fields.branch || !loaded.fields.worktree) throw new Error(`terminal plan has no worktree mapping: ${plan}`);
    const target = executionRootFor(main, loaded.fields);
    const branch = loaded.fields.branch;
    const owner = await findNonterminalPlanOwner(main, loaded.fields.worktree);
    if (owner) throw new Error(`refusing to prune worktree owned by non-terminal plan ${owner}`);
    const entry = listGitWorktrees(main).find((item) => resolve(item.path) === target);
    if (!entry) return { removed: false, reason: "not_found" };
    if (entry.branch !== branch) throw new Error(`branch mismatch: expected ${branch}, found ${entry.branch}`);
    if (resolve(runGit(root, ["rev-parse", "--show-toplevel"])) === target) throw new Error("refusing to prune the caller's current worktree");
    return withCurrentLock(target, async (current) => {
      if (current) throw new Error(`refusing to prune a worktree with current pointer ${current}`);
      if (runGit(target, ["status", "--porcelain"])) throw new Error("refusing to prune a dirty worktree");
      runGit(main, ["worktree", "remove", target]);
      return { removed: true, branch, plan };
    });
  });
}

export async function validateManagedWorktrees(root = process.cwd(), { all = false } = {}) {
  const checkout = runGit(root, ["rev-parse", "--show-toplevel"]);
  const main = mainCheckout(root);
  return withReservationLock(main, "validate", async () => {
    const { withLock } = await import("../skills/pm-roadmap/store.ts");
    return withLock(main, "validateManagedWorktrees", async () => {
      const issues = [];
      const reservations = [];
      const owners = new Map();
      const worktrees = listGitWorktrees(main);
      const plansDir = join(main, ".agents", "plans");
      const current = (await readText(join(checkout, ".agents", "state", "current.txt"))).trim();
      const planEntries = [];
      if (all) {
        for (const file of (await readdir(plansDir).catch(() => [])).filter((name) => name.endsWith(".md"))) {
          planEntries.push({ rel: `.agents/plans/${file}`, markdown: await readText(join(plansDir, file)) });
        }
      } else if (current) {
        try {
          const loaded = await loadPlan(main, current);
          planEntries.push({ rel: current, markdown: loaded.markdown });
        } catch (error) {
          issues.push({ code: "missing_current_plan", plan: current, detail: error.message });
        }
      }
      for (const { rel, markdown } of planEntries) {
        const fields = parseFrontmatter(markdown);
        if (!["draft", "active"].includes(fields.status)) {
          if (!all) issues.push({ code: "stale_current_plan", plan: rel, status: fields.status || null });
          continue;
        }
        if (!fields.base_branch || !/^[0-9a-f]{40}$/i.test(fields.base_commit || "") || !fields.branch || !fields.worktree) {
          issues.push({ code: "unmapped_plan", plan: rel });
          continue;
        }
        let target;
        try { target = executionRootFor(main, fields); }
        catch (error) {
          issues.push({ code: "invalid_plan_mapping", plan: rel, detail: error.message });
          continue;
        }
        const owner = owners.get(target);
        if (owner) issues.push({ code: "duplicate_worktree_owner", plan: rel, other: owner });
        else owners.set(target, rel);
        const entry = worktrees.find((item) => resolve(item.path) === target);
        if (!entry) issues.push({ code: "missing_plan_worktree", plan: rel, worktree: fields.worktree });
        else if (entry.branch !== fields.branch) issues.push({ code: "plan_branch_mismatch", plan: rel, expected: fields.branch, actual: entry.branch });
      }

      const reservationDir = join(main, ".agents", "worktree-reservations");
      const reservationFiles = await readdir(reservationDir).catch(() => []);
      const jsonFiles = reservationFiles.filter((name) => name.endsWith(".json"));
      const reservationIds = new Set(jsonFiles.map((name) => name.slice(0, -".json".length)));
      for (const file of jsonFiles) {
        const id = file.slice(0, -".json".length);
        let reservation;
        try { reservation = JSON.parse(await readText(join(reservationDir, file))); }
        catch (error) {
          issues.push({ code: "invalid_reservation", id, detail: error.message });
          continue;
        }
        let target;
        try { target = assertManagedTarget(main, resolve(main, reservation.worktree || "")); }
        catch (error) {
          issues.push({ code: "invalid_reservation_mapping", id, detail: error.message });
          continue;
        }
        const owner = await findNonterminalPlanOwner(main, reservation.worktree);
        if (owner) {
          issues.push({ code: "reservation_handoff_pending", id, plan: owner });
          reservations.push({ id, state: "owned_by_plan", plan: owner });
          continue;
        }
        const entry = worktrees.find((item) => resolve(item.path) === target);
        if (!entry) {
          issues.push({ code: "abandoned_reservation_missing_worktree", id, worktree: reservation.worktree });
          reservations.push({ id, state: "missing_worktree" });
          continue;
        }
        if (entry.branch !== reservation.branch) {
          issues.push({ code: "abandoned_reservation_branch_mismatch", id, expected: reservation.branch, actual: entry.branch });
          reservations.push({ id, state: "branch_mismatch" });
          continue;
        }
        const pointer = (await readText(join(target, ".agents", "state", "current.txt"))).trim();
        const dirty = runGit(target, ["status", "--porcelain"], { allowFailure: true });
        const head = runGit(target, ["rev-parse", "HEAD"], { allowFailure: true });
        const state = pointer ? "current" : dirty ? "dirty" : head !== reservation.base_commit ? "committed" : "provisional";
        reservations.push({ id, state, worktree: reservation.worktree, branch: reservation.branch });
        if (state !== "provisional") issues.push({ code: `abandoned_reservation_${state}`, id, ...(pointer ? { plan: pointer } : {}) });

        if (reservation.stage_sha256) {
          const stage = join(reservationDir, `${id}.plan.md`);
          const staged = await readText(stage);
          if (!staged) issues.push({ code: "missing_reservation_stage", id });
          else if (createHash("sha256").update(staged).digest("hex") !== reservation.stage_sha256) {
            issues.push({ code: "reservation_stage_hash_mismatch", id });
          }
        }
      }
      for (const file of reservationFiles) {
        if (file.endsWith(".plan.md")) {
          const id = file.slice(0, -".plan.md".length);
          if (!reservationIds.has(id)) issues.push({ code: "orphan_reservation_stage", id, file });
        } else if (file.includes(".tmp-")) {
          issues.push({ code: "orphan_reservation_temp", file });
        }
      }
      return { ok: issues.length === 0, issues, reservations };
    });
  });
}

function parseArgs(argv) {
  const positionals = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) positionals.push(argv[i]);
    else {
      const key = argv[i].slice(2).replace(/-/g, "_");
      const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      options[key] = value;
    }
  }
  return { positionals, options };
}

export async function main(argv = process.argv.slice(2)) {
  const [command] = argv;
  const { options } = parseArgs(argv.slice(1));
  const root = options.root || process.cwd();
  let result;
  if (command === "resolve-current") result = await resolveCurrent(root);
  else if (command === "ensure") result = await ensureManagedWorktree({ root, id: options.id, base: options.base, branch: options.branch, worktree: options.path });
  else if (command === "ensure-current") result = await ensureCurrent({ root });
  else if (command === "adopt") result = await adoptPlan({ root, plan: options.plan, base: options.base, branch: options.branch, worktree: options.path, select: Boolean(options.select) });
  else if (command === "assert-root") result = await assertPlanRoot({ root, plan: options.plan });
  else if (command === "sync-state") result = await syncPlanState({ root, plan: options.plan });
  else if (command === "cancel-provisional") result = await cancelProvisional({ root, id: options.id });
  else if (command === "stage-plan") {
    if (!options.id || !options.input) throw new Error("stage-plan needs --id and --input");
    result = await stagePlan({ root, id: options.id, content: await readFile(resolve(options.input), "utf8") });
  }
  else if (command === "validate") result = await validateManagedWorktrees(root, { all: Boolean(options.all) });
  else if (command === "prune" && options.provisional) {
    if (!options.id) throw new Error("provisional prune needs --id");
    result = await cancelProvisional({ root, id: options.id });
  }
  else if (command === "prune") result = await pruneManagedWorktree({ root, plan: options.plan });
  else throw new Error(`unknown command '${command || ""}'`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
