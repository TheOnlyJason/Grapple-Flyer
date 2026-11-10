// Tether probe for the two swings.   node scripts/tether-probe.mjs
// The default is the classic rope (the 1.2 swing); the pause-menu option
// "Conserve momentum" swaps in a pendulum that must obey Newton. Checks,
// against the real built bundle, for the option: the grab keeps the player's
// energy, a free swing does not drift, reeling in speeds the player up by
// exactly the rope ratio (angular momentum), a moving anchor hands its
// velocity over, a whole glide → grab → swing → release → glide → grab chain
// conserves energy once every deliberate energy knob is zeroed, and a fast
// swing still loops over the top (no cap). For both: the option is off by
// default, off is the old projecting rope, holding grabs (as in 1.2) and a
// hold in open sky does nothing else, the switch is seamless mid-swing and
// the pause screen flips and saves it. Knobs are set through
// window.GALE_CONFIG; nothing is rebuilt.
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
const world = game.world;
const CFG = globalThis.window.GALE_CONFIG;
const DT = CFG.fixedDt;
let t = 0;
function frame(n = 1) {
  for (let i = 0; i < n; i++) {
    t += 1000 / 120;
    const cb = rafCb;
    rafCb = null;
    cb(t);
  }
}
const down = () => dispatch("pointerdown", { clientX: 640, clientY: 360, pointerId: 1 });
const up = () => dispatch("pointerup", { clientX: 640, clientY: 360, pointerId: 1 });
let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

// Start a run, then take the world over: one staged anchor, nothing else.
frame(20);
down(); frame(); up(); frame(2);
if (game.state !== "playing") throw new Error("expected playing, got " + game.state);
check("Conserve momentum is off by default (the 1.2 swing)", game.storage.data.conserveMomentum === false && game.player.conserveMomentum === false);
// Sections 1–7 are about the option's pendulum.
game.player.conserveMomentum = true;
const Anchor = world.anchors[0].constructor;
let staged = null;
function quiet() {
  world.genX = player.x + 1e6; // no new segments
  world.hazards.length = 0;
  world.powerups.length = 0;
  world.collectibles.length = 0;
  world.anchors.length = 0;
  if (staged) world.anchors.push(staged);
}
function stageAnchor(x, y, kind = "normal", opts) {
  staged = new Anchor(x, y, kind, opts);
  quiet();
  return staged;
}
// Fresh glide at (x0, y0) with velocity v, tether off, no stale swing state.
// Grabbing needs a fresh press, so the finger is lifted for a frame first.
function placeGlide(x0, y0, vx, vy) {
  up();
  quiet();
  frame();
  player.state = "glide"; player.anchor = null; player.inPerfectWindow = false;
  player.grabLockout = 0; // a fresh flight, not a barrier bounce just made
  player.x = x0; player.y = y0; player.vx = vx; player.vy = vy;
  player.trail.length = 0;
  game.smashCharge = 0; game.barrier = false; game.magnetTime = 0;
  game.camera.snapTo(x0, y0);
}
// Place the player mid-swing directly (bypassing the grab).
function placeSwing(a, L, phi, omega) {
  up();
  player.anchor = a; player.state = "swing";
  player.ropeLen = L; player.swingPhi = phi; player.swingOmega = omega; player.swingTime = 0;
  player.x = a.x + L * Math.sin(phi); player.y = a.yAt(game.time) + L * Math.cos(phi);
  player.vx = L * omega * Math.cos(phi); player.vy = a.vyAt(game.time) - L * omega * Math.sin(phi);
  game.camera.snapTo(player.x, player.y);
  down(); // keep holding: the tether lets go without it
}
const E = (g) => 0.5 * (player.vx * player.vx + player.vy * player.vy) - g * player.y;
// Press and run frames until the swing starts (a frame can carry 0 or 2 physics steps).
function pressAndGrab(maxFrames = 4) {
  down();
  for (let i = 0; i < maxFrames; i++) { quiet(); frame(); if (player.state === "swing") return true; }
  return player.state === "swing";
}
const setKnobs = (k) => {
  for (const [path, value] of Object.entries(k)) {
    const keys = path.split("."); let o = CFG;
    for (const kk of keys.slice(0, -1)) o = o[kk];
    o[keys[keys.length - 1]] = value;
  }
};
const saved = JSON.parse(JSON.stringify({ world: CFG.world, player: CFG.player, tether: CFG.tether }));
const restoreKnobs = () => { Object.assign(CFG.world, saved.world); Object.assign(CFG.player, saved.player); Object.assign(CFG.tether, saved.tether); };
const deg = (d) => (d * Math.PI) / 180;
const finite = () => [player.x, player.y, player.vx, player.vy, player.swingPhi, player.swingOmega].every(Number.isFinite);

// --- 1. The grab keeps the player's energy ------------------------------------------
// Glide made lossless and given the swing's gravity, so E = ½v² − g·y is one
// quantity across the grab. reel and drag off.
{
  setKnobs({ "tether.swingDrag": 0, "tether.conserveReelRate": 0, "player.forwardDrag": 0, "player.vertDrag": 0, "player.glideLift": 0, "world.gravityAir": CFG.world.gravitySwing });
  const g = CFG.world.gravitySwing;
  let worst = 0, cases = 0, bad = [];
  const v0 = 700;
  for (const beta of [-44, -20, 0, 20, 45]) {
    for (const elev of [15, 30, 50, 70]) {
      for (const d of [200, 300, 420]) {
        const x0 = 5000 + cases * 1000, y0 = -200;
        const a = stageAnchor(x0 + d * Math.cos(deg(elev)), y0 - d * Math.sin(deg(elev)));
        placeGlide(x0, y0, v0 * Math.cos(deg(beta)), v0 * Math.sin(deg(beta)));
        quiet();
        const e0 = E(g);
        down();
        let grabbed = false;
        for (let i = 0; i < 4 && !grabbed; i++) { quiet(); frame(); grabbed = player.state === "swing" && player.anchor === a; }
        const rel = Math.abs(E(g) - e0) / (0.5 * v0 * v0);
        worst = Math.max(worst, rel);
        cases++;
        if (!grabbed || !finite() || rel > 0.005 || Math.abs(player.ropeLen * player.swingOmega) > CFG.player.maxSpeed + 1e-6)
          bad.push(`β${beta} e${elev} d${d}: grabbed=${grabbed} dE=${(100 * rel).toFixed(2)}%`);
        up();
      }
    }
  }
  check(`grab keeps energy in ${cases} geometries (worst loss ${(100 * worst).toFixed(3)}% of ½v²)`, bad.length === 0, bad.slice(0, 3).join("; "));
  // Dead-on radial approach and a very short rope.
  const a = stageAnchor(9000 + 300, -200 - 300);
  placeGlide(9000, -200, 600 * Math.SQRT1_2, -600 * Math.SQRT1_2); // straight at the anchor
  const e0 = E(g);
  pressAndGrab();
  check("dead-on radial grab keeps speed and turns forward", player.state === "swing" && Math.abs(E(g) - e0) / (0.5 * 600 * 600) < 0.005 && player.vx > 0, `vx ${player.vx.toFixed(0)} dE ${(100 * Math.abs(E(g) - e0) / (0.5 * 600 * 600)).toFixed(2)}%`);
  up();
  const b = stageAnchor(9500 + 20, -200 - 22); // 30 px away, just above (level anchors are off limits)
  placeGlide(9500, -200, 500, 0);
  const e1 = E(g);
  pressAndGrab();
  check("30 px grab is sane", player.state === "swing" && finite() && Math.abs(player.ropeLen * player.swingOmega) <= CFG.player.maxSpeed + 1e-6 && Math.abs(E(g) - e1) / (0.5 * 500 * 500) < 0.005, `L ${player.ropeLen.toFixed(1)} |Lω| ${Math.abs(player.ropeLen * player.swingOmega).toFixed(0)}`);
  up();
  restoreKnobs();
}

// --- 2. A free swing does not drift -------------------------------------------------
{
  setKnobs({ "tether.swingDrag": 0, "tether.conserveReelRate": 0 });
  const g = CFG.world.gravitySwing;
  for (const [L, v, label] of [[70, 1900, "L70 v1900"], [150, 1100, "L150 v1100 (loops)"], [300, 600, "L300 v600"], [420, 300, "L420 v300"]]) {
    const a = stageAnchor(12000, -600);
    placeSwing(a, L, 0, v / L);
    quiet();
    const e0 = E(g);
    const scale = Math.max(Math.abs(e0), g * L);
    let worst = 0, ropeErr = 0;
    for (let i = 0; i < 600; i++) {
      quiet(); frame();
      worst = Math.max(worst, Math.abs(E(g) - e0) / scale);
      ropeErr = Math.max(ropeErr, Math.abs(Math.hypot(player.x - a.x, player.y - a.y) - player.ropeLen));
    }
    check(`5 s swing ${label}: energy drift ${(100 * worst).toFixed(3)}%, rope error ${ropeErr.toExponential(1)} px`, player.state === "swing" && worst < 0.01 && ropeErr < 1e-6 && finite());
    up();
  }
  restoreKnobs();
}

// --- 3. Reeling in pumps by the rope ratio (angular momentum) -----------------------
{
  setKnobs({ "tether.swingDrag": 0, "tether.conserveReelRate": 90, "world.gravitySwing": 0 });
  const a = stageAnchor(15000, -600);
  placeSwing(a, 300, 0.3, 600 / 300);
  quiet();
  // Swing speed is L·ω; the reported velocity also carries the reel's 90 px/s inward pull.
  const v0 = Math.abs(player.ropeLen * player.swingOmega);
  for (let i = 0; i < 120; i++) { quiet(); frame(); }
  const v1 = Math.abs(player.ropeLen * player.swingOmega);
  const radial = Math.hypot(player.vx, player.vy) ** 2 - v1 * v1;
  check("reel 300→210 px in 1 s scales swing speed by 300/210", Math.abs(player.ropeLen - 210) < 1e-6 && Math.abs(v1 / v0 - 300 / 210) < 0.001, `L ${player.ropeLen.toFixed(2)} ratio ${(v1 / v0).toFixed(4)} vs ${(300 / 210).toFixed(4)}`);
  check("reported velocity includes the reel's inward pull", Math.abs(Math.sqrt(Math.max(0, radial)) - 90) < 1, `radial ${Math.sqrt(Math.max(0, radial)).toFixed(1)} px/s`);
  up();
  restoreKnobs();
}

// --- 4. A moving anchor hands its velocity over --------------------------------------
{
  setKnobs({ "tether.swingDrag": 0, "tether.conserveReelRate": 0, "world.gravitySwing": 0, "world.gravityAir": 0, "player.vertDrag": 0, "player.forwardDrag": 0, "player.glideLift": 0 });
  const a = stageAnchor(18000, -600, "moving", { amp: 130, phase: 0, speed: 1.6 });
  placeSwing(a, 200, 0, 0);
  let worstV = 0, worstL = 0;
  for (let i = 0; i < 240; i++) {
    quiet(); frame();
    worstV = Math.max(worstV, Math.abs(player.vy - a.vyAt(game.time)));
    worstL = Math.max(worstL, Math.abs((player.y - a.y) - player.ropeLen));
  }
  check("hanging from a moving anchor: player rides it exactly", worstV < 1 && worstL < 1e-6, `|vy − anchor vy| ≤ ${worstV.toFixed(3)} px/s, rope error ${worstL.toExponential(1)}`);
  // Release at a moment the anchor is moving fast: the glide starts with that velocity.
  for (let i = 0; i < 240 && Math.abs(a.vyAt(game.time)) < 150; i++) { quiet(); frame(); }
  const vyAnchor = a.vyAt(game.time + DT); // the step after pointer-up releases, at the new time
  up(); quiet(); frame();
  check("release carries the anchor's velocity (× release boost)", player.state === "glide" && Math.abs(player.vy - CFG.tether.releaseBoost * vyAnchor) < 4, `vy ${player.vy.toFixed(1)} vs ${(CFG.tether.releaseBoost * vyAnchor).toFixed(1)}`);
  restoreKnobs();
}

// --- 5. End to end: with every deliberate energy knob zeroed, Newton holds ------------
{
  setKnobs({ "world.gravitySwing": 300, "world.gravityAir": 300, "player.forwardDrag": 0, "player.vertDrag": 0, "player.glideLift": 0, "tether.swingDrag": 0, "tether.conserveReelRate": 0, "tether.releaseBoost": 1, "tether.perfectBoost": 1, "tether.perfectBonusSpeed": 0 });
  const g = 300;
  const x0 = 21000, y0 = -300;
  const a1 = stageAnchor(x0 + 320, y0 - 160);
  placeGlide(x0, y0, 650, -250);
  quiet();
  const e0 = E(g);
  const scale = 0.5 * 650 * 650;
  let worst = 0; const phases = [];
  const track = () => { worst = Math.max(worst, Math.abs(E(g) - e0) / scale); };
  for (let i = 0; i < 30; i++) { quiet(); frame(); track(); }            // free glide
  down();
  let grabbed = false;
  for (let i = 0; i < 120; i++) { quiet(); frame(); track(); if (player.state === "swing") { grabbed = true; break; } }
  phases.push("grab1:" + grabbed);
  for (let i = 0; i < 120; i++) { quiet(); frame(); track(); }           // swing 1 s
  up(); quiet(); frame(); track();
  phases.push("release:" + (player.state === "glide"));
  for (let i = 0; i < 60; i++) { quiet(); frame(); track(); }            // glide 0.5 s
  const a2 = stageAnchor(player.x + 280, player.y - 180);
  down();
  let grabbed2 = false;
  for (let i = 0; i < 120; i++) { quiet(); frame(); track(); if (player.state === "swing" && player.anchor === a2) { grabbed2 = true; break; } }
  phases.push("grab2:" + grabbed2);
  for (let i = 0; i < 60; i++) { quiet(); frame(); track(); }
  up();
  check(`glide → grab → swing → release → glide → grab conserves energy (worst ${(100 * worst).toFixed(3)}% of ½v₀²)`, grabbed && grabbed2 && worst < 0.01 && finite(), phases.join(" "));
  restoreKnobs();
}

// --- 6. Degenerate grabs -----------------------------------------------------------------
{
  setKnobs({ "tether.swingDrag": 0, "tether.conserveReelRate": 0 });
  // Zero velocity, anchor above-ahead: hangs, then gravity swings it.
  let a = stageAnchor(24000 + 150, -400 - 150);
  placeGlide(24000, -400, 0, 0);
  const startedStill = pressAndGrab();
  for (let i = 0; i < 30; i++) { quiet(); frame(); }
  check("zero-velocity grab starts a swing without NaN", startedStill && finite() && Math.abs(player.swingOmega) > 0.01, `ω after 0.25 s ${player.swingOmega.toFixed(3)}`);
  up();
  // Exactly radial: flying straight up at an anchor directly above → turns forward.
  a = stageAnchor(25000, -400 - 250);
  placeGlide(25000, -400, 0, -500);
  pressAndGrab();
  check("straight-up radial grab turns forward", player.state === "swing" && finite() && player.vx > 0 && Math.abs(Math.hypot(player.vx, player.vy) - 500) < 500 * 0.02, `v (${player.vx.toFixed(0)}, ${player.vy.toFixed(0)})`);
  up();
  restoreKnobs();
}

// --- 7. No cap: like the classic rope, a fast swing carries over the top ---------------------
{
  setKnobs({ "tether.swingDrag": 0, "tether.conserveReelRate": 0 });
  const a = stageAnchor(28000, -600);
  // 1300 px/s at the bottom of a 150 px rope clears the top (needs √(5gL) ≈ 1146).
  placeSwing(a, 150, 0, 1300 / 150);
  let over = false, highest = 0;
  for (let i = 0; i < 120 && player.state === "swing"; i++) {
    quiet(); frame();
    highest = Math.max(highest, a.y - player.y);
    if (Math.abs(player.swingPhi) > deg(170)) over = true;
  }
  check("a fast swing loops over the top of the anchor (no cap, no slip)", over && player.state === "swing" && finite(), `highest ${highest.toFixed(0)} px above the anchor, state ${player.state}`);
  up();
  restoreKnobs();
}

// --- 8. Off (the default) is the classic rope ------------------------------------------------
{
  setKnobs({ "tether.swingDrag": 0 });
  // Level flight into an anchor 30° up: the rope's projection keeps sin(30°) = 50% of
  // speed; the option keeps all of it.
  const v0 = 700;
  const kept = {};
  for (const on of [false, true]) {
    player.conserveMomentum = on;
    const x0 = on ? 30500 : 30000;
    stageAnchor(x0 + 300 * Math.cos(deg(30)), -300 - 300 * Math.sin(deg(30)));
    placeGlide(x0, -300, v0, 0);
    pressAndGrab();
    kept[on] = player.state === "swing" ? Math.hypot(player.vx, player.vy) / v0 : 0;
    up();
  }
  check("off: the grab projects the velocity like 1.2 (keeps ~50% here)", kept[false] > 0.42 && kept[false] < 0.58, `kept ${(100 * kept[false]).toFixed(0)}% of speed`);
  check("on: the same grab keeps the speed", kept[true] > 0.97, `kept ${(100 * kept[true]).toFixed(0)}% of speed`);
  player.conserveMomentum = false;
  quiet(); frame();
  const b = stageAnchor(31000, -600);
  placeSwing(b, 150, 0, 1300 / 150);
  let above = false;
  for (let i = 0; i < 120; i++) { quiet(); frame(); if (player.state === "swing" && player.y < b.y - 10) above = true; }
  check("off: the classic rope can loop too", above && player.state === "swing", `state ${player.state}`);
  up();
  player.conserveMomentum = true;
  restoreKnobs();
}

// --- 9. Hold to grab, as in 1.2; a hold in open sky does nothing else ------------------------
{
  setKnobs({ "tether.swingDrag": 0, "tether.conserveReelRate": 0 });
  for (const on of [false, true]) {
    const label = on ? "on" : "off";
    player.conserveMomentum = on;
    staged = null; // open sky
    placeGlide(33000 + (on ? 4000 : 0), -400, 500, 0);
    world.clouds.length = 0; // no skim points either
    const bonus0 = game.bonus;
    down();
    let swung = false;
    for (let i = 0; i < 60; i++) { quiet(); world.clouds.length = 0; frame(); if (player.state === "swing") swung = true; }
    check(`${label}: a hold in open sky just glides (no trick, no bonus points)`, !swung && player.state === "glide" && !("flipSpin" in player) && game.bonus === bonus0, `state ${player.state}, bonus +${(game.bonus - bonus0).toFixed(0)}`);
    // Still holding: an anchor that comes into reach is latched, as in 1.2.
    stageAnchor(player.x + 200, player.y - 150);
    let grabbed = false;
    for (let i = 0; i < 6; i++) { quiet(); frame(); if (player.state === "swing") { grabbed = true; break; } }
    check(`${label}: a held finger latches onto an anchor as it comes into reach`, grabbed, `state ${player.state}`);
    up();
  }
  player.conserveMomentum = true;
  restoreKnobs();
}

// --- 10. Switching mid-swing is seamless -----------------------------------------------------
{
  setKnobs({ "tether.swingDrag": 0, "tether.conserveReelRate": 0, "tether.reelRate": 0 });
  player.conserveMomentum = true;
  const a = stageAnchor(40000, -600);
  placeSwing(a, 200, 0.4, 700 / 200);
  for (let i = 0; i < 10; i++) { quiet(); frame(); }
  player.setConserveMomentum(false, game.time);
  for (let i = 0; i < 10; i++) { quiet(); frame(); }
  const ropeErr = Math.abs(Math.hypot(player.x - a.x, player.y - a.y) - player.ropeLen);
  check("turned off mid-swing: the classic rope carries on", player.conserveMomentum === false && player.state === "swing" && finite() && ropeErr < 1e-6, `rope error ${ropeErr.toExponential(1)} px`);
  const v1 = Math.hypot(player.vx, player.vy);
  const x1 = player.x, y1 = player.y;
  player.setConserveMomentum(true, game.time);
  const syncErr = Math.abs(player.ropeLen * Math.abs(player.swingOmega) - v1);
  check("turned on mid-swing: the pendulum starts from the same position and speed", player.x === x1 && player.y === y1 && syncErr < 1e-6 * v1, `speed ${v1.toFixed(1)} vs ${(player.ropeLen * Math.abs(player.swingOmega)).toFixed(1)}`);
  quiet(); frame();
  check("…and keeps swinging smoothly", player.state === "swing" && finite() && Math.abs(Math.hypot(player.vx, player.vy) - v1) < 40, `speed ${v1.toFixed(0)} → ${Math.hypot(player.vx, player.vy).toFixed(0)}`);
  up();
  restoreKnobs();
}

// --- 11. A smash's speed scrub mid-swing sticks ----------------------------------------------
{
  setKnobs({ "tether.swingDrag": 0, "tether.conserveReelRate": 0, "world.gravitySwing": 0 });
  player.conserveMomentum = true;
  const a = stageAnchor(42000, -600);
  placeSwing(a, 200, 0.3, 800 / 200);
  quiet(); frame();
  const v0 = player.speed;
  player.scaleVelocity(0.5);
  quiet(); frame();
  check("on: a speed scrub mid-swing sticks (the pendulum is scaled too)", Math.abs(player.speed / v0 - 0.5) < 0.01, `${v0.toFixed(0)} → ${player.speed.toFixed(0)}`);
  up();
  restoreKnobs();
}

// --- 12. The pause screen flips the option and the save keeps it --------------------------------
{
  staged = null;
  placeGlide(44000, -400, 400, 0);
  player.conserveMomentum = game.storage.data.conserveMomentum; // what the game believes
  const before = game.storage.data.conserveMomentum;
  dispatch("keydown", { code: "Escape" }); frame(); dispatch("keyup", { code: "Escape" }); frame();
  check("Esc pauses", game.state === "paused", game.state);
  const r = game.hud.pauseMenuButtons(game.camera).momentum;
  const tap = () => {
    dispatch("pointerdown", { clientX: r.x + r.w / 2, clientY: r.y + r.h / 2, pointerId: 1 }); frame();
    dispatch("pointerup", { clientX: r.x + r.w / 2, clientY: r.y + r.h / 2, pointerId: 1 }); frame();
  };
  tap();
  const saved1 = JSON.parse(globalThis.localStorage.store["gale.save.v1"] || "{}");
  check("tapping the button flips the option, for the player and in the save", game.state === "paused" && game.storage.data.conserveMomentum === !before && player.conserveMomentum === !before && saved1.conserveMomentum === !before, `save ${saved1.conserveMomentum}`);
  tap();
  check("tapping it again flips it back", game.state === "paused" && game.storage.data.conserveMomentum === before && player.conserveMomentum === before);
  dispatch("keydown", { code: "Escape" }); frame(); dispatch("keyup", { code: "Escape" }); frame();
  check("Esc resumes", game.state === "playing", game.state);
}

// --- 13. Restart Run from the pause screen ----------------------------------------------------
{
  for (const on of [false, true]) {
    const label = on ? "on" : "off";
    game.storage.data.conserveMomentum = on; player.conserveMomentum = on;
    staged = null;
    placeGlide(46000 + (on ? 3000 : 0), -400, 500, 0);
    quiet(); frame(5);
    game.runOrbs = 7;
    game.smashCharge = 0.5; game.barrier = true; game.magnetTime = 3;
    const runsBefore = game.storage.data.runs;
    const bestBefore = game.storage.data.bestScore;
    const clockBefore = game.time;
    const camBefore = game.camera.x;
    dispatch("keydown", { code: "Escape" }); frame(); dispatch("keyup", { code: "Escape" }); frame();
    check(`${label}: paused before the restart`, game.state === "paused", game.state);
    const r = game.hud.pauseMenuButtons(game.camera).restart;
    dispatch("pointerdown", { clientX: r.x + r.w / 2, clientY: r.y + r.h / 2, pointerId: 1 }); frame();
    dispatch("pointerup", { clientX: r.x + r.w / 2, clientY: r.y + r.h / 2, pointerId: 1 }); frame(2);
    check(`${label}: RESTART RUN starts a fresh run in place`, game.state === "playing" && game.runOrbs === 0 && game.score < 5 && game.distance < 5 && Math.abs(game.camera.x - camBefore) < 120 && game.time > clockBefore, `state ${game.state} orbs ${game.runOrbs} score ${game.score.toFixed(0)} camera moved ${(game.camera.x - camBefore).toFixed(0)}`);
    check(`${label}: the abandoned run is not recorded and power-ups are cleared`, game.storage.data.runs === runsBefore && game.storage.data.bestScore === bestBefore && !game.barrier && game.magnetTime === 0 && game.smashCharge === 0);
    check(`${label}: music resumes, and the swing option is kept`, game.sound.musicPaused === false && player.conserveMomentum === on && game.storage.data.conserveMomentum === on);
    player.x += 0; // keep going from the fresh run
  }
  game.storage.data.conserveMomentum = false; player.conserveMomentum = true;
}

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
