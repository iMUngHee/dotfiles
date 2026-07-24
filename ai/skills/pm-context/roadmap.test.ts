import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const contract = await readFile(join(here, "design-contract.md"), "utf8");
const dashboard = await readFile(join(here, "roadmap.html"), "utf8");
const server = await readFile(join(here, "server.ts"), "utf8");
const roadmapCli = await readFile(join(here, "..", "pm-roadmap", "pm-roadmap.ts"), "utf8");
const roadmapOps = await readFile(join(here, "..", "pm-roadmap", "ops.ts"), "utf8");

const canonicalSections = [
  "Scope & Inheritance",
  "Surface Type & Craft Profile",
  "Product Context",
  "UX Model",
  "Data & State Model",
  "Interaction Model",
  "Visual System",
  "Component Rules",
  "Responsive & Accessibility",
  "Performance & Formatting",
  "Microcopy",
  "Do / Don't",
  "Implementation Bridge",
  "Decision Log & Open Questions",
];

assert.deepEqual(
  [...contract.matchAll(/^## (.+)$/gm)].map((match) => match[1]),
  canonicalSections,
  "design-contract.md must use the canonical Full Product Craft section order",
);
assert.match(contract, /Task Desk/, "the approved interface concept must be durable");
for (const screen of ["Now", "Tasks", "Task Workspace", "Item detail", "People", "Inbox \/ Health"]) {
  assert.match(contract, new RegExp(`\\b${screen.replace(" / ", " \\/ ")}\\b`), `missing approved screen: ${screen}`);
}
assert.match(contract, /currentPlan/, "the current-plan read model must be explicit");
assert.match(contract, /expectedOwner/, "collaboration conflict protection must be explicit");
assert.doesNotMatch(contract, /focus\.txt|\/api\/focus|\binFlight\b/, "legacy focus and inFlight contracts must be removed");
assert.match(dashboard, /currentPlan/, "the dashboard must consume the structured current-plan model");

for (const view of ["now", "tasks", "task", "item", "people", "health"]) {
  assert.match(dashboard, new RegExp(`data-view=["']${view}["']`), `dashboard must expose the ${view} route`);
}
for (const tab of ["overview", "work", "history", "context"]) {
  assert.match(dashboard, new RegExp(`["']${tab}["']`), `Task Workspace must expose the ${tab} tab`);
}
for (const endpoint of [
  "/api/actor",
  "/api/current-plan/next",
  "/api/tasks",
  "/api/roadmap/validate",
  "/api/inbox",
  "/claim",
  "/release",
  "/handoff",
  "/reprioritize",
  "/reorder",
  "/depend",
]) {
  assert.match(dashboard, new RegExp(endpoint.replaceAll("/", "\\/")), `dashboard must use ${endpoint}`);
}
assert.match(dashboard, /<dialog\b/, "destructive and handoff flows must use a native dialog");
assert.match(dashboard, /history\.pushState/, "navigation must use query routes with browser history");
assert.match(dashboard, /addEventListener\(["']popstate["']/, "query routes must restore with browser navigation");
assert.match(dashboard, /--page:\s*#f4f7f9/, "the approved Task Desk page token must be implemented");
assert.match(dashboard, /--accent:\s*#0f766e/, "the approved Task Desk accent must be implemented");
for (const breakpoint of ["1279px", "959px", "639px"]) {
  assert.match(dashboard, new RegExp(breakpoint), `dashboard must implement the ${breakpoint} responsive boundary`);
}
assert.match(dashboard, /prefers-reduced-motion:\s*reduce/, "reduced-motion behavior must be implemented");
assert.match(dashboard, /data-region=["']task-rail["']/, "desktop Task navigation must be present");
assert.match(dashboard, /data-region=["']context-rail["']/, "desktop Task-wide context must be present");
assert.match(dashboard, /data-testid=["']global-search["']/, "global search must remain visible and addressable");
assert.match(dashboard, /expectedOwner/, "release and handoff must carry the rendered owner guard");
assert.doesNotMatch(dashboard, /location\.hash|hashchange|href=["']#\//, "dashboard routing must not use hash state");
assert.match(
  dashboard,
  /copyPrompt\("\/api\/current-plan\/next", event\.currentTarget, "Resume prompt copied to clipboard"\)/,
  "current-plan resume must provide distinct clipboard success feedback",
);
assert.match(
  dashboard,
  /copyPrompt\(`\/api\/roadmap\/\$\{item\.id\}\/next`, event\.currentTarget, item\.plan \? "Resume prompt copied to clipboard" : "Kickoff prompt copied to clipboard"\)/,
  "Item detail must provide resume or kickoff clipboard feedback without changing prompt bytes",
);
assert.match(
  dashboard,
  /copyPrompt\(`\/api\/roadmap\/\$\{item\.id\}\/next`, event\.currentTarget, "Kickoff prompt copied to clipboard"\)/,
  "planless work-row kickoff must provide kickoff clipboard feedback",
);
assert.match(
  dashboard,
  /async function copyPrompt\(endpoint, button, successMessage\)/,
  "copyPrompt must accept presentation-only success feedback separately from the prompt payload",
);
assert.match(
  dashboard,
  /const prompt = await api\(endpoint\);[\s\S]*navigator\.clipboard\.writeText\(prompt\); announce\(successMessage\);/,
  "copyPrompt must preserve the fetched prompt bytes and vary only its success feedback",
);
for (const [name, source] of [["dashboard", dashboard], ["server", server], ["CLI", roadmapCli], ["ops", roadmapOps]] as const) {
  assert.doesNotMatch(source, /focus\.txt|\/api\/focus|focusSet|focusClear|\binFlight\b/, `${name} retains legacy runtime behavior`);
}

console.log("roadmap contract test: PASS");
