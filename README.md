# GALE — a kinetic sky-sailing runner

A web prototype of **GALE**, a one-touch momentum runner about gliding, swinging
from anchor points, and converting falling momentum into satisfying slingshot
launches across a broken sky-world.

This prototype exists to answer the MVP's one critical question:

> **Is the tap-hold-release movement loop fun enough to carry the game?**

Everything here runs in the browser (and on a phone) so you can _feel_ the loop
immediately, then tune it.

---

## Play it

```bash
npm install
npm run dev
```

Open the printed URL (default <http://localhost:5173>). On desktop you can also
play entirely from the keyboard.

### Controls

| Action | Touch / Mouse | Keyboard |
| --- | --- | --- |
| **Glide** | do nothing | — |
| **Tether & swing** | **press** when an anchor is lit cyan, and hold | press `Space` / `↑` / `W` and hold |
| **Backflip** | **hold** in open sky (no anchor in reach) | hold the same key |
| **Slingshot launch** | release | release the hold key |
| **Wind Dash** (gauge full) | tap the **DASH** button | `Shift` / `D` |
| Mute / unmute | — | `M` |
| Start / restart | tap | `Space` / `↑` / `W` |

Only anchors **above** you can be grabbed (a rope to one at your own height
would have nothing to swing on). Right after you let go there is a short
moment (0.2 s) in which a press grabs nothing — a tap as the finger lifts is
not an aim — and the anchor you just left stays off limits for 0.6 s, so a
reflex re-tap cannot haul you back onto it mid-launch.

### The loop

1. **Glide** forward, losing altitude slowly. Scan for the next anchor (it lights
   up cyan when it's the one you'll grab).
2. **Press** while it is lit to tether. Only a fresh press grabs (with a
   0.15 s grace so a press a hair early still lands); a hold that is already
   running never latches onto the next anchor on its own. Gravity swings you
   in an arc and your descent becomes rotational energy. Holding also reels
   the rope in slightly, giving you lift.
   - **Hold in open sky** instead and you backflip: each full turn scores
     100 × n (BACKFLIP, DOUBLE FLIP, TRIPLE FLIP…) and scrubs 8% of your
     speed, so flips trade momentum for points.
3. **Release** to slingshot. Let go as the rope glows **gold** (pointing up &
   forward) for a **PERFECT** launch: bonus speed, score, Wind Gauge, and a
   screen pop.
4. **Skim clouds** for risky Wind Gauge gains, grab **wind wisps**, dodge the
   dark **rocks** (or **DASH** straight through them), and don't fall into the
   cloud sea.

Each run rolls **3 objectives** and tracks score, distance, and your best.

---

## Project layout

```
src/
  main.ts                 # entry: canvas, DPR resize, rAF loop
  core/
    game.ts               # game manager: states, collisions, scoring, render pipeline
    config.ts             # ★ all gameplay feel + the colour palette (tune here)
    input.ts              # pointer + keyboard (tap / hold / release / dash)
    camera.ts             # smooth follow + look-ahead + screen shake
    audio.ts              # procedural WebAudio (wind, tether, release, perfect…)
    storage.ts            # localStorage best-score / progression seed
    math.ts, rng.ts       # helpers + seedable PRNG (ready for daily seeds)
  entities/
    player.ts             # ★ glide → swing (pendulum) → slingshot state machine
    anchor.ts             # tether targets (normal + moving)
    cloud.ts              # skimmable cloud banks
    collectible.ts        # wind wisps
    hazard.ts             # lethal floating rocks
  systems/
    world.ts              # procedural endless generation + culling
    objectives.ts         # 3-goal run objective system
    particles.ts          # pooled particle effects
  render/
    background.ts         # layered parallax sky, sun, ruins, cloud sea
    hud.ts                # score, objectives, wind gauge / dash, menus
```

`★` = the two files you'll touch most when tuning the game's feel.

---

## Tuning the feel

Open `src/core/config.ts` — every number is a labelled knob. A few high-leverage
ones:

- `world.gravitySwing` / `tether.reelRate` / `tether.swingDrag` — how energetic,
  climby and self-limiting swings feel.
- `tether.idealLaunchAngleDeg` / `perfectToleranceDeg` — where and how forgiving
  the **perfect** window is.
- `tether.perfectBoost` / `releaseBoost` — how rewarding good timing is.
- `tether.grabBuffer` — how early a press may land before an anchor is in reach.
- `tricks.flipRate` / `flipSpeedLoss` / `scoring.flipPoints` — how fast a
  backflip turns, what it costs, what it pays.
- `player.cruiseSpeed` / `forwardDrag` — glide pace and how long launches persist.
- `world.seaLevel` — how much altitude headroom you have before the run ends.

Colours live in the `PALETTE` object in the same file.

---

## How the swing works

The tether is a **pendulum solved in polar coordinates** around the anchor:
the state while tethered is the rope length, the angle from straight below
the anchor and the angular velocity, integrated with velocity Verlet each fixed
step. Position and velocity are written back from that every step, so the rope
is exact by construction and no energy leaks into a position snap or a velocity
projection. The only things that change the swing's energy are gravity, the
anchor's own motion (a moving anchor is a moving pivot, and hands its velocity
to the player), reeling in, and an explicit air-drag knob.

- **Grabbing keeps your speed.** The hook is a frictionless redirect, not a
  rope snapping taut: the player's whole speed relative to the anchor becomes
  swing speed, in the sense of rotation it was already moving. (A real rope
  would delete the component along the rope — the old code did exactly that,
  and chaining straight out of a release into the next anchor kept as little as
  6% of the kinetic energy.)
- **Reeling in pumps.** Holding shortens the rope and conserves angular
  momentum (L²ω), so the player speeds up by L_old / L_new — the real
  shortening-pendulum effect. `tether.reelRate` sets how fast.
- **Air drag** (`tether.swingDrag`, quadratic) is the only deliberate loss
  while swinging, so speed settles instead of running away. Set it to 0 for
  pure energy conservation; `scripts/tether-probe.mjs` does, and checks that
  a glide → grab → swing → release → glide → grab chain conserves energy to
  well under 1% once the deliberate energy sources (`gravitySwing` vs
  `gravityAir`, lift, release boosts) are also zeroed.

On release, the current velocity _is_ your launch vector (plus the release or
PERFECT boost), so timing the release governs the launch's shape and power.

The swing cannot carry you above the anchor: at `tether.maxSwingAngleDeg`
(90°, the anchor's own height) the hook **slips**. The speed is kept but the
direction is not the circle's tangent there — that would be straight up, a
rocket that stalls — it is redirected forward-up at `tether.slipLaunchAngleDeg`
(-62°, just outside the PERFECT window, so a timed release still beats it).

Physics runs on a fixed `1/120s` timestep (`config.fixedDt`) for stability,
independent of render frame rate. `window.GALE_CONFIG` exposes the live tuning
table, which the headless probes poke directly (`scripts/smash-probe.mjs` also
reads `GALE_KNOBS='{"tether.swingDrag":0}'`) without a rebuild.

---

## Scripts

```bash
npm run dev       # dev server with hot reload
npm run build     # type-check + production build to dist/
npm run preview   # preview the production build
node scripts/smoke.mjs   # headless runtime smoke test (run after build)

# Headless checks against the built bundle (all run after `npm run build`):
node scripts/tether-probe.mjs    # swing physics: energy kept at the grab, no drift, reel pump, moving anchors
node scripts/powerups-probe.mjs  # power-ups, orbs, barrier, objectives, restarts (49 checks)
node scripts/smash-probe.mjs decay|ahead|bot   # smash-speed decay, meteor-ahead outcomes, play-bot stats
node scripts/swing-strip.mjs     # contact sheets of a swing, a loop and a moving anchor → screenshots/
node scripts/shatter-strip.mjs   # contact sheet of a meteor smash → screenshots/
node scripts/powerups-shot.mjs   # staged frames of pickups, HUD, game over → screenshots/
```

---

## Status & next steps

Implemented (MVP): glide, tether swing, slingshot + perfect release, anchors
(incl. moving), procedural endless world, cloud sea, clouds + skimming, wind
wisps, one hazard type, Wind Gauge + Wind Dash, 3-objective system, score /
distance / best, parallax background, particles, procedural audio, full
menu → play → game-over → restart loop, mobile + keyboard input.

Natural next steps from the design doc: additional biomes & palettes, the Sky
Pirate threat system (corrupted anchors), weather, daily seed runs (the RNG is
already seedable), ghost replays, and cosmetic unlocks.

Built with **Vite + TypeScript** and an HTML5 Canvas 2D renderer. No game-engine
dependency; the bundle is ~41 kB gzipped.
