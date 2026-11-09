// Render the power-up and orb visuals to PNGs for eyeballing:
//   node scripts/powerups-shot.mjs [W] [H] [mood]
//   INSETS=top,right,bottom,left emulates safe-area insets (iPhone landscape: 0,47,21,47)
// Writes screenshots/pu-<W>-<name>.png — pickups, magnet, barrier, barrier
// break, everything at once, game over and menu.
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

const [wArg = "1280", hArg = "720", moodArg = "0.4"] = process.argv.slice(2);
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
function tick(n, dtMs = 1000 / 120) {
  for (let i = 0; i < n; i++) {
    t += dtMs;
    const cb = rafCb;
    rafCb = null;
    cb(t);
  }
}

const player = game.player;
const world = game.world;
const save = (name) => {
  const out = path.join(outDir, `pu-${W}-${name}.png`);
  writeFileSync(out, gameCanvas.toBuffer("image/png"));
  console.log("wrote", path.relative(path.join(root, ".."), out));
};
const hold = (vx = 420) => {
  for (const a of world.anchors) if (!a.keep) a.y = -99999;
  player.state = "glide"; player.anchor = null; player.y = 0; player.vy = 0; player.vx = vx;
};

if (process.env.INSETS) {
  const [top, right, bottom, left] = process.env.INSETS.split(",").map(Number);
  game.resize(W, H, DPR, { top, right, bottom, left });
}
tick(20);
save("menu");
game.time = Number(moodArg) * 95;
dispatch("pointerdown", { clientX: 400, clientY: 300, pointerId: 1 });
tick(30);
dispatch("pointerup", { clientX: 400, clientY: 300, pointerId: 1 });
tick(2);
if (game.state !== "playing") throw new Error("expected playing, got " + game.state);

// Classes from live instances.
for (let i = 0; i < 6000 && (world.powerups.length === 0 || !world.collectibles.some((c) => c.kind === "orb") || world.hazards.length === 0); i++) {
  hold(900); world.hazards.forEach((h) => (h.y = -5000)); tick(1);
}
const PowerUp = world.powerups[0].constructor;
const Collectible = world.collectibles.find((c) => c.kind === "orb").constructor;
const rockProto = world.hazards[0];
const cloneRock = (x, y) => {
  const r = Object.assign(Object.create(Object.getPrototypeOf(rockProto)), rockProto);
  r.shards = []; r.destroyed = false; r.shatter = 0; r.x = x; r.y = y;
  return r;
};
const anchorProto = world.anchors[world.anchors.length - 1];
function clearStage() {
  world.hazards.length = 0; world.collectibles.length = 0; world.powerups.length = 0;
  game.smashCharge = 0; game.magnetTime = 0; game.barrier = false;
  hold();
}
const orbArc = (cx, cy, radius, n) => {
  for (let i = 0; i < n; i++) {
    const ang = Math.PI / 2 + 0.55 - (i * 1.1) / (n - 1);
    world.collectibles.push(new Collectible(cx + Math.cos(ang) * radius, cy + Math.sin(ang) * radius, "orb"));
  }
};
const orbLine = (x, y, n, dy = 0) => {
  for (let i = 0; i < n; i++) world.collectibles.push(new Collectible(x + i * 48, y + Math.sin((i / (n - 1)) * Math.PI) * dy, "orb"));
};

// 1. Pickups in the world: an orb arc under an anchor, a wave, both power-ups, a wisp.
clearStage();
const a = Object.assign(Object.create(Object.getPrototypeOf(anchorProto)), anchorProto);
a.x = player.x + 420; a.y = -230; a.keep = true; if ("baseY" in a) a.baseY = a.y; if ("baseX" in a) a.baseX = a.x;
world.anchors.push(a);
orbArc(a.x, a.y, 200, 6);
orbLine(player.x + 140, 90, 6, -50);
world.powerups.push(new PowerUp(player.x + 640, -60, "magnet"), new PowerUp(player.x + 800, 110, "barrier"));
world.collectibles.push(new Collectible(player.x + 300, -120, "wisp"));
game.runOrbs = 12;
tick(3);
save("pickups");

// 2. Magnet on: orbs streaming in, chip in the HUD.
clearStage();
game.magnetTime = 6.2;
orbLine(player.x + 180, -150, 7, 40);
orbLine(player.x + 120, 170, 6, -30);
world.collectibles.push(new Collectible(player.x + 330, 40, "wisp"));
for (let i = 0; i < 16; i++) { hold(); tick(1); }
save("magnet");

// 3. Barrier up, rock ahead.
clearStage();
game.barrier = true;
world.hazards.push(cloneRock(player.x + 330, 10));
orbLine(player.x + 110, -110, 5, 0);
for (let i = 0; i < 4; i++) { hold(); tick(1); }
save("barrier");

// 4. The barrier takes the hit.
for (let i = 0; i < 200 && !world.hazards[0].destroyed; i++) { hold(); world.hazards[0].y = player.y + 10; tick(1); }
for (let i = 0; i < 9; i++) { hold(); tick(1); }
save("barrier-break");

// 5. Everything at once: magnet + barrier + smash charge.
clearStage();
game.magnetTime = 3.4; game.barrier = true;
orbLine(player.x + 150, -120, 6, 30);
for (let i = 0; i < 10; i++) { hold(1150); tick(1); }
save("all-effects");

// 6. Barrier saves a sea crash.
clearStage();
game.barrier = true;
player.y = world.seaLevel - 40; player.vy = 500; player.vx = 380;
for (let i = 0; i < 40; i++) { for (const an of world.anchors) an.y = -99999; tick(1); }
save("sea-bounce");

// 6b. Objectives: one just completed (line crossing), then one fading out.
clearStage();
{
  const list = game.objectives.list;
  game.objectives.report(list[0].kind, list[0].target);
  game.objectives.set(list[0].kind, list[0].target);
  for (let i = 0; i < 22; i++) { hold(); tick(1); }
  save("objective-struck");
  for (let i = 0; i < 138; i++) { hold(); tick(1); }
  save("objective-leaving");
  for (let i = 0; i < 60; i++) { hold(); tick(1); }
  save("objective-gone");
}

// 6c. The pause screen with its restart and swing-model buttons.
clearStage();
hold(); tick(2);
game.togglePause();
tick(1);
save("paused");
game.togglePause();

// 7. Game over with orbs banked.
clearStage();
game.runOrbs = 27;
world.hazards.push(cloneRock(player.x + 160, 0));
for (let i = 0; i < 300 && game.state === "playing"; i++) { hold(); world.hazards[0].y = player.y; tick(1); }
tick(60);
save("gameover");
console.log("state:", game.state, "bank:", game.storage.data.orbs);
