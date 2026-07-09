import { PALETTE } from "../core/config";

// A continuously drifting time-of-day palette is the single biggest thing that
// gives Alto's Adventure its identity. The atmospheric colours below cycle
// smoothly through dawn -> day -> golden hour -> dusk -> night, while the
// readable foreground colours stay (mostly) constant for clarity.

export interface Theme {
  // Atmospheric (cycled each frame).
  skyTop: string;
  skyMid: string;
  skyHorizon: string;
  skyGlow: string;
  sun: string; // becomes the moon at night
  far: string;
  mid: string;
  sea: string;
  seaDeep: string;
  cloud: string;
  fog: string; // atmospheric-perspective haze colour for distant layers
  ambient: string; // drifting motes / fireflies
  night: number; // 0 = full day, 1 = full night (drives stars, glow strength)
  /**
   * Monotonic counter bumped only when the (quantized) palette actually
   * changes (~a few times per second). Renderers key gradient / sprite caches
   * on this instead of rebuilding them every frame.
   */
  version: number;
  // Foreground (constant, from PALETTE).
  player: string;
  playerGlow: string;
  anchor: string;
  anchorRing: string;
  anchorPerfect: string;
  tether: string;
  collectible: string;
  hazard: string;
  hazardEdge: string;
  text: string;
  textDim: string;
}

type Mood = Pick<
  Theme,
  | "skyTop"
  | "skyMid"
  | "skyHorizon"
  | "skyGlow"
  | "sun"
  | "far"
  | "mid"
  | "sea"
  | "seaDeep"
  | "cloud"
  | "fog"
  | "ambient"
  | "night"
>;

const ATMOS_KEYS = [
  "skyTop",
  "skyMid",
  "skyHorizon",
  "skyGlow",
  "sun",
  "far",
  "mid",
  "sea",
  "seaDeep",
  "cloud",
  "fog",
  "ambient",
] as const;

// Seconds for a full day->night->day loop. Each run starts at dawn.
export const CYCLE_SECONDS = 95;

const MOODS: Mood[] = [
  {
    // Dawn — cool lavender lifting into a soft rose horizon.
    skyTop: "#2b2c54",
    skyMid: "#5e5392",
    skyHorizon: "#eaa6a0",
    skyGlow: "#ffd9b4",
    sun: "#fff1da",
    far: "#6f6aa0",
    mid: "#514c80",
    sea: "#ddd4c8",
    seaDeep: "#b5a090",
    cloud: "#f4eefb",
    fog: "#b9aecd",
    ambient: "#ffd9b4",
    night: 0.18,
  },
  {
    // Day — clean, bright, airy blue.
    skyTop: "#3f7fc6",
    skyMid: "#86b8e8",
    skyHorizon: "#d6ecf7",
    skyGlow: "#ffffff",
    sun: "#fffdf6",
    far: "#9ec6e8",
    mid: "#6f9fcf",
    sea: "#ddd5c0",
    seaDeep: "#bfa68a",
    cloud: "#ffffff",
    fog: "#d4e7f6",
    ambient: "#ffffff",
    night: 0,
  },
  {
    // Golden hour — warm amber wash, long light.
    skyTop: "#4a4a8e",
    skyMid: "#c07f86",
    skyHorizon: "#ffb56e",
    skyGlow: "#ffe6ad",
    sun: "#fff0cb",
    far: "#8a6e9c",
    mid: "#664f7c",
    sea: "#f0d4b0",
    seaDeep: "#c99268",
    cloud: "#ffe9d6",
    fog: "#d6a98f",
    ambient: "#ffcaa0",
    night: 0.08,
  },
  {
    // Dusk — deep magenta and violet, sun nearly gone.
    skyTop: "#211a40",
    skyMid: "#5d3a6e",
    skyHorizon: "#c2587c",
    skyGlow: "#ff9c78",
    sun: "#ffd0b0",
    far: "#46375f",
    mid: "#322850",
    sea: "#c8a088",
    seaDeep: "#8a6458",
    cloud: "#e9c8da",
    fog: "#6e5378",
    ambient: "#ff9c78",
    night: 0.5,
  },
  {
    // Night — deep navy, moonlit, starry.
    skyTop: "#080c26",
    skyMid: "#172050",
    skyHorizon: "#3a4c80",
    skyGlow: "#90a6d6",
    sun: "#eef3ff",
    far: "#19224a",
    mid: "#10142f",
    sea: "#8a94a8",
    seaDeep: "#525a70",
    cloud: "#cdd7f4",
    fog: "#222a52",
    ambient: "#a9beea",
    night: 1,
  },
];

// Initialise with foreground constants + the dawn mood.
export const theme: Theme = {
  ...(PALETTE as unknown as Theme),
  ...MOODS[0],
  version: 0,
};

// Palette updates are quantized to 1/512 of the day cycle (~0.19s). A full
// mood crossfade spans ~19s, so each step moves colours by at most ~2-3 RGB
// units — imperceptible — while letting every gradient/sprite cache downstream
// key off theme.version instead of rebuilding 60x per second.
const PHASE_STEPS = 512;
let lastBucket = -1;

export function updateTheme(phaseSeconds: number) {
  const phase = phaseSeconds / CYCLE_SECONDS;
  const bucket = Math.floor((((phase % 1) + 1) % 1) * PHASE_STEPS);
  if (bucket === lastBucket) return;
  lastBucket = bucket;
  theme.version++;

  const n = MOODS.length;
  const f = (bucket / PHASE_STEPS) * n;
  const i = Math.floor(f);
  let t = f - i;
  t = t * t * (3 - 2 * t); // smoothstep for gentle transitions
  const a = MOODS[i];
  const b = MOODS[(i + 1) % n];
  for (const k of ATMOS_KEYS) {
    theme[k] = mixColor(a[k], b[k], t);
  }
  theme.night = a.night + (b.night - a.night) * t;
}

// --- colour helpers (handle both #hex and rgb()/rgba()) ---

// Hex nibble value for a char code ("0"-"9", "a"-"f", "A"-"F").
function nib(code: number): number {
  return code <= 57 ? code - 48 : (code | 32) - 87;
}

// Allocation-light colour parse: no regex, no match arrays. Handles "#rrggbb"
// and "rgb()/rgba()" (the live theme's interpolated colours are rgb strings).
export function parseColor(c: string): [number, number, number] {
  if (c.charCodeAt(0) === 35 /* "#" */) {
    return [
      nib(c.charCodeAt(1)) * 16 + nib(c.charCodeAt(2)),
      nib(c.charCodeAt(3)) * 16 + nib(c.charCodeAt(4)),
      nib(c.charCodeAt(5)) * 16 + nib(c.charCodeAt(6)),
    ];
  }
  // Walk digit runs: rgb(12,34,56) / rgba(12, 34, 56, 0.5)
  const out: [number, number, number] = [0, 0, 0];
  let chan = 0;
  let v = 0;
  let inNum = false;
  for (let i = 3; i < c.length && chan < 3; i++) {
    const d = c.charCodeAt(i) - 48;
    if (d >= 0 && d <= 9) {
      v = v * 10 + d;
      inNum = true;
    } else if (inNum) {
      out[chan++] = v;
      v = 0;
      inNum = false;
    }
  }
  if (inNum && chan < 3) out[chan] = v;
  return out;
}

export function mixColor(a: string, b: string, t: number): string {
  const pa = parseColor(a);
  const pb = parseColor(b);
  return `rgb(${Math.round(pa[0] + (pb[0] - pa[0]) * t)},${Math.round(
    pa[1] + (pb[1] - pa[1]) * t
  )},${Math.round(pa[2] + (pb[2] - pa[2]) * t)})`;
}
