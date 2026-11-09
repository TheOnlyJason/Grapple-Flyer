// Smash-speed probe.   node scripts/smash-probe.mjs [decay|ahead|bot]
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


const player = game.player;
let t = 0;
function frame() {
  t += 1000 / 120;
  const cb = rafCb;
  rafCb = null;
  cb(t);
}
for (let i = 0; i < 20; i++) frame();
dispatch("pointerdown", { clientX: 640, clientY: 360, pointerId: 1 });
frame();
dispatch("pointerup", { clientX: 640, clientY: 360, pointerId: 1 });
for (let i = 0; i < 4; i++) frame();
if (game.state !== "playing") throw new Error("expected playing, got " + game.state);

const MODE = process.argv[2] || "decay";
// Knobs come from the live config (exposed as window.GALE_CONFIG). GALE_KNOBS
// overrides them before anything runs, e.g.
//   GALE_KNOBS='{"tether.swingDrag":0,"player.smashSpeed":1250}' node scripts/smash-probe.mjs bot
const CFG = globalThis.window.GALE_CONFIG;
if (process.env.GALE_KNOBS) {
  for (const [path, value] of Object.entries(JSON.parse(process.env.GALE_KNOBS))) {
    const keys = path.split(".");
    let o = CFG;
    for (const k of keys.slice(0, -1)) o = o[k];
    o[keys[keys.length - 1]] = value;
  }
  console.log("knobs:", process.env.GALE_KNOBS);
}
const SMASH = CFG.player.smashSpeed;
const armedNow = () => ("smashArmed" in game ? game.smashArmed : player.speed >= SMASH);
function restart() {
  while (game.state === "crashing") frame(); // a sea skid at smash speeds lasts 3.5–4 s
  for (let i = 0; i < 400 && game.state !== "playing"; i++) {
    if (i % 60 === 30) dispatch("pointerdown", { clientX: 640, clientY: 360, pointerId: 1 });
    if (i % 60 === 32) dispatch("pointerup", { clientX: 640, clientY: 360, pointerId: 1 });
    frame();
  }
  if (game.state !== "playing") throw new Error("could not restart: " + game.state);
  dispatch("pointerup", { clientX: 640, clientY: 360, pointerId: 1 }); // never leave the tether held
  frame();
}

if (MODE === "decay") {
  const ANGLE = (-44 * Math.PI) / 180; // CONFIG.tether.idealLaunchAngleDeg
  const KEEPS = [900, 800, 700, 600, 500];
  console.log("seconds (and px travelled) until speed first drops below each level after a launch at -44 deg:");
  console.log(`launch |  >=${SMASH}        | ` + KEEPS.map((k) => `>=${k}`.padEnd(14)).join("| "));
  for (const v0 of [1060, 1100, 1200, 1300, 1450]) {
    restart(); // an earlier launch may have flown into the sea
    game.world.hazards.length = 0;
    for (const a of game.world.anchors) a.y = -99999;
    player.state = "glide";
    player.anchor = null;
    player.y = 0;
    player.vx = Math.cos(ANGLE) * v0;
    player.vy = Math.sin(ANGLE) * v0;
    const x0 = player.x;
    const levels = [SMASH, ...KEEPS];
    const out = levels.map(() => null);
    for (let i = 0; i < 120 * 8 && game.state === "playing"; i++) {
      frame();
      levels.forEach((k, j) => {
        if (out[j] === null && player.speed < k) out[j] = `${(i / 120).toFixed(2)}s ${(player.x - x0).toFixed(0)}px`;
      });
      if (out.every((o) => o !== null)) break;
    }
    console.log(`${String(v0).padStart(6)} | ` + out.map((o) => (o ?? "never").padEnd(14)).join("| "));
  }
  if ("smashArmed" in game) {
    console.log("\nwith the game's own latch (game.smashArmed):");
    for (const v0 of [1060, 1100, 1200, 1300, 1450]) {
      restart();
      game.world.hazards.length = 0;
      for (const a of game.world.anchors) a.y = -99999;
      player.state = "glide"; player.anchor = null; player.y = 0;
      player.vx = Math.cos(ANGLE) * v0; player.vy = Math.sin(ANGLE) * v0;
      const x0 = player.x;
      let armed = 0, dist = 0, saw = false;
      for (let i = 0; i < 120 * 8 && game.state === "playing"; i++) {
        frame();
        if (game.smashArmed) { armed++; dist = player.x - x0; saw = true; } else if (saw) break;
      }
      console.log(`${String(v0).padStart(6)} | armed ${(armed / 120).toFixed(2)} s, ${dist.toFixed(0)} px`);
    }
  }
}

if (MODE === "ahead") {
  console.log("meteor N px ahead of a level launch (player glides straight at it):");
  for (const v0 of [1100, 1250]) {
    const row = [];
    for (const D of [150, 400, 700, 1000, 1300, 1700, 2200]) {
      restart();
      for (const a of game.world.anchors) a.y = -99999;
      // A fresh, intact rock (the previous trial's may still be shattering).
      let rock = null;
      for (let i = 0; i < 2400 && !rock; i++) {
        rock = game.world.hazards.find((h) => !h.destroyed) ?? null;
        if (!rock) { player.y = 0; player.vy = 0; player.vx = 400; frame(); }
        if (game.state !== "playing") restart();
      }
      if (!rock) throw new Error("no intact rock generated");
      const rocks = game.world.hazards;
      rocks.length = 0;
      rocks.push(rock);
      player.state = "glide"; player.anchor = null; player.y = 0;
      player.vx = v0; player.vy = 0;
      rock.x = player.x + D + rock.rx;
      game.barrier = false;
      let outcome = "missed";
      for (let i = 0; i < 120 * 8; i++) {
        rock.y = player.y; // keep it dead ahead
        for (const a of game.world.anchors) a.y = -99999; // nothing to latch onto
        game.world.powerups.length = 0; // no barrier pickup may absorb the hit
        if (game.world.hazards[0] !== rock) { outcome = "culled"; break; }
        const speed = player.speed;
        frame();
        if (rock.destroyed) { outcome = `SMASHED @${speed.toFixed(0)}`; break; }
        if (game.state !== "playing") { outcome = `died @${speed.toFixed(0)}`; break; }
      }
      if (outcome === "missed") outcome += ` (dx ${(rock.x - player.x).toFixed(0)}, dy ${(rock.y - player.y).toFixed(0)}, v ${player.speed.toFixed(0)}, pstate ${player.state}, y ${player.y.toFixed(0)})`;
      row.push(`${D}px: ${outcome}`);
    }
    console.log(`launch ${v0} px/s -> ` + row.join(" | "));
  }
}

if (MODE === "bot") {
  const SECONDS = Number(process.argv[3] || 500);
  // Classify deaths from endRun's own flag: crashSound is set only for meteor
  // kills. (Testing the player's position afterwards is wrong — endRun has
  // already re-posed the player for the attract screen.)
  let meteorKill = false;
  const endRun = game.endRun;
  game.endRun = function (opts = {}) {
    meteorKill = !!opts.crashSound;
    return endRun.call(this, opts);
  };
  // Speeds at every grab and release (perfect / not), for the retune.
  const grabSpeeds = [], perfectReleases = [], plainReleases = [];
  const origGrab = Object.getPrototypeOf(player).grab;
  const origRelease = Object.getPrototypeOf(player).release;
  player.grab = function (...args) { grabSpeeds.push(this.speed); return origGrab.apply(this, args); };
  player.release = function (...args) {
    const perfect = this.inPerfectWindow;
    const r = origRelease.apply(this, args);
    (perfect ? perfectReleases : plainReleases).push(this.speed);
    return r;
  };
  const pctl = (xs, q) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] : 0);
  const fmt = (xs) => `p50 ${String(Math.round(pctl(xs, 0.5))).padStart(4)} p90 ${String(Math.round(pctl(xs, 0.9))).padStart(4)} (${xs.length})`;
  for (const P of [1, 0.5, 0.15]) {
    restart();
    grabSpeeds.length = 0; perfectReleases.length = 0; plainReleases.length = 0;
    let frames = 0, armedFrames = 0, fastFrames = 0, runs = 0, smashes = 0, meteorDeaths = 0, otherDeaths = 0;
    let holding = false, swingFrames = 0, lastRelease = -1e9, goPerfect = true, sloppyDelay = 0;
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const seen = new Set();
    while (frames < SECONDS * 120) {
      if (game.state !== "playing") {
        if (meteorKill) meteorDeaths++; else otherDeaths++;
        meteorKill = false;
        runs++;
        if (holding) { dispatch("pointerup", { clientX: 640, clientY: 360, pointerId: 1 }); holding = false; }
        restart();
        seen.clear();
        continue;
      }
      if (player.state === "glide" && !holding) {
        const target = t - lastRelease > 380 ? player.findGrabTarget(game.world.anchors, game.camera) : null;
        if (target && target.x > player.x + 30) {
          dispatch("pointerdown", { clientX: 640, clientY: 360, pointerId: 1 });
          holding = true; swingFrames = 0; goPerfect = rnd() < P; sloppyDelay = Math.floor(rnd() * 30);
        }
      } else if (holding) {
        swingFrames++;
        const upForward = player.vx > 0 && player.vy < 0;
        const want = player.state === "swing" && (goPerfect ? player.inPerfectWindow : upForward && --sloppyDelay < 0);
        if (want || swingFrames > 360 || (player.state !== "swing" && swingFrames > 6)) {
          dispatch("pointerup", { clientX: 640, clientY: 360, pointerId: 1 });
          holding = false; lastRelease = t;
        }
      }
      // Power-ups would absorb hits and inflate the smash columns.
      game.world.powerups.length = 0; game.barrier = false; game.magnetTime = 0;
      frame(); frames++;
      if (game.state !== "playing") continue;
      if (armedNow()) armedFrames++;
      if (player.speed >= SMASH) fastFrames++;
      for (const h of game.world.hazards) if (h.destroyed && !seen.has(h)) { seen.add(h); smashes++; }
    }
    const pct = (a) => ((100 * a) / frames).toFixed(1) + "%";
    const per100 = (n) => ((100 * n) / (frames / 120)).toFixed(1);
    console.log(
      `perfect-release rate ${String(Math.round(P * 100)).padStart(3)}% | ${runs} runs in ${SECONDS}s | at smash speed ${pct(fastFrames).padStart(6)} | smash charged ${pct(armedFrames).padStart(6)} | meteors smashed ${String(smashes).padStart(3)} | killed by meteor ${String(meteorDeaths).padStart(3)} (${per100(meteorDeaths)}/100s) | other deaths ${otherDeaths} (${per100(otherDeaths)}/100s)`
    );
    console.log(
      `      grab speed ${fmt(grabSpeeds)} | perfect release ${fmt(perfectReleases)} p75 ${Math.round(pctl(perfectReleases, 0.75))} | plain release ${fmt(plainReleases)} p75 ${Math.round(pctl(plainReleases, 0.75))}`
    );
  }
}
