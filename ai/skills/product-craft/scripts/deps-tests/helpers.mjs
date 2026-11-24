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

/** A candidate that declares accent, gap and align on :root and has sticky, scrolling and deep content. */
export const tokenCandidate = (name, { accent = "#03c75a", gap = 16, align = "start", declare = ["accent", "gap", "align"], extraCss = "" } = {}) => {
  const vars = { accent, gap: `${gap}px`, align };
  const root = declare.map(t => `--${t}: ${vars[t]};`).join(" ");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
:root { ${root} }
body { margin: 0; font: 15px/1.5 system-ui; }
header { position: sticky; top: 0; background: #fff; padding: 8px 16px; }
.row { display: flex; gap: var(--gap); justify-content: var(--align); padding: 16px; }
.price { color: var(--accent); }
.scroller { height: 120px; overflow: auto; margin: 16px; border: 1px solid #ccc; }
${extraCss}
</style></head><body>
<header id="hd"><h1 id="title">${name}</h1></header>
<div class="row" id="row"><span class="price" id="price">89,000원</span><span>B</span></div>
<div class="scroller" id="scroller"><div style="height:600px"><p id="deep" style="margin-top:300px">깊은 요소</p></div></div>
<div style="height:1500px"></div>
</body></html>`;
};

/** The default surface plus the four adjustment controls. */
export async function fullSurface({ radius = false } = {}) {
  const surface = await template();
  const { components } = surface[0].createSurface;
  const add = [
    { id: "accent", component: "ColorToken", token: "accent", label: "강조색", initial: "#03c75a", value: { "@path": "/adjust/accent" } },
    { id: "gap", component: "SizeNudge", token: "gap", label: "간격", initial: 16, min: 0, max: 64, step: 4, value: { "@path": "/adjust/gap" } },
    { id: "align", component: "AlignPicker", token: "align", label: "정렬", initial: "start", options: ["start", "center", "end"], value: { "@path": "/adjust/align" } },
    { id: "pins", component: "RegionNotes", label: "위치 메모", value: { "@path": "/pins" } },
    ...(radius ? [{ id: "radius", component: "SizeNudge", token: "radius", label: "모서리", initial: 4, min: 0, max: 24, step: 2, value: { "@path": "/adjust/radius" } }] : []),
  ];
  components.push(...add);
  const root = components.find(c => c.id === "root");
  root.children.splice(root.children.indexOf("comment"), 0, ...add.map(c => c.id));
  return surface;
}
