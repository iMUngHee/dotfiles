import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { census } from "./style-census.mjs";

test("three near-identical greys and a singleton are reported with source locations", () => {
  const report = census([{ path: "styles.css", text: ".a { color: #888; padding: 8px; }\n.b { color: #898989; padding: 8px; }\n.c { color: #8a8a8a; border-radius: 7px; }" }]);
  assert.deepEqual(report.categories.colors.map(x => x.value), ["#888888", "#898989", "#8a8a8a"]);
  assert.equal(report.nearDuplicates.filter(x => x.category === "colors").length, 3);
  assert.equal(report.categories.spacing[0].count, 2);
  const radius = report.singletons.find(x => x.category === "radii");
  assert.equal(radius.value, "7px");
  assert.equal(radius.locations[0].line, 3);
});

test("CSS, JSX, XAML, Slint and Rust/Go string style literals share categories", () => {
  const report = census([
    { path: "a.css", text: "a { font-size: 16px; font-weight: 400; border-radius: 4px; margin: 0 8px; color: rgb(136, 136, 136); }" },
    { path: "b.tsx", text: 'const s = { fontSize: 16, fontWeight: "normal", borderRadius: 4, paddingInline: "8px", color: "#888888" };' },
    { path: "c.xaml", text: '<TextBlock FontSize="17" FontWeight="Bold" Foreground="#FF888888" Margin="8,0,8,0" CornerRadius="4" />' },
    { path: "d.slint", text: 'font-size: 16px; font-weight: 700; border-radius: 4px; spacing: 8px; color: #888;' },
    { path: "e.rs", text: 'let css = r#"font_size: 18; padding: 9px; color: #898989;"#;' },
    { path: "f.go", text: 'css := `font-size: 18px; gap: 8px; color: rgba(136,136,136,1);`' },
  ]);
  assert.equal(report.files.length, 6);
  assert.equal(report.categories.colors.find(x => x.value === "#888888").count, 5);
  assert.equal(report.categories.fontWeights.find(x => x.value === "400").count, 2);
  assert.equal(report.categories.fontWeights.find(x => x.value === "700").count, 2);
  assert.ok(report.categories.fontSizes.find(x => x.value === "16px"));
  assert.ok(report.categories.fontSizes.find(x => x.value === "16"));
  assert.ok(report.nearDuplicates.find(x => x.category === "spacing" && x.values.includes("9px")));
});

test("comments, dynamic values and unrelated source numbers are excluded", () => {
  const report = census([{ path: "a.tsx", text: '// color: #123456\n/* padding: 99px */\nconst version = 123; const id = "#thing"; const s = { fontSize: theme.size, padding: token(8), color: "var(--ink)" };' }]);
  for (const values of Object.values(report.categories)) assert.deepEqual(values, []);
});

test("CLI walks supported source files, deduplicates paths and skips dependency folders", async () => {
  const dir = await mkdtemp(join(tmpdir(), "craft-census-"));
  try {
    await mkdir(join(dir, "node_modules"));
    await writeFile(join(dir, "a.css"), "a { color: #888; padding: 8px; }");
    await writeFile(join(dir, "b.tsx"), 'const s = { color: "#898989", fontSize: 16 };');
    await writeFile(join(dir, "notes.md"), "color: #ffffff");
    await writeFile(join(dir, "node_modules", "ignored.css"), "a { color: #ffffff; }");
    const run = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL("style-census.mjs", import.meta.url)), ...args], { encoding: "utf8" });
    const output = run(dir, join(dir, "a.css"));
    assert.equal(output.status, 0, output.stderr);
    const report = JSON.parse(output.stdout);
    assert.equal(report.files.length, 2);
    assert.equal(report.categories.colors.length, 2);
    assert.equal(report.categories.colors[0].count, 1);
    const bad = run(join(dir, "missing"));
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
