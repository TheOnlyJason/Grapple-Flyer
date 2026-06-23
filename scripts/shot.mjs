// Render real frames of the built bundle to PNGs using @napi-rs/canvas, so the
// graphics can be eyeballed without a browser.
import { readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";

const root = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(root, "..", "dist", "assets");
const outDir = path.join(root, "..", "screenshots");
mkdirSync(outDir, { recursive: true });
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
  createElement: () => ({ relList: { supports: () => true } }),
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
  for (let i = 0; i < n; i++) {
    t += dtMs;
    const cb = rafCb;
    rafCb = null;
    cb(t);
  }
}
function save(name) {
  const buf = gameCanvas.toBuffer("image/png");
  const p = path.join(outDir, name + ".png");
  writeFileSync(p, buf);
  console.log("wrote", path.relative(path.join(root, ".."), p));
}

// Warm up so the world is generated, then sample each time-of-day mood.
tick(20);
const CYCLE = 95;
const moods = [
  ["dawn", 0.0],
  ["day", 0.2],
  ["golden", 0.4],
  ["dusk", 0.6],
  ["night", 0.8],
];
for (const [name, p] of moods) {
  game.time = p * CYCLE;
  tick(1);
  save("mood-" + name);
}

// A gameplay shot mid-swing at golden hour.
game.time = 0.4 * CYCLE;
dispatch("pointerdown", { clientX: 400, clientY: 300, pointerId: 1 });
tick(46);
save("play-golden");

// And one deeper into a run at dusk.
game.time = 0.6 * CYCLE;
for (let c = 0; c < 4; c++) {
  dispatch("pointerup", { clientX: 400, clientY: 300, pointerId: 1 });
  tick(22);
  dispatch("pointerdown", { clientX: 400, clientY: 300, pointerId: 1 });
  tick(34);
}
game.time = 0.6 * CYCLE;
tick(2);
save("play-dusk");

console.log("done");
