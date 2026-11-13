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
| Mute / unmute | in a run: the **speaker** button by the pause button. On the menus: **SETTINGS ▸ SOUND** | `M` |
| Start / restart | tap anywhere on the home screen (TAP TO FLY) | — |
| Open a page | **DAILY**, **SHOP**, **SETTINGS**: the small buttons top right on the home screen | — |
| Back to the home screen | **HOME**, top left on every page and on a game-over screen; **HOME** on the pause screen ends the run there | `Esc` on a page or game-over screen |
| Change character | **SHOP**: the **‹ ›** either side of its name (Paper Plane, Monkey, Snow Monkey, Golden Monkey, Night Monkey, Monkey King, Rainbow Cat) | `C` (also `←` `→` on the home screen) |
| Trails (spend orbs) | **SHOP**: tap a swatch, then **UNLOCK** | in the shop: `←` `→` pick, `U` unlock |
| Daily run | **DAILY** ▸ **FLY** (two tries a day) | `Enter` on the daily page |

### The menus: a home screen and three pages

In the manner of Alto's Adventure: the live sky is the picture, with the
character gliding through it, and the type sits quietly on top
(`Hud.drawAttractScreen` and the page drawers under it).

- **Home** is nearly empty: a light, wide-tracked GALE, TAP TO FLY (no play
  button: a tap anywhere flies), the best run and the orbs as plain words in
  the bottom corners, where a resting thumb's tap simply flies, and three
  small round buttons in the top-right corner — **DAILY**, **SHOP**,
  **SETTINGS**. A brand-new player sees only SETTINGS until the first flight
  is done. After a run the home screen carries the run's points, distance,
  perfects, goals and orbs in the middle (on a soft dark wash so a pale day
  sky cannot swallow them), TAP TO FLY AGAIN, and **HOME** in the top-left
  corner to clear it.
- **Shop**: the character (its name between thin chevrons; the one gliding
  on the left is the preview), the trails, and the orbs to spend.
- **Settings**: SOUND, CONSERVE MOMENTUM (the same switch as on the pause
  screen) and HOW TO PLAY (the tutorial run again).
- **Daily run**: the date, today's best, the tries left, and FLY.

Every page has **HOME** in its top-left corner (Esc on a keyboard), its
column sits right of centre so the gliding character stays in view, and a tap
that misses its controls does nothing — only the home screen flies on a tap.
The page buttons' names, and the gaps between them, are part of the buttons,
and after HOME the home screen waits a beat before a tap flies, so a double
tap on HOME stays home. (The game-over screen's TAP TO FLY AGAIN stays
instant, as in 1.2.)
The pause screen has HOME too: it ends the run there (recorded like any
other, except the tutorial, which is simply left) and opens the home screen.

The best in the home screen's corner is the record the next run would chase
(the swing in force). After a run it is the record of the run just flown, so
NEW BEST always sits beside the record it is about.

### Bests per swing

The classic rope and **Conserve momentum** keep separate bests (score and
distance), so Conserve is a mode of its own and the classic best stays the
classic rope's. A run counts toward Conserve's best if the option was on at
any point of it — switching it on in the pause screen mid-run moves the run
over, and switching it back off does not move it back. Saves from before 1.3
had one best; it is kept as the classic one. The in-run line reads
`BEST 6120` or `BEST 6120 · MOMENTUM`; the home screen's corner reads `BEST`
or `BEST · MOMENTUM`.

### The daily run

One world per calendar day — the same anchors, rocks, orbs, power-ups and
objectives for every player, built from the date (`core/daily.ts`: the seed
is the player's local calendar date) — and **two tries a day**
(`CONFIG.daily.tries`), both swings together. The daily page shows the date,
today's best for the swing in force, the tries left as two pips, and **FLY**,
the only thing that begins a try: a stray tap can never spend one. A try is
counted and saved the moment it begins, so closing the app does not give it
back; RESTART RUN on the pause screen of a daily try ends that try (recorded,
like any other end: a try is never thrown away) and begins the next (the
button says `RESTART · TRY 2/2`), and is off when none is left. A try
ends back on the daily page with its result, the tries left, and FLY again or
`A NEW SKY IN 6H 38M` once both are spent. For a moment after a try ends FLY
is dimmed and takes no tap, so a swing press already on its way cannot spend
the next try unseen; and the press that begins a try is not taken as a grab.

The day keeps its own best per swing (`TODAY` on the in-run line, `BEST
TODAY` on the result); a daily run still banks its orbs and still counts
toward the all-time best. A run still in the air at midnight belongs to the
day it began (`BEST OF NOV 11`), and the save keeps the last week of days, so
a clock that steps back a day (a changed time zone) finds that day's best and
tries again rather than wiping the later one.

A daily run starts from the very start of its world (`Game.startDailyRun`)
rather than from wherever the home screen's glide happens to be, with a short
fade in and the plain camera (no speed pull-back left over from the last
run). Only world generation draws from the day's seed once the run is under
way, so nothing the player does can shift what comes later, and the screen
size only changes how far ahead the world is built, never what is built
(`scripts/daily-probe.mjs` flies it at four screen sizes, with both swings,
idle and by bots, after Restart Run and after a game over, and compares every
object). The tutorial never runs in the daily world, and the daily page is not
on the home screen until the first flight is done.

### Trails (something to spend orbs on)

Orbs are banked at the end of every run, good or bad, and the **shop** is
where they go: six coloured ribbons (`characters/trails.ts`) from 60 to 800 orbs.
Any character can wear any trail owned; **Signature** — each character's own
trail — is always there. On the shop page a tap on a swatch wears an owned
trail at once, or previews a locked one on the gliding character with its
price and an **UNLOCK** button (lit when the bank covers it); leaving the
page takes a locked trail on preview off. A gold dot on the home screen's
SHOP button says something is affordable. Prices are set against the orb take of
an ordinary run (5–7 for a player not chasing them), so the first unlock comes
within an evening and the last is a long-term goal. Every character is free;
the shop's item list is where a priced character would go.

The Snow, Golden and Night Monkeys are the plain Monkey with a coat of their
own (`monkeyCoat` in `render/drawMonkey.ts`): grey-white with a pink face and
a red scarf streaming behind, golden-orange with a pale blue face, and charcoal
with big eyes ringed in pale fur. They leap and swing exactly as the Monkey does.

### Starting a run: READY, GO

Watching new players, the first press was often a quick tap and let go —
which, a run being a grab from the first frame, grabbed the first anchor and
let go of it at once. So a tap no longer starts the run itself: the home
screen gives way to a short intro (`CONFIG.intro.seconds`, 1.15 s) — READY
with HOLD TO SWING · LET GO TO FLY under it, then GO — while the character
glides on, and nothing pressed in it counts. A finger still down when it
ends grabs only once lifted and pressed again. A daily try (FLY, or RESTART
on its pause screen) cuts to the start of the day's world first and the intro
plays over that starting line, so the day still starts the same for everyone.
The run after GO is exactly the run a tap started before; the headless probes
turn the intro off (`GALE_INTRO=1` keeps it) and `scripts/daily-probe.mjs`
checks it.

### How hard the sky gets: the curve and the assist

The spawner reads one difficulty number (`World.difficulty`). In 1.2 it rose in
a straight line and was at its hardest by 650 m, so every stretch after that
was the same. Now it rises with distance and levels off without stopping —
`base = d / (d + halfPx)`, times `scale` — so the 1.2 game's hardest sky comes
at about 4,000 m and the ceiling is half again past it (with caps on the gap,
rock and moving-anchor chances so it stays flyable). Roughly 0.25 at 400 m,
0.6 at 1,300 m, 1.0 at 4,000 m, 1.25 at 10,000 m.

A struggling player gets an **assist**: at the start of a run the game
averages the last three scores on that swing against its best; at
`assistNone` (40%) of the best or more there is none, at `assistFull` (15%)
or less the full `assistMax` (30% easier), and in between on a line. It
changes only what spawns — never gravity, the rope or the swing — and fades
out as the run nears the player's best distance, so a record is still
earned. Never in the tutorial or a daily run. All of it is in
`CONFIG.difficulty`; `scripts/difficulty-bot.mjs` compares the ramps with a
play-bot (`LEGACY=1` the 1.2 ramp, `NOASSIST=1`, `NONE=`/`FULL=` other
thresholds). The thresholds are a first guess from the bot (help in about a
third to a half of its runs) and should be set from real play.

### Zones: every 5,000 m

A run passes through zones (`systems/zones.ts`, `CONFIG.zones`): every
5,000 m the scenery and the weather change and the sky gains a twist, and a
banner names it (ZONE 2 · RAIN · ROCKS DRIFT).

| Zone | From | Weather | Twist |
| --- | --- | --- | --- |
| 1 Dusk Peaks | 0 m | the sky as it always was | — |
| 2 Rain | 5,000 m | a cool tint, rain | rocks drift up and down |
| 3 Snow | 10,000 m | a pale tint, snow | frosted anchors give way 0.9 s after a grab (you drop off with your speed, no slingshot) |
| 4 Storm | 15,000 m | dark, heavy rain | lightning marks a column (1.2 s), then strikes it: in it when it strikes ends the run, a barrier takes it, a dash rides through |

Each zone also has its own sky (`ZONE_MOODS` in `render/theme.ts`, blended
over the time of day so dawn and night still show through): slate and grey-
green rain, an icy blue snow sky, a purple-black storm with a red horizon.
The cloud sea takes the zone's colours too, with rain rings on its surface,
snow drifts along it, or the storm's light flickering inside it. And its
sound, made in code like everything else (`Sound.setZone`): a soft rain hiss,
a hollow wind for the snow, rain and a low rumble for the storm, and thunder
on each strike; silent while paused or muted.

The wildlife follows the zone too (`Background.setZone`): birds fly low in
the rain, slow white snow owls glide through the snow, and in the storm only
bats fly, day or night. Butterflies stay in Dusk Peaks. The islands keep the
same look in every zone.

Behind the mountains each zone has a sky effect (`Background.drawZoneSky`):
a rainbow as the rain begins (gone after its first 2 km), an aurora over the
snow at night, and lightning flickering far off on the storm's horizon (a
picture only; the strikes that matter are the marked columns).

After the storm the last three go round again (rain at 20,000 m), each pass a
quarter stronger. Twists come from the world's seeded generator and only in
segments past the first zone, so the first 5,000 m are object for object
what they were, and the daily run's zones are the same for everyone.

Zones change gradually (`zoneLook` in `systems/zones.ts`): the old zone's
sky, weather, wildlife and sound cross-fade into the new one's over 1,400 m
centred on each boundary (`CONFIG.zones.blendM`), so the new sky is half there
when its banner shows. That is drawing only; each twist still starts exactly
at its boundary.

### Chasing the best

During a run a thin dashed gold line stands across the sky at the best
distance (the run's swing's, or today's on a daily run), labelled `BEST
1,834 m`; flying past it pops NEW BEST once, with a chime
(`Game.drawBestMarker`; drawing and sound only). A game over that sets no
best shows the run's share of it where NEW BEST would be: `91% OF YOUR BEST`
(`91% OF TODAY'S BEST` after a daily try).

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
    storage.ts            # the save: bests per swing, daily bests, orbs, owned trails, options
    daily.ts              # the daily run's date key and world seed
    math.ts, rng.ts       # helpers + seedable PRNG (the daily run seeds it from the date)
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
  characters/
    registry.ts           # the playable characters
    trails.ts             # the trails bought with orbs (names, prices, colours)
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
  `player.conserveSmashSpeed` / `camera.speedPull*` — the same for the
  **Conserve momentum** swing (see below).
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
starts a fresh one in place), **HOME** (ends the run there and opens the home
screen) and one switch, **CONSERVE MOMENTUM** (off by default, remembered in
the save, and also on the settings page). Off is the swing above, unchanged from
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
- **Re-grabs are the same swing.** Letting go and grabbing the same anchor
  again within a second carries its lap count on and takes back the release
  boost just paid out, so tapping around one anchor neither pumps speed nor
  dodges the lap cost.
- **Meteors need more speed:** `player.conserveSmashSpeed` (1200, against
  1.2's 1050), and the speed bar runs to 1500 so its tick stays on it.
- **The camera pulls back at speed** (`camera.speedPull*`, this mode only):
  as the pace (quick to rise, slow to fall) goes from 900 to 1600 px/s the
  view zooms out by up to a quarter and the plane slides further left,
  around the plane so nothing jumps. At speed that is about a quarter more
  warning of what is coming (iPhone 14: 0.80 s → 1.01 s on average above
  1000 px/s). Off, the camera never moves: grabs need the anchor on screen,
  so the view is part of the 1.2 game. A run that starts on the classic rope
  therefore starts with the plain camera even straight after a fast Conserve
  run (`Game.clearSpeedPull`), and so does every daily attempt.

In both swings, a rock still off the right edge that the plane will reach
within 1.6 s shows a warning puck on that edge, level with it and growing as
it nears (drawing only). At cruise the screen already shows more than that,
so the pucks appear only when the run is fast.

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
node scripts/equiv-probe.mjs     # the default swing plays exactly like the 1.2 release, frame for frame (builds 1.2 from its commit to compare)
node scripts/difficulty-bot.mjs  # a bot's run distances on the 1.2 ramp, the new curve, and with the assist
node scripts/daily-probe.mjs     # the daily world is the same for everyone; two tries a day; bests per swing and per day; the pages and their HOME buttons; the shop; old and tampered saves
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

Since then: the Conserve momentum option, the tutorial, the Alto-style home
screen, more characters, orbs and power-ups, bests per swing, the daily run,
and trails bought with orbs.

Natural next steps: new stages every 10,000 m (biomes & palettes), weather
(rain, snow, thunder), the Sky Pirate threat system (corrupted anchors),
ghost replays, and more to unlock (characters).

Built with **Vite + TypeScript** and an HTML5 Canvas 2D renderer. No game-engine
dependency; the bundle is ~43 kB gzipped.
