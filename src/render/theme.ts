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
};

export function updateTheme(phaseSeconds: number) {
  const phase = phaseSeconds / CYCLE_SECONDS;
  const n = MOODS.length;
  const f = (((phase % 1) + 1) % 1) * n;
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

export function parseColor(c: string): [number, number, number] {
  if (c[0] === "#") {
    const h = c.slice(1);
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  const m = c.match(/[\d.]+/g);
  if (m && m.length >= 3) return [+m[0], +m[1], +m[2]];
  return [0, 0, 0];
}

export function mixColor(a: string, b: string, t: number): string {
  const pa = parseColor(a);
  const pb = parseColor(b);
  return `rgb(${Math.round(pa[0] + (pb[0] - pa[0]) * t)},${Math.round(
    pa[1] + (pb[1] - pa[1]) * t
  )},${Math.round(pa[2] + (pb[2] - pa[2]) * t)})`;
}
