// Contact sheets of the tether in motion, for eyeballing the swing physics:
//   node scripts/swing-strip.mjs
// Writes screenshots/swing-<name>.png: 4x4 crops every 50 ms around the anchor
// for an ordinary swing, a loop-the-loop on a short rope, and a moving anchor,
// all with the pause-menu option Conserve momentum on (the pendulum).
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

const W = 1280;
const H = 720;
const DPR = 2;

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
    tag === "canvas" ? createCanvas(300, 150) : { relList: { supports: () => true } },
  querySelectorAll: () => [],
  addEventListener() {},
};
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.localStorage = {
  // A returning player: the first-flight tutorial is done (scripts/tutorial-probe.mjs covers it).
  store: { "gale.save.v1": JSON.stringify({ tutorialDone: true }) },
  getItem(k) {
    return this.store[k] ?? null;
  },
  setItem(k, v) {
    this.store[k] = String(v);
  },
};

await import(path.join(assetsDir, bundle));
// The READY / GO intro before a run is off here (it changes nothing in the run
// itself); GALE_INTRO=1 keeps it. scripts/daily-probe.mjs checks it.
if (globalThis.window.GALE_CONFIG?.intro && process.env.GALE_INTRO !== "1") globalThis.window.GALE_CONFIG.intro.seconds = 0;
const game = globalThis.window.GALE;
if (!game) throw new Error("game instance not exposed on window.GALE");

let t = 0;
function tick(n, dtMs = 1000 / 120) {
  for (let i = 0; i < n; i++) {
    t += dtMs;
    const cb = rafCb;
    rafCb = null;
    cb(t);
  }
}

const player = game.player;
player.conserveMomentum = true; // these sheets show the pendulum
const world = game.world;
const CFG = globalThis.window.GALE_CONFIG;
tick(20);
game.time = 0.4 * 95;
dispatch("pointerdown", { clientX: 400, clientY: 300, pointerId: 1 });
tick(30);
dispatch("pointerup", { clientX: 400, clientY: 300, pointerId: 1 });
tick(2);
if (game.state !== "playing") throw new Error("expected playing, got " + game.state);
const Anchor = world.anchors[0].constructor;
let staged = null;
function quiet() {
  world.genX = player.x + 1e6;
  world.hazards.length = 0; world.powerups.length = 0; world.collectibles.length = 0;
  world.anchors.length = 0;
  if (staged) world.anchors.push(staged);
}
function placeSwing(a, L, phi, omega) {
  player.anchor = a; player.state = "swing";
  player.ropeLen = L; player.swingPhi = phi; player.swingOmega = omega; player.swingTime = 0;
  player.x = a.x + L * Math.sin(phi); player.y = a.yAt(game.time) + L * Math.cos(phi);
  player.vx = L * omega * Math.cos(phi); player.vy = a.vyAt(game.time) - L * omega * Math.sin(phi);
  player.trail.length = 0;
  game.camera.snapTo(player.x, player.y);
  dispatch("pointerdown", { clientX: 400, clientY: 300, pointerId: 1 });
}
function sheet(name, a, every = 6) {
  const COLS = 4, ROWS = 4, CW = 520, CH = 340;
  const canvas = createCanvas(COLS * CW, ROWS * CH);
  const c = canvas.getContext("2d");
  for (let shot = 0; shot < COLS * ROWS; shot++) {
    for (let i = 0; i < every; i++) { quiet(); tick(1); }
    const cam = game.camera;
    const sx = (a.x - cam.x) * cam.zoom - CW / 2;
    const sy = (a.y - cam.y) * cam.zoom - CH / 2 + 60;
    const col = shot % COLS, row = Math.floor(shot / COLS);
    c.drawImage(gameCanvas, sx * DPR, sy * DPR, CW * DPR, CH * DPR, col * CW, row * CH, CW, CH);
    c.fillStyle = "#fff"; c.font = "bold 18px sans-serif";
    c.fillText(`+${Math.round(shot * every * (1000 / 120))}ms  v=${Math.round(player.speed)}  L=${Math.round(player.ropeLen)}`, col * CW + 10, row * CH + 24);
    c.strokeStyle = "#444"; c.strokeRect(col * CW + 0.5, row * CH + 0.5, CW - 1, CH - 1);
  }
  const out = path.join(outDir, `swing-${name}.png`);
  writeFileSync(out, canvas.toBuffer("image/png"));
  console.log("wrote", path.relative(path.join(root, ".."), out));
}

// 1. An ordinary swing: grabbed at 60° up, 600 px/s, 300 px rope.
let a = (staged = new Anchor(player.x + 400, player.y - 200));
quiet();
placeSwing(a, 300, -1.05, 600 / 300);
sheet("swing", a);
dispatch("pointerup", { clientX: 400, clientY: 300, pointerId: 1 });

// 2. A loop-the-loop: 150 px rope at 1300 px/s.
a = staged = new Anchor(player.x + 400, player.y - 100);
quiet();
placeSwing(a, 150, 0, 1300 / 150);
sheet("loop", a, 3);
dispatch("pointerup", { clientX: 400, clientY: 300, pointerId: 1 });

// 3. Riding a moving anchor through its fastest stretch.
a = staged = new Anchor(player.x + 400, player.y - 150, "moving", { amp: 130, phase: 0, speed: 1.6 });
quiet();
placeSwing(a, 260, 0.6, 500 / 260);
sheet("moving", a);
dispatch("pointerup", { clientX: 400, clientY: 300, pointerId: 1 });
