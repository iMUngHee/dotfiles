import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  for (let bit = 0; bit < 8; bit++) i = (i >>> 1) ^ ((i & 1) ? 0xedb88320 : 0);
  return i >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  result.write(type, 4, 4, "ascii");
  data.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4);
  return result;
}

export function decodePng(bytes) {
  if (!bytes.subarray(0, 8).equals(signature)) throw new Error("Invalid PNG signature");
  let header, palette, transparency;
  const compressed = [];
  const colorChunks = [];
  let ended = false;
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) throw new Error("Truncated PNG chunk");
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error("Truncated PNG chunk");
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, end - 4);
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw new Error(`PNG CRC mismatch: ${type}`);
    if (!header && type !== "IHDR") throw new Error("PNG must start with IHDR");
    if (type === "IHDR") {
      if (header || length !== 13) throw new Error("Invalid PNG IHDR");
      header = data;
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") transparency = data;
    else if (["gAMA", "cHRM", "sRGB", "iCCP"].includes(type)) colorChunks.push({ type, data });
    else if (type === "IDAT") compressed.push(data);
    else if (type === "IEND") { ended = true; break; }
    else if ((bytes[offset + 4] & 32) === 0) throw new Error(`Unsupported PNG critical chunk: ${type}`);
    offset = end;
  }
  if (!header || !ended || !compressed.length) throw new Error("PNG missing IHDR, IDAT or IEND");
  const width = header.readUInt32BE(0), height = header.readUInt32BE(4);
  const colorType = header[9];
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (header[8] !== 8 || !channels || header[10] || header[11] || header[12]) {
    throw new Error("Only non-interlaced 8-bit grayscale, RGB, indexed, grayscale-alpha and RGBA PNGs are supported");
  }
  // Bound both decompression and the expanded RGBA allocation for untrusted images.
  if (!width || !height || width * height > 64 * 1024 * 1024) throw new Error("PNG dimensions exceed the 64-megapixel limit");
  if (colorType === 3 && (!palette || !palette.length || palette.length % 3 || palette.length > 768)) throw new Error("Invalid PNG palette");
  if (transparency && ((colorType === 0 && transparency.length !== 2) || (colorType === 2 && transparency.length !== 6) ||
    (colorType === 3 && transparency.length > palette.length / 3) || colorType === 4 || colorType === 6)) throw new Error("Invalid PNG transparency");
  const stride = width * channels;
  const scan = inflateSync(Buffer.concat(compressed), { maxOutputLength: (stride + 1) * height });
  if (scan.length !== (stride + 1) * height) throw new Error("Invalid PNG scanline length");
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = scan[y * (stride + 1)];
    if (filter > 4) throw new Error(`Invalid PNG filter: ${filter}`);
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const a = x >= channels ? raw[i - channels] : 0;
      const b = y ? raw[i - stride] : 0;
      const c = y && x >= channels ? raw[i - stride - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      if (filter === 2) predictor = b;
      if (filter === 3) predictor = Math.floor((a + b) / 2);
      if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      raw[i] = scan[y * (stride + 1) + x + 1] + predictor;
    }
  }
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0, p = 0; i < raw.length; i += channels, p += 4) {
    let r, g, b, a = 255;
    if (colorType === 3) {
      const index = raw[i];
      if (index * 3 + 2 >= palette.length) throw new Error("PNG palette index out of range");
      [r, g, b] = palette.subarray(index * 3, index * 3 + 3);
      a = transparency?.[index] ?? 255;
    } else if (colorType === 0 || colorType === 4) {
      r = g = b = raw[i];
      if (colorType === 4) a = raw[i + 1];
      else if (transparency && raw[i] === transparency.readUInt16BE(0)) a = 0;
    } else {
      [r, g, b] = raw.subarray(i, i + 3);
      if (colorType === 6) a = raw[i + 3];
      else if (transparency && r === transparency.readUInt16BE(0) && g === transparency.readUInt16BE(2) && b === transparency.readUInt16BE(4)) a = 0;
    }
    pixels[p] = r; pixels[p + 1] = g; pixels[p + 2] = b; pixels[p + 3] = a;
  }
  return { width, height, pixels, ...(colorChunks.length ? { colorChunks } : {}) };
}

export function encodePng({ width, height, pixels, colorChunks = [] }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const scan = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) pixels.copy(scan, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([signature, chunk("IHDR", header), ...colorChunks.map(({ type, data }) => chunk(type, data)),
    chunk("IDAT", deflateSync(scan)), chunk("IEND", Buffer.alloc(0))]);
}

export function crop(image, { x, y, width, height }) {
  if (![x, y, width, height].every(Number.isSafeInteger) || x < 0 || y < 0 || width <= 0 || height <= 0) throw new Error("Region requires nonnegative integer coordinates and positive integer dimensions");
  if (x + width > image.width || y + height > image.height) throw new Error("Region is outside image bounds");
  const pixels = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row++) {
    const start = ((y + row) * image.width + x) * 4;
    image.pixels.copy(pixels, row * width * 4, start, start + width * 4);
  }
  return { width, height, pixels, ...(image.colorChunks ? { colorChunks: image.colorChunks } : {}) };
}

async function main(args) {
  const usage = "Usage: node tiles.mjs input.png output-dir [--tile 1024x1024 | --region x,y,width,height]";
  if (args.length === 1 && args[0] === "--help") { console.log(usage); return; }
  const [input, output, option, value] = args;
  if (!input || !output || ![2, 4].includes(args.length) || (option && !["--tile", "--region"].includes(option))) throw new Error(usage);
  const image = decodePng(await readFile(input));
  const regions = [];
  if (option === "--region") {
    if (!/^\d+,\d+,\d+,\d+$/.test(value)) throw new Error("Region must be x,y,width,height");
    const [x, y, width, height] = value.split(",").map(Number);
    const region = { x, y, width, height };
    crop(image, region);
    regions.push(region);
  } else {
    const dimensions = value ?? "1024x1024";
    if (!/^\d+x\d+$/.test(dimensions)) throw new Error("Tile size must be WIDTHxHEIGHT");
    const [width, height] = dimensions.split("x").map(Number);
    if (![width, height].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error("Tile dimensions must be positive integers");
    for (let y = 0; y < image.height; y += height) for (let x = 0; x < image.width; x += width) {
      regions.push({ x, y, width: Math.min(width, image.width - x), height: Math.min(height, image.height - y) });
    }
  }
  await mkdir(output, { recursive: true });
  const tiles = [];
  for (const region of regions) {
    const path = resolve(join(output, `tile-${region.x}-${region.y}.png`));
    if (path === resolve(input)) throw new Error("Output would overwrite the source PNG");
    await writeFile(path, encodePng(crop(image, region)));
    tiles.push({ ...region, path });
  }
  console.log(JSON.stringify({ input: resolve(input), width: image.width, height: image.height, tiles }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
