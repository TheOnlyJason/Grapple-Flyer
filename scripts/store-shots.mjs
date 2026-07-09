// Render App Store screenshots with the real engine at the exact pixel sizes
// App Store Connect requires (landscape). Output: store-screenshots/.
//
//   node scripts/store-shots.mjs
//
// Sizes: iPhone 6.9" 2868x1320, iPad 13" 2752x2064.
import { readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";

const root = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(root, "..", "dist", "assets");
const outDir = path.join(root, "..", "store-screenshots");
mkdirSync(outDir, { recursive: true });
const bundle = readdirSync(assetsDir).find((f) => f.endsWith(".js"));
if (!bundle) {
  console.error("No built bundle. Run `npm run build` first.");
  process.exit(1);
}
const bundlePath = path.join(assetsDir, bundle);

const ALL_TARGETS = [
  { tag: "iphone69", pw: 2868, ph: 1320 }, // 6.9" iPhone landscape
  { tag: "ipad13", pw: 2752, ph: 2064 }, // 13" iPad landscape
];
// One target per process (node scripts/store-shots.mjs <tag>) keeps memory
// flat; with no arg, run every target in a child process each.
const only = process.argv[2];
const TARGETS = only ? ALL_TARGETS.filter((t) => t.tag === only) : ALL_TARGETS;
if (!only) {
  const { execFileSync } = await import("node:child_process");
  for (const t of ALL_TARGETS) {
    execFileSync(process.execPath, [fileURLToPath(import.meta.url), t.tag], {
      stdio: "inherit",
    });
  }
  process.exit(0);
}

async function renderTarget({ tag, pw, ph }) {
  const DPR = 2;
  const W = pw / DPR;
  const H = ph / DPR;

  const gameCanvas = createCanvas(pw, ph);
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
  const dispatch = (type, ev = {}) => {
    for (const fn of handlers.get(type) || []) fn({ preventDefault() {}, ...ev });
  };
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
    createElement: (t) =>
      t === "canvas" ? createCanvas(300, 150) : { relList: { supports: () => true } },
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

  // Fresh module instance per target (cache-bust the import).
  await import(bundlePath + `?${tag}`).catch(async () => import(bundlePath));
  const game = globalThis.window.GALE;

  let t = 0;
  const tick = (n) => {
    for (let i = 0; i < n; i++) {
      t += 16.6;
      const cb = rafCb;
      rafCb = null;
      cb(t);
    }
  };
  const save = (name) => {
    writeFileSync(path.join(outDir, `${tag}-${name}.png`), gameCanvas.toBuffer("image/png"));
    console.log(`wrote store-screenshots/${tag}-${name}.png (${pw}x${ph})`);
  };
  const CYCLE = 95;

  // --- State-aware driver: keep a run alive, capture flattering moments. ---
  let holding = false;
  const down = () => {
    if (!holding) {
      holding = true;
      dispatch("pointerdown", { clientX: W * 0.4, clientY: H * 0.4, pointerId: 1 });
    }
  };
  const up = () => {
    if (holding) {
      holding = false;
      dispatch("pointerup", { clientX: W * 0.4, clientY: H * 0.4, pointerId: 1 });
    }
  };
  // Alternate hold/release on a cadence that sustains runs (mirrors smoke.mjs);
  // restart instantly on game over. Stops when cond(game) holds.
  const driveUntil = (cond, maxTicks = 2000) => {
    let phase = 0;
    for (let i = 0; i < maxTicks; i++) {
      if (game.state === "menu" || game.state === "gameover") {
        up();
        tick(2);
        down();
        tick(2);
        up();
        phase = 0;
      }
      if (phase < 42) down();
      else up();
      phase = (phase + 1) % 74;
      tick(1);
      if (game.state === "playing" && cond(game)) return true;
    }
    return false;
  };

  // 1: menu at dawn.
  tick(30);
  save("1-menu");

  // 2: golden-hour swing — captured mid-tether.
  game.time = 0.4 * CYCLE;
  driveUntil((g) => g.player.state === "swing" && g.player.speed > 380);
  game.time = 0.4 * CYCLE;
  tick(1);
  save("2-swing");

  // 3: bright day glide, moving fast.
  game.time = 0.22 * CYCLE;
  driveUntil((g) => g.player.state === "glide" && g.player.speed > 430);
  game.time = 0.22 * CYCLE;
  tick(1);
  save("3-day");

  // 4: dusk swing deeper into a run.
  game.time = 0.6 * CYCLE;
  driveUntil((g) => g.player.state === "swing" && g.distance > 30);
  game.time = 0.6 * CYCLE;
  tick(1);
  save("4-dusk");

  // 5: night flight under the stars.
  game.time = 0.8 * CYCLE;
  driveUntil((g) => g.player.state !== "dead" && g.player.speed > 400);
  game.time = 0.8 * CYCLE;
  tick(1);
  save("5-night");
}

for (const target of TARGETS) {
  await renderTarget(target);
}
console.log("done");
