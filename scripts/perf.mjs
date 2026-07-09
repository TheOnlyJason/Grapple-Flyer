// Headless performance benchmark: run the real built bundle through gameplay
// frames on a full-size canvas and report frame times, plus a per-layer
// micro-bench of the background renderer. Numbers are skia-backed (not mobile
// WebKit), so treat them as RELATIVE — for before/after comparisons.
//
// CAVEAT: @napi-rs/canvas snapshots the source surface on every
// canvas-to-canvas drawImage, so the sprite-cache render paths (clouds, glow
// auras, moon) read 10-50x slower here than in GPU-backed browsers, where
// sprite blits are the FAST path (Chromium measured a locked 120fps).
// Trust this harness for math/path-heavy layers (dunes, stars, forest) and
// allocation regressions; do not read sprite-path numbers as real.
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";

const root = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(root, "..", "dist", "assets");
const bundle = readdirSync(assetsDir).find((f) => f.endsWith(".js"));
if (!bundle) {
  console.error("No built bundle. Run `npm run build` first.");
  process.exit(1);
}

const DPR = 2;
const W = 1280;
const H = 720;

const gameCanvas = createCanvas(W * DPR, H * DPR);
const handlers = new Map();
Object.assign(gameCanvas, {
  style: {},
  addEventListener: (t, fn) => {
    const a = handlers.get(t) || [];
    a.push(fn);
    handlers.set(t, a);
  },
  removeEventListener() {},
  setPointerCapture() {},
  releasePointerCapture() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
});

function dispatch(type, ev = {}) {
  for (const fn of handlers.get(type) || []) fn({ preventDefault() {}, ...ev });
}

const boot = { classList: { add() {}, remove() {} }, remove() {} };

let rafCb = null;
globalThis.requestAnimationFrame = (cb) => {
  rafCb = cb;
  return 1;
};
globalThis.cancelAnimationFrame = () => {};
globalThis.window = {
  innerWidth: W,
  innerHeight: H,
  devicePixelRatio: DPR,
  addEventListener: (t, fn) => {
    const a = handlers.get(t) || [];
    a.push(fn);
    handlers.set(t, a);
  },
  removeEventListener() {},
};
globalThis.document = {
  getElementById: (id) => (id === "game" ? gameCanvas : boot),
  createElement: (tag) =>
    tag === "canvas"
      ? createCanvas(300, 150)
      : { relList: { supports: () => true } },
  querySelectorAll: () => [],
  addEventListener() {},
};
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.localStorage = {
  store: {},
  getItem(k) {
    return this.store[k] ?? null;
  },
  setItem(k, v) {
    this.store[k] = String(v);
  },
};

await import(path.join(assetsDir, bundle));
const game = globalThis.window.GALE;
if (!game) throw new Error("game instance not exposed on window.GALE");

let t = 0;
function tick(n, dtMs = 16.6) {
  const times = [];
  for (let i = 0; i < n; i++) {
    t += dtMs;
    const cb = rafCb;
    rafCb = null;
    const a = performance.now();
    cb(t);
    times.push(performance.now() - a);
  }
  return times;
}

function stats(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  const pick = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return {
    avg: sum / s.length,
    p50: pick(0.5),
    p95: pick(0.95),
    max: s[s.length - 1],
  };
}
const fmt = (o) =>
  `avg ${o.avg.toFixed(2)}ms  p50 ${o.p50.toFixed(2)}ms  p95 ${o.p95.toFixed(2)}ms  max ${o.max.toFixed(2)}ms`;

// --- Full-frame benchmark through real gameplay -----------------------------
tick(30); // menu warmup
dispatch("pointerdown", { clientX: 400, clientY: 300, pointerId: 1 });
tick(10);
// Alternate swing-hold / release so the run keeps going and exercises
// tether + trail + particles + collectibles.
const HOLD = 40;
const GLIDE = 30;
tick(120); // JIT warmup during play
const frames = [];
for (let c = 0; c < 10; c++) {
  dispatch("pointerdown", { clientX: 400, clientY: 300, pointerId: 1 });
  frames.push(...tick(HOLD));
  dispatch("pointerup", { clientX: 400, clientY: 300, pointerId: 1 });
  frames.push(...tick(GLIDE));
}
console.log(`gameplay frames (${frames.length}):  ${fmt(stats(frames))}`);

// --- Per-layer micro-bench ---------------------------------------------------
const ctx = gameCanvas.getContext("2d");
ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
const bg = game.background;
const cam = game.camera;
const time = game.time;
const layers = [
  ["drawSky", () => bg.drawSky(ctx, cam, time)],
  ["drawSkyClouds", () => bg.drawSkyClouds(ctx, cam, time)],
  ["drawMountains", () => bg.drawMountains(ctx, cam)],
  ["drawFar", () => bg.drawFar(ctx, cam, time)],
  ["drawMid", () => bg.drawMid(ctx, cam)],
  ["drawSea", () => bg.drawSea(ctx, cam, time)],
  ["drawForeground", () => bg.drawForeground(ctx, cam, time)],
  ["drawAmbient", () => bg.drawAmbient(ctx, cam, time)],
];
const REPS = 300;
for (const [name, fn] of layers) {
  if (typeof bg[name.replace("draw", "draw")] !== "function") continue;
  for (let i = 0; i < 30; i++) fn(); // warmup
  const a = performance.now();
  for (let i = 0; i < REPS; i++) fn();
  const ms = (performance.now() - a) / REPS;
  console.log(`layer ${name.padEnd(15)} ${ms.toFixed(3)} ms`);
}
console.log("done");
