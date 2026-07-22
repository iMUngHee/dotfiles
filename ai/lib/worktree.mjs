#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { OwnerLockError, withOwnerLock } from "./owner-lock.mjs";

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SESSION_TOOLS = new Set(["claude", "codex"]);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

class AutoAdoptionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

class SessionBindingStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sessionIdentityReason(tool, sessionId) {
  if (!SESSION_TOOLS.has(tool)) return "invalid_tool";
  if (typeof sessionId !== "string" || !sessionId.length) return "missing_session_id";
  return null;
}

function bindingStoreBase(storeRoot) {
  return resolve(storeRoot || process.env.PM_SESSION_BINDINGS_ROOT || tmpdir());
}

export function sessionBindingPaths({ root = process.cwd(), tool, sessionId, storeRoot } = {}) {
  const invalid = sessionIdentityReason(tool, sessionId);
  if (invalid) throw new Error(invalid);
  const main = mainCheckout(root);
  const uid = typeof process.getuid === "function" ? String(process.getuid()) : "unknown";
  const base = bindingStoreBase(storeRoot);
  const managedRoot = join(base, "pm-session-bindings", `uid-${uid}`, "v1");
  const toolDir = join(managedRoot, tool);
  const rootDir = join(toolDir, sha256(main));
  const sessionDigest = sha256(sessionId);
  return {
    base,
    managed_root: managedRoot,
    tool_dir: toolDir,
    root_dir: rootDir,
    binding: join(rootDir, `${sessionDigest}.json`),
    lock: join(rootDir, `${sessionDigest}.lock`),
    main_root: main,
    root_digest: sha256(main),
    session_digest: sessionDigest,
  };
}

async function pathInfo(path) {
  return lstat(path).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
}

async function assertSafeStorePath(path, kind) {
  const info = await pathInfo(path);
  if (!info) return null;
  if (info.isSymbolicLink()) throw new SessionBindingStoreError("binding_store_unsafe", `unsafe session binding ${kind} symlink: ${path}`);
  return info;
}

async function assertSafeStoreLayout(paths) {
  const base = await assertSafeStorePath(paths.base, "store root");
  if (base && !base.isDirectory()) throw new SessionBindingStoreError("binding_store_unsafe", `session binding store root is not a directory: ${paths.base}`);
  for (const path of [paths.managed_root, paths.tool_dir, paths.root_dir]) {
    const info = await assertSafeStorePath(path, "directory");
    if (info && !info.isDirectory()) throw new SessionBindingStoreError("binding_store_unsafe", `session binding path is not a directory: ${path}`);
  }
  const binding = await assertSafeStorePath(paths.binding, "file");
  if (binding && !binding.isFile()) throw new SessionBindingStoreError("binding_store_unsafe", `session binding path is not a file: ${paths.binding}`);
  const lock = await assertSafeStorePath(paths.lock, "lock");
  if (lock && !lock.isDirectory()) throw new SessionBindingStoreError("binding_store_unsafe", `session binding lock is not a directory: ${paths.lock}`);
}

async function prepareSessionBindingStore(paths) {
  await assertSafeStoreLayout(paths);
  await mkdir(paths.base, { recursive: true, mode: 0o700 });
  for (const path of [paths.managed_root, paths.tool_dir, paths.root_dir]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const info = await assertSafeStorePath(path, "directory");
    if (!info?.isDirectory()) throw new SessionBindingStoreError("binding_store_unsafe", `session binding path is not a directory: ${path}`);
    await chmod(path, 0o700);
  }
  await assertSafeStoreLayout(paths);
}

async function atomicWritePrivate(path, content) {
  const current = await assertSafeStorePath(path, "file");
  if (current && !current.isFile()) throw new SessionBindingStoreError("binding_store_unsafe", `session binding path is not a file: ${path}`);
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await writeFile(tmp, content, { flag: "wx", mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, path);
  } finally {
    await unlink(tmp).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function withExclusiveFileLock(path, fn, { operation = "worktree", retries = 100, retryMs = 25 } = {}) {
  return withOwnerLock(path, operation, fn, { retries, retryMs });
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

export async function withReservationLock(root, id, fn, options = {}) {
  const main = mainCheckout(root);
  const paths = reservationPaths(main, id);
  return withExclusiveFileLock(paths.lock, () => fn({ main, ...paths }), { operation: `reservation:${id}`, ...options });
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

function assertAncestor(main, ancestor, descendant, label) {
  const result = runGit(main, ["merge-base", "--is-ancestor", ancestor, descendant], { allowFailure: true });
  if (result === null) throw new Error(`${label}: ${ancestor} is not an ancestor of ${descendant}`);
}

function resolveBaseAndStart(main, { base, baseCommit, start }) {
  if (!base) throw new Error("base ref is required");
  const baseTip = runGit(main, ["rev-parse", "--verify", `${base}^{commit}`]);
  let historical = baseTip;
  if (baseCommit !== undefined) {
    if (!/^[0-9a-f]{40}$/i.test(baseCommit)) throw new Error("base commit must be a 40-character OID");
    historical = runGit(main, ["rev-parse", "--verify", `${baseCommit}^{commit}`]);
    if (historical.toLowerCase() !== baseCommit.toLowerCase()) throw new Error(`base commit does not resolve exactly: ${baseCommit}`);
  }
  assertAncestor(main, historical, baseTip, "historical base mismatch");
  const startCommit = start
    ? runGit(main, ["rev-parse", "--verify", `${start}^{commit}`])
    : historical;
  assertAncestor(main, historical, startCommit, "start commit mismatch");
  return { baseTip, baseCommit: historical, startCommit };
}

function normalizeReservation(reservation) {
  return { ...reservation, start_commit: reservation.start_commit || reservation.base_commit };
}

function assertReservationIdentity(existing, expected) {
  const normalized = normalizeReservation(existing);
  for (const key of ["id", "base_branch", "base_commit", "start_commit", "branch", "worktree"]) {
    if (normalized[key] !== expected[key]) throw new Error(`reservation conflict for ${expected.id}: ${key}`);
  }
  return normalized;
}

async function ensureManagedWorktreeLocked({ main, root, id, base, baseCommit, start, branch, worktree, paths }) {
  const refs = resolveBaseAndStart(main, { base, baseCommit, start });
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

  const branchCommit = runGit(main, ["rev-parse", "--verify", `refs/heads/${targetBranch}^{commit}`], { allowFailure: true });
  const existingRaw = await readText(paths.json);
  const existing = existingRaw ? JSON.parse(existingRaw) : null;
  let expectedStart = refs.startCommit;
  if (existing) expectedStart = normalizeReservation(existing).start_commit;
  else if (byPath?.head || branchCommit) expectedStart = byPath?.head || branchCommit;
  if (start && expectedStart !== refs.startCommit) throw new Error(`existing branch ${targetBranch} does not match start commit`);
  assertAncestor(main, refs.baseCommit, expectedStart, "target start mismatch");

  await mkdir(paths.dir, { recursive: true });
  const reservation = {
    id,
    base_branch: base,
    base_commit: refs.baseCommit,
    start_commit: expectedStart,
    branch: targetBranch,
    worktree: managedRel,
    source_checkout: relativeManagedPath(main, runGit(root, ["rev-parse", "--show-toplevel"])),
    expected_main_current: (await readText(join(main, ".agents", "state", "current.txt"))).trim(),
    created_at: new Date().toISOString(),
  };
  const persisted = existing ? assertReservationIdentity(existing, reservation) : reservation;
  if (!existing) await atomicWrite(paths.json, `${JSON.stringify(reservation, null, 2)}\n`);

  if (!byPath) {
    await mkdir(dirname(targetAbs), { recursive: true });
    if (branchCommit) runGit(main, ["worktree", "add", targetAbs, targetBranch]);
    else runGit(main, ["worktree", "add", "-b", targetBranch, targetAbs, expectedStart]);
  }
  await wireManagedStore(main, targetAbs);
  return {
    status: byPath ? "reused" : "created",
    main_root: main,
    execution_root: targetAbs,
    base_branch: base,
    base_commit: refs.baseCommit,
    start_commit: persisted.start_commit,
    branch: targetBranch,
    worktree: managedRel,
    reservation: relativeManagedPath(main, paths.json),
  };
}

export async function ensureManagedWorktree({ root = process.cwd(), id, base, baseCommit, start, branch, worktree } = {}) {
  if (!ID_RE.test(id || "")) throw new Error(`invalid worktree id '${id ?? ""}'`);
  const main = mainCheckout(root);
  return withReservationLock(main, id, ({ json, stage, lock, dir }) => ensureManagedWorktreeLocked({
    main,
    root,
    id,
    base,
    baseCommit,
    start,
    branch,
    worktree,
    paths: { json, stage, lock, dir },
  }));
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

async function findNonterminalPlanOwner(main, worktree, { excludePlan = null } = {}) {
  const target = resolve(main, worktree);
  const plansDir = join(main, ".agents", "plans");
  for (const file of (await readdir(plansDir).catch(() => [])).filter((name) => name.endsWith(".md"))) {
    const rel = `.agents/plans/${file}`;
    if (rel === excludePlan) continue;
    const fields = parseFrontmatter(await readText(join(plansDir, file)));
    if (["draft", "active"].includes(fields.status) && fields.worktree && resolve(main, fields.worktree) === target) {
      return rel;
    }
  }
  return null;
}

async function resolvePlanReference({ checkout, main, plan: pointer }) {
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
    const candidates = await adoptionCandidates(main, pointer);
    return {
      status: "legacy_unmapped",
      plan: pointer,
      plan_status: fields.status,
      checkout_root: checkout,
      main_root: main,
      recovery: {
        action: "worktree_adopt",
        plan: pointer,
        required_options: ["base"],
        optional_options: candidates.length === 0 ? ["base_commit", "start", "branch", "path", "select"] : ["base_commit", "branch", "path", "select"],
        candidate_count: candidates.length,
        candidates: candidates.map((entry) => ({ execution_root: entry.path, branch: entry.branch, head: entry.head })),
      },
    };
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

export async function resolvePlan({ root = process.cwd(), plan } = {}) {
  const checkout = runGit(root, ["rev-parse", "--show-toplevel"]);
  const main = mainCheckout(checkout);
  return resolvePlanReference({ checkout, main, plan });
}

export async function resolveCurrent(root = process.cwd()) {
  const checkout = runGit(root, ["rev-parse", "--show-toplevel"]);
  const main = mainCheckout(checkout);
  const pointer = (await readText(join(checkout, ".agents", "state", "current.txt"))).trim();
  if (!pointer) return { status: "empty", checkout_root: checkout, main_root: main };
  return resolvePlanReference({ checkout, main, plan: pointer });
}

export async function writeCurrentCAS(checkoutRoot, expected, next) {
  const state = join(checkoutRoot, ".agents", "state");
  const pointer = join(state, "current.txt");
  const lock = join(state, "current.lock");
  return withExclusiveFileLock(lock, async () => {
    const current = (await readText(pointer)).trim();
    if (current !== (expected || "").trim()) return { updated: false, current, reason: "cas_conflict" };
    const normalizedNext = next?.trim() || "";
    if (current === normalizedNext) return { updated: false, current, reason: "unchanged" };
    await atomicWrite(pointer, normalizedNext ? `${normalizedNext}\n` : "");
    return { updated: true, current: normalizedNext, reason: "updated" };
  }, { operation: "current-cas" });
}

async function withCurrentLock(checkoutRoot, fn, options = {}) {
  const state = join(checkoutRoot, ".agents", "state");
  return withExclusiveFileLock(join(state, "current.lock"), async () => {
    const current = (await readText(join(state, "current.txt"))).trim();
    return fn(current);
  }, { operation: "current", ...options });
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
    return ensureMappedCurrent({ root, result });
  } else if (result.status === "legacy_unmapped") {
    const adoption = await autoAdoptLegacy({ root, legacy: result });
    if (adoption.status === "legacy_unmapped") return adoption;
    const resolved = await resolveCurrent(root);
    if (resolved.status !== "ok") return resolved;
    const ensured = await ensureMappedCurrent({ root, result: resolved });
    if (ensured.status !== "ok") return ensured;
    if (adoption.auto_adoption) ensured.auto_adoption = adoption.auto_adoption;
    return ensured;
  } else if (result.status === "terminal") {
    await writeCurrentCAS(result.checkout_root, result.plan, "");
  }
  return result;
}

function unboundSessionResult({ checkout, main, tool, sessionId, reason }) {
  return {
    status: "unbound",
    reason,
    tool: SESSION_TOOLS.has(tool) ? tool : null,
    session_id: typeof sessionId === "string" && sessionId.length ? sessionId : null,
    checkout_root: checkout,
    main_root: main,
    binding_status: "unbound",
  };
}

async function readSessionBinding(paths) {
  await assertSafeStoreLayout(paths);
  const info = await pathInfo(paths.binding);
  if (!info) return { state: "missing", raw: null, value: null };
  const raw = await readFile(paths.binding, "utf8");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { state: "invalid", raw, value: null, reason: "malformed_json" };
  }
  const keys = value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).sort() : [];
  if (keys.join(",") !== "main_root,plan" || typeof value.main_root !== "string" || typeof value.plan !== "string") {
    return { state: "invalid", raw, value: null, reason: "invalid_schema" };
  }
  return { state: "ok", raw, value };
}

async function resolveSessionState({ root = process.cwd(), tool, sessionId, storeRoot } = {}) {
  const checkout = runGit(root, ["rev-parse", "--show-toplevel"]);
  const main = mainCheckout(checkout);
  const identityError = sessionIdentityReason(tool, sessionId);
  if (identityError) {
    return { result: unboundSessionResult({ checkout, main, tool, sessionId, reason: identityError }), paths: null, binding: null };
  }

  const paths = sessionBindingPaths({ root: checkout, tool, sessionId, storeRoot });
  let binding;
  try {
    binding = await readSessionBinding(paths);
  } catch (error) {
    const status = error instanceof SessionBindingStoreError ? error.code : "binding_store_error";
    return {
      result: {
        status,
        reason: error.message,
        tool,
        session_id: sessionId,
        checkout_root: checkout,
        main_root: main,
        binding_status: "unbound",
      },
      paths,
      binding: null,
    };
  }

  if (binding.state === "invalid") {
    return {
      result: {
        status: "invalid_binding",
        reason: binding.reason,
        tool,
        session_id: sessionId,
        checkout_root: checkout,
        main_root: main,
        binding_status: "stale",
      },
      paths,
      binding,
    };
  }

  if (binding.state === "ok") {
    if (binding.value.main_root !== main) {
      return {
        result: {
          status: "binding_root_mismatch",
          reason: "stored_main_root_mismatch",
          tool,
          session_id: sessionId,
          checkout_root: checkout,
          main_root: main,
          binding_status: "stale",
        },
        paths,
        binding,
      };
    }
    const resolved = await resolvePlan({ root: checkout, plan: binding.value.plan });
    return {
      result: {
        ...resolved,
        tool,
        session_id: sessionId,
        binding_status: resolved.status === "ok" ? "bound" : "stale",
        binding_source: "session",
      },
      paths,
      binding,
    };
  }

  if (resolve(checkout) !== resolve(main)) {
    const local = await resolveCurrent(checkout);
    if (local.status === "ok" && local.route_required === false) {
      return {
        result: {
          ...local,
          tool,
          session_id: sessionId,
          binding_status: "local",
          binding_source: "checkout",
        },
        paths,
        binding,
      };
    }
  }

  return {
    result: unboundSessionResult({ checkout, main, tool, sessionId, reason: "missing_binding" }),
    paths,
    binding,
  };
}

export async function resolveSession(options = {}) {
  return (await resolveSessionState(options)).result;
}

export async function bindSession({ root = process.cwd(), tool, sessionId, plan, storeRoot } = {}) {
  const checkout = runGit(root, ["rev-parse", "--show-toplevel"]);
  const main = mainCheckout(checkout);
  const identityError = sessionIdentityReason(tool, sessionId);
  if (identityError) return unboundSessionResult({ checkout, main, tool, sessionId, reason: identityError });
  const resolved = await resolvePlan({ root: checkout, plan });
  if (resolved.status !== "ok") {
    return { ...resolved, tool, session_id: sessionId, binding_status: "unbound", binding_source: "session" };
  }
  const paths = sessionBindingPaths({ root: checkout, tool, sessionId, storeRoot });
  try {
    await prepareSessionBindingStore(paths);
    await withExclusiveFileLock(paths.lock, async () => {
      await assertSafeStoreLayout(paths);
      await atomicWritePrivate(paths.binding, `${JSON.stringify({ main_root: main, plan })}\n`);
    }, { operation: `session-bind:${tool}` });
  } catch (error) {
    const status = error instanceof SessionBindingStoreError ? error.code : "binding_store_error";
    return {
      status,
      reason: error.message,
      tool,
      session_id: sessionId,
      checkout_root: checkout,
      main_root: main,
      binding_status: "unbound",
      binding_source: "session",
    };
  }
  return { ...resolved, tool, session_id: sessionId, binding_status: "bound", binding_source: "session" };
}

async function removeExactSessionBinding(paths, expectedRaw) {
  await prepareSessionBindingStore(paths);
  return withExclusiveFileLock(paths.lock, async () => {
    const current = await readSessionBinding(paths);
    if (current.state === "missing") return false;
    if (current.raw !== expectedRaw) return false;
    await unlink(paths.binding);
    return true;
  }, { operation: "session-unbind" });
}

export async function unbindSession({ root = process.cwd(), tool, sessionId, storeRoot } = {}) {
  const state = await resolveSessionState({ root, tool, sessionId, storeRoot });
  if (!state.paths || !state.binding?.raw) {
    return { status: "unbound", removed: false, reason: state.result.reason || "missing_binding" };
  }
  const removed = await removeExactSessionBinding(state.paths, state.binding.raw);
  return { status: "unbound", removed, reason: removed ? "removed" : "binding_changed" };
}

export async function ensureSession({ root = process.cwd(), tool, sessionId, storeRoot } = {}) {
  let state = await resolveSessionState({ root, tool, sessionId, storeRoot });
  if (state.result.status === "ok") {
    const ensured = await ensureMappedCurrent({ result: state.result });
    return { ...ensured, tool, session_id: sessionId, binding_status: state.result.binding_status, binding_source: state.result.binding_source };
  }

  const pruneStatuses = new Set([
    "terminal",
    "missing_plan",
    "invalid_plan_status",
    "invalid_mapping",
    "missing_worktree",
    "branch_mismatch",
    "binding_root_mismatch",
    "invalid_binding",
  ]);
  if (state.paths && state.binding?.raw && pruneStatuses.has(state.result.status)) {
    const removed = await removeExactSessionBinding(state.paths, state.binding.raw);
    return { ...state.result, binding_pruned: removed, binding_status: "unbound" };
  }

  if (state.result.status === "unbound" && resolve(state.result.checkout_root) !== resolve(state.result.main_root)) {
    await ensureCurrent({ root: state.result.checkout_root });
    state = await resolveSessionState({ root: state.result.checkout_root, tool, sessionId, storeRoot });
  }
  return state.result;
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

async function adoptionCandidates(main, plan) {
  const candidates = [];
  for (const entry of listGitWorktrees(main)) {
    if (resolve(entry.path) === resolve(main)) continue;
    const pointer = (await readText(join(entry.path, ".agents", "state", "current.txt"))).trim();
    if (pointer === plan) candidates.push(entry);
  }
  return candidates;
}

function hasOwnField(fields, key) {
  return Object.prototype.hasOwnProperty.call(fields, key);
}

function mappedFieldsComplete(fields) {
  return Boolean(fields.base_branch && /^[0-9a-f]{40}$/i.test(fields.base_commit || "") && fields.branch && fields.worktree);
}

function autoFailure(legacy, code, message, candidates = legacy.recovery?.candidates || [], details = {}) {
  const candidateDetails = candidates.map((entry) => ({
    execution_root: entry.path || entry.execution_root,
    branch: entry.branch,
    head: entry.head,
  }));
  const manualCommand = `pm worktree adopt --plan ${legacy.plan} --base <base-ref>`;
  return {
    ...legacy,
    status: "legacy_unmapped",
    failure_code: code,
    message,
    manual_command: manualCommand,
    candidate_count: candidateDetails.length,
    candidates: candidateDetails,
    ...details,
    recovery: {
      ...(legacy.recovery || {}),
      plan: legacy.plan,
      candidate_count: candidateDetails.length,
      candidates: candidateDetails,
      manual_command: manualCommand,
    },
  };
}

function ownerLockFailureCode(error, main) {
  const message = error?.message || "";
  let scope = "reservation";
  if (message.includes(`${join(main, ".agents", "tasks", ".lock")}`)) scope = "pm_store";
  else if (message.includes("current.lock")) {
    scope = message.includes(join(main, ".agents", "state", "current.lock")) ? "main" : "target";
  }
  return `${scope}_lock_${error.code === "owner_lock_timeout" ? "timeout" : "blocked"}`;
}

function resolveExactCommit(main, value, code, label) {
  if (!value || !/^[0-9a-f]{40}$/i.test(value)) throw new AutoAdoptionError(code, `${label} must be a 40-character OID`);
  const resolvedCommit = runGit(main, ["rev-parse", "--verify", `${value}^{commit}`], { allowFailure: true });
  if (!resolvedCommit || resolvedCommit.toLowerCase() !== value.toLowerCase()) {
    throw new AutoAdoptionError(code, `${label} does not resolve exactly: ${value}`);
  }
  return resolvedCommit;
}

function assertAutomaticAncestor(main, ancestor, descendant) {
  if (runGit(main, ["merge-base", "--is-ancestor", ancestor, descendant], { allowFailure: true }) === null) {
    throw new AutoAdoptionError("base_ancestry_invalid", `${ancestor} is not an ancestor of ${descendant}`);
  }
}

function defaultBaseRef(main) {
  const origin = runGit(main, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { allowFailure: true });
  if (origin) return origin;
  const raw = runGit(main, ["for-each-ref", "--format=%(refname:short)%09%(symref:short)", "refs/remotes"], { allowFailure: true }) || "";
  const defaults = raw.split("\n")
    .map((line) => line.split("\t"))
    .filter(([name, target]) => name?.endsWith("/HEAD") && target)
    .map(([, target]) => target);
  const distinct = [...new Set(defaults)];
  if (distinct.length > 1) throw new AutoAdoptionError("default_ref_ambiguous", `multiple symbolic remote defaults: ${distinct.join(", ")}`);
  if (distinct.length === 1) return distinct[0];
  const branch = runGit(main, ["branch", "--show-current"], { allowFailure: true });
  if (!branch) throw new AutoAdoptionError("default_ref_missing", "no symbolic remote default or main checkout branch");
  return branch;
}

function uniqueMergeBase(main, baseTip, sourceHead) {
  const raw = runGit(main, ["merge-base", "--all", baseTip, sourceHead], { allowFailure: true });
  const commits = [...new Set((raw || "").split(/\s+/).filter(Boolean))];
  if (commits.length === 0) throw new AutoAdoptionError("merge_base_missing", `no merge base for ${baseTip} and ${sourceHead}`);
  if (commits.length > 1 || !/^[0-9a-f]{40}$/i.test(commits[0])) {
    throw new AutoAdoptionError("merge_base_ambiguous", `merge base is not one exact OID for ${baseTip} and ${sourceHead}`);
  }
  return commits[0];
}

function inferAutomaticBase(main, fields, sourceHead) {
  const hasBranch = hasOwnField(fields, "base_branch");
  const hasCommit = hasOwnField(fields, "base_commit");
  if (hasBranch && !fields.base_branch) throw new AutoAdoptionError("invalid_mapping_fields", "base_branch is present but empty");
  if (hasCommit && !fields.base_commit) throw new AutoAdoptionError("invalid_mapping_fields", "base_commit is present but empty");
  const baseRef = hasBranch ? fields.base_branch : defaultBaseRef(main);
  const baseTip = runGit(main, ["rev-parse", "--verify", `${baseRef}^{commit}`], { allowFailure: true });
  if (!baseTip) throw new AutoAdoptionError("base_ref_invalid", `base ref does not resolve: ${baseRef}`);
  const baseCommit = hasCommit
    ? resolveExactCommit(main, fields.base_commit, "base_commit_invalid", "base_commit")
    : uniqueMergeBase(main, baseTip, sourceHead);
  assertAutomaticAncestor(main, baseCommit, baseTip);
  assertAutomaticAncestor(main, baseCommit, sourceHead);
  return { baseRef, baseTip, baseCommit };
}

function normalizeAutomaticTopology(main, id, fields, candidate) {
  const conventional = requestedAdoptionTarget(main, id);
  const hasBranch = hasOwnField(fields, "branch");
  const hasWorktree = hasOwnField(fields, "worktree");
  if (hasBranch) {
    if (!fields.branch || runGit(main, ["check-ref-format", "--branch", fields.branch], { allowFailure: true }) === null) {
      throw new AutoAdoptionError("invalid_mapping_fields", `invalid branch constraint: ${fields.branch || "(empty)"}`);
    }
  }
  let worktreeConstraint = null;
  if (hasWorktree) {
    if (!fields.worktree || isAbsolute(fields.worktree)) {
      throw new AutoAdoptionError("invalid_mapping_fields", "worktree constraint must be a non-empty relative managed path");
    }
    try {
      const absolute = assertManagedTarget(main, resolve(main, fields.worktree));
      worktreeConstraint = relativeManagedPath(main, absolute);
    } catch (error) {
      throw new AutoAdoptionError("invalid_mapping_fields", error.message);
    }
  }
  if (candidate) {
    if (!candidate.branch) throw new AutoAdoptionError("candidate_detached", "the sole adoption candidate is detached");
    const candidateWorktree = relativeManagedPath(main, assertManagedTarget(main, candidate.path));
    if ((hasBranch && fields.branch !== candidate.branch) || (hasWorktree && worktreeConstraint !== candidateWorktree)) {
      throw new AutoAdoptionError("topology_constraint_mismatch", "legacy topology fields do not match the sole candidate");
    }
    return { branch: candidate.branch, worktree: candidate.path };
  }
  if ((hasBranch && fields.branch !== conventional.targetBranch) || (hasWorktree && worktreeConstraint !== conventional.managedRel)) {
    throw new AutoAdoptionError("topology_constraint_mismatch", "legacy topology fields do not match the conventional managed target");
  }
  return { branch: conventional.targetBranch, worktree: conventional.targetAbs };
}

function requestedAdoptionTarget(main, id, branch, worktree) {
  const targetBranch = branch || `agent/${id}`;
  const targetAbs = worktree
    ? (isAbsolute(worktree) ? worktree : resolve(main, worktree))
    : join(main, ".agents", "worktrees", id);
  if (resolve(targetAbs) === resolve(main)) throw new Error("main checkout cannot be a plan execution worktree");
  assertManagedTarget(main, targetAbs);
  return { targetBranch, targetAbs, managedRel: relativeManagedPath(main, targetAbs) };
}

async function reserveAdoptionCandidate({ main, root, id, base, baseCommit, candidate, paths }) {
  if (!candidate.branch) throw new Error("detached worktree cannot be an adoption candidate");
  const refs = resolveBaseAndStart(main, { base, baseCommit });
  const head = runGit(candidate.path, ["rev-parse", "HEAD"]);
  assertAncestor(main, refs.baseCommit, head, "candidate base mismatch");
  const expected = {
    id,
    base_branch: base,
    base_commit: refs.baseCommit,
    start_commit: head,
    branch: candidate.branch,
    worktree: relativeManagedPath(main, candidate.path),
    source_checkout: relativeManagedPath(main, runGit(root, ["rev-parse", "--show-toplevel"])),
    expected_main_current: (await readText(join(main, ".agents", "state", "current.txt"))).trim(),
    created_at: new Date().toISOString(),
  };
  const raw = await readText(paths.json);
  const reservation = raw ? assertReservationIdentity(JSON.parse(raw), expected) : expected;
  if (!raw) {
    await mkdir(paths.dir, { recursive: true });
    await atomicWrite(paths.json, `${JSON.stringify(expected, null, 2)}\n`);
  }
  return {
    status: "reused",
    main_root: main,
    execution_root: candidate.path,
    base_branch: base,
    base_commit: refs.baseCommit,
    start_commit: reservation.start_commit,
    branch: candidate.branch,
    worktree: expected.worktree,
    reservation: relativeManagedPath(main, paths.json),
  };
}

async function cleanupAdoptionReservation(paths) {
  await unlink(paths.stage).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  await unlink(paths.json).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

async function withPmStoreLock(main, operation, fn, options = {}) {
  return withOwnerLock(join(main, ".agents", "tasks", ".lock"), operation, fn, options);
}

async function adoptPlanLocked({
  main,
  root,
  plan,
  id,
  base,
  baseCommit,
  start,
  branch,
  worktree,
  select,
  automatic = false,
  automaticOutcome = "adopted_parked",
  paths,
  candidates: classifiedCandidates,
}) {
    const candidates = classifiedCandidates || await adoptionCandidates(main, plan);
    if (candidates.length > 1) throw new Error(`multiple adoption candidates for ${plan}`);

    let topology;
    if (candidates.length === 1) {
      if (start) throw new Error("--start cannot be used when reusing an adoption candidate");
      const candidate = candidates[0];
      assertManagedTarget(main, candidate.path);
      if (branch && branch !== candidate.branch) throw new Error(`adoption candidate branch mismatch: ${candidate.branch}`);
      if (worktree) {
        const requested = isAbsolute(worktree) ? worktree : resolve(main, worktree);
        if (resolve(requested) !== resolve(candidate.path)) throw new Error(`adoption candidate path mismatch: ${candidate.path}`);
      }
      const owner = await findNonterminalPlanOwner(main, relativeManagedPath(main, candidate.path), { excludePlan: plan });
      if (owner) throw new Error(`target already owned by plan ${owner}`);
      topology = await reserveAdoptionCandidate({ main, root, id, base, baseCommit, candidate, paths });
    } else {
      const requested = requestedAdoptionTarget(main, id, branch, worktree);
      const existingRaw = await readText(paths.json);
      if (!existingRaw) {
        const worktrees = listGitWorktrees(main);
        const occupiedPath = worktrees.some((entry) => resolve(entry.path) === resolve(requested.targetAbs));
        const occupiedBranch = worktrees.some((entry) => entry.branch === requested.targetBranch)
          || Boolean(runGit(main, ["rev-parse", "--verify", `refs/heads/${requested.targetBranch}^{commit}`], { allowFailure: true }));
        if (occupiedPath || occupiedBranch || await exists(requested.targetAbs)) {
          throw new Error("occupied topology has no exact adoption reservation");
        }
        const dirty = runGit(main, ["status", "--porcelain", "--untracked-files=all", "--", ".", ":(exclude).agents/**"]);
        if (dirty) throw new Error("dirty main checkout: commit or stash project changes before legacy adoption");
      }
      topology = await ensureManagedWorktreeLocked({
        main,
        root,
        id,
        base,
        baseCommit,
        start,
        branch: requested.targetBranch,
        worktree: requested.targetAbs,
        paths,
      });
    }

    return withPmStoreLock(main, `adopt:${id}`, async () => {
      const loaded = await loadPlan(main, plan);
      if (!["draft", "active"].includes(loaded.fields.status)) throw new Error(`cannot adopt ${loaded.fields.status || "statusless"} plan`);
      const owner = await findNonterminalPlanOwner(main, topology.worktree, { excludePlan: plan });
      if (owner) throw new Error(`target already owned by plan ${owner}`);
      const entry = listGitWorktrees(main).find((item) => resolve(item.path) === resolve(topology.execution_root));
      if (!entry) throw new Error(`adoption target is no longer registered: ${topology.execution_root}`);
      if (entry.branch !== topology.branch) throw new Error(`adoption target branch changed: ${entry.branch}`);
      const head = runGit(topology.execution_root, ["rev-parse", "HEAD"]);
      assertAncestor(main, topology.base_commit, head, "adoption target base mismatch");

      for (const [key, expected] of Object.entries({
        base_branch: topology.base_branch,
        base_commit: topology.base_commit,
        branch: topology.branch,
        worktree: topology.worktree,
      })) {
        if (loaded.fields[key] && loaded.fields[key] !== expected) throw new Error(`plan already has a different ${key} mapping`);
      }

      return withCurrentLock(topology.execution_root, async (targetCurrent) => {
        if (targetCurrent && targetCurrent !== plan) throw new Error(`target current conflict: ${targetCurrent}`);
        if (!targetCurrent) {
          await atomicWrite(join(topology.execution_root, ".agents", "state", "current.txt"), `${plan}\n`);
        }
        const updated = setFrontmatterFields(loaded.markdown, {
          base_branch: topology.base_branch,
          base_commit: topology.base_commit,
          branch: topology.branch,
          worktree: topology.worktree,
        });
        if (updated !== loaded.markdown) await atomicWrite(loaded.path, updated);

        let outcome = "adopted_parked";
        if (automatic) {
          outcome = automaticOutcome;
        } else if (select) {
          const reservation = normalizeReservation(JSON.parse(await readText(paths.json)));
          outcome = await withCurrentLock(main, async (mainCurrent) => {
            if (mainCurrent === plan) return "adopted_selected";
            if (mainCurrent !== (reservation.expected_main_current || "")) return "adopted_parked";
            await atomicWrite(join(main, ".agents", "state", "current.txt"), `${plan}\n`);
            return "adopted_selected";
          });
        }
        await cleanupAdoptionReservation(paths);
        return { ...topology, outcome };
      });
    });
}

export async function adoptPlan({ root = process.cwd(), plan, base, baseCommit, start, branch, worktree, select = false }) {
  const main = mainCheckout(root);
  const initial = await loadPlan(main, plan);
  const id = initial.fields.id;
  if (!ID_RE.test(id || "")) throw new Error(`invalid plan id '${id ?? ""}'`);
  return withReservationLock(main, id, async (paths) => adoptPlanLocked({
    main,
    root,
    plan,
    id,
    base,
    baseCommit,
    start,
    branch,
    worktree,
    select,
    paths,
  }));
}

function automaticDomainError(error) {
  if (error instanceof AutoAdoptionError) return error;
  const message = error?.message || String(error);
  if (message.includes("multiple adoption candidates")) return new AutoAdoptionError("candidate_ambiguous", message);
  if (message.includes("detached worktree")) return new AutoAdoptionError("candidate_detached", message);
  if (message.includes("reservation conflict")) return new AutoAdoptionError("reservation_identity_mismatch", message);
  if (message.includes("occupied topology")) return new AutoAdoptionError("topology_occupied", message);
  if (message.includes("dirty main checkout")) return new AutoAdoptionError("main_dirty", message);
  if (message.includes("target current conflict")) return new AutoAdoptionError("foreign_pointer", message);
  if (message.includes("target already owned")) return new AutoAdoptionError("foreign_owner", message);
  if (message.includes("candidate branch mismatch") || message.includes("candidate path mismatch")) {
    return new AutoAdoptionError("topology_constraint_mismatch", message);
  }
  if (message.includes("different base_") || message.includes("different branch") || message.includes("different worktree")) {
    return new AutoAdoptionError("invalid_mapping_fields", message);
  }
  return null;
}

async function autoAdoptLegacy({ root, legacy }) {
  const main = mainCheckout(root);
  const initial = await loadPlan(main, legacy.plan);
  const id = initial.fields.id;
  if (!ID_RE.test(id || "")) return autoFailure(legacy, "invalid_mapping_fields", `invalid plan id '${id ?? ""}'`);
  let candidates = [];
  try {
    const result = await withReservationLock(main, id, async (paths) => {
      const loaded = await loadPlan(main, legacy.plan);
      if (loaded.fields.id !== id) throw new AutoAdoptionError("invalid_mapping_fields", "plan id changed during automatic adoption");
      if (!["draft", "active"].includes(loaded.fields.status)) {
        throw new AutoAdoptionError("invalid_mapping_fields", `automatic adoption requires draft/active status, found ${loaded.fields.status || "unknown"}`);
      }
      if (mappedFieldsComplete(loaded.fields)) return { converged: true };

      candidates = await adoptionCandidates(main, legacy.plan);
      if (candidates.length > 1) throw new AutoAdoptionError("candidate_ambiguous", `multiple adoption candidates for ${legacy.plan}`);
      const candidate = candidates[0] || null;
      const reservationRaw = await readText(paths.json);
      const existingReservation = reservationRaw ? normalizeReservation(JSON.parse(reservationRaw)) : null;
      const sourceKind = candidate ? "candidate" : existingReservation ? "reservation" : "main_checkout";
      const sourceHead = candidate
        ? runGit(candidate.path, ["rev-parse", "--verify", "HEAD^{commit}"], { allowFailure: true })
        : existingReservation
          ? runGit(main, ["rev-parse", "--verify", `${existingReservation.start_commit}^{commit}`], { allowFailure: true })
          : runGit(main, ["rev-parse", "--verify", "HEAD^{commit}"], { allowFailure: true });
      if (!sourceHead || !/^[0-9a-f]{40}$/i.test(sourceHead)) {
        throw new AutoAdoptionError("source_invalid", "automatic adoption source does not resolve to one commit");
      }
      const inferenceFields = { ...loaded.fields };
      if (existingReservation && !hasOwnField(inferenceFields, "base_branch")) inferenceFields.base_branch = existingReservation.base_branch;
      if (existingReservation && !hasOwnField(inferenceFields, "base_commit")) inferenceFields.base_commit = existingReservation.base_commit;
      const inferred = inferAutomaticBase(main, inferenceFields, sourceHead);
      let target;
      if (!candidate && existingReservation) {
        if (existingReservation.id !== id) throw new AutoAdoptionError("reservation_identity_mismatch", "reservation id differs from the plan");
        const reserved = requestedAdoptionTarget(main, id, existingReservation.branch, existingReservation.worktree);
        if ((hasOwnField(loaded.fields, "branch") && loaded.fields.branch !== reserved.targetBranch)
          || (hasOwnField(loaded.fields, "worktree") && resolve(main, loaded.fields.worktree) !== reserved.targetAbs)) {
          throw new AutoAdoptionError("reservation_identity_mismatch", "legacy topology fields differ from the existing reservation");
        }
        target = { branch: reserved.targetBranch, worktree: reserved.targetAbs };
      } else target = normalizeAutomaticTopology(main, id, loaded.fields, candidate);
      const automaticOutcome = await withCurrentLock(main, async (mainCurrent) => mainCurrent === legacy.plan ? "adopted_selected" : "adopted_parked");
      const topology = await adoptPlanLocked({
        main,
        root,
        plan: legacy.plan,
        id,
        base: inferred.baseRef,
        baseCommit: inferred.baseCommit,
        start: candidate ? undefined : sourceHead,
        branch: target.branch,
        worktree: target.worktree,
        select: false,
        automatic: true,
        automaticOutcome,
        paths,
        candidates,
      });
      return {
        auto_adoption: {
          source_kind: sourceKind,
          source_head: sourceHead,
          base_ref: inferred.baseRef,
          base_tip: inferred.baseTip,
          base_commit: inferred.baseCommit,
          topology: topology.status,
          outcome: topology.outcome,
        },
      };
    }, { deadlineMs: 20_000, retryMs: 25 });
    return { status: "adopted", ...result };
  } catch (error) {
    if (error instanceof OwnerLockError) {
      return autoFailure(legacy, ownerLockFailureCode(error, main), error.message, candidates);
    }
    const domain = automaticDomainError(error);
    if (domain) return autoFailure(legacy, domain.code, domain.message, candidates, domain.details);
    throw error;
  }
}

async function reconcileMappedReservation(result) {
  const paths = reservationPaths(result.main_root, result.id);
  if (!await exists(paths.json) && !await exists(paths.stage)) return result;
  const legacy = {
    ...result,
    status: "legacy_unmapped",
    recovery: { action: "worktree_adopt", plan: result.plan, candidate_count: 0, candidates: [] },
  };
  try {
    return await withReservationLock(result.main_root, result.id, async (locked) => {
      const raw = await readText(locked.json);
      const stagePresent = await exists(locked.stage);
      if (!raw) {
        if (stagePresent) throw new AutoAdoptionError("residual_stage_pending", "residual staged content requires the manual PM lifecycle path");
        return result;
      }
      const reservation = normalizeReservation(JSON.parse(raw));
      if (reservation.stage_sha256 !== undefined || stagePresent) {
        throw new AutoAdoptionError("residual_stage_pending", "residual staged content requires the manual PM lifecycle path");
      }
      for (const [key, expected] of Object.entries({
        id: result.id,
        base_branch: result.base_branch,
        base_commit: result.base_commit,
        branch: result.branch,
        worktree: result.worktree,
      })) {
        if (reservation[key] !== expected) {
          throw new AutoAdoptionError("residual_reservation_mismatch", `residual reservation differs at ${key}`);
        }
      }
      const startCommit = resolveExactCommit(result.main_root, reservation.start_commit, "residual_reservation_mismatch", "reservation start_commit");
      const entry = listGitWorktrees(result.main_root).find((item) => resolve(item.path) === resolve(result.execution_root));
      if (!entry || entry.branch !== result.branch) {
        throw new AutoAdoptionError("residual_reservation_mismatch", "residual target registration or branch differs from the mapped plan");
      }
      const head = runGit(result.execution_root, ["rev-parse", "--verify", "HEAD^{commit}"], { allowFailure: true });
      if (!head || runGit(result.main_root, ["merge-base", "--is-ancestor", startCommit, head], { allowFailure: true }) === null) {
        throw new AutoAdoptionError("residual_reservation_mismatch", "target HEAD is not a descendant of reservation start_commit");
      }
      const pointer = (await readText(join(result.execution_root, ".agents", "state", "current.txt"))).trim();
      if (pointer !== result.plan) throw new AutoAdoptionError("residual_reservation_mismatch", "target pointer differs from the mapped plan");
      const baseTip = runGit(result.main_root, ["rev-parse", "--verify", `${result.base_branch}^{commit}`], { allowFailure: true }) || result.base_commit;

      return withPmStoreLock(result.main_root, `reconcile:${result.id}`, async () => withCurrentLock(result.execution_root, async (targetCurrent) => {
        if (targetCurrent !== result.plan) throw new AutoAdoptionError("residual_reservation_mismatch", "target pointer changed during reconciliation");
        const outcome = await withCurrentLock(result.main_root, async (mainCurrent) => mainCurrent === result.plan ? "adopted_selected" : "adopted_parked");
        await unlink(locked.json);
        return {
          ...result,
          auto_adoption: {
            source_kind: "reservation",
            source_head: startCommit,
            base_ref: result.base_branch,
            base_tip: baseTip,
            base_commit: result.base_commit,
            topology: "reconciled",
            outcome,
          },
        };
      }));
    }, { deadlineMs: 20_000, retryMs: 25 });
  } catch (error) {
    if (error instanceof OwnerLockError) return autoFailure(legacy, ownerLockFailureCode(error, result.main_root), error.message);
    if (error instanceof AutoAdoptionError) return autoFailure(legacy, error.code, error.message);
    throw error;
  }
}

async function ensureMappedCurrent({ result }) {
  const reconciled = await reconcileMappedReservation(result);
  if (reconciled.status !== "ok") return reconciled;
  const targetPointer = (await readText(join(reconciled.execution_root, ".agents", "state", "current.txt"))).trim();
  if (targetPointer !== reconciled.plan) await syncPlanState({ root: reconciled.main_root, plan: reconciled.plan });
  if (reconciled.route_required && resolve(reconciled.checkout_root) !== resolve(reconciled.main_root)) {
    await writeCurrentCAS(reconciled.checkout_root, reconciled.plan, "");
  }
  return reconciled;
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
      if (head && head !== (reservation.start_commit || reservation.base_commit)) return { removed: false, reason: "committed" };
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
        const expectedHead = reservation.start_commit || reservation.base_commit;
        const state = pointer ? "current" : dirty ? "dirty" : head !== expectedHead ? "committed" : "provisional";
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
  const sessionTool = options.tool || process.env.PM_SESSION_TOOL;
  const sessionId = options.session_id === undefined ? process.env.PM_SESSION_ID : options.session_id;
  let result;
  if (command === "resolve-current") result = await resolveCurrent(root);
  else if (command === "resolve-plan") result = await resolvePlan({ root, plan: options.plan });
  else if (command === "bind-session") result = await bindSession({ root, tool: sessionTool, sessionId, plan: options.plan, storeRoot: options.store_root });
  else if (command === "resolve-session") result = await resolveSession({ root, tool: sessionTool, sessionId, storeRoot: options.store_root });
  else if (command === "ensure-session") result = await ensureSession({ root, tool: sessionTool, sessionId, storeRoot: options.store_root });
  else if (command === "unbind-session") result = await unbindSession({ root, tool: sessionTool, sessionId, storeRoot: options.store_root });
  else if (command === "ensure") result = await ensureManagedWorktree({ root, id: options.id, base: options.base, baseCommit: options.base_commit, start: options.start, branch: options.branch, worktree: options.path });
  else if (command === "ensure-current") result = await ensureCurrent({ root });
  else if (command === "adopt") result = await adoptPlan({ root, plan: options.plan, base: options.base, baseCommit: options.base_commit, start: options.start, branch: options.branch, worktree: options.path, select: Boolean(options.select) });
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
