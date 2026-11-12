// Difficulty bot.   node scripts/difficulty-bot.mjs    (after `npm run build`)
// A bot flies RUNS runs in a row (one save, so the assist sees its own
// recent runs) and reports how far they get. Compare the ramps:
//   LEGACY=1   the 1.2 ramp (linear, at its hardest by 650 m)
//   NOASSIST=1 the new curve without the assist
//   (neither)  the new curve with the assist
// P = the share of releases timed for the gold window (skill), RUNS, SEED.
//   decay : launch like a release and report how long the smash stays available
//   ahead : put a meteor N px ahead of a launch — smashed, or run over?
//   bot   : a bot plays with varying release skill; how often is the smash
//           charged, and how do meteor contacts end?
// Same no-op canvas mocks as smoke.mjs (logic only, no rendering).
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(root, "..", "dist", "assets");
const bundle = readdirSync(assetsDir).find((f) => f.endsWith(".js"));
if (!bundle) {
  console.error("No built bundle found. Run `npm run build` first.");
  process.exit(1);
}

// --- Canvas 2D context mock (no-op, but gradients return usable objects) ---
const gradient = { addColorStop() {} };
const ctxMock = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === "createLinearGradient" || prop === "createRadialGradient")
        return () => gradient;
      if (prop === "measureText") return () => ({ width: 10 });
      // data props read back as themselves; methods are no-ops.
      return typeof prop === "string" &&
        /^[a-z]/.test(prop) &&
        ![
          "fillStyle",
          "strokeStyle",
          "lineWidth",
          "font",
          "textAlign",
          "textBaseline",
          "globalAlpha",
          "lineCap",
          "lineJoin",
        ].includes(prop)
        ? () => {}
        : undefined;
    },
    set() {
      return true;
    },
  }
);

const handlers = new Map();
function makeEl() {
  return {
    width: 1280,
    height: 720,
    style: {},
    classList: { add() {}, remove() {} },
    remove() {},
    setPointerCapture() {},
    releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    getContext: () => ctxMock,
    addEventListener: (type, fn) => {
      const arr = handlers.get(type) || [];
      arr.push(fn);
      handlers.set(type, arr);
    },
    removeEventListener() {},
  };
}
function dispatch(type, ev = {}) {
  for (const fn of handlers.get(type) || []) fn({ preventDefault() {}, ...ev });
}

const canvas = makeEl();
const boot = makeEl();

let rafCb = null;
globalThis.requestAnimationFrame = (cb) => {
  rafCb = cb;
  return 1;
};
globalThis.cancelAnimationFrame = () => {};
globalThis.window = {
  innerWidth: 1280,
  innerHeight: 720,
  devicePixelRatio: 2,
  addEventListener: (type, fn) => {
    const arr = handlers.get(type) || [];
    arr.push(fn);
    handlers.set(type, arr);
  },
  removeEventListener() {},
};
globalThis.document = {
  getElementById: (id) => (id === "game" ? canvas : boot),
  // Canvas-ish element for offscreen sprite caches; link stub satisfies
  // Vite's modulepreload polyfill so it short-circuits.
  createElement: (tag) =>
    tag === "canvas" ? makeEl() : { relList: { supports: () => true } },
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
globalThis.setTimeout = globalThis.setTimeout || ((fn) => fn());

await import(path.join(assetsDir, bundle));
// The READY / GO intro before a run is off here (it changes nothing in the run
// itself); GALE_INTRO=1 keeps it. scripts/daily-probe.mjs checks it.
if (globalThis.window.GALE_CONFIG?.intro && process.env.GALE_INTRO !== "1") globalThis.window.GALE_CONFIG.intro.seconds = 0;

const game = globalThis.window.GALE;
if (!game) throw new Error("game instance not exposed on window.GALE");

const C = globalThis.window.GALE_CONFIG;
if (process.env.LEGACY === "1") C.difficulty.legacy = true;
if (process.env.NOASSIST === "1") C.difficulty.assistMax = 0;
if (process.env.NONE) C.difficulty.assistNone = Number(process.env.NONE); // try other thresholds
if (process.env.FULL) C.difficulty.assistFull = Number(process.env.FULL);
game.enterMenu(); // the menu's world again, with the settings above
const player = game.player;
let t = 0;
function frame() {
  t += 1000 / 120;
  const cb = rafCb;
  rafCb = null;
  cb(t);
}
const tap = (type) => dispatch(type, { clientX: 640, clientY: 360, pointerId: 1 });
for (let i = 0; i < 20; i++) frame();
const P = Number(process.env.P ?? 0.5);
const RUNS = Number(process.env.RUNS ?? 40);
let seed = Number(process.env.SEED ?? 777);
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const results = [];
for (let r = 0; r < RUNS; r++) {
  for (let i = 0; i < 600 && game.state !== "playing"; i++) {
    if (i % 60 === 30) tap("pointerdown");
    if (i % 60 === 32) tap("pointerup");
    frame();
  }
  tap("pointerup");
  frame();
  const assist = game.runAssist ?? 0;
  let holding = false, swingFrames = 0, lastRelease = -1e9, goPerfect = true, sloppy = 0, frames = 0;
  while (game.state === "playing" && frames < 120 * 900) {
    if (player.state === "glide" && !holding) {
      const target = t - lastRelease > 380 ? player.findGrabTarget(game.world.anchors, game.camera) : null;
      if (target && target.x > player.x + 30) { tap("pointerdown"); holding = true; swingFrames = 0; goPerfect = rnd() < P; sloppy = Math.floor(rnd() * 30); }
    } else if (holding) {
      swingFrames++;
      const up = player.vx > 0 && player.vy < 0;
      const want = player.state === "swing" && (goPerfect ? player.inPerfectWindow : up && --sloppy < 0);
      if (want || swingFrames > 360 || (player.state !== "swing" && swingFrames > 6)) { tap("pointerup"); holding = false; lastRelease = t; }
    }
    frame();
    frames++;
  }
  if (holding) tap("pointerup");
  results.push({ dist: Math.floor(game.distance), assist });
  while (game.state === "crashing") frame();
}
const ds = results.map((x) => x.dist).sort((a, b) => a - b);
const q = (f) => ds[Math.floor(f * (ds.length - 1))];
const avg = ds.reduce((a, b) => a + b, 0) / ds.length;
const assisted = results.filter((x) => x.assist > 0);
const mode = process.env.LEGACY === "1" ? "1.2 ramp" : process.env.NOASSIST === "1" ? "new curve" : "new + assist";
console.log(`${mode.padEnd(13)} P=${P} | ${RUNS} runs | distance p25 ${q(0.25)} m, median ${q(0.5)} m, p75 ${q(0.75)} m, max ${q(1)} m, mean ${avg.toFixed(0)} m | assisted ${assisted.length} runs (mean ${assisted.length ? ((assisted.reduce((a, b) => a + b.assist, 0) / assisted.length) * 100).toFixed(0) : 0}%)`);
