// Daily-run probe.   node scripts/daily-probe.mjs
// The daily run must give every player the same world for the day: the same
// anchors, rocks, orbs, clouds, power-ups and objectives in the same places,
// whatever the screen size, the swing option, how the player flies, or how
// the run was started (from the home screen, after a game over, or by
// Restart Run). Each case runs in a child process (the game is a module
// singleton) and reports what the world generated while the run was live;
// the parent compares them. Also checks per-swing and per-day bests, the
// trail shop, and save migration. Same canvas mocks as smoke.mjs.
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import path from "node:path";

const self = fileURLToPath(import.meta.url);
const root = path.dirname(self);
const assetsDir = path.join(root, "..", "dist", "assets");
const bundle = readdirSync(assetsDir).find((f) => f.endsWith(".js"));
if (!bundle) {
  console.error("No built bundle found. Run `npm run build` first.");
  process.exit(1);
}

const CASE = process.env.DAILY_CASE;

if (!CASE) {
  // --- Parent: run the cases and compare. ---------------------------------
  const run = (name, env = {}) =>
    JSON.parse(
      execFileSync(process.execPath, [self], {
        env: { ...process.env, DAILY_CASE: name, ...env },
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      }).trim().split("\n").pop()
    );
  let failures = 0;
  const check = (ok, label, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
    if (!ok) failures++;
  };

  const cases = {
    eager: run("world", { SIZE: "1280x720", EAGER: "1" }),
    bot: run("world", { SIZE: "1280x720", BOT: "0.8" }),
    phone: run("world", { SIZE: "844x390", BOT: "0.3", CONSERVE: "1" }),
    small: run("world", { SIZE: "568x320" }),
    ipad: run("world", { SIZE: "1366x1024", BOT: "0.6", RESTART: "1" }),
    again: run("world", { SIZE: "1280x720", BOT: "0.5", AFTER_GAMEOVER: "1" }),
  };
  const ref = cases.eager;
  for (const [name, c] of Object.entries(cases)) {
    if (name === "eager") continue;
    // Compared as sets (generated eagerly, a burst of segments lists its
    // anchors before its rocks; flown, they arrive segment by segment), up to
    // where both worlds reach.
    const upTo = Math.min(ref.liveGenX, c.liveGenX) - 1500;
    const keys = (list) => list.filter((o) => o[1] < upTo).map((o) => JSON.stringify(o)).sort();
    const a = keys(ref.objects);
    const b = keys(c.objects);
    const same = JSON.stringify(a) === JSON.stringify(b);
    check(same && a.length > 10, `${name}: the same world as generated eagerly`, `${b.length} objects to x ${Math.round(upTo)}, ${c.note}`);
    check(JSON.stringify(c.objectives) === JSON.stringify(ref.objectives), `${name}: the same objectives`, c.objectives.join(" | "));
  }
  const other = run("world", { SIZE: "1280x720", EAGER: "1", FAKE_DATE: "2026-11-12T09:00:00" });
  check(JSON.stringify(other.objects.slice(0, 40)) !== JSON.stringify(ref.objects.slice(0, 40)), "another day: a different world", `${ref.day} vs ${other.day}`);
  const normal = run("world", { SIZE: "1280x720", EAGER: "1", NORMAL: "1" });
  check(JSON.stringify(normal.objects.slice(0, 40)) !== JSON.stringify(ref.objects.slice(0, 40)), "an ordinary run: not the daily world");

  const rec = run("records");
  for (const [label, ok, detail] of rec.checks) check(ok, label, detail);
  const tamper = run("tamper");
  for (const [label, ok, detail] of tamper.checks) check(ok, label, detail);
  const views = run("views", { FAKE_DATE: "2026-11-11T23:59:00" });
  for (const [label, ok, detail] of views.checks) check(ok, label, detail);

  console.log(failures ? `\n${failures} FAILED` : "\nall daily checks passed");
  process.exit(failures ? 1 : 0);
}

// --- Child: boot the game. -------------------------------------------------
const [VW, VH] = (process.env.SIZE || "1280x720").split("x").map(Number);
if (process.env.FAKE_DATE) {
  const RealDate = Date;
  let fixed = new RealDate(process.env.FAKE_DATE).getTime();
  globalThis.setFakeDate = (iso) => {
    fixed = new RealDate(iso).getTime();
  };
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixed]));
    }
    static now() {
      return fixed;
    }
  };
}
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
  createElement: (tag) => (tag === "canvas" ? makeEl() : { relList: { supports: () => true } }),
  querySelectorAll: () => [],
  addEventListener() {},
};
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
};
const initialSave =
  CASE === "records"
    ? // A save from before 1.3: one best, some orbs, no shop, no daily.
      { tutorialDone: true, runs: 40, bestScore: 9000, bestDistance: 2500, orbs: 150, character: "monkey" }
    : CASE === "tamper"
      ? // Hand-edited: wearing a trail it never bought, junk in the shop list and records.
        {
          tutorialDone: true,
          runs: 2,
          trail: "aurora",
          owned: ["trail:coral", "trail:nope", 7, "trail:coral"],
          bestScore: -5,
          conserveBestScore: "lots",
          daily: { date: 5, "not-a-day": { classic: { score: 9 } }, "2026-11-10": { classic: { score: "x", distance: 40 } }, "2026-11-09": null },
          orbs: 30,
        }
      : CASE === "views"
        ? { tutorialDone: true, runs: 9, bestScore: 9000, bestDistance: 2500 }
      : { tutorialDone: true, runs: 3 };
globalThis.localStorage = {
  store: { "gale.save.v1": JSON.stringify(initialSave) },
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
const tapAt = (x, y) => {
  dispatch("pointerdown", { clientX: x, clientY: y, pointerId: 1 });
  frame();
  dispatch("pointerup", { clientX: x, clientY: y, pointerId: 1 });
  frame();
};
const centre = (r) => [r.x + r.w / 2, r.y + r.h / 2];
const flyTap = () => tapAt(VW / 2, VH * 0.45);
frame(60);

if (CASE === "tamper") {
  const S = game.storage;
  const checks = [
    ["tampered save: a trail it does not own is not worn", S.data.trail === "own" && player.trailId === "own", S.data.trail],
    ["tampered save: only real shop items are kept, once each", JSON.stringify(S.data.owned) === JSON.stringify(["trail:coral"]), JSON.stringify(S.data.owned)],
    ["tampered save: bad records read as none", S.data.bestScore === 0 && S.data.conserveBestScore === 0],
    [
      "tampered save: only real days are kept, their junk read as none",
      JSON.stringify(S.data.daily) === JSON.stringify({ "2026-11-10": { classic: { score: 0, distance: 40 }, conserve: { score: 0, distance: 0 } } }),
      JSON.stringify(S.data.daily),
    ],
    ["tampered save: buying with too few orbs fails", S.buy("trail:lilac", 120) === false && S.data.orbs === 30],
    ["tampered save: an unknown item cannot be bought", S.buy("trail:nope", 0) === false],
  ];
  console.log(JSON.stringify({ checks }));
  process.exit(0);
}

if (CASE === "views") {
  // What the screens show: the game-over screen pairs NEW BEST / BEST TODAY
  // with the record of the run just flown, whatever the next run would be.
  const checks = [];
  const ok = (label, cond, detail = "") => checks.push([label, !!cond, detail]);
  const S = game.storage;
  const hud = () => game.buildHudData();
  performance.now = () => t; // the game reads the date at most once a second of this clock
  const endWith = (score, metres) => {
    game.distance = metres;
    game.bonus = score - metres;
    game.endRun({});
    frame(140);
  };

  // 1. Conserve on at the start, switched off in the pause screen: still Conserve's run.
  S.setConserveMomentum(true);
  flyTap();
  frame(10);
  game.togglePause();
  game.toggleConserveMomentum();
  game.togglePause();
  endWith(3000, 1000);
  let d = hud();
  ok(
    "Conserve switched off mid-run: its game over shows Conserve's record beside NEW BEST",
    d.state === "gameover" && d.newBest && d.bestConserve && d.best === 3000 && d.bestDistance === 1000 && S.best("classic").score === 9000,
    JSON.stringify({ newBest: d.newBest, bestConserve: d.bestConserve, best: d.best, bestDistance: d.bestDistance })
  );
  flyTap();
  frame(10);
  d = hud();
  ok("...and the next run, on the classic rope, chases the classic best", d.state === "playing" && !d.bestConserve && d.best === 9000);
  endWith(500, 200);
  d = hud();
  ok("a classic run below the best: no flag, the classic record", !d.newBest && d.dailyFlag === "" && !d.bestConserve && d.best === 9000);

  // 1b. The camera's speed pull-back (Conserve momentum's) never leaks into
  // a classic run's opening: grabs are gated by the view.
  const cam = game.camera;
  const wide = () => {
    game.paceSpeed = 1500;
    cam.setPull(0.8, player.x, player.y);
  };
  wide();
  flyTap();
  frame(2);
  ok("a classic run starts with the 1.2 camera even if the last run left it pulled back", game.state === "playing" && cam.pull === 0 && cam.zoom === cam.baseZoom, `pull ${cam.pull}`);
  endWith(100, 50);
  S.setConserveMomentum(true);
  player.setConserveMomentum(true);
  wide();
  flyTap();
  frame(2);
  ok("a Conserve run keeps the camera where it was (no pop)", game.state === "playing" && cam.pull > 0.5, `pull ${cam.pull}`);
  endWith(100, 50);
  S.setConserveMomentum(false);
  player.setConserveMomentum(false);

  // 2. DAILY RUN on, then HOW TO PLAY: the tutorial run is an ordinary one.
  tapAt(...centre(game.hud.dailyButton(game.camera)));
  frame(5);
  d = hud();
  ok("DAILY RUN switched on at a game over: the corner turns to today's best", d.bestDaily && d.bestDay === "TODAY" && d.best === 0 && d.daily.on);
  tapAt(...centre(game.hud.howToPlayButton(game.camera)));
  frame(10);
  ok("HOW TO PLAY with DAILY RUN on flies an ordinary run, with the tutorial", game.state === "playing" && game.runDaily === null && game.tutorial.active);
  game.skipTutorial();
  endWith(10000, 3000);
  d = hud();
  ok(
    "...whose game over shows the classic record it set, not today's",
    d.newBest && !d.bestDaily && d.best === 10000 && d.bestDistance === 3000 && Object.keys(S.data.daily).length === 0,
    JSON.stringify({ newBest: d.newBest, bestDaily: d.bestDaily, best: d.best })
  );

  // 3. A daily run begun at 23:59 and ended after midnight belongs to the day it began.
  S.setConserveMomentum(true);
  player.setConserveMomentum(true);
  wide();
  flyTap();
  frame(1);
  ok("every daily attempt starts with the plain camera, Conserve or not", game.state === "playing" && game.runDaily === "2026-11-11" && cam.pull < 0.02, `pull ${cam.pull}`);
  game.endRun({});
  frame(140);
  S.setConserveMomentum(false);
  player.setConserveMomentum(false);
  S.data.daily = {};
  flyTap();
  frame(10);
  ok("the next tap flies the daily run", game.state === "playing" && game.runDaily === "2026-11-11", String(game.runDaily));
  d = hud();
  ok("in the run, before any best: the line says DAILY RUN", d.bestDaily && d.best === 0 && d.bestDay === "TODAY");
  globalThis.setFakeDate("2026-11-12T00:01:00");
  frame(150);
  endWith(600, 500);
  d = hud();
  ok(
    "ended after midnight: recorded for the day it began, and named by its date",
    S.dailyBest("2026-11-11", "classic").score === 600 && S.dailyBest("2026-11-12", "classic").score === 0 && d.dailyFlag === "BEST OF NOV 11" && d.bestDaily && d.bestDay === "NOV 11" && d.best === 600 && d.daily.label === "NOV 12",
    JSON.stringify({ flag: d.dailyFlag, bestDay: d.bestDay, best: d.best, label: d.daily.label })
  );
  flyTap();
  frame(10);
  d = hud();
  ok("the next daily run is the new day's, with nothing flown yet", game.runDaily === "2026-11-12" && d.bestDaily && d.bestDay === "TODAY" && d.best === 0);
  endWith(700, 650);
  d = hud();
  ok("its game over: BEST TODAY beside today's record", d.dailyFlag === "BEST TODAY" && d.bestDay === "TODAY" && d.best === 700 && d.bestDistance === 650);
  tapAt(...centre(game.hud.dailyButton(game.camera)));
  frame(5);
  d = hud();
  ok("DAILY RUN switched off there: the corner turns to the all-time best", !d.daily.on && !d.bestDaily && d.best === 10000);
  console.log(JSON.stringify({ checks }));
  process.exit(0);
}

if (CASE === "records") {
  const checks = [];
  const ok = (label, cond, detail = "") => checks.push([label, !!cond, detail]);
  const S = game.storage;
  ok("old save: its best is the classic swing's", S.best("classic").score === 9000 && S.best("classic").distance === 2500);
  ok("old save: Conserve momentum starts with no record", S.best("conserve").score === 0);
  ok("old save: wears its character's own trail, owns no trails", S.data.trail === "own" && S.data.owned.length === 0);
  ok("old save: keeps its orbs and character", S.data.orbs === 150 && S.data.character === "monkey");

  // Per-swing records.
  let r = S.recordRun(5000, 1500, 0, 0, "conserve", null);
  ok("a Conserve run sets Conserve's best only", r.best && S.best("conserve").score === 5000 && S.best("classic").score === 9000);
  r = S.recordRun(7000, 1800, 0, 0, "classic", null);
  ok("a classic run below the classic best is no new best", !r.best && S.best("classic").score === 9000);
  r = S.recordRun(9500, 2600, 0, 0, "classic", null);
  ok("a classic run above it is", r.best && S.best("classic").score === 9500);

  // Daily records: per day and per swing.
  r = S.recordRun(3000, 900, 0, 0, "classic", "2026-11-11");
  ok("the day's first daily run is the day's best", r.dailyBest && S.dailyBest("2026-11-11", "classic").score === 3000);
  r = S.recordRun(2000, 950, 0, 0, "classic", "2026-11-11");
  ok("a lower daily run keeps the day's best (distance kept on its own)", !r.dailyBest && S.dailyBest("2026-11-11", "classic").score === 3000 && S.dailyBest("2026-11-11", "classic").distance === 950);
  ok("the Conserve daily best is its own", S.dailyBest("2026-11-11", "conserve").score === 0);
  r = S.recordRun(1000, 300, 0, 0, "classic", "2026-11-12");
  ok("a new day starts from nothing", r.dailyBest && S.dailyBest("2026-11-12", "classic").score === 1000);
  // The clock steps back a day (a flight east over the date line, a changed time zone): the
  // earlier day's run must not wipe the later day's best, nor the reverse.
  r = S.recordRun(100, 50, 0, 0, "classic", "2026-11-11");
  ok(
    "flying an earlier day again keeps both days' bests",
    !r.dailyBest && S.dailyBest("2026-11-11", "classic").score === 3000 && S.dailyBest("2026-11-12", "classic").score === 1000
  );
  for (let d = 13; d <= 25; d++) S.recordRun(10 * d, 5, 0, 0, "classic", `2026-11-${d}`);
  ok(
    "only the newest week of days is kept",
    Object.keys(S.data.daily).length === 7 && S.data.daily["2026-11-25"] && S.data.daily["2026-11-19"] && !S.data.daily["2026-11-18"],
    Object.keys(S.data.daily).sort().join(" ")
  );
  r = S.recordRun(77, 5, 0, 0, "classic", "2026-10-01");
  ok(
    "a day far in the past is still recorded while it is flown",
    r.dailyBest && S.dailyBest("2026-10-01", "classic").score === 77 && Object.keys(S.data.daily).length === 7 && S.data.daily["2026-11-25"],
    Object.keys(S.data.daily).sort().join(" ")
  );

  // In the game: the run's swing decides its record, including a mid-run switch.
  tapAt(...centre(game.hud.dailyButton(game.camera)));
  frame(10);
  ok("DAILY RUN switches on from its button", game.dailyMode === true);
  flyTap();
  frame(10);
  ok("a tap then flies the daily run", game.state === "playing" && typeof game.runDaily === "string", `runDaily ${game.runDaily}`);
  ok("the daily run is not a classic best's run before the switch", game.runConserve === false);
  game.togglePause();
  game.toggleConserveMomentum();
  game.togglePause();
  ok("Conserve switched on mid-run: the run counts toward Conserve", game.runConserve === true);
  game.toggleConserveMomentum(); // off again: still a Conserve run
  ok("...and stays a Conserve run when switched back off", game.runConserve === true);
  const classicBefore = S.best("classic").score;
  frame(240);
  game.endRun({});
  ok("its end leaves the classic best alone", S.best("classic").score === classicBefore, `conserve best ${S.best("conserve").score}`);
  ok("and records the day's Conserve best", S.dailyBest(game.runDaily, "conserve").score > 0, `${S.dailyBest(game.runDaily, "conserve").score}`);
  frame(200);

  // The shop.
  const P = () => game.hud.trailsPanel(game.camera);
  S.data.orbs = 100;
  tapAt(...centre(game.hud.trailsButton(game.camera).hit));
  frame(10);
  ok("TRAILS opens the picker", game.trailsOpen === true);
  const sw = (i) => P().swatches[i];
  tapAt(sw(2).x, sw(2).y); // Lilac, 120: not affordable with 100
  frame(5);
  ok("a locked trail previews on the glide", player.trailId === "lilac" && S.data.trail === "own");
  tapAt(...centre(P().action));
  frame(5);
  ok("UNLOCK without the orbs buys nothing", S.data.orbs === 100 && !S.owns("trail:lilac"));
  ok("...and the tap did not close the picker", game.trailsOpen === true);
  tapAt(sw(6).x, sw(6).y + P().r + 15); // the "800" under Aurora
  frame(5);
  ok("a tap on the price under a swatch picks that trail", game.trailsOpen === true && game.trailPick === "aurora");
  tapAt(P().cx, (P().rowY + P().nameY) / 2 + 12); // between the swatches and the name: a near miss
  frame(5);
  ok("a near miss inside the panel neither closes it nor drops the preview", game.trailsOpen === true && player.trailId === "aurora");
  ok("UNLOCK's touch target is 44 pt tall", P().action.h >= 44);
  tapAt(sw(1).x, sw(1).y); // Coral, 60
  frame(5);
  tapAt(P().cx, P().action.y + 1); // the top edge of UNLOCK's target
  frame(5);
  ok("UNLOCK with the orbs buys it and wears it", S.owns("trail:coral") && S.data.orbs === 40 && S.data.trail === "coral" && player.trailId === "coral");
  tapAt(sw(2).x, sw(2).y);
  frame(5);
  tapAt(VW / 2, VH * 0.2); // not on the panel: closes
  frame(5);
  ok("closing takes a previewed locked trail off", game.trailsOpen === false && player.trailId === "coral");
  ok("closing the picker did not start a run", game.state === "gameover" || game.state === "menu", game.state);
  flyTap();
  frame(5);
  ok("the run wears the trail", game.state === "playing" && player.trailId === "coral");
  const saved = JSON.parse(globalThis.localStorage.store["gale.save.v1"]);
  ok(
    "all of it is saved",
    saved.trail === "coral" && saved.owned.includes("trail:coral") && saved.orbs === 40 && Object.keys(saved.daily).length > 0 && saved.conserveBestScore > 0
  );
  console.log(JSON.stringify({ checks }));
  process.exit(0);
}

// --- CASE "world": fly a daily run and log what is generated. ---------------
const seen = new Map();
const objects = [];
const r1 = (v) => Math.round(v * 10) / 10;
function scan() {
  for (const a of world.anchors)
    if (!seen.has(a)) {
      seen.set(a, 1);
      objects.push(["anchor", r1(a.x), r1(a.baseY), a.kind, r1(a.amp), r1(a.phase), r1(a.speed)]);
    }
  for (const h of world.hazards)
    if (!seen.has(h)) {
      seen.set(h, 1);
      objects.push(["rock", r1(h.x), r1(h.y), r1(h.rx), r1(h.ry)]);
    }
  for (const c of world.collectibles)
    if (!seen.has(c)) {
      seen.set(c, 1);
      objects.push([c.kind, r1(c.baseX), r1(c.baseY)]);
    }
  for (const p of world.powerups)
    if (!seen.has(p)) {
      seen.set(p, 1);
      objects.push(["power:" + p.kind, r1(p.x), r1(p.baseY)]);
    }
  for (const c of world.clouds)
    if (!seen.has(c)) {
      seen.set(c, 1);
      objects.push(["cloud", r1(c.x), r1(c.y), r1(c.rx), r1(c.ry)]);
    }
}
if (process.env.AFTER_GAMEOVER) {
  // An ordinary run first, then the daily from its game-over screen.
  flyTap();
  frame(20);
  game.endRun({});
  frame(200);
}
if (!process.env.NORMAL) tapAt(...centre(game.hud.dailyButton(game.camera)));
frame(5);
if (process.env.CONSERVE) {
  game.storage.setConserveMomentum(true);
}
flyTap();
if (game.state !== "playing") throw new Error("the run did not start: " + game.state);
if (!process.env.NORMAL && !game.runDaily) throw new Error("not a daily run");
let note = "";
if (process.env.RESTART) {
  // Fly a little, then Restart Run from the pause screen: the same world again.
  frame(240);
  game.togglePause();
  frame(2);
  tapAt(...centre(game.hud.pauseMenuButtons(game.camera).restart));
  if (game.state !== "playing") throw new Error("restart did not start a run: " + game.state);
  note += "after Restart Run, ";
}
seen.clear();
objects.length = 0;
const startX = game.startX;
const objectives = game.objectives.list.map((o) => o.text ?? JSON.stringify(o));
scan();
let liveGenX = world.genX;
if (process.env.EAGER) {
  world.ensure(startX + 120000);
  scan();
  liveGenX = world.genX;
  note += "eager";
} else {
  const P = Number(process.env.BOT || 0);
  let seed = 4242;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  let holding = false;
  let swingFrames = 0;
  let lastRelease = -1e9;
  let perfect = true;
  let sloppy = 0;
  let frames = 0;
  const down = () => dispatch("pointerdown", { clientX: VW / 2, clientY: VH * 0.45, pointerId: 1 });
  const up = () => dispatch("pointerup", { clientX: VW / 2, clientY: VH * 0.45, pointerId: 1 });
  while ((game.state === "playing" || game.state === "crashing") && frames < 120 * 90) {
    if (P > 0) {
      if (player.state === "glide" && !holding) {
        const target = t - lastRelease > 380 ? player.findGrabTarget(world.anchors, game.camera) : null;
        if (target && target.x > player.x + 30) {
          down();
          holding = true;
          swingFrames = 0;
          perfect = rnd() < P;
          sloppy = Math.floor(rnd() * 30);
        }
      } else if (holding) {
        swingFrames++;
        const upward = player.vx > 0 && player.vy < 0;
        const want = player.state === "swing" && (perfect ? player.inPerfectWindow : upward && --sloppy < 0);
        if (want || swingFrames > 360 || (player.state !== "swing" && swingFrames > 6)) {
          up();
          holding = false;
          lastRelease = t;
        }
      }
    }
    frame();
    frames++;
    if (game.state === "playing" || game.state === "crashing") {
      scan();
      liveGenX = world.genX;
    }
  }
  if (holding) up();
  note += `${P ? `bot ${P}` : "idle"}, ${(frames / 120).toFixed(1)} s, ${Math.floor(game.distance)} m`;
}
console.log(JSON.stringify({ day: game.runDaily, liveGenX, objectives, objects, note }));
