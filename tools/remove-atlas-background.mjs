import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const [inputArg, outputArg] = process.argv.slice(2);

if (!inputArg || !outputArg) {
  throw new Error("Usage: node tools/remove-atlas-background.mjs <input.png> <output.png>");
}

const input = resolve(inputArg);
const output = resolve(outputArg);
const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const pixelCount = width * height;
const visited = new Uint8Array(pixelCount);
const queue = new Int32Array(pixelCount);
let readIndex = 0;
let writeIndex = 0;

function isCanvasPixel(pixelIndex) {
  const offset = pixelIndex * channels;
  const red = data[offset] ?? 0;
  const green = data[offset + 1] ?? 0;
  const blue = data[offset + 2] ?? 0;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;

  return maximum - minimum <= 13 && luminance >= 207;
}

function enqueue(pixelIndex) {
  if (pixelIndex < 0 || pixelIndex >= pixelCount || visited[pixelIndex] || !isCanvasPixel(pixelIndex)) {
    return;
  }

  visited[pixelIndex] = 1;
  queue[writeIndex] = pixelIndex;
  writeIndex += 1;
}

for (let x = 0; x < width; x += 1) {
  enqueue(x);
  enqueue((height - 1) * width + x);
}

for (let y = 0; y < height; y += 1) {
  enqueue(y * width);
  enqueue(y * width + width - 1);
}

while (readIndex < writeIndex) {
  const pixelIndex = queue[readIndex];
  readIndex += 1;
  if (pixelIndex === undefined) continue;

  const x = pixelIndex % width;
  const y = Math.floor(pixelIndex / width);
  if (x > 0) enqueue(pixelIndex - 1);
  if (x + 1 < width) enqueue(pixelIndex + 1);
  if (y > 0) enqueue(pixelIndex - width);
  if (y + 1 < height) enqueue(pixelIndex + width);
}

for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
  if (!visited[pixelIndex]) continue;
  data[pixelIndex * channels + 3] = 0;
}

await sharp(data, { raw: info }).png({ compressionLevel: 9, palette: false }).toFile(output);

process.stdout.write(`removed ${writeIndex} connected canvas pixels from ${width}x${height}\n`);
