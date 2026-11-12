// Render a contact sheet of a meteor smash so the shatter animation can be
// eyeballed headlessly:  node scripts/shatter-strip.mjs [tag] [W] [H] [mode]
//   mode = "speed" (default: fly into the rock above smashSpeed) | "dash"
//   mood = time-of-day fraction, 0.4 golden hour (default), 0.8 night
// Writes screenshots/shatter-<tag>.png — a 4x4 grid of crops around the rock,
// one every 50 ms, starting just before impact.
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

const [tag = "speed", wArg = "1280", hArg = "720", mode = "speed", moodArg = "0.4"] = process.argv.slice(2);
const DPR = 2;
const W = Number(wArg);
const H = Number(hArg);

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

// Warm up, start a run, let go of the tether so the player free-flies.
tick(20);
game.time = Number(moodArg) * 95; // 0.4 = golden hour, 0.8 = night
dispatch("pointerdown", { clientX: 400, clientY: 300, pointerId: 1 });
tick(30);
dispatch("pointerup", { clientX: 400, clientY: 300, pointerId: 1 });
tick(2);
if (game.state !== "playing") throw new Error("expected playing, got " + game.state);

// Stage the collision: park one rock dead ahead of the player and clear the rest.
const player = game.player;
const rocks = game.world.hazards;
// A fresh run starts rock-free, so fly on (high, out of harm's way) until one exists.
for (let i = 0; i < 12000 && rocks.length === 0; i++) {
  for (const a of game.world.anchors) a.y -= 2000;
  game.world.powerups.length = 0;
  player.state = "glide"; player.y = -900; player.vy = 0; player.vx = 900;
  tick(1);
}
player.y = 0;
tick(2);
if (rocks.length === 0) throw new Error("no hazards generated");
const rock = rocks[0];
rocks.length = 1;
const gap = mode === "dash" ? 60 : 110;
rock.x = player.x + rock.rx + gap;
rock.y = player.y;
player.vy = 0;
if (mode === "dash") {
  player.vx = 1550;
  player.hazardInvuln = 0.7;
} else {
  player.vx = 1300; // above CONFIG.player.smashSpeed (1050)
  player.hazardInvuln = 0;
}
for (const a of game.world.anchors) a.y -= 2000; // nothing to latch onto
const focusX = rock.x;
const focusY = rock.y;

// Capture crops around the rock every 50 ms.
const COLS = 4;
const ROWS = 4;
const CW = 520; // crop size in CSS px
const CH = 340;
const sheet = createCanvas(COLS * CW, ROWS * CH);
const sctx = sheet.getContext("2d");
sctx.fillStyle = "#000";
sctx.fillRect(0, 0, sheet.width, sheet.height);
let shots = 0;
let destroyedAt = -1;
let frame = 0;
function capture() {
  const cam = game.camera;
  const sx = (focusX - cam.x) * cam.zoom - CW / 2;
  const sy = (focusY - cam.y) * cam.zoom - CH / 2;
  const col = shots % COLS;
  const row = Math.floor(shots / COLS);
  sctx.drawImage(gameCanvas, sx * DPR, sy * DPR, CW * DPR, CH * DPR, col * CW, row * CH, CW, CH);
  sctx.fillStyle = "#fff";
  sctx.font = "bold 18px sans-serif";
  const ms = destroyedAt < 0 ? "pre" : `+${Math.round((frame - destroyedAt) * (1000 / 120))}ms`;
  sctx.fillText(ms, col * CW + 10, row * CH + 24);
  sctx.strokeStyle = "#444";
  sctx.strokeRect(col * CW + 0.5, row * CH + 0.5, CW - 1, CH - 1);
  shots++;
}

capture(); // the intact rock, just before impact
while (shots < COLS * ROWS && frame < 400) {
  tick(1);
  frame++;
  if (destroyedAt < 0 && rock.destroyed) destroyedAt = frame;
  if (destroyedAt >= 0 && (frame - destroyedAt) % 6 === 0) capture();
  // One full frame shortly after impact, to check the HUD and the player glow.
  if (destroyedAt >= 0 && frame - destroyedAt === 12)
    writeFileSync(path.join(outDir, `shatter-${tag}-full.png`), gameCanvas.toBuffer("image/png"));
}
if (destroyedAt < 0) throw new Error("rock never smashed — state " + game.state + " speed " + player.speed);
console.log(`smash at frame ${destroyedAt}; state after: ${game.state}; rock gone: ${rock.gone}`);
const out = path.join(outDir, `shatter-${tag}.png`);
writeFileSync(out, sheet.toBuffer("image/png"));
console.log("wrote", path.relative(path.join(root, ".."), out));
