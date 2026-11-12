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

// The game seeds each run from the clock; pin it so the smoke is the same
// run every time (a flaky smoke is worse than none).
let fakeNow = 1762_000_000_000;
Date.now = () => (fakeNow += 1);
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
// 1b) The pages: SETTINGS mutes (a phone has no M key) and the save keeps it;
//     the SHOP's character name cycles the character; HOME goes back; and
//     none of it starts a run.
{
  const tapCircle = (b) => {
    dispatch("pointerdown", { clientX: b.x, clientY: b.y, pointerId: 1 });
    tick(1);
    dispatch("pointerup", { clientX: b.x, clientY: b.y, pointerId: 1 });
    tick(1);
  };
  const mid = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const nav = () => game.hud.navButtons(game.camera, true);
  tapCircle(nav().settings);
  assert(game.state === "menu" && game.page === "settings", `SETTINGS did not open its page (state ${game.state}, page ${game.page})`);
  tapCircle(mid(game.hud.settingsRows(game.camera).sound));
  const saved = JSON.parse(globalThis.localStorage.store["gale.save.v1"] || "{}");
  assert(game.state === "menu" && game.sound.enabled === false && saved.muted === true, "the settings page's SOUND row did not mute (or started a run)");
  tapCircle(mid(game.hud.settingsRows(game.camera).sound));
  assert(game.state === "menu" && game.sound.enabled === true && game.storage.data.muted === false, "the settings page's SOUND row did not unmute");
  tapCircle(mid(game.hud.backButton(game.camera)));
  assert(game.state === "menu" && game.page === "home", `HOME did not go back to the home screen (page ${game.page})`);
  // The character's name is the picker: its right half goes forward, its
  // left half back, and neither starts a run.
  tapCircle(nav().shop);
  assert(game.page === "shop", `SHOP did not open its page (page ${game.page})`);
  const c0 = game.storage.data.character;
  const P = game.hud.shopPanel(game.camera);
  tapCircle({ x: P.cx + 20, y: P.charY });
  const c1 = game.storage.data.character;
  tapCircle({ x: P.cx - 20, y: P.charY });
  assert(game.state === "menu" && c1 !== c0 && game.storage.data.character === c0, `tapping the name did not cycle the character (${c0} -> ${c1} -> ${game.storage.data.character}, state ${game.state})`);
  tapCircle(mid(game.hud.backButton(game.camera)));
  assert(game.state === "menu" && game.page === "home", "HOME did not leave the shop");
  // A second tap straight after HOME stays home (no run by a double tap)...
  tapCircle({ x: game.camera.w / 2, y: game.camera.h * 0.45 });
  assert(game.state === "menu", "a tap straight after HOME started a run");
  // ...and a moment later a tap flies as ever.
  tick(60);
}
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
// 4b) Mid-run the mute button sits by the pause button: a tap there mutes
//     and is not a grab; paused, it mutes without resuming.
if (game.state === "playing") {
  const b = game.hud.muteButton(game.camera);
  dispatch("pointerdown", { clientX: b.x, clientY: b.y, pointerId: 1 });
  let grabbed = false;
  for (let i = 0; i < 40; i++) { tick(1); if (game.player.state === "swing") grabbed = true; }
  dispatch("pointerup", { clientX: b.x, clientY: b.y, pointerId: 1 });
  tick(1);
  assert(game.sound.enabled === false, "the in-run mute button did not mute");
  assert(!grabbed, "a tap on the mute button was taken as a grab");
  dispatch("keydown", { code: "Escape" });
  tick(2);
  dispatch("keyup", { code: "Escape" });
  if (game.state === "paused") {
    dispatch("pointerdown", { clientX: b.x, clientY: b.y, pointerId: 1 });
    tick(1);
    dispatch("pointerup", { clientX: b.x, clientY: b.y, pointerId: 1 });
    tick(1);
    assert(game.state === "paused" && game.sound.enabled === true, "paused, the mute button did not unmute (or it resumed)");
    dispatch("keydown", { code: "Escape" });
    tick(2);
    dispatch("keyup", { code: "Escape" });
  }
}
// 5) Trigger a dash via keyboard.
dispatch("keydown", { code: "KeyD" });
tick(60);
// 5b) The pause screen's swing option: tap it, swing with it on, then off again.
assert(game.storage.data.conserveMomentum === false, "Conserve momentum should be off by default");
dispatch("keydown", { code: "Escape" });
tick(2);
dispatch("keyup", { code: "Escape" });
if (game.state === "paused") {
  const r = game.hud.pauseMenuButtons(game.camera).momentum;
  const tapOption = () => {
    dispatch("pointerdown", { clientX: r.x + r.w / 2, clientY: r.y + r.h / 2, pointerId: 1 });
    tick(1);
    dispatch("pointerup", { clientX: r.x + r.w / 2, clientY: r.y + r.h / 2, pointerId: 1 });
    tick(1);
  };
  tapOption();
  assert(game.player.conserveMomentum === true && game.storage.data.conserveMomentum === true, "the pause button did not turn Conserve momentum on");
  dispatch("keydown", { code: "Escape" });
  tick(2);
  dispatch("keyup", { code: "Escape" });
  let swungConserving = false;
  for (let c = 0; c < 3; c++) {
    dispatch("pointerdown", { clientX: 400, clientY: 300, pointerId: 1 });
    for (let i = 0; i < 45; i++) {
      tick(1);
      if (game.player.state === "swing") swungConserving = true;
    }
    dispatch("pointerup", { clientX: 400, clientY: 300, pointerId: 1 });
    tick(35);
  }
  if (game.state === "playing") {
    assert(swungConserving, "never swung with Conserve momentum on");
    dispatch("keydown", { code: "Escape" });
    tick(2);
    dispatch("keyup", { code: "Escape" });
    tapOption();
    assert(game.player.conserveMomentum === false && game.storage.data.conserveMomentum === false, "the pause button did not turn Conserve momentum off");
    dispatch("keydown", { code: "Escape" });
    tick(2);
    dispatch("keyup", { code: "Escape" });
  }
} else if (game.state === "playing") {
  failures.push("Esc did not pause the run");
}
// 6) Let the run end (a hands-off glide sinks into the cloud sea; a lucky
//    lift can stretch it, and a fast crash skids for a few seconds before the
//    game-over screen, so wait for the state rather than a fixed span), then
//    restart.
let waited = 0;
while ((game.state === "playing" || game.state === "crashing") && waited < 6000) {
  tick(10);
  waited += 10;
}
// (An Esc pressed once the run was over is the game-over screen's HOME: the plain menu.)
assert(game.state === "gameover" || game.state === "menu", `run did not reach game over within ${waited} frames (state=${game.state})`);
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
