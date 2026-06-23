// Strip black background, flip to face right, trim, and write game-ready PNG.
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] ||
  path.join(
    root,
    "..",
    "..",
    ".cursor/projects/Users-jasondai-Grapple-Flyer/assets/Gemini_Generated_Image_3g3cph3g3cph3g3c__1_-3d736fb8-be8f-4e30-9375-c9da15fd88f4.png"
  );
const out = path.join(root, "..", "public", "assets", "paper-airplane.png");

const img = await loadImage(src);
const w = img.width;
const h = img.height;
const scratch = createCanvas(w, h);
const sctx = scratch.getContext("2d");
sctx.drawImage(img, 0, 0);
const px = sctx.getImageData(0, 0, w, h);
const d = px.data;

for (let i = 0; i < d.length; i += 4) {
  const r = d[i];
  const g = d[i + 1];
  const b = d[i + 2];
  // Remove near-black background.
  if (r < 28 && g < 28 && b < 28) {
    d[i + 3] = 0;
    continue;
  }
  // Shift lavender toward game cyan-blue while keeping facet contrast.
  const lum = (r + g + b) / 3;
  const t = Math.min(1, lum / 220);
  d[i] = Math.round(45 + t * 30 + (r - lum) * 0.15);
  d[i + 1] = Math.round(130 + t * 50 + (g - lum) * 0.15);
  d[i + 2] = Math.round(200 + t * 40 + (b - lum) * 0.15);
}

sctx.putImageData(px, 0, 0);

// Flip horizontal so nose points right.
const flipped = createCanvas(w, h);
const fctx = flipped.getContext("2d");
fctx.translate(w, 0);
fctx.scale(-1, 1);
fctx.drawImage(scratch, 0, 0);

// Trim transparent padding.
const trimmed = fctx.getImageData(0, 0, w, h);
const td = trimmed.data;
let minX = w,
  minY = h,
  maxX = 0,
  maxY = 0;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const a = td[(y * w + x) * 4 + 3];
    if (a > 8) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
}
const pad = 4;
minX = Math.max(0, minX - pad);
minY = Math.max(0, minY - pad);
maxX = Math.min(w - 1, maxX + pad);
maxY = Math.min(h - 1, maxY + pad);
const tw = maxX - minX + 1;
const th = maxY - minY + 1;

const final = createCanvas(tw, th);
const finalCtx = final.getContext("2d");
finalCtx.drawImage(flipped, minX, minY, tw, th, 0, 0, tw, th);

writeFileSync(out, final.toBuffer("image/png"));
console.log("wrote", out, `${tw}x${th}`);
