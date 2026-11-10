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
    // Stronger gravity while tethered: a deliberate energy source relative to
    // gravityAir, so swings build speed that a glide alone never would.
    gravitySwing: 1750,
    metersPerPixel: 0.05, // distance scoring scale
  },

  player: {
    radius: 13,
    startSpeed: 400,
    cruiseSpeed: 360, // glide forward speed eases toward this
    minSpeed: 140,
    maxSpeed: 1900,
    // Reach this speed and meteors shatter on contact instead of ending the
    // run — a clean perfect release gets you there (bot-measured median
    // perfect release 1400–1800 px/s; about a quarter of sloppy releases
    // reach it). Retuned from 1050 when the swing stopped losing energy.
    smashSpeed: 1200,
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
    // Rope shortens this many px/s while holding. Reeling in conserves angular
    // momentum (L²ω), so it is a real pump: speed grows by reelRate/L per
    // second (10%/s on a 300 px rope, 20%/s on 150 px). The old integrator
    // silently ate this, which is why 90 once looked harmless.
    reelRate: 30,
    // Quadratic air drag on the swing speed (px⁻¹): a = -swingDrag·v·|v|. The
    // swing is otherwise lossless, so this sets the soft terminal speed —
    // fractional loss is swingDrag·v per second (6%/s at 1000 px/s for 6e-5).
    // 0 = pure energy conservation (the physics probes set it).
    swingDrag: 6e-5,
    // The swing cannot carry the player above the anchor: reaching this angle
    // from straight-below while still holding makes the hook slip (the player
    // flies on with the speed they have, no boost) — no loop-the-loops.
    maxSwingAngleDeg: 90,
    // Where the slip flings the player (screen angle, negative = up). At the
    // cap the swing's own velocity is straight up — a rocket that stalls —
    // so the hook slipping off redirects the speed forward-up instead. Just
    // outside the PERFECT window (-44 ± 17), so a timed release still wins.
    slipLaunchAngleDeg: -62,
    // An anchor must be at least this far above the player to be grabbable:
    // the swing cannot lift the player above the anchor, so a rope to one
    // at or below their height would slip on the very next step.
    grabMinAbove: 10,
    // A grab whose swing would reach the cap within this many seconds is
    // refused too: hooking an anchor only to slip off it a frame later is
    // the yank this rule exists to prevent (a rising glide at a near-level
    // anchor, or an anchor just passed).
    grabHeadroom: 0.15,
    // After a release or slip the anchor just left stays ungrabbable for
    // this long, so a re-press during the launch cannot haul the player back
    // onto it (the clip that prompted this turned a PERFECT into a vertical
    // rocket). Other anchors can be grabbed at once.
    regrabCooldown: 0.6,
    // ...and for this long after letting go nothing at all can be grabbed:
    // a press that lands as the finger lifts, or a reflex re-tap during the
    // launch, would otherwise hook whatever is in range and re-pose the
    // player mid-flight. Longer than grabBuffer, so such a press expires
    // unanswered; a deliberate press for the next anchor comes later anyway.
    releaseGrabDelay: 0.2,
    // The "classic" swing model (the pre-pendulum rod) kept its own reel rate.
    classicReelRate: 90,
    // A press grabs only if an anchor is in reach at that moment — or comes
    // into reach within this many seconds. Holding never latches onto an
    // anchor by itself: that is what makes grabbing a deliberate act.
    grabBuffer: 0.15,
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
  },

  scoring: {
    perfectPoints: 250,
    collectPoints: 60,
    skimPointsPerSec: 40,
    flipPoints: 100, // the n-th backflip in one hold scores n × this
  },

  // Tricks: press and hold in open sky (no anchor in reach) to backflip.
  tricks: {
    flipRate: 10, // rad/s of rotation while holding (a full flip every ~0.63 s)
    flipSpeedLoss: 0.08, // speed scrubbed by each completed flip
    settleRate: 14, // how fast the character rights itself after letting go
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
