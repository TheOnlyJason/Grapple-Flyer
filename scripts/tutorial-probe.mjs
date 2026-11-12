// Tutorial probe: a brand-new player's first flight.   node scripts/tutorial-probe.mjs
// Plays the first run the way a new player would — doing what each card
// says — and checks the cards come in order, time slows under the ones that
// wait for a move, nothing ends the run until it is over, it is saved as done,
// and the next run is normal. Also HOW TO PLAY, Restart Run and SKIP.
// GALE_SAVE='<json>' boots with that save instead of a fresh one.
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
// GALE_SIZE=WxH plays at that viewport (default 1280x720).
const [VW, VH] = (process.env.GALE_SIZE || "1280x720").split("x").map(Number);

const root = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(root, "..", "dist", "assets");
const bundle = readdirSync(assetsDir).find((f) => f.endsWith(".js"));
if (!bundle) {
  console.error("No built bundle found. Run `npm run build` first.");
  process.exit(1);
}

// --- Canvas 2D context mock (no-op, but gradients return usable objects) ---
const gradient = { addColorStop() {} };
// Every string the game draws, so the probe can check what is on screen.
const drawn = [];
const ctxMock = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === "createLinearGradient" || prop === "createRadialGradient")
        return () => gradient;
      if (prop === "measureText") return () => ({ width: 10 });
      if (prop === "fillText") return (str) => { drawn.push(String(str)); };
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
    width: VW,
    height: VH,
    style: {},
    classList: { add() {}, remove() {} },
    remove() {},
    setPointerCapture() {},
    releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: VW, height: VH }),
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
  innerWidth: VW,
  innerHeight: VH,
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
  // A brand-new player by default (GALE_SAVE=<json> boots with that save).
  store: process.env.GALE_SAVE !== undefined ? { "gale.save.v1": process.env.GALE_SAVE } : {},
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
// GALE_SEED=<n> shifts the pinned clock, so the run is a different world.
let fakeNow = 1762_000_000_000 + Number(process.env.GALE_SEED || 0) * 7919;
Date.now = () => (fakeNow += 1);
await import(path.join(assetsDir, bundle));

const game = globalThis.window.GALE;
if (!game) throw new Error("game instance not exposed on window.GALE");
const CFG = globalThis.window.GALE_CONFIG;
const player = game.player;
const tut = game.tutorial;

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
let t = 0;
function tick(n = 1) {
  for (let i = 0; i < n; i++) {
    t += 16.6;
    if (!rafCb) throw new Error("game stopped scheduling frames");
    const cb = rafCb;
    rafCb = null;
    cb(t);
    const p = game.player;
    if (![p.x, p.y, p.vx, p.vy].every(Number.isFinite)) throw new Error("player went non-finite");
  }
}
// Taps land in open sky mid-screen (the name row and corner buttons are controls).
const down = (x = VW / 2, y = VH * 0.45) => dispatch("pointerdown", { clientX: x, clientY: y, pointerId: 1 });
const up = (x = VW / 2, y = VH * 0.45) => dispatch("pointerup", { clientX: x, clientY: y, pointerId: 1 });
const tapAt = (r) => { down(r.x + r.w / 2, r.y + r.h / 2); tick(1); up(r.x + r.w / 2, r.y + r.h / 2); tick(1); };
// HOW TO PLAY lives on the settings page: SETTINGS on the home screen, then its row.
const openSettings = () => { const b = game.hud.navButtons(game.camera, true).settings; down(b.x, b.y); tick(1); up(b.x, b.y); tick(2); };
const howToPlay = () => { openSettings(); tapAt(game.hud.settingsRows(game.camera).howTo); };
const key = (code) => { dispatch("keydown", { code }); tick(1); dispatch("keyup", { code }); };
const hud = () => game.buildHudData();

// The returning-player check (section 7) runs this file again with a 1.2 save.
if (process.env.GALE_MUTE_CHECK === "1") {
  tick(5);
  console.log(`MUTED AT BOOT: ${game.sound.enabled === false}`);
  process.exit(0);
}
if (process.env.GALE_RETURNING_CHECK === "1") {
  tick(20);
  down(); tick(2); up(); tick(2);
  console.log(game.state === "playing" && !tut.active ? "RETURNING: no tutorial" : `RETURNING: tutorial=${tut.active} state=${game.state}`);
  process.exit(0);
}

// Play through the tutorial the way a new player would: do what each card says.
// Returns the cards seen (in order), the slowest time scale under each, and more.
// A person needs a moment to read a card and react: the bot waits REACT frames.
const REACT = 24; // 0.4 s at 60 fps
function playThrough(maxFrames = 6000) {
  const seen = [];
  const slowest = {};
  let holding = false, swingFrames = 0, perfects0 = game.perfectCount, frames = 0, deaths = 0;
  let cardFor = 0, lastWant = null, lessonRock = null;
  const covered = new Set();
  let objectivesHiddenWhileActive = true, hintSuppressed = true;
  while (frames < maxFrames && tut.active) {
    frames++;
    const want = tut.want;
    cardFor = want && want === lastWant ? cardFor + 1 : 0;
    lastWant = want;
    const ready = cardFor >= REACT;
    if (want && seen[seen.length - 1] !== want) seen.push(want);
    if (want) slowest[want] = Math.min(slowest[want] ?? 1, game.timeScale);
    if (want && tut.shown === want && tut.alpha > 0.95 && game.hud.lastTutorialCard) {
      const f = game.buildHudData().tutorial.focus, c = game.hud.lastTutorialCard;
      if (f && f.bottom > c.y && f.top < c.y + c.h) covered.add(want);
    }
    const h = hud();
    if (h.tutorial.active && h.hintAlpha > 0) hintSuppressed = false;
    if (game.state !== "playing") { deaths++; break; }
    if (player.state === "swing") swingFrames++; else swingFrames = 0;
    if (!holding && (want === "grab" || want === "chain") && ready) { down(); holding = true; }
    else if (holding && player.state === "swing" && ((want === "release" && ready && player.inPerfectWindow) || (want !== "release" && swingFrames > 30 && player.inPerfectWindow) || swingFrames > 400)) { up(); holding = false; }
    else if (holding && player.state !== "swing" && want !== "grab" && want !== "chain") { up(); holding = false; }
    if (want === "dash" && ready) key("KeyD");
    if (game.tutorialRock) lessonRock = game.tutorialRock;
    tick(1);
  }
  if (holding) up();
  return { seen, slowest, frames, deaths, perfects: game.perfectCount - perfects0, hintSuppressed, lessonRock, covered: [...covered] };
}

// --- 1. A brand-new player: the first run is the tutorial ----------------------------------
tick(20);
check("menu first", game.state === "menu", game.state);
check("a new save has not done the tutorial", game.storage.data.tutorialDone === false && game.storage.data.runs === 0);
down(); tick(2); up(); tick(2);
check("tapping play starts the tutorial run", game.state === "playing" && tut.active, `state ${game.state}, tutorial ${tut.active}`);
{
  drawn.length = 0;
  tick(2);
  check("objectives are hidden and SKIP is up while it runs", !drawn.some((x) => x.startsWith("OBJECTIVES")) && drawn.includes("SKIP TUTORIAL"), `drew ${[...new Set(drawn)].slice(0, 8).join(" / ")}`);
}
const stored = () => JSON.parse(globalThis.localStorage.store["gale.save.v1"] || "{}");
{
  // The tap that started the run must not be taken as the grab.
  let grabbedOnStart = false;
  for (let i = 0; i < 10; i++) { tick(1); if (player.state === "swing") grabbedOnStart = true; }
  check("the start tap is not a grab", !grabbedOnStart);
}
const run1 = playThrough();
console.log(`      cards: ${run1.seen.join(" → ")} | slowest: ${Object.entries(run1.slowest).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ")} | ${run1.frames} frames`);
check("the cards come in order: grab, release, chain, dash, sea, done",
  JSON.stringify(run1.seen) === JSON.stringify(["grab", "release", "chain", "dash", "sea", "done"]), run1.seen.join(","));
check("time slows under the grab, release, chain and dash cards", (run1.slowest.grab ?? 1) < 0.2 && (run1.slowest.release ?? 1) < 0.15 && (run1.slowest.chain ?? 1) < 0.4 && (run1.slowest.dash ?? 1) < 0.2);
check("with a 0.4 s reaction, the release card still lands a PERFECT", run1.perfects >= 1, `${run1.perfects} perfect`);
check("the info cards do not slow time", (run1.slowest.sea ?? 1) > 0.95 && (run1.slowest.done ?? 1) > 0.95);
check("letting go on the release card is a PERFECT", run1.perfects >= 1, `${run1.perfects} perfect`);
check("the 1.2 start hint stays hidden during the tutorial", run1.hintSuppressed);
check("no card covers the plane or what it points at", run1.covered.length === 0, run1.covered.join(", ") || "clear");
check("the run survives the tutorial", run1.deaths === 0 && game.state === "playing");
check("finishing saves it and ends the slow motion", !tut.active && stored().tutorialDone === true && Math.abs(game.timeScale - 1) < 1e-9, `saved ${stored().tutorialDone}, timeScale ${game.timeScale}`);
{
  drawn.length = 0;
  tick(2);
  check("afterwards the objectives are back and SKIP is gone", drawn.some((x) => x.startsWith("OBJECTIVES")) && !drawn.includes("SKIP TUTORIAL"));
}
check("the dash lesson's dash smashes its rock", !!run1.lessonRock && run1.lessonRock.destroyed === true, run1.lessonRock ? `destroyed ${run1.lessonRock.destroyed}` : "no rock staged");

// --- 2. Afterwards the run is real, and the next run has no tutorial --------------------------
{
  player.y = game.world.seaLevel - 4; player.vy = 500;
  let ended = false;
  for (let i = 0; i < 600 && !ended; i++) { tick(1); ended = game.state === "gameover"; }
  check("after the tutorial the cloud sea ends the run as usual", ended, game.state);
  tick(30);
  // A resting left thumb taps the bottom-left corner to fly again: that is a
  // normal run (the corner holds the best run, not a button).
  const cx = game.camera.insets.left + 60, cy = game.camera.h - game.camera.insets.bottom - 40;
  down(cx, cy); tick(2); up(cx, cy); tick(2);
  check("the next run starts without the tutorial (a tap in the bottom-left corner)", game.state === "playing" && !tut.active, `state ${game.state}, tutorial ${tut.active}`);
}

// --- 3. Nothing ends a run during the tutorial --------------------------------------------------
{
  // Back to the menu through a death, then HOW TO PLAY.
  player.y = game.world.seaLevel - 4; player.vy = 500;
  for (let i = 0; i < 900 && game.state !== "gameover"; i++) tick(1);
  tick(30);
  howToPlay();
  check("HOW TO PLAY starts the tutorial again", game.state === "playing" && tut.active);
  for (let i = 0; i < 20; i++) tick(1);
  player.y = game.world.seaLevel - 4; player.vy = 600; player.state = "glide"; player.anchor = null;
  let low = 0;
  for (let i = 0; i < 120; i++) { tick(1); low = Math.max(low, player.y); }
  check("the cloud sea throws the player back up during the tutorial", game.state === "playing" && player.y < game.world.seaLevel, `state ${game.state}, deepest y ${low.toFixed(0)}`);
}

// --- 4. Restart Run during the tutorial starts it over; SKIP ends it for good ------------------
{
  key("Escape"); tick(1);
  check("paused mid-tutorial", game.state === "paused", game.state);
  tapAt(game.hud.pauseMenuButtons(game.camera).restart);
  tick(2);
  check("Restart Run during the tutorial starts it over", game.state === "playing" && tut.active && tut.step === "grab", `step ${tut.step}`);
  // As if it had never been finished, in the save itself.
  game.storage.data.tutorialDone = false;
  game.storage.save();
  for (let i = 0; i < 10; i++) tick(1);
  const r = game.hud.tutorialSkipButton(game.camera);
  let grabbedBySkip = false;
  down(r.x + r.w / 2, r.y + r.h / 2);
  for (let i = 0; i < 20; i++) { tick(1); if (player.state === "swing") grabbedBySkip = true; }
  up(r.x + r.w / 2, r.y + r.h / 2); tick(1);
  check("SKIP ends the tutorial and saves it as done", !tut.active && stored().tutorialDone === true && game.timeScale === 1, `saved ${stored().tutorialDone}`);
  check("the SKIP tap is not a grab", !grabbedBySkip);
}

// --- 5. SKIP during the dash card removes the lesson's rock --------------------------------
{
  player.y = game.world.seaLevel - 4; player.vy = 500;
  for (let i = 0; i < 900 && game.state !== "gameover"; i++) tick(1);
  tick(30);
  howToPlay();
  // Jump the tutorial to its dash lesson.
  tut.step = "dash";
  let prompted = false;
  for (let i = 0; i < 900 && !prompted; i++) { if (player.state === "swing") { up(); } tick(1); prompted = tut.want === "dash"; }
  const rock = game.tutorialRock;
  check("the dash lesson stages a rock ahead and fills the gauge", prompted && rock && rock.x > player.x && game.wind >= CFG.wind.dashCost, `rock ${rock ? (rock.x - player.x).toFixed(0) : "none"} px ahead, gauge ${game.wind}`);
  if (rock) {
    // A rock in the face during the tutorial only breaks.
    const other = new rock.constructor(player.x + 10, player.y, 40, 40, game.rng);
    game.world.hazards.push(other);
    tick(3);
    check("a rock only breaks during the tutorial", game.state === "playing" && other.destroyed, `state ${game.state}, destroyed ${other.destroyed}`);
  }
  const r = game.hud.tutorialSkipButton(game.camera);
  tapAt(r);
  check("SKIP during the dash card takes the rock away with it", !tut.active && rock && !game.world.hazards.includes(rock));
}

// --- 5b. The dash card: at the top (its rock is low), hidden while paused, and it gives up ---------
{
  player.y = game.world.seaLevel - 4; player.vy = 500;
  for (let i = 0; i < 900 && game.state !== "gameover"; i++) tick(1);
  tick(30);
  howToPlay();
  tut.step = "dash";
  let prompted = false;
  for (let i = 0; i < 900 && !prompted; i++) { tick(1); prompted = tut.want === "dash"; }
  for (let i = 0; i < 20; i++) tick(1); // let it fade in
  const rock = game.tutorialRock;
  const cam = game.camera;
  const card = game.hud.lastTutorialCard;
  const rTop = (rock.y - rock.ry - cam.y) * cam.zoom, rBot = (rock.y + rock.ry - cam.y) * cam.zoom;
  check("the dash card does not cover its rock", prompted && !!card && (rBot < card.y || rTop > card.y + card.h), card ? `rock y ${rTop.toFixed(0)}..${rBot.toFixed(0)}, card y ${card.y.toFixed(0)}..${(card.y + card.h).toFixed(0)}` : "no card drawn");
  key("Escape"); tick(2);
  check("cards are hidden while paused", game.state === "paused" && hud().tutorial.alpha === 0);
  key("Escape"); tick(2);
  // Never tap DASH: the lesson moves on after 8 s and takes its rock away.
  let movedOn = false;
  for (let i = 0; i < 60 * 10 && !movedOn; i++) { tick(1); movedOn = tut.step === "sea" || tut.step === "done" || !tut.active; }
  tick(5); // the rock goes on the next physics step
  check("a dash card nobody answers gives up after 8 s and clears its rock", movedOn && !game.world.hazards.includes(rock), `step ${tut.step}, rock still listed ${game.world.hazards.includes(rock)}, is lesson rock ${rock === game.tutorialRock}, destroyed ${rock.destroyed}, dx ${(rock.x - player.x).toFixed(0)}, lesson rock now ${game.tutorialRock ? "set" : "null"}`);
  // and the closing cards keep an anchor in reach for when the net goes
  let anchorNear = false;
  for (let i = 0; i < 60 * 7 && tut.active; i++) {
    tick(1);
    if (game.world.anchors.some((a) => a.x > player.x && a.x < player.x + 700 && a.y < player.y)) anchorNear = true;
  }
  check("when the safety net goes there is an anchor ahead", anchorNear && !tut.active);
}

// --- 5c. A finger kept down from the play tap still gets to grab -----------------------------------
{
  player.y = game.world.seaLevel - 4; player.vy = 500;
  for (let i = 0; i < 900 && game.state !== "gameover"; i++) tick(1);
  tick(30);
  openSettings();
  const hb = game.hud.settingsRows(game.camera).howTo;
  down(hb.x + hb.w / 2, hb.y + hb.h / 2); // and never lift it
  let grabbed = false;
  for (let i = 0; i < 60 * 12 && !grabbed; i++) { tick(1); grabbed = player.state === "swing"; }
  up(hb.x + hb.w / 2, hb.y + hb.h / 2); tick(2);
  check("a finger held down from the start grabs once an anchor comes", tut.active !== undefined && grabbed);
  if (tut.active) tapAt(game.hud.tutorialSkipButton(game.camera)); // back to a normal run
}

// --- 6. The tutorial cannot stall --------------------------------------------------------------
{
  // (a) No anchor anywhere ahead (a missed opening anchor, a sparse sky):
  // the tutorial hangs a good one in reach before long.
  player.y = game.world.seaLevel - 4; player.vy = 500;
  for (let i = 0; i < 900 && game.state !== "gameover"; i++) tick(1);
  tick(30);
  howToPlay();
  for (let i = 0; i < 5; i++) tick(1);
  game.world.anchors.length = 0;
  // In slow motion a frame can run no physics step, so the card still
  // standing for an anchor just removed takes a moment to go.
  for (let i = 0; i < 60 && tut.want === "grab"; i++) { game.world.genX = player.x + 1e6; tick(1); }
  let shownAfter = -1;
  for (let i = 0; i < 400 && shownAfter < 0; i++) {
    game.world.anchors = game.world.anchors.filter((a) => a === game.tutorialAnchor); // nothing but the tutorial's own
    game.world.genX = player.x + 1e6;
    tick(1);
    if (tut.want === "grab") shownAfter = i;
  }
  check("with no anchor in the sky, the tutorial hangs a good one and the grab card shows", shownAfter >= 0, shownAfter >= 0 ? `after ${(shownAfter / 60).toFixed(1)} s` : "never");
  // (The card can come up as the anchor crosses the view's edge, so look
  // over its first half second rather than at one instant.)
  let lit = null;
  for (let i = 0; i < 30 && !(lit && lit.y < player.y - 60 && lit.x > player.x); i++) {
    lit = player.findGrabTarget(game.world.anchors, game.camera);
    if (!(lit && lit.y < player.y - 60 && lit.x > player.x)) tick(1);
  }
  check("…an anchor above and ahead of the plane", !!lit && lit.y < player.y - 60 && lit.x > player.x, lit ? `dx ${(lit.x - player.x).toFixed(0)} dy ${(lit.y - player.y).toFixed(0)}` : "none");
  // (b) A weak grab (a level anchor right ahead: the 1.2 rope hangs dead):
  // the card says to let go instead of leaving the player holding forever.
  const A = lit ? lit.constructor : null;
  if (A) {
    game.world.anchors.length = 0;
    const level = new A(player.x + 180, player.y - 4, "normal");
    game.world.anchors.push(level);
    down();
    let grabbed = false;
    for (let i = 0; i < 30 && !grabbed; i++) { tick(1); grabbed = player.state === "swing"; }
    let letgoAfter = -1;
    for (let i = 0; i < 600 && letgoAfter < 0; i++) {
      game.world.anchors = [level]; game.world.genX = player.x + 1e6;
      tick(1);
      if (tut.want === "letgo") letgoAfter = i;
    }
    check("a swing that cannot reach gold gets a Let go card", grabbed && letgoAfter >= 0, `grabbed ${grabbed}, card after ${letgoAfter >= 0 ? (letgoAfter / 60).toFixed(1) + " s" : "never"}`);
    up(); tick(2);
    check("…and letting go moves the lesson on", tut.step === "chain", `step ${tut.step}`);
  }
}

// --- 7. A returning player (a 1.2 save with runs) never gets it automatically ------------------
{
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, GALE_RETURNING_CHECK: "1", GALE_SAVE: JSON.stringify({ bestScore: 900, bestDistance: 400, runs: 7, totalPerfect: 3, orbs: 40, character: "plane" }) },
    encoding: "utf8",
  });
  check("a returning 1.2 player's first run here has no tutorial", out.includes("RETURNING: no tutorial"), out.trim().split("\n").pop());
  const muted = execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, GALE_MUTE_CHECK: "1", GALE_SAVE: JSON.stringify({ runs: 3, tutorialDone: true, muted: true }) },
    encoding: "utf8",
  });
  check("the mute button's setting survives a relaunch", muted.includes("MUTED AT BOOT: true"), muted.trim().split("\n").pop());
}
console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
