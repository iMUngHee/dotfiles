// Install as scripts/agents-build.mjs. Requires Node 22.16 or later.
import * as fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

process.chdir(path.dirname(import.meta.dirname));
const stat = (file) => fs.lstatSync(file, { throwIfNoEntry: false });
const read = (file) => fs.readFileSync(file, "utf8");

function entries(dir, optional = true) {
  const info = stat(dir);
  if (!info && optional) return [];
  if (!info?.isDirectory()) throw new Error(`Expected a directory: ${dir}`);
  return fs.readdirSync(dir).sort();
}

function source(file) {
  if (!stat(file)?.isFile()) throw new Error(`Expected a regular source file: ${file}`);
  return read(file);
}

function scoped(text, name) {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  if (lines[0] !== "---") return text;
  const end = lines.indexOf("---", 1);
  if (end < 3 || lines[1] !== "paths:") throw new Error(`Invalid paths header: ${name}`);
  const patterns = lines.slice(2, end).map((line) => {
    const match = /^\s+-\s+(?:"([^"]+)"|'([^']+)'|([^'"\s].*?))\s*$/.exec(line);
    if (!match) throw new Error(`Invalid path pattern: ${name}`);
    return match[1] ?? match[2] ?? match[3];
  });
  return `Scope: ${patterns.join(", ")}\n\n${lines.slice(end + 1).join("\n")}`;
}

function build(check) {
  entries(".ai", false);
  const project = source(".ai/PROJECT.md");
  const rules = entries(".ai/rules").filter((name) => name.endsWith(".md"));
  const bodies = rules.map((name) => scoped(source(`.ai/rules/${name}`), name));
  const skills = entries(".ai/skills");
  for (const name of skills) {
    entries(`.ai/skills/${name}`, false);
    source(`.ai/skills/${name}/SKILL.md`);
  }

  const edits = [];
  for (const [file, origin, body] of [
    ["CLAUDE.md", ".ai/PROJECT.md", project],
    ["AGENTS.md", ".ai/PROJECT.md and .ai/rules", [project, ...bodies].join("\n\n")],
  ]) {
    const header = `<!-- AUTO-GENERATED from ${origin} by node scripts/agents-build.mjs -->\n`;
    const info = stat(file);
    if (info && !info.isFile()) throw new Error(`Conflicting file: ${file}`);
    const old = info ? read(file) : undefined;
    if (info && !old.startsWith(header)) throw new Error(`Handwritten file: ${file}`);
    if (old !== header + body) edits.push({ file, content: header + body });
  }

  for (const [dir, src, names, type] of [
    [".claude/rules", ".ai/rules", rules, "file"],
    [".agents/skills", ".ai/skills", skills, "dir"],
    [".claude/skills", ".ai/skills", skills, "dir"],
  ]) {
    entries(path.dirname(dir));
    const existing = entries(dir);
    const wanted = new Set(names);
    for (const name of new Set([...names, ...existing])) {
      const file = path.join(dir, name);
      const target = path.relative(dir, path.join(src, name));
      const info = stat(file);
      const owned = info?.isSymbolicLink() && fs.readlinkSync(file).split(path.sep).join("/") === target.split(path.sep).join("/");
      if (wanted.has(name)) {
        if (info && !owned) throw new Error(`Conflicting link destination: ${file}`);
        if (!info) edits.push({ file, target, type });
      } else if (owned && (type === "dir" || name.endsWith(".md"))) {
        edits.push({ file, remove: true });
      }
    }
  }

  for (const edit of edits) {
    console.log(edit.file);
    if (check) continue;
    if (edit.remove) {
      fs.unlinkSync(edit.file);
    } else if (edit.target) {
      fs.mkdirSync(path.dirname(edit.file), { recursive: true });
      fs.symlinkSync(edit.target, edit.file, edit.type);
    } else {
      const temp = `${edit.file}.${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temp, edit.content, { flag: "wx" });
        fs.renameSync(temp, edit.file);
      } finally {
        fs.rmSync(temp, { force: true });
      }
    }
  }
  if (check && edits.length) process.exitCode = 1;
}

try {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 1 && args[0] === "--check")) throw new Error("Usage: node scripts/agents-build.mjs [--check]");
  build(args[0] === "--check");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
