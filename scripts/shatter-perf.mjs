// Cost of the shatter effect: time Hazard.draw in isolation for three rocks —
// intact, mid crack-flash, and as tumbling pieces — plus the per-step update.
//   node scripts/shatter-perf.mjs
// skia-backed numbers (path fills/strokes, which this harness measures
// faithfully) — read them RELATIVE to the intact rock.
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";

const root = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(root, "..", "dist", "assets");
const bundle = readdirSync(assetsDir).find((f) => f.endsWith(".js"));
if (!bundle) throw new Error("No built bundle. Run `npm run build` first.");

const DPR = 2, W = 1280, H = 720;
const gameCanvas = createCanvas(W * DPR, H * DPR);
const handlers = new Map();
Object.assign(gameCanvas, {
  style: {},
  addEventListener: (t, fn) => { const a = handlers.get(t) || []; a.push(fn); handlers.set(t, a); },
  removeEventListener() {}, setPointerCapture() {}, releasePointerCapture() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
});
const dispatch = (type, ev = {}) => { for (const fn of handlers.get(type) || []) fn({ preventDefault() {}, ...ev }); };
const boot = { classList: { add() {}, remove() {} }, remove() {} };
let rafCb = null;
globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
globalThis.cancelAnimationFrame = () => {};
globalThis.window = { innerWidth: W, innerHeight: H, devicePixelRatio: DPR,
  addEventListener: (t, fn) => { const a = handlers.get(t) || []; a.push(fn); handlers.set(t, a); }, removeEventListener() {} };
globalThis.document = {
  getElementById: (id) => (id === "game" ? gameCanvas : boot),
  createElement: (tag) => (tag === "canvas" ? createCanvas(300, 150) : { relList: { supports: () => true } }),
  querySelectorAll: () => [], addEventListener() {},
};
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.localStorage = { store: {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = String(v); } };

await import(path.join(assetsDir, bundle));
const game = globalThis.window.GALE;
let t = 0;
const tick = (n, dtMs = 1000 / 120) => { for (let i = 0; i < n; i++) { t += dtMs; const cb = rafCb; rafCb = null; cb(t); } };

tick(20);
game.time = 0.4 * 95;
dispatch("pointerdown", { clientX: 400, clientY: 300, pointerId: 1 });
tick(30);
dispatch("pointerup", { clientX: 400, clientY: 300, pointerId: 1 });
tick(2);
const player = game.player;
player.vx = 360; player.vy = 0; // cruise, so the scene barely changes between windows
for (const a of game.world.anchors) a.y -= 2000;

// A fresh run starts rock-free, so fly on until the world has made three.
for (let i = 0; i < 12000 && game.world.hazards.length < 3; i++) {
  for (const a of game.world.anchors) a.y = -99999;
  game.world.powerups.length = 0;
  player.state = "glide"; player.y = -900; player.vy = 0; player.vx = 900;
  tick(1);
}
player.vx = 360; player.y = 0;
// Three rocks parked in view, well above the flight line.
const mine = game.world.hazards.slice(0, 3);
if (mine.length < 3) throw new Error("need 3 generated rocks, got " + mine.length);
mine.forEach((h, i) => { h.x = player.x + 260 + i * 170; h.y = player.y - 230 + i * 30; });
tick(1); // one real frame so each rock has drawn (and recorded its rotation)

const ctx = game.ctx;
const cam = game.camera;
const N = 4000;
function timeDraw(label) {
  ctx.save();
  cam.apply(ctx);
  for (let i = 0; i < 200; i++) for (const h of mine) h.draw(ctx, game.time); // warm up
  const s = performance.now();
  for (let i = 0; i < N; i++) for (const h of mine) h.draw(ctx, game.time);
  const us = ((performance.now() - s) * 1000) / (N * mine.length);
  ctx.restore();
  console.log(`${label.padEnd(26)} ${us.toFixed(1)} us per rock per frame`);
  return us;
}

const intact = timeDraw("intact rock");
for (const h of mine) h.break_(player.x, player.y, 1300, 0);
const shards = mine.reduce((n, h) => n + h.shards.length, 0);
const flash = timeDraw("shattered, crack flash");
for (let i = 0; i < 36; i++) for (const h of mine) h.update(1 / 120); // +0.3 s: pieces flying, flash over
const flying = timeDraw("shattered, pieces flying");

const s0 = performance.now();
const STEPS = 200000;
for (let i = 0; i < STEPS; i++) mine[0].update(1e-9); // negligible dt: stays mid-flight
const upd = ((performance.now() - s0) * 1e6) / STEPS;

console.log(`${shards} pieces across 3 rocks`);
console.log(`update: ${upd.toFixed(0)} ns per rock per physics step`);
console.log(`worst case (3 rocks at once): +${(Math.max(flash, flying) * 3 / 1000 - intact * 3 / 1000).toFixed(3)} ms per frame over intact rocks`);
