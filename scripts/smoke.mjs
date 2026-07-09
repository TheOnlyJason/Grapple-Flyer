// Headless runtime smoke test: mock just enough DOM/Canvas to run the real
// built bundle through hundreds of frames while simulating input, and fail
// loudly on any thrown error or NaN in the player state.
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
  store: {},
  getItem(k) {
    return this.store[k] ?? null;
  },
  setItem(k, v) {
    this.store[k] = String(v);
  },
};
globalThis.setTimeout = globalThis.setTimeout || ((fn) => fn());

await import(path.join(assetsDir, bundle));

const game = globalThis.window.GALE;
if (!game) throw new Error("game instance not exposed on window.GALE");

const failures = [];
function assert(cond, msg) {
  if (!cond) failures.push(msg);
}
function finite(v) {
  return typeof v === "number" && Number.isFinite(v);
}

// Drive frames. Timestamps advance ~16.6ms/frame. Guards against NaN each frame.
let t = 0;
function tick(n, dtMs = 16.6) {
  for (let i = 0; i < n; i++) {
    t += dtMs;
    if (!rafCb) throw new Error("game stopped scheduling frames");
    const cb = rafCb;
    rafCb = null;
    cb(t);
    const p = game.player;
    if (!finite(p.x) || !finite(p.y) || !finite(p.vx) || !finite(p.vy)) {
      throw new Error(
        `player went non-finite: x=${p.x} y=${p.y} vx=${p.vx} vy=${p.vy}`
      );
    }
  }
}

// 1) Menu frames.
tick(20);
assert(game.state === "menu", `expected menu state, got ${game.state}`);
// 2) Start the run + hold to swing (pointerdown).
dispatch("pointerdown", { clientX: 400, clientY: 300, pointerId: 1 });
tick(8);
assert(game.state === "playing", `run did not start (state=${game.state})`);
const startX = game.player.x;
let sawSwing = false;
for (let i = 0; i < 112; i++) {
  tick(1);
  if (game.player.state === "swing") sawSwing = true;
}
assert(sawSwing, "player never entered the swing state while holding near an anchor");
// 3) Release -> slingshot.
dispatch("pointerup", { clientX: 400, clientY: 300, pointerId: 1 });
tick(60);
assert(game.player.x > startX, "player did not make forward progress");
// 4) A few grab/release cycles.
for (let c = 0; c < 6; c++) {
  dispatch("pointerdown", { clientX: 400, clientY: 300, pointerId: 1 });
  tick(45);
  dispatch("pointerup", { clientX: 400, clientY: 300, pointerId: 1 });
  tick(35);
}
// 5) Trigger a dash via keyboard.
dispatch("keydown", { code: "KeyD" });
tick(60);
// 6) Run long enough to likely die and reach gameover, then restart.
tick(1200);
dispatch("pointerdown", { clientX: 400, clientY: 300, pointerId: 1 });
tick(5);
dispatch("pointerup", { clientX: 400, clientY: 300, pointerId: 1 });
tick(120);

// Final assertions: a run was recorded and distance accrued.
assert(game.distance > 0, "distance never increased");
assert(
  game.storage.data.runs > 0,
  "no run was recorded to storage after death/restart"
);

if (failures.length) {
  console.error("SMOKE FAILED:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log(
  `SMOKE OK: ran ~${Math.round(t / 16.6)} frames | ` +
    `peak distance ${Math.floor(game.distance)}m | runs ${game.storage.data.runs} | ` +
    `swing verified, no NaN`
);
