import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { decodePng, encodePng, crop } from "./tiles.mjs";

function chunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  payload.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}

function fixture(width, height, colorType, rows, extra = []) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = colorType;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    ...extra, chunk("IDAT", deflateSync(Buffer.from(rows))), chunk("IEND", Buffer.alloc(0))]);
}

test("all five PNG row filters recover the original RGBA pixels", () => {
  // Each row contains the same two pixels; the residuals exercise left, up and Paeth.
  const raw = [10, 20, 30, 255, 40, 50, 60, 128];
  const rows = [0, ...raw, 1, 10, 20, 30, 255, 30, 30, 30, 129,
    2, 0, 0, 0, 0, 0, 0, 0, 0,
    3, 5, 10, 15, 128, 15, 15, 15, 193,
    4, 0, 0, 0, 0, 0, 0, 0, 0];
  const image = decodePng(fixture(2, 5, 6, rows));
  assert.deepEqual(image.pixels, Buffer.from(Array(5).fill(raw).flat()));
  const region = crop(image, { x: 1, y: 1, width: 1, height: 3 });
  assert.deepEqual(region.pixels, Buffer.from(Array(3).fill(raw.slice(4)).flat()));
  assert.deepEqual(decodePng(encodePng(region)), region);
});

test("RGB, grayscale, grayscale alpha and indexed PNGs preserve transparency", () => {
  assert.deepEqual([...decodePng(fixture(1, 1, 2, [0, 7, 8, 9])).pixels], [7, 8, 9, 255]);
  assert.deepEqual([...decodePng(fixture(1, 1, 0, [0, 7], [chunk("tRNS", Buffer.from([0, 7]))])).pixels], [7, 7, 7, 0]);
  assert.deepEqual([...decodePng(fixture(1, 1, 4, [0, 7, 80])).pixels], [7, 7, 7, 80]);
  const palette = chunk("PLTE", Buffer.from([7, 8, 9]));
  assert.deepEqual([...decodePng(fixture(1, 1, 3, [0, 0], [palette, chunk("tRNS", Buffer.from([30]))])).pixels], [7, 8, 9, 30]);
  assert.deepEqual([...decodePng(fixture(1, 1, 2, [0, 7, 8, 9], [chunk("tRNS", Buffer.from([0, 7, 0, 8, 0, 9]))])).pixels], [7, 8, 9, 0]);
});

test("invalid PNGs and out-of-bounds crops fail explicitly", () => {
  const png = fixture(1, 1, 6, [0, 1, 2, 3, 255]);
  const broken = Buffer.from(png);
  broken[29] ^= 1;
  assert.throws(() => decodePng(broken), /CRC/);
  assert.throws(() => decodePng(png.subarray(0, -5)), /truncated|IEND/i);
  assert.throws(() => decodePng(Buffer.from("not a PNG")), /PNG/);
  assert.throws(() => crop(decodePng(png), { x: 1, y: 0, width: 1, height: 1 }), /bounds/);
  assert.throws(() => crop(decodePng(png), { x: 0, y: 0, width: 0, height: 1 }), /positive/);
  const header = Buffer.from(png.subarray(16, 29));
  header[12] = 1;
  const interlaced = Buffer.concat([png.subarray(0, 8), chunk("IHDR", header), png.subarray(33)]);
  assert.throws(() => decodePng(interlaced), /non-interlaced 8-bit/);
});

test("cropping preserves colour interpretation chunks", () => {
  const gamma = Buffer.alloc(4);
  gamma.writeUInt32BE(45455);
  const source = decodePng(fixture(1, 1, 6, [0, 10, 20, 30, 255], [chunk("gAMA", gamma)]));
  const output = decodePng(encodePng(crop(source, { x: 0, y: 0, width: 1, height: 1 })));
  assert.deepEqual(output.colorChunks, [{ type: "gAMA", data: gamma }]);
});

test("CLI grid and region outputs keep exact source pixels at edge tiles", async () => {
  const dir = await mkdtemp(join(tmpdir(), "craft-tiles-"));
  try {
    const pixels = Buffer.from(Array.from({ length: 3 * 2 * 4 }, (_, i) => i * 9));
    const input = join(dir, "input image.png");
    await writeFile(input, fixture(3, 2, 6, [0, ...pixels.subarray(0, 12), 0, ...pixels.subarray(12)]));
    const run = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL("tiles.mjs", import.meta.url)), input, ...args], { encoding: "utf8" });
    const grid = run(join(dir, "grid"), "--tile", "2x1");
    assert.equal(grid.status, 0, grid.stderr);
    const report = JSON.parse(grid.stdout);
    assert.equal(report.tiles.length, 4);
    for (const tile of report.tiles) {
      const decoded = decodePng(await readFile(tile.path));
      assert.deepEqual(decoded, crop({ width: 3, height: 2, pixels }, tile));
    }
    const region = run(join(dir, "region"), "--region", "1,0,2,2");
    assert.equal(region.status, 0, region.stderr);
    assert.deepEqual(decodePng(await readFile(JSON.parse(region.stdout).tiles[0].path)).pixels,
      Buffer.concat([pixels.subarray(4, 12), pixels.subarray(16, 24)]));
    const bad = run(join(dir, "bad"), "--tile", "0x1");
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /positive/);
    assert.deepEqual((await readdir(dir)).sort(), ["grid", "input image.png", "region"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
