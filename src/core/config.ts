// All gameplay feel lives here. Tweak freely — every number is a knob.
// World units are pixels. +y is DOWN (screen space), so "up" / altitude is -y.

export const CONFIG = {
  // Fixed-timestep physics. The render loop interpolates between steps.
  fixedDt: 1 / 120,
  maxFrameDt: 1 / 20, // clamp huge frame gaps (tab switches) to avoid tunneling

  world: {
    startY: 0, // player spawn altitude reference
    seaLevel: 980, // y of the cloud-sea death floor (fall past this = run over)
    skyCeiling: -1700, // soft upper bound for generated anchors
    gravityAir: 300, // gentle gravity while gliding / airborne
    gravitySwing: 1750, // strong gravity while tethered (energetic swing)
    metersPerPixel: 0.05, // distance scoring scale
  },

  player: {
    radius: 13,
    startSpeed: 400,
    cruiseSpeed: 360, // glide forward speed eases toward this
    minSpeed: 140,
    maxSpeed: 1900,
    // Reach this speed and meteors shatter on contact instead of ending the
    // run — a clean perfect release gets you there.
    smashSpeed: 1050,
    // ...and with the pause screen's Conserve momentum on, where every launch
    // keeps more of its speed (1.2's 1050 would be reached most of the time).
    conserveSmashSpeed: 1200,
    // Reaching smash speed charges the smash for this long. Drag bleeds a
    // launch below smashSpeed within 0.1–0.5 s, far too briefly to reach the
    // meteor you were aiming at, so the charge outlives the speed itself.
    smashHold: 1.3,
    smashSpeedLoss: 0.06, // momentum scrubbed per meteor smashed at speed
    forwardDrag: 0.5, // rate vx eases back to cruise (per second)
    vertDrag: 1.15, // vertical air drag while gliding -> gentler terminal sink
    // Speed-based lift: flying fast trades into altitude retention (a glider!),
    // so keeping momentum after a launch lets you soar and recover from falls.
    glideLift: 0.48, // upward accel per px/s of speed above the base
    glideLiftBaseSpeed: 240, // no lift below this forward speed
    trailMax: 42, // trail sample count
  },

  skid: {
    friction: 1.05, // velocity decay per second — higher = shorter slide
    stopSpeed: 28, // px/s — run ends once slower than this
    groundInset: 0.65, // player.radius multiplier — sits on the dune surface
  },

  tether: {
    grabRange: 440, // max distance to attach to an anchor
    minRope: 70,
    maxRope: 340,
    reelRate: 90, // rope shortens this many px/s while holding (adds lift)
    // The "Conserve momentum" swing (pause menu, off by default) is a
    // pendulum that keeps the player's speed: the grab turns the whole
    // velocity into swing, and reeling in conserves angular momentum (L²ω),
    // so it pumps for real — hence its own, slower reel.
    conserveReelRate: 30,
    // Quadratic air drag on that swing's speed (px⁻¹), its only deliberate
    // loss: a = -swingDrag·v·|v|, 6%/s at 1000 px/s. 0 = pure conservation.
    swingDrag: 6e-5,
    // Each full lap around the same anchor keeps only this much of the speed
    // (Conserve momentum only). An ordinary swing turns well under a lap and
    // never feels it; circling an anchor to hold top speed winds down instead
    // of going on for ever. 1 = no lap cost (the physics probes set it).
    lapSpeedKeep: 0.85,
    releaseBoost: 1.07, // velocity multiplier on a normal release
    perfectBoost: 1.45, // velocity multiplier on a perfect release
    perfectBonusSpeed: 130, // additive speed on perfect
    idealLaunchAngleDeg: -44, // screen-space launch dir: up & forward
    perfectToleranceDeg: 17, // +/- window around ideal that counts as perfect
    minSwingSpeed: 60, // below this while tethered, swing feels dead
  },

  hazard: {
    // Shatter animation when a meteor is smashed (wind dash or smash speed).
    shatter: {
      hold: 0.04, // seconds the cracked rock hangs together before flying apart
      life: 0.8, // seconds from the break until the last piece is gone
      shards: [5, 7], // target pieces per rock (small -> big); a coarse silhouette can cap it at 4-6
      speed: [170, 380], // outward shard speed away from the impact point, px/s
      carry: 0.45, // fraction of the player's velocity the pieces inherit
      lift: 70, // small upward pop so pieces arc instead of dropping flat
      gravity: 520,
      drag: 1.1,
      spin: [2.5, 7], // |angular velocity| of a tumbling piece, rad/s
      flash: 0.16, // seconds the fresh fracture edges glow
    },
  },

  wind: {
    max: 100,
    skimGainPerSec: 30, // gauge gain while cloud-skimming
    perfectGain: 16, // gauge gain on a perfect release
    collectGain: 9, // gauge gain per collectible
    dashSpeed: 1550, // forward speed during a wind dash
    dashDuration: 0.7, // seconds
    dashCost: 100, // full gauge
    dashMagnetRange: 240, // collectibles pulled in during dash
    dashDebrisRange: 90, // hazards destroyed in path during dash
  },

  // Orbs are the currency: collected in a run, banked into the save when it ends.
  // How hard the sky gets. The spawner's difficulty rises with distance and
  // levels off without ever stopping: base = d / (d + halfPx), scaled so the
  // 1.2 game's hardest sky (difficulty 1) comes at about 4,000 m and the
  // ceiling is half again past it. A struggling player gets an assist from
  // their recent runs that eases what spawns (never the physics), fading out
  // as they near their best so a record is still earned.
  difficulty: {
    legacy: false, // true: the 1.2 ramp (linear, at its hardest by 650 m) — the equivalence probe uses it
    halfPx: 40000, // world px at which base reaches 0.5 (2,000 m)
    scale: 1.5, // difficulty = base * scale, so 1.0 (the old hardest) at 4,000 m and 1.5 at the limit
    assistMax: 0.3, // at most 30% easier
    // A best is a player's luckiest run, so ordinary runs sit well below it:
    // these were set (with scripts/difficulty-bot.mjs) so the assist is on in
    // about a third to a half of runs, not nearly all. Tune with real play.
    assistNone: 0.4, // recent runs averaging this share of the best or more: no assist
    assistFull: 0.15, // this share or less: the full assist
    recentRuns: 3, // runs averaged (fewer than this on the swing: no assist)
  },

  // The moment between the tap that starts a run and the run: READY, GO.
  // Nothing is taken in it, so a first tap-and-let-go is not a wasted grab.
  intro: {
    seconds: 1.15, // READY for about two thirds of it, then GO
  },

  // The daily run: one world a day, the same for everyone.
  daily: {
    tries: 2, // daily runs a player may begin per day (both swings together)
  },

  orbs: {
    points: 10, // score per orb (the orb itself is the reward: +1 to the bank)
    pickupRadius: 16, // added to the player radius
    trailChance: 0.6, // chance a world segment carries a trail of orbs
    trailCount: [4, 7], // orbs per trail
    spacing: 48, // px between orbs in a trail
  },

  // Power-ups are rare floating pickups; touching one switches its effect on.
  powerups: {
    firstAt: 1400, // px of world before the first pickup can appear
    gap: [2600, 4200], // px between pickups
    pickupRadius: 30, // added to the player radius
    magnet: {
      duration: 8, // seconds
      range: 380, // orbs + wisps inside this radius fly to the player
      strength: 1150, // their speed, px/s
    },
    barrier: {
      grace: 0.6, // seconds of smash-through after the barrier breaks
      seaBounce: 820, // upward launch (px/s) when it saves you from the cloud sea
    },
  },

  camera: {
    anchorX: 0.33, // player rests this far across the screen
    anchorY: 0.46,
    followX: 14, // horizontal follow smoothing rate
    followY: 3.4, // vertical follow smoothing rate
    lookAheadSpeed: 0.16, // extra forward offset scaled by speed
    shakeDecay: 6,
    // With Conserve momentum on, the camera pulls back at speed so more of
    // what is coming is on screen: between these paces (px/s, smoothed) it
    // zooms out by up to speedZoomOut and slides the plane speedAnchorShift
    // further left. Off (the 1.2 swing) it never moves: grabs need the
    // anchor on screen, so the view is part of the 1.2 game.
    speedPullFrom: 900,
    speedPullTo: 1600,
    speedZoomOut: 0.25,
    speedAnchorShift: 0.12,
  },

  scoring: {
    perfectPoints: 250,
    collectPoints: 60,
    skimPointsPerSec: 40,
  },
} as const;

// Minimalist dawn-biome palette. One biome for the MVP.
export const PALETTE = {
  skyTop: "#0f1438",
  skyMid: "#3b3d78",
  skyHorizon: "#f0a36a",
  skyGlow: "#ffd9a8",
  sun: "#fff0d4",
  far: "#2b2f66",
  farHaze: "#454b8f",
  mid: "#191d4a",
  midHaze: "#2a2f63",
  sea: "#c9d4ff",
  seaDeep: "#8d9bd8",
  cloud: "#eef2ff",
  player: "#4ab4e8",
  playerGlow: "#9ad8ff",
  anchor: "#8be9ff",
  anchorRing: "#bdf3ff",
  anchorPerfect: "#ffce6b",
  tether: "#cfeeff",
  collectible: "#9bffd6",
  hazard: "#14172f",
  hazardEdge: "#3a4078",
  text: "#eaf0ff",
  textDim: "#9aa6d8",
} as const;
