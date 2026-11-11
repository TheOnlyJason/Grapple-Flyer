// 1.2-equivalence probe.   node scripts/equiv-probe.mjs      (after `npm run build`)
//
// With the Conserve momentum option off, the game must play exactly like the
// 1.2 release: the same physics, the same world for the same seed, the same
// camera (grabs are gated by the view), the same input timing. This plays
// the built bundle and the 1.2 release side by side with the same scripted
// input, frame by frame, and compares the plane, the camera and the run state
// to the last bit of every number.
//
// The 1.2 release is built from its commit the first time (into the system
// temp folder; it is rebuilt if that is cleaned). Each case runs in its own
// child process, since the game is a module singleton.
//
//   steady   : grabs the anchor ahead, lets go in the gold window (long flights)
//   mixed    : the same pilot, but half its releases are early or late
//   sloppy   : grabs anything in reach, misses some, lets go early, sits out
//              stretches (deaths, the game-over screen, restarts)
//   pausing  : the steady flight, paused and resumed now and then
//
//   EQUIV_FRAMES=7200 (60 s at 120 Hz) by default.
//   EQUIV_NEW_DIR=<assets folder> compares that build instead of dist/.
import { existsSync, mkdirSync, readdirSync, symlinkSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const self = fileURLToPath(import.meta.url);
const repo = path.join(path.dirname(self), "..");
// "Submit 1.2 (build 8) to App Review": the source of the 1.2 on the App Store.
const V12_COMMIT = "4e20de9";

if (!process.env.EQUIV_BUNDLE) {
  // --- Parent: make sure both bundles exist, run the cases, compare. -------
  // EQUIV_NEW_DIR compares another build's assets folder instead of dist/.
  const newDir = process.env.EQUIV_NEW_DIR || path.join(repo, "dist", "assets");
  if (!existsSync(newDir) || !readdirSync(newDir).some((f) => f.endsWith(".js"))) {
    console.error("No built bundle found. Run `npm run build` first.");
    process.exit(1);
  }
  const v12Root = path.join(os.tmpdir(), `gale-v12-${V12_COMMIT}`);
  const v12Dir = path.join(v12Root, "dist", "assets");
  if (!existsSync(v12Dir) || !readdirSync(v12Dir).some((f) => f.endsWith(".js"))) {
    console.log(`building the 1.2 release (${V12_COMMIT}) into ${v12Root} ...`);
    mkdirSync(v12Root, { recursive: true });
    execSync(`git archive ${V12_COMMIT} | tar -x -C "${v12Root}"`, { cwd: repo, stdio: "inherit" });
    if (!existsSync(path.join(v12Root, "node_modules"))) {
      symlinkSync(path.join(repo, "node_modules"), path.join(v12Root, "node_modules"));
    }
    execFileSync("npx", ["vite", "build"], { cwd: v12Root, stdio: "ignore" });
  }

  const FRAMES = process.env.EQUIV_FRAMES || "7200";
  const play = (dir, policy) =>
    execFileSync(process.execPath, [self], {
      env: { ...process.env, EQUIV_BUNDLE: dir, EQUIV_POLICY: policy, EQUIV_FRAMES: FRAMES },
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    })
      .trim()
      .split("\n");
  let failures = 0;
  for (const policy of ["steady", "mixed", "sloppy", "pausing"]) {
    const a = play(v12Dir, policy);
    const b = play(newDir, policy);
    const summary = a.pop();
    b.pop();
    let diff = -1;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        diff = i;
        break;
      }
    }
    if (diff < 0) {
      console.log(`PASS  ${policy}: IDENTICAL to 1.2 over ${a.length} frames  (${summary})`);
    } else {
      failures++;
      console.log(`FAIL  ${policy}: DIFFERS from 1.2 at frame ${diff}`);
      console.log(`      frame,game,player,x,y,vx,vy,camX,camY,zoom,distance`);
      for (let i = Math.max(0, diff - 1); i <= diff + 1; i++) {
        console.log(`      1.2: ${a[i]}`);
        console.log(`      new: ${b[i]}`);
      }
    }
  }
  console.log(failures ? `\n${failures} FAILED` : "\nthe default swing plays exactly like 1.2");
  process.exit(failures ? 1 : 0);
}

// --- Child: boot one bundle and fly it. ------------------------------------
const assetsDir = process.env.EQUIV_BUNDLE;
const bundle = readdirSync(assetsDir).find((f) => f.endsWith(".js"));
const POLICY = process.env.EQUIV_POLICY || "steady";
const FRAMES = Number(process.env.EQUIV_FRAMES || 7200);

const gradient = { addColorStop() {} };
const ctxMock = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => gradient;
      if (prop === "measureText") return () => ({ width: 10 });
      return typeof prop === "string" &&
        /^[a-z]/.test(prop) &&
        !["fillStyle", "strokeStyle", "lineWidth", "font", "textAlign", "textBaseline", "globalAlpha", "lineCap", "lineJoin", "globalCompositeOperation"].includes(prop)
        ? () => {}
        : undefined;
    },
    set() {
      return true;
    },
  }
);
const handlers = new Map();
const listen = (type, fn) => {
  const arr = handlers.get(type) || [];
  arr.push(fn);
  handlers.set(type, arr);
};
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
    addEventListener: listen,
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
globalThis.window = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 2, addEventListener: listen, removeEventListener() {} };
globalThis.document = {
  getElementById: (id) => (id === "game" ? canvas : boot),
  createElement: (tag) => (tag === "canvas" ? makeEl() : { relList: { supports: () => true } }),
  querySelectorAll: () => [],
  addEventListener() {},
};
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.localStorage = {
  // A returning player (1.2 has no tutorial; later builds skip theirs for this save).
  store: { "gale.save.v1": JSON.stringify({ tutorialDone: true }) },
  getItem(k) {
    return this.store[k] ?? null;
  },
  setItem(k, v) {
    this.store[k] = String(v);
  },
};
// Runs are seeded from the clock: the same clock for both builds, so the
// same worlds as long as both ask for the time the same number of times.
let fakeNow = 1762_000_000_000;
Date.now = () => (fakeNow += 1);

await import(path.join(assetsDir, bundle));
const game = globalThis.window.GALE;
if (!game) throw new Error("game instance not exposed on window.GALE");
const player = game.player;
const world = game.world;
const cam = game.camera;

let t = 0;
function frame() {
  t += 1000 / 120;
  const cb = rafCb;
  rafCb = null;
  cb(t);
}
// A point that is plain sky on every build's menu and game-over screens.
const AT = { clientX: 400, clientY: 300, pointerId: 1 };
let isDown = false;
const down = () => {
  dispatch("pointerdown", AT);
  isDown = true;
};
const up = () => {
  dispatch("pointerup", AT);
  isDown = false;
};

for (let i = 0; i < 20; i++) frame();
const rows = [];
let holding = false;
let held = 0;
let runs = 0;
let lastState = game.state;
let best = 0;
let lastRelease = -1e9;
let perfect = true;
let late = 0;
let seed = 20261111;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
for (let f = 0; f < FRAMES; f++) {
  const state = game.state;
  if (state !== lastState) {
    if (state === "playing" && lastState !== "paused") runs++;
    lastState = state;
  }
  if (state === "menu" || state === "gameover") {
    holding = false;
    // Tap to fly, once a second.
    if (f % 120 === 60 && !isDown) down();
    else if (f % 120 === 62 && isDown) up();
  } else if (state === "playing") {
    if (isDown && !holding) up(); // the tap that started the run
    const sloppy = POLICY === "sloppy";
    const sitOut = sloppy && f % 2400 > 1200;
    if (!holding) {
      const target = player.state === "glide" ? player.findGrabTarget(world.anchors, cam) : null;
      // The pilots wait a beat after a release and take only an anchor ahead
      // (re-grabbing the one just left hangs dead); the sloppy one takes anything.
      const ok = sloppy ? f % 3 !== 0 : f - lastRelease > 45 && target !== null && target.x > player.x + 30;
      if (target && !sitOut && ok) {
        down();
        holding = true;
        held = 0;
        perfect = POLICY !== "mixed" || rnd() < 0.5;
        late = Math.floor(rnd() * 30);
      }
    } else {
      held++;
      const swinging = player.state === "swing";
      const rising = player.vx > 0 && player.vy < 0;
      const letGo = sloppy
        ? held > 14 + (f % 7)
        : (swinging && (perfect ? player.inPerfectWindow : rising && --late < 0)) || held > 360 || (!swinging && held > 6);
      if (letGo) {
        up();
        holding = false;
        lastRelease = f;
      }
    }
    if (POLICY === "pausing" && f % 1500 === 700) {
      // Pause for three quarters of a second, hands off, then resume.
      if (holding) {
        up();
        holding = false;
      }
      dispatch("keydown", { code: "Escape" });
      frame();
      dispatch("keyup", { code: "Escape" });
      for (let k = 0; k < 90; k++) frame();
      dispatch("keydown", { code: "Escape" });
      frame();
      dispatch("keyup", { code: "Escape" });
    }
  } else if (holding || isDown) {
    up();
    holding = false;
  }
  frame();
  best = Math.max(best, Math.floor(game.distance));
  rows.push([f, game.state, player.state, player.x, player.y, player.vx, player.vy, cam.x, cam.y, cam.zoom ?? 1, game.distance].join(","));
}
rows.push(`${runs} runs, best ${best} m`);
console.log(rows.join("\n"));
