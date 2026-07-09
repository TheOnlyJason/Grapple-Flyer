// Generate the app icons (home-screen / PWA / favicon) from a self-contained
// GALE scene — dawn sky, silhouetted peaks and a paper-plane glyph with a wind
// streak. No game code imported, so this stays fast and dependency-free.
//
//   node scripts/icons.mjs
//
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(root, "..", "public");
mkdirSync(outDir, { recursive: true });

// Draw a paper-plane dart in a local unit space (nose at +x), centered at 0.
function drawPlane(ctx, cx, cy, k, angle, streaks) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.scale(k, k);

  if (streaks) {
    ctx.strokeStyle = "rgba(238,243,255,0.42)";
    ctx.lineCap = "round";
    for (const [oy, len, w] of [
      [-0.42, 1.25, 0.11],
      [0.05, 1.7, 0.14],
      [0.48, 1.15, 0.11],
    ]) {
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(-1.05, oy);
      ctx.lineTo(-1.05 - len, oy);
      ctx.stroke();
    }
  }

  // Upper wing (bright).
  ctx.beginPath();
  ctx.moveTo(1.15, 0);
  ctx.lineTo(-1.0, -0.78);
  ctx.lineTo(-0.42, 0);
  ctx.closePath();
  ctx.fillStyle = "#eef3ff";
  ctx.fill();

  // Lower wing (shaded, for the folded-paper read).
  ctx.beginPath();
  ctx.moveTo(1.15, 0);
  ctx.lineTo(-1.0, 0.78);
  ctx.lineTo(-0.42, 0);
  ctx.closePath();
  ctx.fillStyle = "#b7c2ec";
  ctx.fill();

  // Center fold.
  ctx.beginPath();
  ctx.moveTo(1.15, 0);
  ctx.lineTo(-0.42, 0);
  ctx.strokeStyle = "rgba(28,36,74,0.35)";
  ctx.lineWidth = 0.045;
  ctx.stroke();

  ctx.restore();
}

function drawIcon(S, { maskable = false } = {}) {
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext("2d");

  // Dawn sky.
  const sky = ctx.createLinearGradient(0, 0, 0, S);
  sky.addColorStop(0, "#10214f");
  sky.addColorStop(0.46, "#46509a");
  sky.addColorStop(0.72, "#f0a36a");
  sky.addColorStop(1, "#ffd9a8");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, S, S);

  // Stars.
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  for (const [x, y, r] of [
    [0.2, 0.17, 0.011],
    [0.33, 0.27, 0.006],
    [0.68, 0.14, 0.009],
    [0.83, 0.25, 0.006],
    [0.52, 0.11, 0.007],
  ]) {
    ctx.beginPath();
    ctx.arc(x * S, y * S, r * S, 0, Math.PI * 2);
    ctx.fill();
  }

  // Sun glow.
  const sunX = 0.5 * S;
  const sunY = 0.66 * S;
  const sunR = 0.3 * S;
  const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR);
  glow.addColorStop(0, "rgba(255,242,214,0.95)");
  glow.addColorStop(1, "rgba(255,242,214,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
  ctx.fill();

  // Silhouetted peaks along the bottom.
  ctx.fillStyle = "#161a44";
  ctx.beginPath();
  ctx.moveTo(0, S);
  ctx.lineTo(0, 0.8 * S);
  ctx.lineTo(0.22 * S, 0.87 * S);
  ctx.lineTo(0.41 * S, 0.75 * S);
  ctx.lineTo(0.6 * S, 0.89 * S);
  ctx.lineTo(0.78 * S, 0.73 * S);
  ctx.lineTo(S, 0.85 * S);
  ctx.lineTo(S, S);
  ctx.closePath();
  ctx.fill();

  // Paper plane. Keep it well within the maskable safe zone for that variant.
  if (maskable) {
    drawPlane(ctx, S * 0.5, S * 0.47, S * 0.15, -0.5, false);
  } else {
    drawPlane(ctx, S * 0.53, S * 0.44, S * 0.19, -0.5, true);
  }

  return canvas.toBuffer("image/png");
}

const targets = [
  ["icon-192.png", 192, {}],
  ["icon-512.png", 512, {}],
  ["icon-512-maskable.png", 512, { maskable: true }],
  ["apple-touch-icon.png", 180, {}],
  ["favicon-32.png", 32, {}],
];

for (const [name, size, opts] of targets) {
  writeFileSync(path.join(outDir, name), drawIcon(size, opts));
  console.log("wrote public/" + name);
}

// --- Native source assets for @capacitor/assets (iOS icon + launch screen) ---
// `npx @capacitor/assets generate --ios` slices these into every required
// AppIcon / splash size. The icon must be fully opaque (no alpha, no rounded
// corners — iOS applies the mask itself); drawIcon already fills edge-to-edge.
function drawSplash(S, dark) {
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, S);
  if (dark) {
    g.addColorStop(0, "#141a3e");
    g.addColorStop(1, "#05070f");
  } else {
    g.addColorStop(0, "#1a2150");
    g.addColorStop(1, "#0a0d24");
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  // Soft dawn glow so the launch screen echoes the game.
  const glow = ctx.createRadialGradient(
    S * 0.5,
    S * 0.52,
    0,
    S * 0.5,
    S * 0.52,
    S * 0.34
  );
  glow.addColorStop(0, "rgba(240,163,106,0.22)");
  glow.addColorStop(1, "rgba(240,163,106,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, S, S);

  // Centered paper plane, kept small so it survives any launch aspect ratio.
  drawPlane(ctx, S * 0.5, S * 0.5, S * 0.12, -0.5, true);
  return canvas.toBuffer("image/png");
}

const assetsDir = path.join(root, "..", "assets");
mkdirSync(assetsDir, { recursive: true });
writeFileSync(path.join(assetsDir, "icon.png"), drawIcon(1024, {}));
writeFileSync(path.join(assetsDir, "splash.png"), drawSplash(2732, false));
writeFileSync(path.join(assetsDir, "splash-dark.png"), drawSplash(2732, true));
console.log("wrote assets/icon.png, assets/splash.png, assets/splash-dark.png");

console.log("done");
