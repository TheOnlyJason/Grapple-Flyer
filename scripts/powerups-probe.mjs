// Power-up + orb logic probe (no rendering).   node scripts/powerups-probe.mjs
// Exercises the real built bundle: orb pickup and banking, the magnet pull,
// the barrier's meteor and cloud-sea saves, save-file migration and the spawn
// rules. Prints PASS/FAIL per check and exits non-zero on any failure.
// Set GALE_SAVE='<json>' to boot with that string as the stored save.
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
  store: process.env.GALE_SAVE !== undefined ? { "gale.save.v1": process.env.GALE_SAVE } : {},
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
let t = 0;
function frame(n = 1) {
  for (let i = 0; i < n; i++) {
    t += 1000 / 120;
    const cb = rafCb;
    rafCb = null;
    cb(t);
  }
}
const tap = () => {
  dispatch("pointerdown", { clientX: 640, clientY: 360, pointerId: 1 });
  frame();
  dispatch("pointerup", { clientX: 640, clientY: 360, pointerId: 1 });
  frame();
};
function restart() {
  for (let i = 0; i < 600 && game.state !== "playing"; i++) {
    if (i % 60 === 30) tap();
    else frame();
  }
  if (game.state !== "playing") throw new Error("could not start a run: " + game.state);
}
// A clean stage: level glide at cruise, nothing to grab or hit unless placed.
function stage() {
  restart();
  world.hazards.length = 0;
  world.collectibles.length = 0;
  world.powerups.length = 0;
  player.state = "glide"; player.anchor = null;
  player.y = 0; player.vy = 0; player.vx = 420;
  game.smashCharge = 0;
  game.runOrbs = 0; // orbs swept up while flying between stages don't count
  game.barrier = false; game.magnetTime = 0;
}
// Rocks and power-ups a stage placed on purpose; everything else the world
// generates is cleared each frame so it cannot interfere with a check.
const stagedRocks = new Set();
const stagedPowers = new Set();
const keepStaged = (list, staged) => {
  let w = 0;
  for (const e of list) if (staged.has(e)) list[w++] = e;
  list.length = w;
};
const clearAnchors = () => {
  for (const a of world.anchors) a.y = -99999; // nothing to latch onto
  world.clouds.length = 0; // no cloud skimming (it adds score and wind)
  keepStaged(world.hazards, stagedRocks);
  keepStaged(world.powerups, stagedPowers);
};
let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
const saved = () => JSON.parse(globalThis.localStorage.getItem("gale.save.v1") || "{}");

// --- 0. Save migration -------------------------------------------------------
if (process.env.GALE_SAVE !== undefined) {
  console.log(`booted with save: ${process.env.GALE_SAVE}`);
  check("orb bank is a non-negative integer", Number.isInteger(game.storage.data.orbs) && game.storage.data.orbs >= 0, `orbs=${game.storage.data.orbs}`);
  check("best score survives", typeof game.storage.data.bestScore === "number", `best=${game.storage.data.bestScore}`);
  console.log(JSON.stringify({ orbs: game.storage.data.orbs, best: game.storage.data.bestScore }));
  process.exit(failures ? 1 : 0);
}

frame(20);
check("fresh save starts with 0 orbs", game.storage.data.orbs === 0);

// Classes, from live instances (generate world until one of each exists).
restart();
for (let i = 0; i < 4000 && (world.powerups.length === 0 || !world.collectibles.some((c) => c.kind === "orb") || world.hazards.length === 0); i++) {
  for (const a of world.anchors) a.y = -99999;
  player.y = 0; player.vy = 0; player.vx = 900; world.hazards.forEach((h) => (h.y = -5000)); frame();
}
const PowerUp = world.powerups[0]?.constructor;
const Collectible = world.collectibles[0]?.constructor;
const rockProto = world.hazards[0];
check("world generated a power-up, an orb and a rock", !!PowerUp && !!Collectible && !!rockProto);
const cloneRock = (x, y) => {
  const r = Object.assign(Object.create(Object.getPrototypeOf(rockProto)), rockProto);
  r.shards = []; r.destroyed = false; r.shatter = 0; r.x = x; r.y = y;
  stagedRocks.add(r);
  return r;
};

// Keep only the staged pickups: the world keeps generating its own ahead.
function onlyStaged(staged) {
  const cs = world.collectibles;
  let w = 0;
  for (const c of cs) if (staged.has(c)) cs[w++] = c;
  cs.length = w;
  world.powerups.length = 0;
}

// --- 1. Orbs: pickup, score, banking -----------------------------------------
stage();
const bank0 = game.storage.data.orbs;
const bonus0 = game.bonus;
for (let i = 0; i < 5; i++) world.collectibles.push(new Collectible(player.x + 80 + i * 48, 0, "orb"));
world.collectibles.push(new Collectible(player.x + 400, 0, "wisp"));
const staged1 = new Set(world.collectibles);
const wind0 = game.wind;
for (let i = 0; i < 200; i++) { clearAnchors(); onlyStaged(staged1); player.y = 0; player.vy = 0; frame(); }
check("5 orbs collected", game.runOrbs === 5, `runOrbs=${game.runOrbs}`);
check("orbs score 10 each (+wisp 60)", Math.round(game.bonus - bonus0) === 5 * 10 + 60, `bonus +${game.bonus - bonus0}`);
check("wisp still feeds the wind gauge, orbs do not", Math.round(game.wind - wind0) === 9, `wind +${game.wind - wind0}`);
check("bank untouched mid-run", game.storage.data.orbs === bank0);
// End the run on a rock.
world.hazards.push(cloneRock(player.x + 200, 0));
for (let i = 0; i < 300 && game.state === "playing"; i++) { clearAnchors(); onlyStaged(staged1); world.hazards[0].y = player.y; frame(); }
check("run ended on the rock", game.state === "gameover", game.state);
check("orbs banked at run end", game.storage.data.orbs === bank0 + 5, `bank=${game.storage.data.orbs}`);
check("bank persisted to storage", saved().orbs === bank0 + 5, `saved=${saved().orbs}`);
check("effects cleared on game over", game.magnetTime === 0 && game.barrier === false);

// --- 2. Magnet ----------------------------------------------------------------
stage();
{ const pu = new PowerUp(player.x + 60, 0, "magnet"); stagedPowers.add(pu); world.powerups.push(pu); }
for (let i = 0; i < 60 && game.magnetTime === 0; i++) { clearAnchors(); player.y = 0; player.vy = 0; frame(); }
check("magnet pickup switches the magnet on", game.magnetTime > 7.5, `magnetTime=${game.magnetTime.toFixed(2)}`);
const near = new Collectible(player.x + 250, -260, "orb"); // ~360 px away: inside 380
const far = new Collectible(player.x + 300, -700, "orb"); // far outside
const wisp = new Collectible(player.x + 200, 220, "wisp");
world.collectibles.push(near, far, wisp);
const farY = far.baseY;
for (let i = 0; i < 240; i++) { clearAnchors(); player.y = 0; player.vy = 0; player.vx = 420; frame(); }
check("orb inside the range is pulled in and collected", near.collected);
check("wisp inside the range is pulled in too", wisp.collected);
check("orb outside the range stays put", !far.collected && Math.abs(far.baseY - farY) < 1);
let ticks = 0;
while (game.magnetTime > 0 && ticks < 2000) { clearAnchors(); player.y = 0; player.vy = 0; player.vx = 420; frame(); ticks++; }
check("magnet lasts ~8 s then ends", Math.abs((ticks + 240) / 120 - 8) < 0.6, `${((ticks + 240) / 120).toFixed(2)} s`);

// --- 3. Barrier vs meteors ------------------------------------------------------
stage();
{ const pu = new PowerUp(player.x + 60, 0, "barrier"); stagedPowers.add(pu); world.powerups.push(pu); }
for (let i = 0; i < 60 && !game.barrier; i++) { clearAnchors(); player.y = 0; player.vy = 0; frame(); }
check("barrier pickup raises the barrier", game.barrier === true);
const r1 = cloneRock(player.x + 260, 0);
const r2 = cloneRock(player.x + 300, 0); // overlapping twin right behind it
world.hazards.push(r1, r2);
for (let i = 0; i < 200 && game.state === "playing" && !(r1.destroyed && r2.destroyed); i++) { clearAnchors(); r1.y = r2.y = player.y; frame(); }
check("slow hit with a barrier: rock breaks, run continues", r1.destroyed && game.state === "playing", `speed ${player.speed.toFixed(0)} state ${game.state}`);
check("barrier is used up", game.barrier === false);
check("overlapping second rock is smashed in the grace window", r2.destroyed && game.state === "playing");
check("a barrier break is not a speed smash (no charge, no hint, no HUD)", !game.smashArmed && game.smashHintShown === false && player.smashGlow === false);
check("grace smashes are not credited to the smash objective", game.objectives.list.every((o) => o.kind !== "smash" || o.progress === 0));
const r3 = cloneRock(player.x + 1100, 0);
world.hazards.push(r3);
for (let i = 0; i < 600 && game.state === "playing" && !r3.destroyed; i++) { clearAnchors(); r3.y = player.y; player.vx = Math.min(player.vx, 500); frame(); }
check("no barrier, no charge: the next rock ends the run", game.state === "gameover" && !r3.destroyed, `state ${game.state}`);

// --- 4. Barrier vs the cloud sea ---------------------------------------------------
stage();
game.barrier = true;
const sea = world.seaLevel;
player.y = sea - 6; player.vy = 320; player.vx = 300;
let minY = player.y, bounced = false;
for (let i = 0; i < 240 && game.state === "playing"; i++) {
  clearAnchors(); frame();
  if (player.vy < 0) bounced = true;
  minY = Math.min(minY, player.y);
}
check("barrier turns a sea crash into a bounce", bounced && game.state === "playing", `state ${game.state}`);
check("barrier is used up by the bounce", game.barrier === false);
check("bounce climbs back toward the lowest anchors", sea - minY > 300, `rose ${(sea - minY).toFixed(0)} px`);
// Tethered at the sea line with the finger held: the rope must not drag the
// player back under after the bounce.
{
  let saved = 0, trials = 0;
  for (const [dx, ay] of [[160, 570], [220, 600], [120, 640], [260, 560], [180, 690]]) {
    stage();
    const a = world.anchors.find((an) => an.kind === "normal") ?? world.anchors[0];
    for (const an of world.anchors) an.y = -99999;
    a.x = player.x + dx; a.y = ay; if ("baseY" in a) a.baseY = ay; if ("baseX" in a) a.baseX = a.x;
    game.barrier = true;
    player.y = sea - 8; player.vy = 100; player.vx = 480;
    dispatch("pointerdown", { clientX: 640, clientY: 360, pointerId: 1 });
    let popped = false;
    for (let i = 0; i < 180 && game.state === "playing"; i++) { frame(); if (!game.barrier) popped = true; }
    dispatch("pointerup", { clientX: 640, clientY: 360, pointerId: 1 });
    frame();
    if (popped) { trials++; if (game.state === "playing") saved++; }
  }
  check("barrier saves a tethered player from the sea too", trials > 0 && saved === trials, `${saved}/${trials} staged grabs survived 1.5 s`);
}
// A fast, shallow entry: the launch must not push the player over smash speed.
stage();
game.barrier = true; game.smashHintShown = false;
player.y = sea - 6; player.vy = 320; player.vx = 760;
let peak = 0;
for (let i = 0; i < 120 && game.state === "playing"; i++) { clearAnchors(); frame(); peak = Math.max(peak, player.speed); }
check("a fast barrier bounce does not arm the smash", game.state === "playing" && !game.barrier && !game.smashArmed && game.smashHintShown === false && peak < 1050, `peak speed ${peak.toFixed(0)}`);
stage();
player.y = sea - 6; player.vy = 320;
for (let i = 0; i < 60 && game.state === "playing"; i++) { clearAnchors(); frame(); }
check("without a barrier the sea still ends the run", game.state === "crashing" || game.state === "gameover", game.state);

// --- 5. Spawn rules over a long stretch of world ------------------------------------
// Generate ahead without culling, then audit everything that is still live.
restart();
const x0 = world.genX;
world.collectibles.length = 0; world.powerups.length = 0; world.hazards.length = 0;
world.ensure(x0 + 400000);
const span = world.genX - x0;
const orbs = world.collectibles.filter((c) => c.kind === "orb" && !c.collected);
const wisps = world.collectibles.filter((c) => c.kind === "wisp");
const cleared = world.collectibles.filter((c) => c.kind === "orb" && c.collected).length;
const inRock = (x, y, pad) => world.hazards.some((h) => Math.abs(h.x - x) < 300 && h.hits(x, y, pad));
const badOrb = orbs.filter((c) => inRock(c.baseX, c.baseY, 10)).length;
const lowOrb = orbs.filter((c) => c.baseY > sea - 60).length;
const badPower = world.powerups.filter((p) => inRock(p.x, p.baseY, 30)).length;
const px = world.powerups.map((p) => p.x).sort((a, b) => a - b);
const gaps = px.slice(1).map((x, i) => x - px[i]);
const kinds = {};
for (const p of world.powerups) kinds[p.kind] = (kinds[p.kind] || 0) + 1;
console.log(`generated ${span.toFixed(0)} px: ${orbs.length} orbs (${((orbs.length / span) * 1000).toFixed(1)} per 1000 px, ${cleared} cleared out of rocks), ${wisps.length} wisps, ${world.hazards.length} rocks, ${px.length} power-ups ${JSON.stringify(kinds)}, gaps ${Math.min(...gaps).toFixed(0)}–${Math.max(...gaps).toFixed(0)} px`);
check("orbs spawn", orbs.length > 100);
check("no live orb inside a rock", badOrb === 0, `${badOrb}`);
check("no orb in the cloud sea", lowOrb === 0, `${lowOrb}`);
check("no power-up inside a rock", badPower === 0, `${badPower}`);
check("power-ups are rare and evenly mixed", px.length >= 8 && Math.min(...gaps) > 2000 && Math.abs((kinds.magnet || 0) - (kinds.barrier || 0)) <= 1);

// --- 6. Objectives: completed → crossed out → gone -----------------------------------
stage();
const objs = game.objectives.list;
check("three objectives listed", objs.length === 3 && objs.every((o) => !o.done && !o.gone && o.doneFor === 0));
const first = objs[0];
game.objectives.report(first.kind, first.target);
game.objectives.set(first.kind, first.target);
check("objective completes", first.done && !first.gone);
for (let i = 0; i < 30; i++) { clearAnchors(); player.y = 0; player.vy = 0; frame(); }
check("still listed while crossed out", first.done && !first.gone && first.doneFor > 0.2, `doneFor=${first.doneFor.toFixed(2)}`);
for (let i = 0; i < 200; i++) { clearAnchors(); player.y = 0; player.vy = 0; frame(); }
check("gone ~1.7 s after completing", first.gone, `doneFor=${first.doneFor.toFixed(2)}`);
check("the other two are untouched", objs.slice(1).every((o) => !o.done && !o.gone));
check("completed count is 1", game.objectives.completedCount === 1);

// --- 7. A new run restarts the difficulty ramp but not the world -----------------------
// Fly a long way (difficulty maxes out), die, restart in place.
stage();
for (let i = 0; i < 120 * 40; i++) { clearAnchors(); world.hazards.length = 0; player.y = 0; player.vy = 0; player.vx = 1400; frame(); }
const hardBefore = world.difficulty();
const clockBefore = game.time;
// Slow down and shed the smash charge and any barrier, so the rock is fatal.
player.vx = 420; game.smashCharge = 0; game.barrier = false; world.powerups.length = 0;
const killer = cloneRock(player.x + 200, 0);
world.hazards.push(killer);
for (let i = 0; i < 300 && game.state === "playing"; i++) { clearAnchors(); world.powerups.length = 0; killer.y = player.y; player.vx = 420; frame(); }
check("long first run ended", game.state === "gameover", `difficulty was ${hardBefore.toFixed(2)}`);
frame(120);
const onScreen = (e) => e.x <= game.camera.right;
const visibleBefore = world.anchors.filter(onScreen).length + world.clouds.filter(onScreen).length;
const camXBefore = game.camera.x;
tap(); frame(2);
check("second run started in place", game.state === "playing" && Math.abs(game.camera.x - camXBefore) < 40, `camera moved ${(game.camera.x - camXBefore).toFixed(0)} px`);
check("the sky keeps its time of day", game.time > clockBefore, `clock ${clockBefore.toFixed(1)} → ${game.time.toFixed(1)} s`);
check("what was on screen is still there", world.anchors.filter(onScreen).length + world.clouds.filter(onScreen).length >= visibleBefore - 1, `${visibleBefore} → ${world.anchors.filter(onScreen).length + world.clouds.filter(onScreen).length}`);
check("difficulty ramp restarted", hardBefore > 0.9 && world.difficulty() < 0.25, `${hardBefore.toFixed(2)} → ${world.difficulty().toFixed(2)}`);
const rocksEarly = world.hazards.filter((h) => !h.destroyed && h.x - h.rx > game.camera.right + 60 && h.x < player.x + 800).length;
check("no rocks generated in the fresh run's opening stretch", rocksEarly === 0, `${rocksEarly}`);

// --- 8. Restarts: nothing pops into view, trails stay whole, idling stays easy -------
{
  let popIns = 0, cutTrails = 0, restarts = 0, worstIdle = 0;
  let seed = 4242;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const [vw, vh] of [[667, 375], [1366, 1024], [932, 430]]) {
    game.resize(vw, vh, 2);
    for (let k = 0; k < 25; k++) {
      restart();
      // A short run, then a fatal rock.
      const fly = 60 + Math.floor(rnd() * 500);
      for (let i = 0; i < fly && game.state === "playing"; i++) {
        for (const a of world.anchors) if (a.x < player.x + 200) a.y = -99999;
        keepStaged(world.hazards, stagedRocks);
        player.y = 0; player.vy = 0; player.vx = 300 + rnd() * 900; frame();
      }
      player.vx = 420; game.smashCharge = 0; game.barrier = false; game.barrierGrace = 0;
      const killer = cloneRock(player.x + 150, 0);
      world.hazards.push(killer);
      for (let i = 0; i < 300 && game.state === "playing"; i++) { killer.y = player.y; player.vx = 420; game.barrier = false; frame(); }
      if (game.state !== "gameover") continue;
      // Idle on the game-over screen for a random while (up to ~40 s).
      const idle = 95 + Math.floor(rnd() * 3000);
      frame(idle);
      worstIdle = Math.max(worstIdle, world.difficulty());
      const cloudsBefore = new Set(world.clouds);
      const listBefore = world.collectibles.slice();
      const orbSet = new Set(listBefore.filter((c) => c.kind === "orb"));
      tap();
      if (game.state !== "playing") continue;
      restarts++;
      const right = game.camera.right;
      // New scenery whose solid body reaches into the frame = a pop-in.
      for (const c of world.clouds) if (!cloudsBefore.has(c) && c.x - (0.85 * c.rx + 0.56 * c.ry) < right) popIns++;
      for (const c of world.collectibles) if (c.kind === "orb" && !orbSet.has(c) && c.baseX + 9 < right) popIns++;
      // A kept orb whose own trail carries on to the right and was dropped =
      // a cut trail. One trail's orbs are neighbours in the world's list, left
      // to right; orbs of different trails have the next segment's wisps
      // between them, so only true neighbours are compared.
      const kept = new Set(world.collectibles);
      for (let i = 0; i + 1 < listBefore.length; i++) {
        const a = listBefore[i], b = listBefore[i + 1];
        if (a.kind !== "orb" || b.kind !== "orb") continue;
        const near = Math.hypot(a.baseX - b.baseX, a.baseY - b.baseY) <= 80;
        // (An orb marked collected was cleared out of a newly generated rock's
        // footprint and then culled — the normal rule, not a cut.)
        if (near && b.baseX > a.baseX && kept.has(a) && !kept.has(b) && !a.collected && !b.collected) cutTrails++;
      }
    }
  }
  game.resize(1280, 720, 2);
  check("restarts ran at three viewport sizes", restarts >= 60, `${restarts}`);
  check("no cloud or orb pops into view on a restart", popIns === 0, `${popIns} in ${restarts} restarts`);
  check("no orb trail is cut at the rebuild line", cutTrails === 0, `${cutTrails}`);
  check("idling on game over keeps the next opening easy", worstIdle < 0.3, `worst difficulty after idling ${worstIdle.toFixed(2)}`);
}

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
