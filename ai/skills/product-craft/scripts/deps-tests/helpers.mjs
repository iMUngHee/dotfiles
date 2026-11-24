// Shared by the deps tests: build a board directory, run board.mjs, read the template.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL = fileURLToPath(new URL("../../", import.meta.url));
const BOARD = join(SKILL, "scripts", "board.mjs");
const TEMPLATE = join(SKILL, "references", "feedback-surface.json");

export async function makeBoard(surface, candidates = { "one.html": "<p>one</p>", "two.html": "<p>two</p>" }, prepare) {
  const dir = await mkdtemp(join(tmpdir(), "board-deps-"));
  for (const [name, html] of Object.entries(candidates)) await writeFile(join(dir, name), html);
  if (prepare) await prepare(dir);
  await writeFile(join(dir, "surface.json"), JSON.stringify(surface));
  await writeFile(join(dir, "board.json"), JSON.stringify({
    candidates: Object.keys(candidates).filter(n => n.endsWith(".html")).map(path => ({ path })),
  }));
  return dir;
}

/** Starts `board.mjs serve` and resolves with its url and round once it prints ready. */
export function serve(dir) {
  const child = spawn(process.execPath, [BOARD, "serve", dir], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  const exited = new Promise(resolve => child.once("exit", code => resolve(code)));
  const ready = new Promise((resolve, reject) => {
    let stdout = "";
    child.stdout.on("data", chunk => {
      stdout += chunk;
      const match = stdout.match(/^board: ready (\S+) round=(\S+)$/m);
      if (match) resolve({ url: match[1], round: match[2] });
    });
    exited.then(code => reject(new Error(`serve exited ${code}: ${stderr}`)));
  });
  return { child, ready, exited, stderr: () => stderr };
}

export function run(args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [BOARD, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("exit", code => resolve({ code, stdout, stderr }));
  });
}

export const template = async () => JSON.parse(await readFile(TEMPLATE, "utf8"));
