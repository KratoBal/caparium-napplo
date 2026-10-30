// The web app's icons from the logo (Lili 2026-10-31, task caparium-webapp-ikon, card 135b457e): node scripts/make-app-icons.mjs <logo.png>
// The logo is a rounded tile with transparent corners. iOS and Android round an icon themselves, so a transparent corner would show as a white
// or black wedge: the art is cropped to the largest square whose four corners are opaque (the tile's rounded corners fall outside it), and the
// icons are that square at full bleed. The maskable icon keeps the art inside the safe zone (the middle 80 %) on a background made of the
// art itself, blurred. Output: public/icons/*.png and the colour the manifest uses.
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const src = process.argv[2];
if (!src) throw new Error("usage: node scripts/make-app-icons.mjs <logo.png>");
const out = new URL("../public/icons/", import.meta.url).pathname;
await mkdir(out, { recursive: true });

const img = sharp(src).ensureAlpha();
const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const alpha = (x, y) => data[(y * width + x) * channels + 3];
// the tile's box: the rows and columns that hold an opaque pixel
let x0 = width, y0 = height, x1 = 0, y1 = 0;
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++)
    if (alpha(x, y) > 250) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
// the smallest inset from the tile's box at which the four corners and their 3 px neighbourhood are opaque
const opaque = (x, y) => {
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (alpha(x + dx, y + dy) < 255) return false;
  return true;
};
let inset = 0;
while (inset < 400 && !(opaque(x0 + inset, y0 + inset) && opaque(x1 - inset, y0 + inset) && opaque(x0 + inset, y1 - inset) && opaque(x1 - inset, y1 - inset))) inset++;
inset += 6; // a little more, so no anti-aliased edge pixel is left in a corner
const side = Math.min(x1 - x0 + 1, y1 - y0 + 1) - 2 * inset;
const left = Math.round((x0 + x1 + 1) / 2 - side / 2);
const top = Math.round((y0 + y1 + 1) / 2 - side / 2);
console.log(`tile ${x0},${y0}-${x1},${y1}; inset ${inset}; square ${side} at ${left},${top}`);
const art = await sharp(src).extract({ left, top, width: side, height: side }).flatten({ background: "#1d7f8c" }).png().toBuffer();

const square = (size) => sharp(art).resize(size, size, { kernel: "lanczos3" }).png({ compressionLevel: 9 });
await square(180).toFile(out + "apple-touch-icon.png");
await square(192).toFile(out + "icon-192.png");
await square(512).toFile(out + "icon-512.png");
await square(32).toFile(out + "icon-32.png");

// maskable: the art at 84 % in the middle, faded out in a circle (the ring of the logo lies inside the safe zone, the corner gears do not), the rest the art blurred and stretched to the whole icon
const M = 512;
const inner = Math.round(M * 0.84);
const background = await sharp(art).resize(M, M).blur(24).modulate({ brightness: 0.95 }).png().toBuffer();
// the art's edge fades out in a circle (opaque to 93 % of the radius), so the mask's circle meets the blurred background without a seam
const fade = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${inner}" height="${inner}"><defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0.93" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
);
const innerArt = await sharp(art).resize(inner, inner, { kernel: "lanczos3" }).composite([{ input: fade, blend: "dest-in" }]).png().toBuffer();
await sharp(background).composite([{ input: innerArt, left: Math.round((M - inner) / 2), top: Math.round((M - inner) / 2) }]).removeAlpha().png({ compressionLevel: 9 }).toFile(out + "maskable-512.png");

// the colour of the manifest and of the status bar: the average of the art's rim, a strip 4 % wide on every side
const strip = Math.round(side * 0.04);
const rim = await Promise.all([
  sharp(art).extract({ left: 0, top: 0, width: side, height: strip }).stats(),
  sharp(art).extract({ left: 0, top: side - strip, width: side, height: strip }).stats(),
  sharp(art).extract({ left: 0, top: 0, width: strip, height: side }).stats(),
  sharp(art).extract({ left: side - strip, top: 0, width: strip, height: side }).stats(),
]);
const mean = [0, 1, 2].map((c) => Math.round(rim.reduce((s, r) => s + r.channels[c].mean, 0) / rim.length));
console.log("rim colour", "#" + mean.map((v) => v.toString(16).padStart(2, "0")).join(""));
