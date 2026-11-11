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
fly from the keyboard (starting a run and the pause-screen buttons take a click).

### Controls

| Action | Touch / Mouse | Keyboard |
| --- | --- | --- |
| **Glide** | do nothing | — |
| **Tether & swing** | tap **and hold** | hold `Space` / `↑` / `W` |
| **Slingshot launch** | release | release the hold key |
| **Wind Dash** (gauge full) | tap the **DASH** button | `Shift` / `D` |
| Mute / unmute | tap the **speaker** button (top right: by the pause button in a run) | `M` |
| Start / restart | tap anywhere on the menu (TAP TO FLY) | — |
| Change character | the **‹ ›** either side of its name | `C` / `←` `→` |

### The home screen

In the manner of Alto's Adventure: the live sky is the picture, with the
plane gliding through it, and the type sits quietly on top — a light,
wide-tracked GALE, small spaced capitals, no play button (a tap anywhere
flies), the character's name between thin chevrons (a tap on either half
of the name works too), HOW TO PLAY and the sound in the top corners, and
the best run and orbs as plain words in the bottom ones, where a resting
thumb's tap simply flies. The game-over screen is the same page with the
run's points, distance, perfects, goals and orbs in the middle, on a soft
dark wash so a pale day sky cannot swallow them (`Hud.drawAttractScreen`).

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

### First flight (the tutorial)

A brand-new player's first run teaches the loop the way Alto's Adventure
does: no screens of text, one move at a time, prompted as the moment for it
arrives, with time slowed almost to a stop until the player does it. The
cards are written for a phone (touch and hold, lift your finger, tap DASH,
with an arrow to the button); a mouse click and hold reads the same.

1. An anchor glows: **Hold to grab**.
2. Swinging up toward the gold window: **Let go on gold** (time all but
   stops inside the window, so a PERFECT is there for the taking).
3. The next anchor glows mid-air: **Grab the next one**, and a second swing
   (the gold prompt again if the first launch was not PERFECT).
4. The gauge is filled and a rock drifts onto the dash line: **Tap DASH**.
5. **Stay above the clouds**, then **You're ready** — and the run carries on
   for real.

The grab cards only come up for a good anchor (above and ahead: the 1.2
rope also grabs a level one, and that swing hangs dead); if none comes along
for a moment the tutorial hangs one in reach. A swing that cannot reach gold
gets a **Let go** card instead of leaving the player holding forever; a
DASH card nobody answers moves on after 8 s; a finger kept down from the
play tap counts as a hold after 0.6 s. Each card sits low in the frame or up
under SKIP, whichever covers none of the plane, its anchor or the rock.
Until the last card nothing ends the run: the cloud sea throws the player
back up and rocks only break. **SKIP TUTORIAL** (top centre) ends it at
once. It is saved as done when finished or skipped, never shows again on its
own, and does not show for anyone who already has runs on their save.
**HOW TO PLAY** on the menu and game-over screens replays it; Restart Run
during it starts it over. The logic is `src/systems/tutorial.ts`; the cards
are drawn by `Hud.drawTutorial`. With the tutorial done, play is unchanged
from 1.2 (a headless replay against the 1.2 build matches frame for frame);
the menu and game-over screens add the HOW TO PLAY and speaker buttons.

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
    tutorial.ts           # first-flight tutorial: one move at a time, in slow motion
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
- `tether.conserveReelRate` / `tether.swingDrag` / `tether.lapSpeedKeep` /
  `player.conserveSmashSpeed` — the same for the **Conserve momentum** swing
  (see below).
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

### Option: Conserve momentum

The pause screen has **RESTART RUN** (abandons the run, unrecorded, and
starts a fresh one in place) and one switch, **CONSERVE MOMENTUM** (off by
default, and remembered in the save). Off is the swing above, unchanged from
1.2. On swaps
in a **pendulum solved in polar coordinates** around the anchor: rope length,
angle from straight below and angular velocity, integrated with velocity
Verlet each fixed step, with position and velocity written back from them.
Nothing else in the game changes.

- **Grabbing keeps your speed.** The hook is a frictionless redirect: the
  player's whole speed relative to the anchor becomes swing speed, in the
  sense of rotation already under way. (The rope above deletes the component
  along the rope at the first step.)
- **Reeling in pumps.** Holding shortens the rope at `tether.conserveReelRate`
  and conserves angular momentum (L²ω), so the player speeds up by
  L_old / L_new.
- **Air drag** (`tether.swingDrag`, quadratic) is the only deliberate loss
  while swinging. A moving anchor is a moving pivot and hands its velocity
  over. Like the rope, there is no cap: a fast swing loops over the top.
- **Laps cost speed.** Each full lap around the same anchor keeps
  `tether.lapSpeedKeep` (85%) of the speed. An ordinary swing turns well
  under a lap and never feels it; circling an anchor to hold top speed winds
  down instead (from a fast entry: about 1880 px/s held for ever before,
  about 960 after 12 s now).
- **Meteors need more speed:** `player.conserveSmashSpeed` (1200, against
  1.2's 1050), and the speed bar runs to 1500 so its tick stays on it.

Switching mid-swing carries the motion over seamlessly.
`scripts/tether-probe.mjs` checks both swings: the option's grab keeps
energy, a free swing does not drift, the reel pumps by exactly the rope
ratio, and a whole glide → grab → swing → release → grab chain conserves
energy once every deliberate knob is zeroed.

Physics runs on a fixed `1/120s` timestep (`config.fixedDt`) for stability,
independent of render frame rate. `window.GALE_CONFIG` exposes the live tuning
table, which the headless probes poke directly (`scripts/smash-probe.mjs` also
reads `GALE_KNOBS='{"player.smashSpeed":1200}'`, and `GALE_CONSERVE=1` for the
option) without a rebuild.

---

## Scripts

```bash
npm run dev       # dev server with hot reload
npm run build     # type-check + production build to dist/
npm run preview   # preview the production build
node scripts/smoke.mjs   # headless runtime smoke test (run after build)

# Headless checks against the built bundle (all run after `npm run build`):
node scripts/tether-probe.mjs    # both swings: 1.2 rope by default, the Conserve momentum pendulum, the switch, Restart Run
node scripts/tutorial-probe.mjs  # a new player's first flight: card order, slow motion, safety net, SKIP, HOW TO PLAY
node scripts/powerups-probe.mjs  # power-ups, orbs, barrier, objectives, restarts
node scripts/smash-probe.mjs decay|ahead|bot   # smash-speed decay, meteor-ahead outcomes, play-bot stats
node scripts/swing-strip.mjs     # contact sheets of the pendulum: a swing, a loop, a moving anchor → screenshots/
node scripts/shatter-strip.mjs   # contact sheet of a meteor smash → screenshots/
node scripts/powerups-shot.mjs   # staged frames of pickups, HUD, pause, game over → screenshots/
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
dependency; the bundle is ~43 kB gzipped.
