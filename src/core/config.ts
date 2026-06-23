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
    releaseBoost: 1.07, // velocity multiplier on a normal release
    perfectBoost: 1.45, // velocity multiplier on a perfect release
    perfectBonusSpeed: 130, // additive speed on perfect
    idealLaunchAngleDeg: -44, // screen-space launch dir: up & forward
    perfectToleranceDeg: 17, // +/- window around ideal that counts as perfect
    minSwingSpeed: 60, // below this while tethered, swing feels dead
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
