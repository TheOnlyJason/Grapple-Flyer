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
| **Tether & swing** | tap **and hold** | hold `Space` / `↑` / `W` |
| **Slingshot launch** | release | release the hold key |
| **Wind Dash** (gauge full) | tap the **DASH** button | `Shift` / `D` |
| Mute / unmute | — | `M` |
| Start / restart | tap | any key |

### The loop

1. **Glide** forward, losing altitude slowly. Scan for the next anchor (it lights
   up cyan when it's the one you'll grab).
2. **Hold** to tether. Gravity swings you in an arc and your descent becomes
   rotational energy. Holding also reels the rope in slightly, giving you lift.
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

- `world.gravitySwing` / `tether.reelRate` — how energetic and climby swings feel.
- `tether.idealLaunchAngleDeg` / `perfectToleranceDeg` — where and how forgiving
  the **perfect** window is.
- `tether.perfectBoost` / `releaseBoost` — how rewarding good timing is.
- `player.cruiseSpeed` / `forwardDrag` — glide pace and how long launches persist.
- `world.seaLevel` — how much altitude headroom you have before the run ends.

Colours live in the `PALETTE` object in the same file.

---

## How the swing works

While tethered, the player is integrated under gravity each fixed step, then a
**rigid distance constraint** snaps it back onto a circle around the anchor and
removes the radial velocity component — leaving pure tangential (swinging)
motion. Holding shortens the rope, which does work against gravity and adds
energy (lift). On release, the current tangential velocity _is_ your launch
vector, so timing the release governs the launch's shape and power.

Physics runs on a fixed `1/120s` timestep (`config.fixedDt`) for stability,
independent of render frame rate.

---

## Scripts

```bash
npm run dev       # dev server with hot reload
npm run build     # type-check + production build to dist/
npm run preview   # preview the production build
node scripts/smoke.mjs   # headless runtime smoke test (run after build)
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
dependency; the bundle is ~13 kB gzipped.
