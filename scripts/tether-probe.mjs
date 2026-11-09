// Tether physics probe: the swing must obey Newton.   node scripts/tether-probe.mjs
// Checks, against the real built bundle: the grab keeps the player's energy,
// a free swing does not drift, reeling in speeds the player up by exactly the
// rope ratio (angular momentum), a moving anchor hands its velocity over, and
// a whole glide → grab → swing → release → glide → grab chain conserves energy
// once every deliberate energy knob (boosts, drag, lift, gravity asymmetry) is
// zeroed. Knobs are set through window.GALE_CONFIG; nothing is rebuilt.
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
const NO_CAP = { "tether.maxSwingAngleDeg": 1e9 }; // the pure-physics checks loop on purpose
const restoreKnobs = () => { Object.assign(CFG.world, saved.world); Object.assign(CFG.player, saved.player); Object.assign(CFG.tether, saved.tether); };
const deg = (d) => (d * Math.PI) / 180;
const finite = () => [player.x, player.y, player.vx, player.vy, player.swingPhi, player.swingOmega].every(Number.isFinite);

// --- 1. The grab keeps the player's energy ------------------------------------------
// Glide made lossless and given the swing's gravity, so E = ½v² − g·y is one
// quantity across the grab. reel and drag off.
{
  setKnobs({ "tether.swingDrag": 0, "tether.reelRate": 0, "player.forwardDrag": 0, "player.vertDrag": 0, "player.glideLift": 0, "world.gravityAir": CFG.world.gravitySwing });
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
  setKnobs({ ...NO_CAP, "tether.swingDrag": 0, "tether.reelRate": 0 });
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
  setKnobs({ ...NO_CAP, "tether.swingDrag": 0, "tether.reelRate": 90, "world.gravitySwing": 0 });
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
  setKnobs({ "tether.swingDrag": 0, "tether.reelRate": 0, "world.gravitySwing": 0, "world.gravityAir": 0, "player.vertDrag": 0, "player.forwardDrag": 0, "player.glideLift": 0 });
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
  setKnobs({ "world.gravitySwing": 300, "world.gravityAir": 300, "player.forwardDrag": 0, "player.vertDrag": 0, "player.glideLift": 0, "tether.swingDrag": 0, "tether.reelRate": 0, "tether.releaseBoost": 1, "tether.perfectBoost": 1, "tether.perfectBonusSpeed": 0 });
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
  setKnobs({ ...NO_CAP, "tether.swingDrag": 0, "tether.reelRate": 0 });
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
  // Above (or level with) the anchor: the swing could not lift the player
  // past it, so the press is refused and the glide carries on untouched.
  a = stageAnchor(26000 + 100, -400 + 200);
  placeGlide(26000, -400, 500, 0);
  const grabbedFromAbove = pressAndGrab();
  check("a press above the anchor's height is refused", !grabbedFromAbove && player.state === "glide" && player.vx > 0, `state ${player.state} vx ${player.vx.toFixed(0)}`);
  up();
  a = stageAnchor(26500 + 200, -400 + 4);
  placeGlide(26500, -400, 500, 0);
  const grabbedLevel = pressAndGrab();
  check("a press at an anchor level with the player is refused", !grabbedLevel && player.state === "glide", `state ${player.state}`);
  up();
  restoreKnobs();
}

// --- 7. The cap: the hook slips at the anchor's height ------------------------------------
{
  setKnobs({ "tether.swingDrag": 0, "tether.reelRate": 0 });
  const a = stageAnchor(28000, -600);
  placeSwing(a, 150, 0, 1300 / 150); // would loop
  quiet();
  let maxPhi = 0, slipSpeed = 0, preSpeed = 0, slipped = false, slipY = 0;
  for (let i = 0; i < 240 && !slipped; i++) {
    preSpeed = Math.hypot(player.vx, player.vy);
    quiet(); frame();
    if (player.state === "swing") maxPhi = Math.max(maxPhi, Math.abs(player.swingPhi));
    else { slipped = true; slipSpeed = Math.hypot(player.vx, player.vy); slipY = player.y; }
  }
  check("a swing that would loop slips at the anchor's height instead", slipped && maxPhi <= Math.PI / 2 + 1e-9 && Math.abs(slipY - a.y) < 1.5, `max φ ${(maxPhi * 180 / Math.PI).toFixed(1)}°, slipped at y−anchor.y = ${(slipY - a.y).toFixed(1)}`);
  check("the slip keeps the speed (no boost, no loss)", slipped && Math.abs(slipSpeed - preSpeed) / preSpeed < 0.02, `${preSpeed.toFixed(0)} → ${slipSpeed.toFixed(0)}`);
  const slipAng = (Math.atan2(player.vy, player.vx) * 180) / Math.PI;
  check("the slip flings forward-up, not straight up", slipped && player.vx > 0 && Math.abs(slipAng - CFG.tether.slipLaunchAngleDeg) < 0.5, `launch ${slipAng.toFixed(1)}° (knob ${CFG.tether.slipLaunchAngleDeg}°), v (${player.vx.toFixed(0)}, ${player.vy.toFixed(0)})`);
  // Still holding: no re-grab, even with the anchor in reach.
  let regrabbed = false;
  for (let i = 0; i < 120; i++) { quiet(); frame(); if (player.state === "swing") regrabbed = true; }
  check("a held finger does not re-grab after the slip", !regrabbed, `state ${player.state}`);
  // Lift and press again: grabs.
  up(); quiet(); frame();
  player.x = a.x - 200; player.y = a.y + 150; player.vx = 500; player.vy = 0; game.camera.snapTo(player.x, player.y);
  down();
  let grabbed = false;
  for (let i = 0; i < 10 && !grabbed; i++) { quiet(); frame(); grabbed = player.state === "swing"; }
  check("a fresh press grabs again", grabbed);
  up();
  restoreKnobs();
}

// --- 7b. The anchor just left is off limits for a moment ------------------------------------
{
  setKnobs({ "tether.swingDrag": 0, "tether.reelRate": 0 });
  const a = stageAnchor(28600, -600);
  placeSwing(a, 150, deg(45), 900 / 150); // in the PERFECT window, rising
  quiet(); frame();
  up(); quiet(); frame(); // release
  const launched = player.state === "glide" && player.vx > 0 && player.vy < 0;
  down();
  let regrabbed = false;
  for (let i = 0; i < 6; i++) { quiet(); frame(); if (player.state === "swing") regrabbed = true; }
  check("a re-press right after a release does not re-grab the anchor just left", launched && !regrabbed && player.vx > 0, `state ${player.state}, v (${player.vx.toFixed(0)}, ${player.vy.toFixed(0)})`);
  up(); quiet(); frame();
  // ...but another anchor in reach is grabbed at once.
  const b = new Anchor(player.x + 160, player.y - 200);
  world.anchors.push(b);
  down();
  let grabbedOther = false;
  for (let i = 0; i < 6; i++) { world.anchors.length = 0; world.anchors.push(a, b); world.genX = player.x + 1e6; frame(); if (player.state === "swing") { grabbedOther = player.anchor === b; break; } }
  check("a different anchor can be grabbed right away", grabbedOther, `anchor is ${player.anchor === b ? "the new one" : player.anchor === a ? "the old one" : "none"}`);
  up();
  // After the cooldown the old anchor is fair game again.
  placeGlide(a.x - 200, a.y + 150, 400, 0);
  for (let i = 0; i < Math.ceil(CFG.tether.regrabCooldown * 120) + 12; i++) { quiet(); frame(); player.x = a.x - 200; player.y = a.y + 150; }
  check("the old anchor is grabbable again once the cooldown has run out", pressAndGrab() && player.anchor === a);
  up();
  restoreKnobs();
}

// --- 8. The classic model is still the old rod ----------------------------------------------
{
  setKnobs({ "tether.swingDrag": 0 });
  player.swingModel = "classic";
  // Level flight into an anchor 30° up: the old projection keeps sin(30°) = 50% of speed.
  const v0 = 700;
  const a = stageAnchor(30000 + 300 * Math.cos(deg(30)), -300 - 300 * Math.sin(deg(30)));
  placeGlide(30000, -300, v0, 0);
  pressAndGrab();
  const kept = Math.hypot(player.vx, player.vy) / v0;
  check("classic grab projects the velocity like before (keeps ~50% here)", player.state === "swing" && kept > 0.42 && kept < 0.58, `kept ${(100 * kept).toFixed(0)}% of speed`);
  // and it can loop (no cap applied to the classic rod)
  up(); quiet(); frame();
  const b = stageAnchor(31000, -600);
  placeSwing(b, 150, 0, 1300 / 150);
  let above = false;
  for (let i = 0; i < 120; i++) { quiet(); frame(); if (player.state === "swing" && player.y < b.y - 10) above = true; }
  check("classic rod is unchanged (it may still loop)", above && player.state === "swing", `state ${player.state}`);
  up();
  player.swingModel = "pendulum";
  restoreKnobs();
}

// --- 9. Restart run from the pause screen ------------------------------------------------------
{
  const a = stageAnchor(33000 + 300, -400 - 200);
  placeGlide(33000, -400, 500, 0);
  quiet(); frame(5);
  game.runOrbs = 7;
  const runsBefore = game.storage.data.runs;
  const clockBefore = game.time;
  const camBefore = game.camera.x;
  game.togglePause();
  check("paused", game.state === "paused");
  game.restartRun();
  frame(2);
  check("restart starts a fresh run in place", game.state === "playing" && game.runOrbs === 0 && Math.abs(game.camera.x - camBefore) < 60 && game.time > clockBefore, `state ${game.state} orbs ${game.runOrbs} camera moved ${(game.camera.x - camBefore).toFixed(0)}`);
  check("an abandoned run is not recorded", game.storage.data.runs === runsBefore);
  check("music resumes after a restart from pause", game.sound.musicPaused === false);
}

// --- 10. Deliberate grabs and backflips ------------------------------------------------
{
  setKnobs({ "tether.swingDrag": 0, "tether.reelRate": 0, "player.forwardDrag": 0, "player.vertDrag": 0, "player.glideLift": 0, "world.gravityAir": 0 });
  // Holding in open sky backflips: each full turn scores more and scrubs speed.
  staged = null; quiet();
  placeGlide(36000, -400, 600, 0);
  const bonus0 = game.bonus;
  const flipObj = game.objectives.list.find((o) => o.kind === "flip");
  const flipProgress0 = flipObj ? flipObj.progress : 0;
  down();
  let flips = [];
  for (let i = 0; i < 120 * 2; i++) { quiet(); frame(); if (game.bonus !== (flips.length ? flips[flips.length - 1].bonus : bonus0)) flips.push({ t: i / 120, bonus: game.bonus, speed: Math.hypot(player.vx, player.vy) }); }
  const gains = flips.map((f, i) => f.bonus - (i ? flips[i - 1].bonus : bonus0));
  check("holding in open sky backflips and scores 100, 200, 300…", flips.length >= 3 && gains[0] === 100 && gains[1] === 200 && gains[2] === 300 && player.state === "glide", `gains ${gains.join(",")} at ${flips.map((f) => f.t.toFixed(2) + "s").join(" ")}`);
  check("each flip scrubs 8% of speed", flips.length >= 2 && Math.abs(flips[1].speed / flips[0].speed - 0.92) < 0.01, `${flips.map((f) => f.speed.toFixed(0)).join(" → ")}`);
  check("the flip objective counts them", !flipObj || flipObj.progress - flipProgress0 === Math.min(flips.length, flipObj.target - flipProgress0));
  check("the character is spinning while held", Math.abs(player.flipSpin) > 0.5, `spin ${player.flipSpin.toFixed(2)}`);
  up();
  for (let i = 0; i < 60; i++) { quiet(); frame(); }
  check("the character settles upright after letting go", Math.abs(player.flipSpin) < 0.01, `spin ${player.flipSpin.toFixed(3)}`);

  // Holding past an anchor without a fresh press does not grab it.
  const a = stageAnchor(player.x + 600, player.y - 150);
  down(); // pressed in open sky (anchor 600 px away): a backflip, not a grab
  let grabbedWhileHeld = false;
  for (let i = 0; i < 240; i++) { quiet(); frame(); if (player.state === "swing") grabbedWhileHeld = true; }
  check("a hold that started in open sky never latches onto an anchor it passes", !grabbedWhileHeld && player.x > a.x, `state ${player.state}, passed anchor: ${player.x > a.x}`);
  up();

  // A press just before the anchor comes into reach still grabs (0.15 s grace).
  placeGlide(40000, -400, 500, 0);
  const c = stageAnchor(40000 + 470, -400 - 60); // 474 px away: out of reach at the press, in reach ~70 ms later
  down();
  let grabbedLate = false, framesToGrab = 0;
  for (let i = 0; i < 30 && !grabbedLate; i++) { quiet(); frame(); framesToGrab++; grabbedLate = player.state === "swing" && player.anchor === c; }
  check("a press within the grace window grabs the anchor as it comes into reach", grabbedLate && player.flipSpin === 0, `after ${framesToGrab} frames, spin ${player.flipSpin.toFixed(3)}`);
  up();

  // A press well before reach (beyond the grace) flips and does not grab.
  placeGlide(42000, -400, 500, 0);
  const d = stageAnchor(42000 + 650, -400 - 60); // in reach only after ~0.42 s
  down();
  let grabbedEarly = false;
  for (let i = 0; i < 90; i++) { quiet(); frame(); if (player.state === "swing") grabbedEarly = true; }
  check("a press long before reach is a backflip, not a grab", !grabbedEarly && Math.abs(player.flipSpin) > 0.5, `state ${player.state}`);
  up();
  restoreKnobs();
}

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
