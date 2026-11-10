import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const extensions = new Set([".css", ".scss", ".sass", ".less", ".js", ".jsx", ".ts", ".tsx", ".html", ".vue", ".svelte", ".xaml", ".axaml", ".slint", ".rs", ".go", ".cs", ".swift", ".kt", ".dart", ".py", ".qml"]);
const skipped = new Set(["node_modules", ".git", "target", "dist", "build", "bin", "obj", ".agents"]);

export function census(sources) {
  const buckets = Object.fromEntries(["colors", "fontSizes", "fontWeights", "radii", "spacing"].map(key => [key, new Map()]));
  for (const { path, text } of sources) {
    // Preserve offsets so every finding points to its original source line.
    const source = text.replace(/\/\*[\s\S]*?\*\/|<!--[^]*?-->|(^|\n)[ \t]*\/\/[^\n]*/g, match => match.replace(/[^\n]/g, " "));
    const lineStarts = [0];
    for (let i = 0; i < source.length; i++) if (source[i] === "\n") lineStarts.push(i + 1);
    const add = (category, value, offset) => {
      let low = 0, high = lineStarts.length;
      while (low + 1 < high) {
        const mid = (low + high) >>> 1;
        if (lineStarts[mid] <= offset) low = mid; else high = mid;
      }
      const entry = buckets[category].get(value) ?? { value, count: 0, locations: [] };
      entry.count++;
      entry.locations.push({ path, line: low + 1, column: offset - lineStarts[low] + 1 });
      buckets[category].set(value, entry);
    };
    for (const match of source.matchAll(/#[\da-f]{8}\b|#[\da-f]{6}\b|#[\da-f]{4}\b|#[\da-f]{3}\b|rgba?\([^)]*\)/gi)) {
      const literal = match[0];
      let value;
      if (literal.startsWith("#")) {
        let hex = literal.slice(1).toLowerCase();
        if (hex.length === 3 || hex.length === 4) hex = [...hex].map(c => c + c).join("");
        // XAML-family toolkits and QML write eight-digit colours alpha first, in markup and in code strings.
        if (hex.length === 8 && [".xaml", ".axaml", ".cs", ".qml"].includes(extname(path).toLowerCase())) hex = hex.slice(2) + hex.slice(0, 2);
        value = `#${hex.endsWith("ff") && hex.length === 8 ? hex.slice(0, 6) : hex}`;
      } else {
        const parts = literal.slice(literal.indexOf("(") + 1, -1).trim().split(/[\s,/]+/);
        if (parts.length < 3 || parts.length > 4 || parts.some(p => !/^\d*\.?\d+%?$/.test(p))) continue;
        const rgb = parts.slice(0, 3).map(p => Math.round(Number.parseFloat(p) * (p.endsWith("%") ? 2.55 : 1)));
        const alpha = parts[3] === undefined ? 255 : Math.round(Number.parseFloat(parts[3]) * (parts[3].endsWith("%") ? 2.55 : 255));
        if (rgb.some(n => n > 255) || alpha > 255) continue;
        value = `#${[...rgb, ...(alpha === 255 ? [] : [alpha])].map(n => n.toString(16).padStart(2, "0")).join("")}`;
      }
      add("colors", value, match.index);
    }
    for (const match of source.matchAll(/\bColor\.From(Argb|Rgb)\s*\(([^()]*)\)/gi)) {
      const parts = match[2].split(",").map(p => p.trim());
      const hasAlpha = match[1].toLowerCase() === "argb";
      if (parts.length !== (hasAlpha ? 4 : 3) || parts.some(p => !/^(?:0x[\da-f]+|\d+)$/i.test(p))) continue;
      const channels = parts.map(Number);
      if (channels.some(n => n > 255)) continue;
      const alpha = hasAlpha ? channels.shift() : 255;
      add("colors", `#${[...channels, ...(alpha === 255 ? [] : [alpha])].map(n => n.toString(16).padStart(2, "0")).join("")}`, match.index);
    }
    for (const match of source.matchAll(/\bnew\s+(?:\w+\.)*(Thickness|CornerRadius)\s*\(([^()]*)\)/gi)) {
      const parts = match[2].split(",").map(p => p.trim());
      if (![1, 2, 4].includes(parts.length) || parts.some(p => !/^-?(?:\d*\.)?\d+$/.test(p))) continue;
      for (const part of parts) add(match[1].toLowerCase() === "thickness" ? "spacing" : "radii", String(Number(part)), match.index);
    }
    const declarations = /\b["']?((?:font[-_]?(?:size|weight)|border[\w-]*radius|corner[-_]?radius|radius|(?:margin|padding)[\w-]*|(?:row|column)[-_]?gap|gap|(?:horizontal|vertical|row|column)?spacing))["']?\s*[:=]\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^;,{}\n<>]+))/gi;
    for (const match of source.matchAll(declarations)) {
      const name = match[1].replace(/[-_]/g, "").toLowerCase();
      let category;
      if (name === "fontsize") category = "fontSizes";
      else if (name === "fontweight") category = "fontWeights";
      else if (/^(?:border.*radius|cornerradius|radius)$/.test(name)) category = "radii";
      else if (/^(?:margin|padding)(?:top|right|bottom|left|inline|block|inlinestart|inlineend|blockstart|blockend)?$/.test(name) ||
        /^(?:gap|rowgap|columngap|spacing|horizontalspacing|verticalspacing|rowspacing|columnspacing)$/.test(name)) category = "spacing";
      if (!category) continue;
      let value = (match[2] ?? match[3] ?? match[4]).trim();
      if (category === "fontWeights") {
        value = value.replace(/^FontWeights\./, "");
        value = ({ normal: "400", regular: "400", medium: "500", semibold: "600", bold: "700", black: "900", light: "300", thin: "100" })[value.toLowerCase()] ?? value;
      }
      if (!/^-?(?:\d*\.)?\d+(?:px|pt|em|rem|%|vh|vw)?(?:[\s,]+-?(?:\d*\.)?\d+(?:px|pt|em|rem|%|vh|vw)?)*$/i.test(value)) continue;
      for (const part of value.matchAll(/-?(?:\d*\.)?\d+(?:px|pt|em|rem|%|vh|vw)?/gi)) {
        const [, number, unit] = part[0].match(/^(-?[\d.]+)(.*)$/);
        add(category, `${Number(number)}${unit.toLowerCase()}`, match.index);
      }
    }
  }
  const categories = Object.fromEntries(Object.entries(buckets).map(([key, values]) => [key, [...values.values()].sort((a, b) => a.value.localeCompare(b.value, "en"))]));
  const nearDuplicates = [], singletons = [];
  for (const [category, values] of Object.entries(categories)) {
    for (const entry of values) if (entry.count === 1) singletons.push({ category, ...entry });
    for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) {
      const a = values[i].value, b = values[j].value;
      let distance;
      if (category === "colors") {
        const rgba = value => (value.length === 7 ? value + "ff" : value).slice(1).match(/../g).map(c => Number.parseInt(c, 16));
        const first = rgba(a), second = rgba(b);
        if (first[3] !== second[3]) continue;
        distance = Math.hypot(...first.slice(0, 3).map((c, k) => c - second[k]));
        if (distance > 12) continue;
      } else {
        if (a.replace(/[-\d.]/g, "") !== b.replace(/[-\d.]/g, "")) continue;
        distance = Math.abs(Number.parseFloat(a) - Number.parseFloat(b));
        if (distance > 1) continue;
      }
      nearDuplicates.push({ category, values: [a, b], distance: Number(distance.toFixed(3)) });
    }
  }
  return { files: sources.map(s => s.path), categories, nearDuplicates, singletons };
}

async function main(args) {
  const usage = "Usage: node style-census.mjs [--json] path [path ...]";
  if (args.length === 1 && args[0] === "--help") {
    console.log(`${usage}\nDefault: category counts and up to 20 near-duplicates/singletons each (first location). --json: all findings and locations.\nReports hex/rgb(a)/Color.FromArgb colours, literal style assignments, Thickness and CornerRadius constructors. Near-duplicate thresholds: RGB distance <= 12 (same alpha); numeric difference <= 1 (same unit). Source heuristics do not resolve expressions, tokens or inherited/computed styles.`);
    return;
  }
  const paths = args.filter(arg => arg !== "--json");
  if (!paths.length || paths.some(arg => arg.startsWith("--"))) throw new Error(usage);
  const files = new Set();
  const visit = async path => {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      for (const entry of (await readdir(path)).sort()) if (!skipped.has(entry)) await visit(join(path, entry));
    } else if (stat.isFile() && extensions.has(extname(path).toLowerCase())) files.add(await realpath(path));
  };
  for (const path of paths) await visit(resolve(path));
  const sources = await Promise.all([...files].sort().map(async path => ({ path, text: await readFile(path, "utf8") })));
  const report = census(sources);
  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Files: ${report.files.length} (literal source scan; tokens and computed styles unresolved)`);
    for (const [category, values] of Object.entries(report.categories)) {
      console.log(`${category}: ${values.map(({ value, count }) => `${value} ×${count}`).join(", ") || "—"}`);
    }
    console.log(`nearDuplicates (${report.nearDuplicates.length}):`);
    for (const entry of report.nearDuplicates.slice(0, 20)) console.log(`  ${entry.category}: ${entry.values.join(" ≈ ")} (distance ${entry.distance})`);
    if (report.nearDuplicates.length > 20) console.log(`  ${report.nearDuplicates.length - 20} more; use --json`);
    console.log(`singletons (${report.singletons.length}):`);
    for (const entry of report.singletons.slice(0, 20)) {
      const { path, line, column } = entry.locations[0];
      console.log(`  ${entry.category}: ${entry.value} — ${path}:${line}:${column}`);
    }
    if (report.singletons.length > 20) console.log(`  ${report.singletons.length - 20} more; use --json`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
