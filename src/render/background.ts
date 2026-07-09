import { CONFIG } from "../core/config";
import { Camera } from "../core/camera";
import { clamp, lerp, TAU } from "../core/math";
import { hexA } from "../entities/anchor";
import { theme, mixColor, CYCLE_SECONDS } from "./theme";
import { makeScratch, Scratch, VersionCache } from "./rcache";

// Deterministic [0,1) value from an integer cell index — keeps procedural
// silhouettes stable as they scroll (no popping).
function hash01(i: number): number {
  let h = (i ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

// Dune-surface height cache — screen-space surface y per HEIGHT_STEP px
// column, refilled per dune layer each frame (see sampleDuneHeights) and
// shared by the clip / fill / grain / ripple / crest passes. waveHeight runs
// once per column instead of once per vertex per pass (~170-200k Math.sin a
// frame down to ~5k). Grows to fit the widest canvas seen; reused across
// frames so it never churns the GC.
const HEIGHT_STEP = 4;
let heightScratch = new Float32Array(0);

// Pre-rendered glow for the bright stars — stands in for a per-star radial
// gradient + arc fill. Colours are constant literals, so it's baked once,
// lazily, at 2x (DPR is clamped to 2) so it stays crisp at its 12px CSS size.
const STAR_GLOW_CSS = 12;
let starGlowCanvas: HTMLCanvasElement | null = null;
function starGlow(): HTMLCanvasElement {
  if (!starGlowCanvas) {
    const px = STAR_GLOW_CSS * 2;
    const { canvas, ctx } = makeScratch(px, px);
    const g = ctx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
    g.addColorStop(0, "#dce6ff");
    g.addColorStop(1, hexA("#dce6ff", 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, px, px);
    starGlowCanvas = canvas;
  }
  return starGlowCanvas;
}

// The moon's disc / craters / rim highlight are completely static imagery —
// bake them once (at 2x for retina) and drawImage per frame with globalAlpha
// carrying the visibility. Only the palette-tracking halo stays a gradient.
const MOON_R = 30;
const MOON_SPRITE_CSS = 70; // disc + margin
let moonCanvas: HTMLCanvasElement | null = null;
function moonSprite(): HTMLCanvasElement {
  if (moonCanvas) return moonCanvas;
  const { canvas, ctx } = makeScratch(MOON_SPRITE_CSS * 2, MOON_SPRITE_CSS * 2);
  ctx.scale(2, 2);
  const c = MOON_SPRITE_CSS / 2;
  const r = MOON_R;

  // Disc with gentle limb darkening (lit from the upper-left).
  const disc = ctx.createRadialGradient(
    c - r * 0.28,
    c - r * 0.3,
    r * 0.15,
    c,
    c,
    r * 1.08
  );
  disc.addColorStop(0, "#fdfdf6");
  disc.addColorStop(0.55, "#e9edf6");
  disc.addColorStop(0.85, "#cdd4e4");
  disc.addColorStop(1, "#a7afc6");
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, TAU);
  ctx.fill();

  // Craters / maria — clipped to the disc so nothing spills past the rim.
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, r, 0, TAU);
  ctx.clip();
  const craters: [number, number, number][] = [
    [-0.32, -0.2, 0.26],
    [0.22, -0.32, 0.15],
    [0.36, 0.16, 0.2],
    [-0.06, 0.34, 0.16],
    [-0.44, 0.24, 0.11],
    [0.04, 0.0, 0.1],
    [0.52, -0.12, 0.08],
  ];
  for (const [cx, cy, cr] of craters) {
    const px = c + cx * r;
    const py = c + cy * r;
    const pr = cr * r;
    const cg = ctx.createRadialGradient(
      px - pr * 0.3,
      py - pr * 0.3,
      pr * 0.1,
      px,
      py,
      pr
    );
    cg.addColorStop(0, hexA("#bcc4d8", 0.85));
    cg.addColorStop(0.7, hexA("#a7afc8", 0.7));
    cg.addColorStop(1, hexA("#a7afc8", 0));
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, TAU);
    ctx.fill();
    // Bright sunlit rim along the lower-right of each crater.
    ctx.strokeStyle = hexA("#ffffff", 0.3);
    ctx.lineWidth = Math.max(0.6, pr * 0.16);
    ctx.beginPath();
    ctx.arc(px, py, pr * 0.9, Math.PI * 0.08, Math.PI * 0.92);
    ctx.stroke();
  }
  ctx.restore();

  // Crisp highlight arc on the lit edge.
  ctx.strokeStyle = hexA("#ffffff", 0.4);
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(c, c, r - 1.2, Math.PI * 0.95, Math.PI * 1.78);
  ctx.stroke();

  moonCanvas = canvas;
  return canvas;
}

// Constant per-frame config, hoisted to module scope so the draw methods
// allocate nothing rebuilding byte-identical structures every frame.

// Mountain ridge layers (drawMountains).
const MOUNTAIN_LAYERS = [
  { parallax: 0.035, baseY: 0.6, height: 130, cell: 240, mix: 0.72, alpha: 0.5 },
  { parallax: 0.065, baseY: 0.65, height: 180, cell: 300, mix: 0.52, alpha: 0.66 },
  { parallax: 0.1, baseY: 0.71, height: 240, cell: 360, mix: 0.32, alpha: 0.82 },
];

// Reused peak / valley scratch for drawMountains — grown on demand and
// refilled per ridge each frame instead of allocating ~14 point objects per
// layer per frame.
interface MountainPt {
  x: number;
  apexY: number;
  ph: number;
  valX: number;
  valY: number;
}
const mountainPts: MountainPt[] = [];

// Slow high cloud banks (drawSkyClouds).
const SKY_CLOUD_LAYERS = [
  { parallax: 0.05, y: 0.15, speed: 4, scale: 1.35, alpha: 0.1, spacing: 780, seed: 0 },
  { parallax: 0.09, y: 0.29, speed: 8, scale: 1.0, alpha: 0.14, spacing: 600, seed: 64 },
];

// A few loose flocks drifting at different heights and speeds (drawBirds).
const BIRD_FLOCKS = [
  { y: 0.2, speed: 26, count: 5, size: 6.2, drift: 12 },
  { y: 0.3, speed: 19, count: 4, size: 5.2, drift: 9 },
  { y: 0.14, speed: 33, count: 6, size: 4.6, drift: 7 },
];

// Parallax dune layers — back to front, Alto-style rolling sand hills. The
// structure is constant; only the theme-derived colours change, and only when
// the quantized palette does, so they refresh in place per theme.version.
const SEA_LAYERS = [
  {
    offset: -72,
    parallax: 0.14,
    layer: 0,
    color: "",
    dark: "",
    alpha: 0.48,
    ripples: { spacing: 5.5, depth: 32, alpha: 0.07 },
  },
  {
    offset: -42,
    parallax: 0.3,
    layer: 1,
    color: "",
    dark: "",
    alpha: 0.68,
    ripples: { spacing: 4.2, depth: 48, alpha: 0.1 },
  },
  {
    offset: -14,
    parallax: 0.56,
    layer: 2,
    color: "",
    dark: "",
    alpha: 0.86,
    ripples: { spacing: 3.2, depth: 68, alpha: 0.13 },
  },
  {
    offset: 0,
    parallax: 0.9,
    layer: 3,
    color: "",
    dark: "",
    alpha: 1.0,
    ripples: { spacing: 2.4, depth: 92, alpha: 0.17 },
  },
];
let seaLayersVersion = -1;
function refreshSeaLayers() {
  if (seaLayersVersion === theme.version) return;
  seaLayersVersion = theme.version;
  SEA_LAYERS[0].color = mixColor(theme.sea, theme.fog, 0.62);
  SEA_LAYERS[0].dark = mixColor(theme.seaDeep, theme.fog, 0.5);
  SEA_LAYERS[1].color = mixColor(theme.sea, theme.fog, 0.35);
  SEA_LAYERS[1].dark = mixColor(theme.seaDeep, theme.fog, 0.25);
  SEA_LAYERS[2].color = mixColor(theme.sea, theme.seaDeep, 0.18);
  SEA_LAYERS[2].dark = mixColor(theme.seaDeep, theme.fog, 0.08);
  SEA_LAYERS[3].color = theme.sea;
  SEA_LAYERS[3].dark = theme.seaDeep;
}

// --- Grain stipple tiles --------------------------------------------------
// The sand stipple is hash-static in scroll space and its colours drift under
// 5 RGB units between palette steps, so instead of issuing ~2-3k one-pixel
// fillRects per frame (WebKit's single biggest per-call cost in the sea /
// death scene) each stipple band bakes into a scroll-anchored offscreen tile
// and blits as ONE drawImage. Tiles re-bake only when the camera scrolls past
// their margin, the viewport resizes, or the palette has drifted a few steps
// — staggered per layer so rebakes never share a frame.
const GRAIN_MARGIN = 512;
const DUNE_TILE_PAD = 40; // headroom above baseY for negative wave heights
const DUNE_TILE_H = 224; // pad + wave amplitude + 14 grain rows for layer 3
interface GrainTile {
  s: Scratch | null;
  u0: number; // scroll-space x of the tile's left edge
  w: number;
  h: number;
  version: number; // theme.version at bake time
}
function makeGrainTile(): GrainTile {
  return { s: null, u0: 0, w: 0, h: 0, version: -99 };
}
const seaGrainTile = makeGrainTile();
const duneGrainTiles: GrainTile[] = [];

// (Re)allocate a tile's scratch canvas when its size changes.
function grainScratch(tile: GrainTile, w: number, h: number): Scratch {
  if (!tile.s || tile.w !== w || tile.h !== h) {
    tile.s = makeScratch(w, h);
    tile.w = w;
    tile.h = h;
  }
  return tile.s;
}

function grainTileStale(
  tile: GrainTile,
  tw: number,
  th: number,
  offX: number,
  screenW: number,
  versionSlack: number
): boolean {
  return (
    !tile.s ||
    tile.w !== tw ||
    tile.h !== th ||
    offX < tile.u0 ||
    offX + screenW > tile.u0 + tw ||
    theme.version - tile.version >= versionSlack
  );
}

// One continuous, gently rolling mid-ground line shared by every feature, as
// a smooth function of world X so neighbouring cells line up seamlessly.
// Module-level so drawMid allocates no per-frame closures for it.
function midRoll(wx: number): number {
  return (
    Math.sin(wx * 0.0017) * 15 +
    Math.sin(wx * 0.0043 + 1.3) * 8 +
    Math.sin(wx * 0.0111 + 0.7) * 3
  );
}

// Deterministic scenery layouts (pine clusters, floating islands) are pure
// functions of their integer seed — cache them so the per-frame path is draw
// calls only: no array allocation, no sort, no hash01, no bezier root solves.
// Regeneration after eviction is deterministic, so capping the maps can never
// cause popping.
const LAYOUT_CAP = 64;
function evictOldest<K, V>(map: Map<K, V>) {
  const oldest = map.keys().next(); // Maps iterate in insertion order
  if (!oldest.done) map.delete(oldest.value);
}

// Forest cluster layout — tree positions / heights (and the tall-to-short
// draw order of the front row) in unit space; the cluster scale is applied at
// draw time. See drawPineCluster.
interface PineLayout {
  backX: number[];
  backH: number[];
  frontX: number[]; // sorted with frontH, tallest first
  frontH: number[];
}
const pineLayouts = new Map<number, PineLayout>();

function pineLayout(seed: number): PineLayout {
  let L = pineLayouts.get(seed);
  if (L) return L;
  const nb = 6 + ((hash01(seed * 7) * 5) | 0);
  const backX: number[] = [];
  const backH: number[] = [];
  for (let t = 0; t < nb; t++) {
    backX.push((hash01(seed * 11 + t * 3) - 0.5) * 180 * 1.95);
    backH.push(32 + hash01(seed * 17 + t) * 30);
  }
  const nf = 7 + ((hash01(seed * 13) * 5) | 0);
  const trees: { fx: number; fh: number }[] = [];
  for (let t = 0; t < nf; t++) {
    trees.push({
      fx: (hash01(seed * 23 + t * 5) - 0.5) * 180 * 1.85,
      fh: 50 + hash01(seed * 29 + t) * 66,
    });
  }
  trees.sort((a, b) => b.fh - a.fh);
  L = {
    backX,
    backH,
    frontX: trees.map((t) => t.fx),
    frontH: trees.map((t) => t.fh),
  };
  if (pineLayouts.size >= LAYOUT_CAP) evictOldest(pineLayouts);
  pineLayouts.set(seed, L);
  return L;
}

// Floating-island layout — silhouette metrics, vine anchors (the quad-bezier
// root solves live here), tree spots and the critter pick, all in unit space
// with the island scale applied at draw time. The per-island theme-derived
// styling (body gradient + tinted colour strings) rebuilds only when the
// quantized palette changes. See Background.islandLayout.
interface IslandStyle {
  grad: CanvasGradient;
  treeCol: string;
  trunkCol: string;
  vineCol: string;
  leafCol: string;
  critterCol: string;
}
interface IslandLayout {
  rw: number;
  rh: number;
  hang: number;
  skew: number;
  vineX: number[];
  vineY: number[];
  vineLen: number[];
  vineSway: number[];
  vineCurl: number[];
  treeX: number[];
  treeY: number[];
  treeH: number[];
  hasCritter: boolean;
  critterX: number;
  critterY: number;
  critterPick: number;
  critterPh: number;
  critterSize: number;
  style: VersionCache<IslandStyle>;
}
const islandLayouts = new Map<number, IslandLayout>();

// Shared soft puff sprite for the sky / foreground cloud clusters — the
// radial falloff (same profile as the old per-puff gradient) bakes once in
// white at 2x (DPR is clamped to 2), then re-tints to theme.cloud via
// 'source-in' when the quantized palette changes. Per puff, a drawImage
// replaces a fresh 3-stop createRadialGradient + shader-filled arc.
const PUFF_CSS = 128;
let puffBaseCanvas: HTMLCanvasElement | null = null;
let puffTintCanvas: HTMLCanvasElement | null = null;
let puffTintCtx: CanvasRenderingContext2D | null = null;
let puffTintVersion = -1;
function puffSprite(): HTMLCanvasElement {
  const px = PUFF_CSS * 2;
  let base = puffBaseCanvas;
  if (!base) {
    const { canvas, ctx } = makeScratch(px, px);
    const c = px / 2;
    const r = px / 2;
    const g = ctx.createRadialGradient(c, c - r * 0.3, r * 0.1, c, c + r * 0.15, r);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(0.55, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, TAU);
    ctx.fill();
    base = puffBaseCanvas = canvas;
  }
  let tint = puffTintCanvas;
  let tctx = puffTintCtx;
  if (!tint || !tctx) {
    const t = makeScratch(px, px);
    tint = puffTintCanvas = t.canvas;
    tctx = puffTintCtx = t.ctx;
    puffTintVersion = -1;
  }
  if (puffTintVersion !== theme.version) {
    puffTintVersion = theme.version;
    tctx.globalCompositeOperation = "source-over";
    tctx.clearRect(0, 0, px, px);
    tctx.drawImage(base, 0, 0);
    // 'source-in' keeps the baked alpha falloff and swaps in the cloud colour.
    tctx.globalCompositeOperation = "source-in";
    tctx.fillStyle = theme.cloud;
    tctx.fillRect(0, 0, px, px);
  }
  return tint;
}

// Puff offsets / radii as fractions of the cluster width (drawCloudCluster).
const CLUSTER_PUFFS = [
  { dx: 0, dy: 0, r: 0.28 },
  { dx: -0.22, dy: 0.04, r: 0.22 },
  { dx: 0.24, dy: 0.02, r: 0.24 },
  { dx: -0.08, dy: -0.1, r: 0.26 },
  { dx: 0.1, dy: -0.08, r: 0.2 },
  { dx: 0.38, dy: 0.06, r: 0.16 },
  { dx: -0.35, dy: 0.05, r: 0.15 },
];

// Distinct scenery biomes the run travels through, in the spirit of Alto's
// Odyssey. Each region swaps the mid-ground silhouette features (the sky and
// dunes keep re-grading with the time of day on top). Regions cycle by world
// distance and cross-fade at their seams.
const REGION_KINDS = ["sanctuary", "forest", "village", "peaks", "monuments"] as const;
type RegionKind = (typeof REGION_KINDS)[number];
const REGION_LEN = 3000; // world units per region band

// Flat, layered, fog-faded sky in the spirit of Alto's Adventure. All colours
// come from the live time-of-day `theme`, so the whole scene re-grades together
// through dawn / day / golden hour / dusk / night.
export class Background {
  // Screen-static gradients, rebuilt only when the quantized palette changes
  // (theme.version) or their anchoring geometry moves a few px (quantized
  // keys). Gradients tied to a moving point — sun halo/disc, moon halo, the
  // sky light wash — are built once per version in local space at full
  // strength and drawn translated, with globalAlpha carrying the visibility.
  private skyGrad = new VersionCache<CanvasGradient>();
  private washGrad = new VersionCache<CanvasGradient>();
  private sunHaloGrad = new VersionCache<CanvasGradient>();
  private sunDiscGrad = new VersionCache<CanvasGradient>();
  private moonHaloGrad = new VersionCache<CanvasGradient>();
  private seaBodyGrad = new VersionCache<CanvasGradient>();
  private hazeGrad = new VersionCache<CanvasGradient>();
  private duneGrads = [
    new VersionCache<CanvasGradient>(),
    new VersionCache<CanvasGradient>(),
    new VersionCache<CanvasGradient>(),
    new VersionCache<CanvasGradient>(),
  ];
  // Mid-ground biome colours — pure functions of the palette, so one bundle
  // per theme.version replaces 2-4 mixColor parses per feature cell per frame.
  private midCols = new VersionCache<{
    base: string;
    accent: string;
    forest: string;
    forestLit: string;
    forestBack: string;
    forestBackLit: string;
    peak: string;
    peakLit: string;
    monolith: string;
    monolithLit: string;
  }>();

  drawSky(ctx: CanvasRenderingContext2D, cam: Camera, time: number) {
    const { w, h } = cam;
    const horizon = h * 0.72 - cam.y * 0.04;
    const daylight = 1 - theme.night;
    const sky = this.celestialPositions(cam, horizon, time);

    ctx.fillStyle = this.skyGradient(ctx, cam, horizon);
    ctx.fillRect(0, 0, w, h);

    if (daylight > 0.08 && sky.sun.alt > 0) {
      this.drawSkyLightWash(ctx, sky.sun, daylight * sky.sun.alt);
    }

    if (theme.night > 0.05) this.drawStars(ctx, cam, horizon, time);

    // The moon rises in the east as the sun sets in the west — both share the
    // sky through dusk and dawn. Moon under the sun so a faint daytime moon
    // reads softly behind the brighter disc.
    this.drawMoon(ctx, sky.moon);
    this.drawSun(ctx, sky.sun, daylight);
  }

  // Independent sun + moon arcs across the day-night cycle. Each rises from one
  // side, sails over, and sets at the other — so as the sun goes down the moon
  // is already climbing. `alt` is height above the horizon (0 = on the horizon).
  private celestialPositions(cam: Camera, horizon: number, time: number) {
    const { w, h } = cam;
    const phase = (((time / CYCLE_SECONDS) % 1) + 1) % 1;
    const arc = h * 0.4;
    const baseY = horizon - 16 - cam.y * 0.03;
    const xL = w * 0.06 - cam.x * 0.02;
    const xR = w * 0.94 - cam.x * 0.02;

    const body = (rise: number, set: number) => {
      let p = (phase - rise) / (set - rise);
      if (p < 0 || p > 1) {
        const pw = (phase + 1 - rise) / (set - rise);
        if (pw >= 0 && pw <= 1) p = pw;
      }
      const above = p >= 0 && p <= 1;
      const alt = above ? Math.sin(p * Math.PI) : 0;
      const cp = clamp(p, 0, 1);
      return { x: xL + (xR - xL) * cp, y: baseY - alt * arc, alt };
    };

    // Sun: dawn -> dusk. Moon: dusk -> the next dawn (rises as the sun sets).
    return { sun: body(0.0, 0.6), moon: body(0.52, 1.12) };
  }

  // `daylight` here is daylight * sun altitude (see drawSky).
  private drawSkyLightWash(
    ctx: CanvasRenderingContext2D,
    sun: { x: number; y: number },
    daylight: number
  ) {
    // Below ~0.15 the strongest stop is under ~0.02 alpha — invisible; skip
    // the whole pass instead of paying for a near-fullscreen fill.
    if (daylight < 0.15) return;
    // ~2.5x the sun halo radius; the stops beyond are <= 0.035 alpha, so the
    // old max(w,h)-reaching fill bought nothing but overdraw.
    const reach = 750;

    // Built in sun-local space at full strength; the sun moves < 1px/frame,
    // so translating a version-cached gradient is exact and free.
    const wash = this.washGrad.get(theme.version, 0, () => {
      const g = ctx.createRadialGradient(0, 0, 24, 0, 0, reach);
      g.addColorStop(0, hexA(theme.sun, 0.14));
      g.addColorStop(0.2, hexA(theme.skyGlow, 0.08));
      g.addColorStop(0.45, hexA(theme.skyHorizon, 0.035));
      g.addColorStop(0.7, hexA(theme.skyMid, 0.012));
      g.addColorStop(1, hexA(theme.skyTop, 0));
      return g;
    });

    ctx.save();
    ctx.translate(sun.x, sun.y);
    ctx.globalAlpha = daylight;
    ctx.fillStyle = wash;
    ctx.fillRect(-reach, -reach, reach * 2, reach * 2);
    ctx.restore();
  }

  private drawStars(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    horizon: number,
    time: number
  ) {
    const { w } = cam;
    const cell = Math.max(32, w / 36); // denser grid = more stars
    const offX = cam.x * 0.05;
    const offY = cam.y * 0.05;
    const startI = Math.floor((offX - w) / cell);
    const endI = Math.ceil((offX + w) / cell);
    // Rows whose topmost possible star already sits below the horizon can
    // never draw — clamp the loop instead of rejecting cell by cell.
    const endJ = Math.min(15, Math.floor((horizon - 18 + offY) / cell) + 1);
    const glow = starGlow();
    const half = STAR_GLOW_CSS / 2;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // One fillStyle for every star; the per-star twinkle rides on
    // ctx.globalAlpha (a plain number — no rgba string per star).
    ctx.fillStyle = "#eef2ff";
    for (let i = startI; i <= endI; i++) {
      for (let j = -2; j < endJ; j++) {
        const r = hash01(i * 131 + j * 977 + 17);
        if (r < 0.45) continue; // lower threshold = many more stars
        const sx = i * cell - offX + ((hash01(i * 7 + j) * cell) | 0);
        const sy = j * cell - offY + hash01(i + j * 53) * cell;
        if (sy > horizon - 18) continue;
        // Each star twinkles on its own phase.
        const phase = hash01(i * 17 + j * 5) * TAU;
        const tw = 0.55 + 0.45 * Math.sin(time * 2.2 + phase);
        const fade = clamp((horizon - sy) / horizon, 0, 1);
        const a = (r - 0.45) * 1.7 * tw * fade * theme.night;
        if (a <= 0.01) continue;
        const bright = r > 0.9; // a few standout stars get size + glow
        const size = bright ? 2.4 : 1 + r * 0.9;
        ctx.globalAlpha = clamp(a, 0, 1);
        ctx.fillRect(sx, sy, size, size);
        if (bright) {
          ctx.globalAlpha = clamp(a * 0.9, 0, 1);
          ctx.drawImage(glow, sx + 1 - half, sy + 1 - half, STAR_GLOW_CSS, STAR_GLOW_CSS);
        }
      }
    }
    ctx.restore();
  }

  private drawSun(
    ctx: CanvasRenderingContext2D,
    sun: { x: number; y: number; alt: number },
    daylight: number
  ) {
    if (sun.alt <= 0 || daylight <= 0.02) return;
    // Dim as it nears the horizon (low altitude = setting / rising).
    const vis = daylight * clamp(sun.alt * 1.5, 0, 1);

    ctx.save();
    ctx.translate(sun.x, sun.y);

    // Halo stop alphas are all linear in vis, so it bakes at full strength
    // per palette change and vis rides on globalAlpha — exact modulo rounding.
    const halo = this.sunHaloGrad.get(theme.version, 0, () => {
      const g = ctx.createRadialGradient(0, 0, 20, 0, 0, 300);
      g.addColorStop(0, hexA(theme.sun, 0.28));
      g.addColorStop(0.35, hexA(theme.skyGlow, 0.12));
      g.addColorStop(0.72, hexA(theme.skyHorizon, 0.04));
      g.addColorStop(1, hexA(theme.skyTop, 0));
      return g;
    });
    ctx.globalAlpha = vis;
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, 300, 0, TAU);
    ctx.fill();

    // The disc mixes two ramps of vis, so it can't ride on globalAlpha —
    // quantize vis to 1/64 steps (stop deltas < 2/255) and key on it instead.
    const qvis = Math.round(vis * 64) / 64;
    const disc = this.sunDiscGrad.get(theme.version, qvis, () => {
      const core = 0.4 + qvis * 0.6;
      const g = ctx.createRadialGradient(0, -8, 1, 0, 0, 54);
      g.addColorStop(0, hexA("#ffffff", 0.72 * core));
      g.addColorStop(0.4, hexA(theme.sun, 0.6 * core));
      g.addColorStop(0.78, hexA(theme.skyGlow, 0.18 * qvis));
      g.addColorStop(1, hexA(theme.skyGlow, 0));
      return g;
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(0, 0, 54, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private skyGradient(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    horizon: number
  ): CanvasGradient {
    const { h } = cam;
    // Rebuilt only on palette change / resize / a few px of horizon drift —
    // a 4px-quantized stop on a smooth gradient is sub-RGB-unit noise.
    const qh = Math.round(horizon / 4) * 4;
    return this.skyGrad.get(theme.version, `${h}|${qh}`, () => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, theme.skyTop);
      g.addColorStop(0.45, theme.skyMid);
      g.addColorStop(clamp(qh / h, 0.4, 0.95), theme.skyHorizon);
      g.addColorStop(1, mixColor(theme.skyHorizon, theme.skyGlow, 0.6));
      return g;
    });
  }

  // Full moon — a pale cratered disc with limb darkening and a soft glow.
  // Bold at night, a faint ghost in daylight; fades in as it clears the horizon.
  private drawMoon(
    ctx: CanvasRenderingContext2D,
    moon: { x: number; y: number; alt: number }
  ) {
    if (moon.alt <= 0) return;
    const vis = clamp(moon.alt * 1.7, 0, 1) * (0.26 + 0.74 * theme.night);
    if (vis < 0.02) return;
    const r = MOON_R;

    ctx.save();
    ctx.translate(moon.x, moon.y);
    ctx.globalAlpha = vis;

    // Soft moonglow halo — its stop alphas are linear in vis, so it bakes at
    // full strength per palette change and vis rides on globalAlpha.
    const halo = this.moonHaloGrad.get(theme.version, 0, () => {
      const g = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 3.2);
      g.addColorStop(0, hexA(theme.sun, 0.5));
      g.addColorStop(0.5, hexA(theme.skyGlow, 0.16));
      g.addColorStop(1, hexA(theme.skyGlow, 0));
      return g;
    });
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, r * 3.2, 0, TAU);
    ctx.fill();

    // Static disc + craters + rim highlight, baked once (see moonSprite).
    const half = MOON_SPRITE_CSS / 2;
    ctx.drawImage(moonSprite(), -half, -half, MOON_SPRITE_CSS, MOON_SPRITE_CSS);

    ctx.restore();
  }

  // Which region a world-X falls in, plus a 0..1 fade that dips to 0 at the
  // seams so neighbouring biomes cross-dissolve as you scroll between them.
  private regionAt(worldX: number): { kind: RegionKind; fade: number } {
    const t = worldX / REGION_LEN;
    const idx = Math.floor(t);
    const frac = t - idx;
    const FADE = 0.13;
    let fade = 1;
    if (frac < FADE) fade = frac / FADE;
    else if (frac > 1 - FADE) fade = (1 - frac) / FADE;
    const n = REGION_KINDS.length;
    const kind = REGION_KINDS[((idx % n) + n) % n];
    return { kind, fade: clamp(fade, 0, 1) };
  }

  // Deep, layered mountain ranges fading into haze behind everything — the
  // single biggest "depth" cue from Alto. Three ridges at increasing parallax.
  drawMountains(ctx: CanvasRenderingContext2D, cam: Camera) {
    const { w, h } = cam;
    for (let li = 0; li < MOUNTAIN_LAYERS.length; li++) {
      const L = MOUNTAIN_LAYERS[li];
      const baseY = h * L.baseY - cam.y * L.parallax;
      const offX = cam.x * L.parallax;
      const color = mixColor(theme.far, theme.fog, L.mix);
      const snow = mixColor(color, theme.cloud, 0.62);
      const startI = Math.floor((offX - w) / L.cell) - 1;
      const endI = Math.ceil((offX + w) / L.cell) + 1;

      // Peak / valley vertices for this ridge (valley sits to a peak's right),
      // filled into the reused module-level scratch.
      let n = 0;
      for (let i = startI; i <= endI; i++) {
        const px = i * L.cell - offX + w * 0.5;
        const ph = (0.45 + hash01(i * 131 + li * 17) * 0.55) * L.height;
        let p = mountainPts[n];
        if (!p) p = mountainPts[n] = { x: 0, apexY: 0, ph: 0, valX: 0, valY: 0 };
        p.x = px;
        p.apexY = baseY - ph;
        p.ph = ph;
        p.valX = px + L.cell * 0.5;
        p.valY = baseY - ph * (0.1 + hash01(i * 71 + li) * 0.18);
        n++;
      }

      ctx.save();
      ctx.globalAlpha = L.alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(mountainPts[0].x, h);
      for (let k = 0; k < n; k++) {
        const p = mountainPts[k];
        ctx.lineTo(p.x, p.apexY);
        ctx.lineTo(p.valX, p.valY);
      }
      ctx.lineTo(mountainPts[n - 1].valX, h);
      ctx.closePath();
      ctx.fill();

      // Snow caps that hug the peak: they ride down the real left/right slopes
      // to a snow line, with a softly jagged lower edge (no sideways "brims").
      if (li >= 1) {
        ctx.globalAlpha = L.alpha * (li === 2 ? 0.6 : 0.4);
        ctx.fillStyle = snow;
        for (let j = 1; j < n; j++) {
          const p = mountainPts[j];
          if (p.ph < L.height * 0.55) continue;
          const f = 0.26 + hash01(j * 53 + li) * 0.1; // snow line depth
          // Left slope runs from the apex back to the previous valley.
          const lvX = mountainPts[j - 1].valX;
          const lvY = mountainPts[j - 1].valY;
          const Lx = lerp(p.x, lvX, f);
          const Ly = lerp(p.apexY, lvY, f);
          const Rx = lerp(p.x, p.valX, f);
          const Ry = lerp(p.apexY, p.valY, f);
          const dip = p.ph * 0.05;
          ctx.beginPath();
          ctx.moveTo(p.x, p.apexY);
          ctx.lineTo(Lx, Ly);
          ctx.lineTo(lerp(Lx, Rx, 0.3), lerp(Ly, Ry, 0.3) + dip);
          ctx.lineTo(lerp(Lx, Rx, 0.52), lerp(Ly, Ry, 0.52) - dip * 0.4);
          ctx.lineTo(lerp(Lx, Rx, 0.74), lerp(Ly, Ry, 0.74) + dip);
          ctx.lineTo(Rx, Ry);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  // Soft, slow-drifting cloud banks high in the sky, well behind the mountains.
  // Low parallax keeps them feeling far away; they thin out at night.
  drawSkyClouds(ctx: CanvasRenderingContext2D, cam: Camera, time: number) {
    const { w, h } = cam;
    const dayish = 1 - theme.night * 0.55;
    for (const L of SKY_CLOUD_LAYERS) {
      const offX = cam.x * L.parallax + time * L.speed;
      const startI = Math.floor((offX - w) / L.spacing) - 1;
      const endI = Math.ceil((offX + w) / L.spacing) + 1;
      for (let i = startI; i <= endI; i++) {
        const r = hash01(i * 13 + L.seed);
        if (r < 0.38) continue;
        const sx = i * L.spacing - offX + w * 0.5;
        const sy = h * L.y - cam.y * L.parallax + (r - 0.5) * 70;
        const width = (180 + r * 170) * L.scale;
        this.drawCloudCluster(ctx, sx, sy, width, L.alpha * dayish);
      }
    }
  }

  drawFar(ctx: CanvasRenderingContext2D, cam: Camera, time: number) {
    const { w, h } = cam;
    const spacing = 620;
    const offset = cam.x * 0.1;
    const startIdx = Math.floor((offset - w) / spacing);
    const endIdx = Math.ceil((offset + w) / spacing);
    const farCol = mixColor(theme.far, theme.fog, 0.55);

    for (let i = startIdx; i <= endIdx; i++) {
      const r1 = hash01(i * 2 + 1);
      const r2 = hash01(i * 2 + 7);
      const sx = i * spacing - offset + w * 0.5;
      const sy = h * (0.58 + r1 * 0.08) - cam.y * 0.1;
      const scale = 0.55 + r2 * 0.45;
      this.drawFloatingIsland(ctx, sx, sy, scale, i, farCol, r2 > 0.35, time);
    }

    this.drawBirds(ctx, cam, time);
    this.drawBats(ctx, cam, time);
    this.drawButterflies(ctx, cam, time);

    // Closer ridge — slightly larger islands, less fog.
    const spacing2 = 480;
    const offset2 = cam.x * 0.16;
    const start2 = Math.floor((offset2 - w) / spacing2);
    const end2 = Math.ceil((offset2 + w) / spacing2);
    const nearCol = mixColor(theme.far, theme.fog, 0.28);
    for (let i = start2; i <= end2; i++) {
      const r1 = hash01(i * 3 + 11);
      if (r1 < 0.25) continue;
      const r2 = hash01(i * 3 + 19);
      const sx = i * spacing2 - offset2 + w * 0.5;
      const sy = h * (0.66 + r1 * 0.06) - cam.y * 0.16;
      const scale = 0.7 + r2 * 0.55;
      this.drawFloatingIsland(ctx, sx, sy, scale, i + 50, nearCol, r2 > 0.6, time);
    }
  }

  private drawBirdGlyph(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    flap: number
  ) {
    const lift = size * (0.42 + flap * 0.38);
    const dip = size * 0.14;
    ctx.beginPath();
    ctx.moveTo(x - size, y + size * 0.04);
    ctx.quadraticCurveTo(x - size * 0.3, y - lift, x, y + dip);
    ctx.quadraticCurveTo(x + size * 0.3, y - lift, x + size, y + size * 0.04);
    ctx.closePath();
    ctx.fill();
  }

  private drawBirds(ctx: CanvasRenderingContext2D, cam: Camera, time: number) {
    const daylight = 1 - theme.night;
    if (daylight < 0.35) return;
    const { w, h } = cam;
    const span = w * 3;
    ctx.fillStyle = hexA(theme.mid, 0.62 * daylight);
    for (let k = 0; k < BIRD_FLOCKS.length; k++) {
      const F = BIRD_FLOCKS[k];
      const fx =
        (((time * F.speed + k * 760 - cam.x * 0.18) % span) + span) % span -
        w * 0.4;
      const fy =
        h * F.y - cam.y * 0.07 + Math.sin(time * 0.4 + k) * F.drift;
      for (let b = 0; b < F.count; b++) {
        // V-formation: birds fan back and down from the leader.
        const bx = fx + b * 24 - (b % 2) * 6;
        const by = fy + b * 7 + (b % 2) * 4 + Math.sin(time * 6 + b) * 1.5;
        const s = F.size + (b % 3) * 0.7;
        const flap = 0.5 + Math.sin(time * 7 + b * 1.7 + k) * 0.5;
        this.drawBirdGlyph(ctx, bx, by, s, flap);
      }
    }
  }

  // Nocturnal flyers — small bat silhouettes that come out once it's dark, so
  // the night sky isn't empty after the birds turn in.
  private drawBats(ctx: CanvasRenderingContext2D, cam: Camera, time: number) {
    if (theme.night < 0.45) return;
    const { w, h } = cam;
    const span = w * 3.2;
    ctx.save();
    ctx.fillStyle = hexA(theme.mid, 0.85 * theme.night);
    for (let k = 0; k < 6; k++) {
      const seed = k * 97 + 13;
      const speed = 18 + (k % 3) * 10;
      const x =
        (((time * speed + seed * 31 - cam.x * 0.16) % span) + span) % span -
        w * 0.5;
      const y =
        h * (0.14 + hash01(seed) * 0.26) -
        cam.y * 0.06 +
        Math.sin(time * (0.9 + (k % 2) * 0.5) + k) * 26;
      const s = 5 + hash01(seed * 3) * 4;
      const flap = Math.sin(time * 11 + k * 1.3);
      this.drawBatGlyph(ctx, x, y, s, flap);
    }
    ctx.restore();
  }

  private drawBatGlyph(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    s: number,
    flap: number
  ) {
    const up = s * (0.35 + (flap * 0.5 + 0.5) * 0.65);
    ctx.beginPath();
    ctx.moveTo(x, y - s * 0.1);
    // Left scalloped wing.
    ctx.quadraticCurveTo(x - s * 0.7, y - up, x - s * 1.6, y - up * 0.15);
    ctx.quadraticCurveTo(x - s * 1.05, y + s * 0.05, x - s * 0.72, y + s * 0.1);
    ctx.quadraticCurveTo(x - s * 0.5, y + s * 0.05, x - s * 0.28, y + s * 0.22);
    // Little body dip.
    ctx.quadraticCurveTo(x, y + s * 0.42, x + s * 0.28, y + s * 0.22);
    // Right scalloped wing (mirror).
    ctx.quadraticCurveTo(x + s * 0.5, y + s * 0.05, x + s * 0.72, y + s * 0.1);
    ctx.quadraticCurveTo(x + s * 1.05, y + s * 0.05, x + s * 1.6, y - up * 0.15);
    ctx.quadraticCurveTo(x + s * 0.7, y - up, x, y - s * 0.1);
    ctx.closePath();
    ctx.fill();
  }

  // Daytime butterflies — small flecks of colour that flutter past closer to
  // the player than the birds, bobbing and beating their wings.
  private drawButterflies(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    time: number
  ) {
    const daylight = 1 - theme.night;
    if (daylight < 0.4) return;
    const { w, h } = cam;
    const cols = ["#ff7eb3", "#ffd166", "#7ec8ff", "#c89bff", "#ff9f6b"];
    const span = w * 2.4;
    ctx.save();
    for (let k = 0; k < 7; k++) {
      const seed = k * 53 + 7;
      const col = cols[k % cols.length];
      const speed = 16 + (k % 3) * 9;
      const x =
        (((time * speed + seed * 40 - cam.x * 0.5) % span) + span) % span -
        w * 0.3;
      const y =
        h * (0.3 + hash01(seed) * 0.22) -
        cam.y * 0.22 +
        Math.sin(time * 1.7 + k) * 26;
      const s = 4 + hash01(seed * 5) * 3;
      const flap = Math.abs(Math.sin(time * 9 + k));
      this.drawButterflyGlyph(ctx, x, y, s, flap, col, daylight);
    }
    ctx.restore();
  }

  private drawButterflyGlyph(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    s: number,
    flap: number,
    col: string,
    daylight: number
  ) {
    const wingW = s * (0.35 + flap * 0.7);
    ctx.globalAlpha = 0.85 * daylight;
    ctx.fillStyle = col;
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(x + sgn * wingW, y - s * 0.32, wingW, s * 0.72, sgn * 0.5, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + sgn * wingW * 0.78, y + s * 0.4, wingW * 0.7, s * 0.5, sgn * -0.4, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = hexA("#2a1d12", daylight);
    ctx.fillRect(x - s * 0.09, y - s * 0.5, s * 0.18, s);
    ctx.globalAlpha = 1;
  }

  // Mid-ground biome features. The active region (by world distance) decides
  // what stands here — drifting ruins, fir forests, snow peaks or monoliths —
  // cross-fading at the seams between regions.
  drawMid(ctx: CanvasRenderingContext2D, cam: Camera) {
    const { w, h } = cam;
    const factor = 0.28;
    const spacing = 300;
    const baseY = h * 0.84 - cam.y * factor;
    const offset = cam.x * factor;
    const startIdx = Math.floor((offset - w) / spacing) - 1;
    const endIdx = Math.ceil((offset + w) / spacing) + 1;
    // Biome colours are pure functions of the palette — one bundle per
    // theme.version instead of fresh mixColor parses per feature cell per
    // frame. The shared rolling ground line lives in midRoll (module scope),
    // so no per-frame closures either.
    const C = this.midCols.get(theme.version, 0, () => {
      const base = mixColor(theme.mid, theme.fog, 0.15);
      const forest = mixColor(base, "#1f4d3e", 0.4); // teal-green pines
      const forestBack = mixColor(forest, theme.fog, 0.34);
      const peak = mixColor(base, theme.far, 0.4);
      // Warm, dark stone — deliberately off the cool blue of the ranges so
      // the monoliths read clearly against the mountains behind them.
      const monolith = mixColor(theme.mid, "#4a3a3e", 0.55);
      return {
        base,
        accent: mixColor(theme.mid, theme.skyHorizon, 0.2),
        forest,
        forestLit: mixColor(forest, theme.skyGlow, 0.25),
        forestBack,
        forestBackLit: mixColor(forestBack, theme.skyGlow, 0.2),
        peak,
        peakLit: mixColor(peak, theme.cloud, 0.55),
        monolith,
        monolithLit: mixColor(monolith, theme.skyGlow, 0.32),
      };
    });
    const base = C.base;

    // Fill the ground far below the crest so it always runs into the dune sea —
    // features stand on solid land instead of floating on cut-off platforms.
    const left = startIdx * spacing;
    const right = endIdx * spacing;
    const grad = ctx.createLinearGradient(0, baseY - 40, 0, h);
    grad.addColorStop(0, mixColor(base, theme.skyGlow, 0.12));
    grad.addColorStop(0.22, base);
    grad.addColorStop(1, mixColor(base, theme.fog, 0.4));
    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(left - offset + w * 0.5, h * 3);
    for (let wx = left; wx <= right; wx += 36) {
      ctx.lineTo(wx - offset + w * 0.5, baseY + midRoll(wx));
    }
    ctx.lineTo(right - offset + w * 0.5, h * 3);
    ctx.closePath();
    ctx.fill();
    // Soft sky-lit rim along the crest.
    ctx.strokeStyle = mixColor(base, theme.skyGlow, 0.24);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let wx = left; wx <= right; wx += 36) {
      const x = wx - offset + w * 0.5;
      const y = baseY + midRoll(wx);
      if (wx === left) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    for (let i = startIdx; i <= endIdx; i++) {
      const r1 = hash01(i * 5 + 3);
      const r2 = hash01(i * 5 + 11);
      const worldX = i * spacing;
      const { kind, fade } = this.regionAt(worldX);
      if (fade <= 0.02) continue;
      // Forest is a continuous treeline (every cell); other biomes leave gaps.
      if (kind !== "forest" && r1 < 0.32) continue;

      const sx = worldX - offset + w * 0.5;
      const sy = baseY + midRoll(worldX); // sit on the shared ground line
      const scale = 0.85 + r2 * 0.5;

      ctx.save();
      ctx.globalAlpha = fade;
      if (kind === "forest") {
        this.drawPineCluster(
          ctx,
          sx,
          sy,
          scale,
          i,
          C.forest,
          C.forestLit,
          C.forestBack,
          C.forestBackLit,
          worldX
        );
      } else if (kind === "peaks") {
        this.drawPeak(ctx, sx, sy, scale * 1.1, i, C.peak, C.peakLit);
      } else if (kind === "monuments") {
        this.drawMonolith(ctx, sx, sy, scale, i, C.monolith, C.monolithLit);
      } else if (kind === "village") {
        this.drawVillage(ctx, sx, sy, scale, i, base, C.accent);
      } else {
        const kr = r2 > 0.55 ? "arch" : r2 > 0.3 ? "temple" : "pillars";
        this.drawRuin(ctx, sx, sy, scale, i, kr, base, C.accent);
      }
      ctx.restore();
    }
  }

  drawSea(ctx: CanvasRenderingContext2D, cam: Camera, time: number) {
    const { w, h } = cam;
    // The dune sea is the one world-locked surface (the player skids on it),
    // so its screen position must respect the camera zoom.
    const surfaceY = (CONFIG.world.seaLevel - cam.y) * cam.zoom;
    if (surfaceY > h + 200) return;

    const top = Math.max(0, surfaceY - 100);

    // Deep fill beneath the dunes — warm vertical gradient into the haze.
    // Built in local space with a 4px-quantized span and translated to the
    // (camera-tracking) top, so it survives across frames per palette change.
    const span = h - top;
    const qspan = Math.round(span / 4) * 4;
    const body = this.seaBodyGrad.get(theme.version, qspan, () => {
      const g = ctx.createLinearGradient(0, 0, 0, qspan);
      g.addColorStop(0, hexA(theme.sea, 0));
      g.addColorStop(0.12, hexA(theme.sea, 0.5));
      g.addColorStop(0.4, theme.sea);
      g.addColorStop(1, theme.seaDeep);
      return g;
    });
    ctx.save();
    ctx.translate(0, top);
    ctx.fillStyle = body;
    ctx.fillRect(0, 0, w, span);
    ctx.restore();

    this.drawSandGrain(ctx, cam, surfaceY, top);

    // Dune layer config lives at module scope (SEA_LAYERS); its theme-derived
    // colours refresh in place only when the quantized palette changes.
    refreshSeaLayers();
    // Each layer's surface is sampled once into the shared height cache and
    // its clip traced once, shared by the fill / grain / ripple passes (each
    // pass used to rebuild both from scratch with fresh waveHeight calls).
    let cols = 0;
    for (const L of SEA_LAYERS) {
      const baseY = surfaceY + L.offset;
      cols = this.sampleDuneHeights(cam, baseY, L.parallax, L.layer, time);
      ctx.save();
      this.clipDune(ctx, cols, h);
      this.duneLayer(ctx, cam, baseY, L.layer, L.color, L.dark, L.alpha);
      this.drawDuneGrain(ctx, cam, L.parallax, L.layer, L.dark, baseY, time);
      // Layer 0's ripples (alpha 0.07 under layer alpha 0.48, behind three
      // nearer layers) are invisible — skip the whole pass.
      if (L.layer > 0) {
        this.drawSandRipples(ctx, cam, L.parallax, L.layer, L.color, L.dark, L.ripples, cols);
      }
      ctx.restore();
    }

    // Reuses the front layer's cached heights — sampled last in the loop
    // above with the same offset/parallax the crest used to recompute.
    this.drawDuneCrestHighlight(ctx, cols);
    this.drawHorizonHaze(ctx, cam, surfaceY);
  }

  // Fine stipple grain across the whole ground body (base layer beneath dunes).
  private drawSandGrain(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    surfaceY: number,
    top: number
  ) {
    const { w, h } = cam;
    const offX = cam.x * 0.35;
    const tw = Math.ceil(w + GRAIN_MARGIN);
    if (grainTileStale(seaGrainTile, tw, h, offX, w, 6)) {
      this.bakeSeaGrain(seaGrainTile, tw, h, offX);
    }
    // The tile is anchored to `top` (as the loop was), so the pattern moves
    // with the camera vertically exactly like before; the surface cutoff that
    // was a per-grain reject is now an exact clip line.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, surfaceY + 4, w, Math.max(0, h - surfaceY - 4));
    ctx.clip();
    ctx.drawImage(seaGrainTile.s!.canvas, seaGrainTile.u0 - offX, top);
    ctx.restore();
  }

  private bakeSeaGrain(tile: GrainTile, tw: number, th: number, offX: number) {
    const cell = 28;
    const s = grainScratch(tile, tw, th);
    const c = s.ctx;
    c.clearRect(0, 0, tw, th);
    tile.u0 = Math.floor(offX / cell) * cell - cell;
    tile.version = theme.version;
    const startI = Math.floor(tile.u0 / cell);
    const endI = Math.ceil((tile.u0 + tw) / cell);
    const endJ = Math.ceil(th / cell);
    for (let pass = 0; pass < 2; pass++) {
      const bright = pass === 1;
      c.fillStyle = bright ? theme.cloud : theme.seaDeep;
      const size = bright ? 1.4 : 1;
      for (let i = startI; i <= endI; i++) {
        for (let j = 0; j <= endJ; j++) {
          const r = hash01(i * 113 + j * 197);
          if (r < 0.42) continue;
          if ((r > 0.78) !== bright) continue;
          const gx = i * cell - tile.u0 + hash01(i * 9 + j) * cell;
          const gy = j * cell + hash01(i + j * 13) * cell;
          c.globalAlpha = (r - 0.42) * (bright ? 0.16 : 0.12);
          c.fillRect(gx, gy, size, size);
        }
      }
    }
    c.globalAlpha = 1;
  }

  // Per-dune grain — stipple on each sand layer for a tactile sandy surface.
  // Runs inside the caller's dune clip; surface heights come from the shared
  // height cache (nearest column — the ±8px hash jitter dwarfs the error).
  // Blit the layer's baked stipple band. Called inside the layer's dune clip,
  // so the crest line stays exact even as the (slowly time-drifting) surface
  // moves a few px between rebakes.
  private drawDuneGrain(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    parallax: number,
    layer: number,
    dark: string,
    baseY: number,
    time: number
  ) {
    const { w } = cam;
    const offX = cam.x * parallax;
    const tw = Math.ceil(w + GRAIN_MARGIN);
    const tile = (duneGrainTiles[layer] ??= makeGrainTile());
    // Staggered palette slack so the four layers never rebake the same frame.
    if (grainTileStale(tile, tw, DUNE_TILE_H, offX, w, 5 + layer)) {
      this.bakeDuneGrain(tile, tw, layer, dark, time, offX);
    }
    ctx.drawImage(tile.s!.canvas, tile.u0 - offX, baseY - DUNE_TILE_PAD);
  }

  private bakeDuneGrain(
    tile: GrainTile,
    tw: number,
    layer: number,
    dark: string,
    time: number,
    offX: number
  ) {
    const cell = (10 + layer) * 2;
    const s = grainScratch(tile, tw, DUNE_TILE_H);
    const c = s.ctx;
    c.clearRect(0, 0, tw, DUNE_TILE_H);
    tile.u0 = Math.floor(offX / cell) * cell - cell;
    tile.version = theme.version;
    const fade = 1 - layer * 0.08;
    for (let pass = 0; pass < 2; pass++) {
      const bright = pass === 1;
      c.fillStyle = bright ? theme.cloud : dark;
      const size = bright ? 1.3 : 0.9;
      const gain = (bright ? 0.14 : 0.1) * fade;
      const startI = Math.floor(tile.u0 / cell);
      const endI = Math.ceil((tile.u0 + tw) / cell);
      for (let i = startI; i <= endI; i++) {
        for (let j = 0; j < 14; j++) {
          const r = hash01(i * 89 + j * 157 + layer * 31);
          if (r < 0.48) continue;
          if ((r > 0.76) !== bright) continue;
          const gx = i * cell - tile.u0 + hash01(i * 5 + j) * cell;
          // Surface height in baseY-relative space; wave drift between
          // rebakes is a few px and hides under the caller's fresh clip.
          const wave = this.waveHeight(gx + tile.u0, time, layer);
          const gy =
            DUNE_TILE_PAD + wave + 4 + j * (5 + layer) + hash01(i + j * 11) * 8;
          c.globalAlpha = (r - 0.48) * gain;
          c.fillRect(gx, gy, size, size);
        }
      }
    }
    c.globalAlpha = 1;
  }

  // Wind-blown sand ripples — dense wavy lines following each dune face (Alto-style).
  // Runs inside the caller's dune clip; surface heights come from the shared cache.
  private drawSandRipples(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    parallax: number,
    layer: number,
    sandLight: string,
    sandDark: string,
    ripples: { spacing: number; depth: number; alpha: number },
    cols: number
  ) {
    const step = 8; // 2 height-cache columns — invisible at these line widths
    const { spacing, depth, alpha } = ripples;
    const offX = cam.x * parallax;
    const lastX = (cols - 1) * HEIGHT_STEP; // at or past the right edge

    ctx.save();

    const rippleDark = mixColor(sandDark, sandLight, 0.15);
    const rippleLight = mixColor(sandLight, theme.cloud, 0.45);

    // Batch the alternating light/dark lines (up to ~37 antialiased stroke()
    // calls per layer) into 2 colours x 3 depth bands = 6 strokes, keeping
    // the fade toward the dune base.
    const BANDS = 3;
    for (let band = 0; band < BANDS; band++) {
      const bandAlpha = alpha * (1 - ((band + 0.5) / BANDS) * 0.72);
      if (bandAlpha < 0.015) continue;
      for (let pass = 0; pass < 2; pass++) {
        const light = pass === 0;
        ctx.strokeStyle = hexA(light ? rippleLight : rippleDark, bandAlpha);
        ctx.lineWidth = light ? 0.65 : 0.95;
        ctx.beginPath();
        for (let d = 4; d < depth; d += spacing) {
          if ((Math.floor(d / spacing) % 2 === 0) !== light) continue;
          if (Math.floor((d / depth) * BANDS) !== band) continue;

          // Wind ripples bunch and spread — organic convergence like real sand.
          const freq = 18 + layer * 3 + Math.sin(d * 0.08 + layer) * 4;
          const amp = 1.6 + layer * 0.35 + Math.sin(d * 0.12) * 0.6;
          const phase = d * 0.24 + layer * 1.9;

          for (let x = 0; x <= lastX; x += step) {
            const wx = x + offX;
            const surface = heightScratch[x / HEIGHT_STEP];
            const ripple =
              Math.sin(wx / freq + phase) * amp +
              Math.sin(wx / (freq * 0.38) + phase * 1.4 + 0.8) * amp * 0.42 +
              Math.sin(wx / (freq * 2.1) + phase * 0.6) * amp * 0.18;
            const y = surface + d + ripple;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  // Fill the shared height cache with one layer's dune surface (screen-space
  // y per HEIGHT_STEP px column) and return the column count. The last column
  // lands at or past the right edge so consumers cover the full width.
  private sampleDuneHeights(
    cam: Camera,
    baseY: number,
    parallax: number,
    layer: number,
    time: number
  ): number {
    const cols = Math.ceil(cam.w / HEIGHT_STEP) + 1;
    if (heightScratch.length < cols) heightScratch = new Float32Array(cols);
    const offX = cam.x * parallax;
    for (let k = 0; k < cols; k++) {
      heightScratch[k] = baseY + this.waveHeight(k * HEIGHT_STEP + offX, time, layer);
    }
    return cols;
  }

  // Below-the-dune clip region, traced once per layer from the cached heights
  // and shared by the fill / grain / ripple passes (it used to be rebuilt —
  // with fresh waveHeight calls — for every pass).
  private clipDune(ctx: CanvasRenderingContext2D, cols: number, bottom: number) {
    ctx.beginPath();
    ctx.moveTo(0, bottom);
    for (let k = 0; k < cols; k++) {
      ctx.lineTo(k * HEIGHT_STEP, heightScratch[k]);
    }
    ctx.lineTo((cols - 1) * HEIGHT_STEP, bottom);
    ctx.closePath();
    ctx.clip();
  }

  // Bright rim light along the front dune crest — Alto's glowing sand edge.
  // The crest polyline comes straight from the shared height cache (the front
  // layer is sampled last in drawSea), so this pass costs zero waveHeight
  // calls. Concentric plain 'lighter' strokes stand in for the old
  // shadowBlur glow — WebKit rasterizes canvas shadows through a full-width
  // Gaussian blur pass, the most expensive draw call that was in the frame.
  private drawDuneCrestHighlight(ctx: CanvasRenderingContext2D, cols: number) {
    const daylight = 1 - theme.night * 0.7;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Crest polyline built once, stroked three times: soft outer glow ribbon,
    // tighter halo, then the bright sharp crest line.
    ctx.beginPath();
    for (let k = 0; k < cols; k++) {
      const x = k * HEIGHT_STEP;
      const y = heightScratch[k] - 1;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = hexA(theme.cloud, 0.1 * daylight);
    ctx.lineWidth = 18;
    ctx.stroke();
    ctx.strokeStyle = hexA(theme.cloud, 0.18 * daylight);
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.strokeStyle = hexA(theme.cloud, 0.8 * daylight);
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Warm shadow band just below the crest — sells the lit ridge.
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = hexA(theme.seaDeep, 0.07 * daylight);
    ctx.lineWidth = 8;
    ctx.beginPath();
    for (let k = 0; k < cols; k++) {
      const x = k * HEIGHT_STEP;
      const y = heightScratch[k] + 5;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.restore();
  }

  // Soft haze where the dunes meet the sky — distant layers fade into atmosphere.
  // Fixed 160px band, so the gradient bakes in local space per palette change
  // and just translates with the surface — exact, no quantization needed.
  private drawHorizonHaze(ctx: CanvasRenderingContext2D, cam: Camera, surfaceY: number) {
    const { w } = cam;
    const haze = this.hazeGrad.get(theme.version, 0, () => {
      const g = ctx.createLinearGradient(0, 0, 0, 160);
      g.addColorStop(0, hexA(theme.fog, 0));
      g.addColorStop(0.35, hexA(theme.fog, 0.08));
      g.addColorStop(0.65, hexA(theme.fog, 0.18));
      g.addColorStop(1, hexA(theme.fog, 0));
      return g;
    });
    ctx.save();
    ctx.translate(0, surfaceY - 110);
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, w, 160);
    ctx.restore();
  }

  // Gentle rolling dune silhouettes — long smooth swells like Alto's sand hills.
  private waveHeight(wx: number, time: number, layer: number): number {
    const t = time * (0.06 + layer * 0.04);
    const a = 1 - layer * 0.14;

    let y = 0;
    y += Math.sin(wx / 680 + t) * 34 * a;
    y += Math.sin(wx / 360 + t * 0.85 + 1.1) * 19 * a;
    y += Math.sin(wx / 185 + t * 1.05 + 2.4) * 9 * a;
    y += Math.sin(wx / 95 + t * 1.2 + 0.5) * 4 * a;

    return y;
  }

  // Gradient body of one dune layer. Runs inside the caller's dune clip.
  // The gradient is built in local space with a 4px-quantized span and
  // translated to the (camera-tracking) top, so each layer's cache survives
  // across frames per palette change. The layer's colours are pure functions
  // of the theme, so theme.version covers them too.
  private duneLayer(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    baseY: number,
    layer: number,
    color: string,
    dark: string,
    alpha: number
  ) {
    const { w, h } = cam;
    const gradTop = baseY - 60;
    const span = h - gradTop;
    const qspan = Math.round(span / 4) * 4;
    const grad = this.duneGrads[layer].get(theme.version, qspan, () => {
      const g = ctx.createLinearGradient(0, 0, 0, qspan);
      g.addColorStop(0, mixColor(color, theme.cloud, 0.38));
      g.addColorStop(0.12, mixColor(color, theme.cloud, 0.12));
      g.addColorStop(0.35, color);
      g.addColorStop(1, dark);
      return g;
    });

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(0, gradTop);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 10, w, span - 10);
    ctx.restore();
  }

  // Drifting motes by day; fireflies by night. World-anchored so they stay in
  // the sky instead of sticking to the screen as the player moves.
  drawAmbient(ctx: CanvasRenderingContext2D, cam: Camera, time: number) {
    const { w, h } = cam;
    const parallaxX = 0.22;
    const parallaxY = 0.18;
    const cell = 320;
    const offX = cam.x * parallaxX;
    const offY = cam.y * parallaxY;
    const startI = Math.floor((offX - w) / cell);
    const endI = Math.ceil((offX + w) / cell);
    const startJ = Math.floor((offY - h) / cell);
    const endJ = Math.ceil((offY + h) / cell);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = startI; i <= endI; i++) {
      for (let j = startJ; j <= endJ; j++) {
        const r = hash01(i * 131 + j * 977 + 17);
        if (r < 0.62) continue;
        const sx = i * cell - offX + hash01(i * 7 + j) * cell;
        const sy = j * cell - offY + hash01(i + j * 53) * cell;
        const tw = 0.4 + 0.6 * Math.sin(time * 1.5 + i + j);
        const a = (0.05 + theme.night * 0.22) * tw * (r - 0.62) * 2.5;
        if (a <= 0.01) continue;
        ctx.fillStyle = hexA(theme.ambient, a);
        ctx.beginPath();
        ctx.arc(sx, sy, 1.1 + r * 1.4, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawForeground(ctx: CanvasRenderingContext2D, cam: Camera, time: number) {
    const { w, h } = cam;
    const parallaxX = 1.15;
    const parallaxY = 0.45;
    const spacing = 580;
    const offsetX = cam.x * parallaxX;
    const startIdx = Math.floor((offsetX - w) / spacing);
    const endIdx = Math.ceil((offsetX + w) / spacing);

    for (let i = startIdx; i <= endIdx; i++) {
      const r1 = hash01(i * 13 + 5);
      if (r1 < 0.42) continue;
      const worldX = i * spacing + hash01(i * 7) * 120;
      const worldY = hash01(i * 19 + 3) * 1800 - 400;
      const sx = worldX - offsetX + w * 0.5;
      const sy = worldY - cam.y * parallaxY + Math.sin(time * 0.5 + i) * 10;
      if (sy < -120 || sy > h + 120) continue;
      this.drawCloudCluster(ctx, sx, sy, 180 + r1 * 140, 0.14 + r1 * 0.06);
    }
  }

  // --- Floating island: flat plateau top, rocky sides, tapered underside. ---

  // Unit-space layout for one island seed — every hash01 draw, plateau lookup
  // and quad-bezier root solve happens here, once, instead of per frame.
  private islandLayout(seed: number): IslandLayout {
    let L = islandLayouts.get(seed);
    if (L) return L;
    const rw = 90 + hash01(seed * 7) * 70;
    const rh = 24 + hash01(seed * 13) * 18;
    const hang = 28 + hash01(seed * 19) * 38;
    const skew = (hash01(seed * 23) - 0.5) * rw * 0.12;

    const vineCount = 2 + ((hash01(seed * 53) * 5) | 0);
    const vineX: number[] = [];
    const vineY: number[] = [];
    const vineLen: number[] = [];
    const vineSway: number[] = [];
    const vineCurl: number[] = [];
    for (let v = 0; v < vineCount; v++) {
      const along = hash01(seed * 59 + v * 11);
      const anchorX = (along - 0.5) * rw * 1.15;
      const surfaceY = this.islandUndersideY(anchorX, rw, hang, skew);
      if (surfaceY === null) continue;
      vineX.push(anchorX);
      vineY.push(surfaceY);
      vineLen.push(10 + hash01(seed * 67 + v) * 22);
      vineSway.push((hash01(seed * 71 + v) - 0.5) * 14);
      vineCurl.push((hash01(seed * 73 + v) - 0.5) * 8);
    }

    const treeCount = (1 + hash01(seed * 29) * 3) | 0;
    const treeX: number[] = [];
    const treeY: number[] = [];
    const treeH: number[] = [];
    for (let t = 0; t < treeCount; t++) {
      const tx = (hash01(seed * 31 + t * 7) - 0.5) * rw * 1.2;
      treeX.push(tx);
      treeY.push(this.plateauTopY(tx, rw, rh, 1.2));
      treeH.push(18 + hash01(seed * 41 + t) * 24);
    }

    const critterX = (hash01(seed * 43) - 0.5) * rw * 0.9;
    L = {
      rw,
      rh,
      hang,
      skew,
      vineX,
      vineY,
      vineLen,
      vineSway,
      vineCurl,
      treeX,
      treeY,
      treeH,
      hasCritter: hash01(seed * 37) > 0.5,
      critterX,
      critterY: this.plateauTopY(critterX, rw, rh, 1.2),
      critterPick: hash01(seed * 47),
      critterPh: hash01(seed * 59) * TAU,
      critterSize: hash01(seed * 53),
      style: new VersionCache<IslandStyle>(),
    };
    if (islandLayouts.size >= LAYOUT_CAP) evictOldest(islandLayouts);
    islandLayouts.set(seed, L);
    return L;
  }

  private drawFloatingIsland(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
    seed: number,
    color: string,
    withTrees: boolean,
    time: number
  ) {
    const L = this.islandLayout(seed);
    const rw = L.rw * scale;
    const rh = L.rh * scale;
    const hang = L.hang * scale;
    const skew = L.skew * scale;

    // Gradient + tinted colour strings rebuild only on palette change. The
    // key carries colour + scale so the two ridges (different fog mixes and
    // scales) can't cross-contaminate if they ever share a seed.
    const style = L.style.get(theme.version, `${color}|${scale}`, () => {
      const grad = ctx.createLinearGradient(0, -rh, 0, hang);
      grad.addColorStop(0, mixColor(color, theme.skyGlow, 0.38));
      grad.addColorStop(0.18, mixColor(color, theme.skyGlow, 0.12));
      grad.addColorStop(0.45, color);
      grad.addColorStop(1, mixColor(color, theme.mid, 0.25));
      return {
        grad,
        treeCol: hexA(mixColor(color, theme.mid, 0.45), 0.92),
        trunkCol: hexA(mixColor(color, theme.mid, 0.65), 0.88),
        vineCol: hexA(mixColor(color, theme.mid, 0.4), 0.62),
        leafCol: hexA(mixColor(color, theme.fog, 0.25), 0.5),
        critterCol: hexA(mixColor(color, theme.mid, 0.62), 0.95),
      };
    });

    ctx.save();
    ctx.translate(x, y);

    // One continuous silhouette — plateau curves straight into the cliff and
    // underside. No inset corners or separate pieces that leave a visible seam.
    ctx.beginPath();
    ctx.moveTo(-rw, 0);
    ctx.quadraticCurveTo(-rw * 0.4, -rh * 1.2, 0, -rh);
    ctx.quadraticCurveTo(rw * 0.4, -rh * 1.2, rw, 0);
    ctx.quadraticCurveTo(rw * 0.62 + skew, hang * 0.4, rw * 0.22, hang * 0.78);
    ctx.quadraticCurveTo(0, hang, -rw * 0.22, hang * 0.78);
    ctx.quadraticCurveTo(-rw * 0.62 + skew, hang * 0.4, -rw, 0);
    ctx.closePath();
    ctx.fillStyle = style.grad;
    ctx.fill();

    this.drawIslandVines(ctx, L, scale, style.vineCol, style.leafCol);

    if (withTrees) {
      for (let t = 0; t < L.treeX.length; t++) {
        this.drawCypressTree(
          ctx,
          L.treeX[t] * scale,
          L.treeY[t] * scale,
          L.treeH[t] * scale,
          style.treeCol,
          style.trunkCol
        );
      }
    }

    // A little critter grazing on the plateau every so often.
    if (scale > 0.62 && L.hasCritter) {
      this.drawIslandCritter(
        ctx,
        L.critterX * scale,
        L.critterY * scale + 1,
        scale,
        L.critterPick,
        L.critterPh,
        L.critterSize,
        style.critterCol,
        time
      );
    }

    ctx.restore();
  }

  // Tiny grazing silhouettes (deer / rabbit / perched bird) that give the
  // floating islands a sense of life. Procedurally chosen and seed-stable —
  // pick / ph / size come from the cached island layout.
  private drawIslandCritter(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
    pick: number,
    ph: number, // per-critter phase so they're out of sync
    size: number,
    col: string,
    time: number
  ) {
    const L = (a: number, b: number, t: number) => a + (b - a) * t;

    ctx.save();
    ctx.fillStyle = col;
    ctx.strokeStyle = col;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (pick > 0.66) {
      // Deer — lowers its head to graze, then lifts it again.
      const s = (12 + size * 6) * scale;
      const dip = Math.sin(time * 0.8 + ph) * 0.5 + 0.5; // 0 = head up, 1 = grazing
      ctx.lineWidth = Math.max(1, s * 0.1);
      for (const lx of [-0.3, -0.12, 0.12, 0.3]) {
        ctx.beginPath();
        ctx.moveTo(x + lx * s, y - s * 0.42);
        ctx.lineTo(x + lx * s, y);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(x, y - s * 0.58, s * 0.42, s * 0.2, 0, 0, TAU);
      ctx.fill();
      // Neck swings down toward the ground as it grazes.
      const tipX = L(x + s * 0.5, x + s * 0.62, dip);
      const tipY = L(y - s * 1.04, y - s * 0.46, dip);
      ctx.lineWidth = s * 0.15;
      ctx.beginPath();
      ctx.moveTo(x + s * 0.32, y - s * 0.62);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      const headX = L(x + s * 0.55, x + s * 0.68, dip);
      const headY = L(y - s * 1.12, y - s * 0.34, dip);
      ctx.beginPath();
      ctx.ellipse(headX, headY, s * 0.16, s * 0.1, 0.4 + dip * 0.5, 0, TAU);
      ctx.fill();
      ctx.lineWidth = Math.max(0.8, s * 0.05);
      ctx.beginPath();
      ctx.moveTo(headX - s * 0.05, headY - s * 0.08);
      ctx.lineTo(headX - s * 0.11, headY - s * 0.3);
      ctx.moveTo(headX + s * 0.03, headY - s * 0.08);
      ctx.lineTo(headX + s * 0.09, headY - s * 0.32);
      ctx.stroke();
    } else if (pick > 0.33) {
      // Rabbit — bobs up and down with little ear twitches.
      const s = (8 + size * 4) * scale;
      const bob = -Math.abs(Math.sin(time * 2 + ph)) * s * 0.14;
      const tw = Math.sin(time * 3 + ph * 1.3) * 0.14; // ear flick
      ctx.save();
      ctx.translate(0, bob);
      ctx.beginPath();
      ctx.ellipse(x, y - s * 0.4, s * 0.5, s * 0.4, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + s * 0.45, y - s * 0.62, s * 0.27, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + s * 0.4, y - s * 1.05, s * 0.09, s * 0.32, -0.15 + tw, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + s * 0.56, y - s * 1.02, s * 0.09, s * 0.3, 0.2 + tw, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x - s * 0.52, y - s * 0.36, s * 0.14, 0, TAU);
      ctx.fill();
      ctx.restore();
    } else {
      // Perched bird — pecks the ground, tail flicking up as the head dips.
      const s = (6 + size * 3) * scale;
      const peck = Math.pow(Math.sin(time * 1.6 + ph) * 0.5 + 0.5, 3);
      ctx.beginPath();
      ctx.ellipse(x, y - s * 0.5, s * 0.5, s * 0.33, -0.2, 0, TAU);
      ctx.fill();
      const hX = L(x + s * 0.46, x + s * 0.6, peck);
      const hY = L(y - s * 0.82, y - s * 0.52, peck);
      ctx.beginPath();
      ctx.arc(hX, hY, s * 0.23, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(hX + s * 0.18, hY - s * 0.03);
      ctx.lineTo(hX + s * 0.46, hY + s * 0.02);
      ctx.lineTo(hX + s * 0.18, hY + s * 0.09);
      ctx.closePath();
      ctx.fill();
      const tailUp = peck * s * 0.14;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.46, y - s * 0.52);
      ctx.lineTo(x - s * 0.95, y - s * 0.78 - tailUp);
      ctx.lineTo(x - s * 0.5, y - s * 0.32);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = Math.max(0.6, s * 0.09);
      ctx.beginPath();
      ctx.moveTo(x - s * 0.05, y - s * 0.2);
      ctx.lineTo(x - s * 0.05, y);
      ctx.moveTo(x + s * 0.14, y - s * 0.2);
      ctx.lineTo(x + s * 0.14, y);
      ctx.stroke();
    }

    ctx.restore();
  }

  // Y on the island underside at a given local X (matches the fill path).
  private islandUndersideY(
    x: number,
    rw: number,
    hang: number,
    skew: number
  ): number | null {
    const segs: [[number, number], [number, number], [number, number]][] = [
      [[rw, 0], [rw * 0.62 + skew, hang * 0.4], [rw * 0.22, hang * 0.78]],
      [[rw * 0.22, hang * 0.78], [0, hang], [-rw * 0.22, hang * 0.78]],
      [[-rw * 0.22, hang * 0.78], [-rw * 0.62 + skew, hang * 0.4], [-rw, 0]],
    ];

    for (const [p0, p1, p2] of segs) {
      const y = this.quadBezierYAtX(p0, p1, p2, x);
      if (y !== null) return y;
    }
    return null;
  }

  private quadBezierYAtX(
    p0: [number, number],
    p1: [number, number],
    p2: [number, number],
    x: number
  ): number | null {
    const [x0, y0] = p0;
    const [x1, y1] = p1;
    const [x2, y2] = p2;
    const a = x0 - 2 * x1 + x2;
    const b = 2 * (x1 - x0);
    const c = x0 - x;

    const ts: number[] = [];
    if (Math.abs(a) < 1e-6) {
      if (Math.abs(b) > 1e-6) {
        const t = -c / b;
        if (t >= 0 && t <= 1) ts.push(t);
      }
    } else {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const s = Math.sqrt(disc);
        for (const t of [(-b - s) / (2 * a), (-b + s) / (2 * a)]) {
          if (t >= 0 && t <= 1) ts.push(t);
        }
      }
    }

    for (const t of ts) {
      const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * y1 + t * t * y2;
      return y;
    }
    return null;
  }

  // Y on the domed plateau top at local X (matches ruin + island fill paths).
  private plateauTopY(
    x: number,
    halfW: number,
    peakH: number,
    controlMul = 1.2
  ): number {
    const yLeft = this.quadBezierYAtX(
      [-halfW, 0],
      [-halfW * 0.4, -peakH * controlMul],
      [0, -peakH],
      x
    );
    if (yLeft !== null) return yLeft;

    const yRight = this.quadBezierYAtX(
      [0, -peakH],
      [halfW * 0.4, -peakH * controlMul],
      [halfW, 0],
      x
    );
    if (yRight !== null) return yRight;

    return -peakH;
  }

  // Wispy vines dangling from the island underside. Anchors / lengths come
  // from the cached unit-space layout — the bezier root solves happen once
  // per seed, not per frame.
  private drawIslandVines(
    ctx: CanvasRenderingContext2D,
    L: IslandLayout,
    scale: number,
    vineCol: string,
    leafCol: string
  ) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (let v = 0; v < L.vineX.length; v++) {
      const anchorX = L.vineX[v] * scale;
      const anchorY = L.vineY[v] * scale + 0.5;
      const len = L.vineLen[v] * scale;
      const sway = L.vineSway[v] * scale;
      const curl = L.vineCurl[v] * scale;

      ctx.strokeStyle = vineCol;
      ctx.lineWidth = Math.max(0.7, 1.1 * scale);
      ctx.beginPath();
      ctx.moveTo(anchorX, anchorY);
      ctx.bezierCurveTo(
        anchorX + sway * 0.4,
        anchorY + len * 0.35,
        anchorX + sway + curl,
        anchorY + len * 0.72,
        anchorX + sway * 0.55,
        anchorY + len
      );
      ctx.stroke();

      const tipX = anchorX + sway * 0.55;
      const tipY = anchorY + len;
      const leafR = Math.max(1.2, 2.2 * scale);
      ctx.fillStyle = leafCol;
      ctx.beginPath();
      ctx.ellipse(tipX, tipY + leafR * 0.3, leafR, leafR * 1.6, sway * 0.04, 0, TAU);
      ctx.fill();
      if (len > 14 * scale) {
        ctx.beginPath();
        ctx.ellipse(
          anchorX + sway * 0.25,
          anchorY + len * 0.55,
          leafR * 0.75,
          leafR * 1.2,
          curl * 0.05,
          0,
          TAU
        );
        ctx.fill();
      }
    }
  }

  // Stylized cypress / pine — tapered trunk + overlapping frond layers (no gaps).
  private drawCypressTree(
    ctx: CanvasRenderingContext2D,
    x: number,
    baseY: number,
    height: number,
    color: string,
    trunkColor: string
  ) {
    const trunkW = height * 0.14;
    const trunkH = height * 0.34;

    ctx.fillStyle = trunkColor;
    ctx.beginPath();
    ctx.moveTo(x - trunkW * 0.65, baseY);
    ctx.lineTo(x - trunkW * 0.32, baseY - trunkH);
    ctx.lineTo(x + trunkW * 0.32, baseY - trunkH);
    ctx.lineTo(x + trunkW * 0.65, baseY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = color;
    const base = baseY - trunkH;
    const fronds = [
      { yBot: base, yTop: base - height * 0.22, halfW: height * 0.38 },
      { yBot: base - height * 0.16, yTop: base - height * 0.38, halfW: height * 0.31 },
      { yBot: base - height * 0.31, yTop: base - height * 0.52, halfW: height * 0.23 },
      { yBot: base - height * 0.45, yTop: base - height * 0.72, halfW: height * 0.11 },
    ];
    for (const f of fronds) {
      ctx.beginPath();
      ctx.moveTo(x, f.yTop);
      ctx.lineTo(x - f.halfW, f.yBot);
      ctx.lineTo(x + f.halfW, f.yBot);
      ctx.closePath();
      ctx.fill();
    }
  }

  // --- Ancient ruin on a small floating rock base. ---

  private drawRuin(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
    seed: number,
    kind: "pillars" | "temple" | "arch",
    color: string,
    accent: string
  ) {
    ctx.save();
    ctx.translate(x, y);

    // Small floating rock pedestal.
    const pw = 55 * scale;
    const ph = 14 * scale;
    ctx.fillStyle = hexA(color, 0.9);
    ctx.beginPath();
    ctx.moveTo(-pw, 0);
    ctx.quadraticCurveTo(-pw * 0.4, -ph * 1.3, 0, -ph);
    ctx.quadraticCurveTo(pw * 0.4, -ph * 1.3, pw, 0);
    ctx.quadraticCurveTo(pw * 0.3, ph * 1.8, 0, ph * 2.2);
    ctx.quadraticCurveTo(-pw * 0.3, ph * 1.8, -pw, 0);
    ctx.closePath();
    ctx.fill();

    const seam = 1.5 * scale;
    const lit = mixColor(color, theme.skyGlow, 0.22); // catches the sky on top edges

    if (kind === "arch") {
      this.drawRuinArch(ctx, seed, scale, pw, ph, seam, color, lit);
    } else {
      this.drawRuinColumns(ctx, seed, scale, pw, ph, seam, color, accent, lit, kind === "temple");
    }

    ctx.restore();
  }

  // Stone gateway — two piers carrying a semicircular arch with a keystone.
  // Sometimes ruined: one side crumbled, the span broken mid-air.
  private drawRuinArch(
    ctx: CanvasRenderingContext2D,
    seed: number,
    scale: number,
    pw: number,
    ph: number,
    seam: number,
    color: string,
    lit: string
  ) {
    const pierW = (8 + hash01(seed * 3) * 4) * scale;
    const openW = (24 + hash01(seed * 7) * 16) * scale;
    const R = openW / 2 + pierW / 2; // arch radius (pier center to centre)
    const legH = (30 + hash01(seed * 5) * 40) * scale;
    const baseS = this.plateauTopY(0, pw, ph, 1.3) + seam;
    const springY = baseS - legH;
    const broken = hash01(seed * 43) > 0.45;

    const fill = hexA(color, 0.95);
    const litFill = hexA(lit, 0.95);

    // Piers (slight base flare). Right pier is a low stub when broken.
    const drawPier = (cx: number, top: number) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(cx - pierW * 0.6, baseS);
      ctx.lineTo(cx - pierW * 0.5, top);
      ctx.lineTo(cx + pierW * 0.5, top);
      ctx.lineTo(cx + pierW * 0.6, baseS);
      ctx.closePath();
      ctx.fill();
    };
    drawPier(-R, springY);
    drawPier(R, broken ? baseS - legH * 0.32 : springY);

    // Arch band riding on the piers.
    ctx.strokeStyle = fill;
    ctx.lineWidth = pierW;
    ctx.lineCap = "butt";
    ctx.beginPath();
    if (broken) {
      ctx.arc(0, springY, R, Math.PI, Math.PI * 1.46); // springs from left, snaps off
    } else {
      ctx.arc(0, springY, R, Math.PI, TAU);
    }
    ctx.stroke();

    if (!broken) {
      // Keystone wedge at the apex.
      const ksW = pierW * 1.4;
      const ksH = pierW * 1.1;
      const apexY = springY - R - pierW * 0.5;
      ctx.fillStyle = litFill;
      ctx.beginPath();
      ctx.moveTo(-ksW * 0.5, apexY + ksH);
      ctx.lineTo(-ksW * 0.32, apexY);
      ctx.lineTo(ksW * 0.32, apexY);
      ctx.lineTo(ksW * 0.5, apexY + ksH);
      ctx.closePath();
      ctx.fill();
      // Thin sky-lit rim across the pier tops.
      ctx.fillStyle = litFill;
      ctx.fillRect(-R - pierW * 0.5, springY - 1.5 * scale, pierW, 1.5 * scale);
      ctx.fillRect(R - pierW * 0.5, springY - 1.5 * scale, pierW, 1.5 * scale);
    } else {
      // A little fallen rubble at the foot of the broken side.
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(R + pierW * 0.4, baseS - 2 * scale, pierW * 0.5, 0, TAU);
      ctx.fill();
    }
  }

  // A row of columns on a stylobate. Temples keep an architrave + pediment
  // across the intact columns; loose "pillars" are mostly weathered stumps.
  private drawRuinColumns(
    ctx: CanvasRenderingContext2D,
    seed: number,
    scale: number,
    pw: number,
    ph: number,
    seam: number,
    color: string,
    accent: string,
    lit: string,
    temple: boolean
  ) {
    const cols = temple ? 4 : 3;
    const gap = (temple ? 19 : 26) * scale;
    const fullH = (temple ? 70 : 64) * scale;
    const fill = hexA(color, 0.95);
    const litFill = hexA(lit, 0.95);

    // Stylobate (base platform).
    const platW = ((cols - 1) * gap) / 2 + 11 * scale;
    const baseS = this.plateauTopY(0, pw, ph, 1.3) + seam;
    ctx.fillStyle = fill;
    ctx.fillRect(-platW, baseS - 3.5 * scale, platW * 2, 5 * scale);
    ctx.fillStyle = litFill;
    ctx.fillRect(-platW, baseS - 4 * scale, platW * 2, 1.2 * scale);

    const tops: { cx: number; topY: number; broken: boolean }[] = [];
    for (let c = 0; c < cols; c++) {
      const cx = (c - (cols - 1) / 2) * gap;
      const colW = (7 + hash01(seed + c * 3) * 4) * scale;
      const broken = hash01(seed + c * 11) > (temple ? 0.62 : 0.4);
      const colH = broken
        ? fullH * (0.28 + hash01(seed + c * 13) * 0.4)
        : fullH;
      const surfaceY = baseS - 3.5 * scale;
      const topY = surfaceY - colH;

      // Fluted shaft with a touch of entasis (mid bulge via tapered trapezoid).
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(cx - colW * 0.5, surfaceY);
      ctx.lineTo(cx - colW * 0.42, topY);
      ctx.lineTo(cx + colW * 0.42, topY);
      ctx.lineTo(cx + colW * 0.5, surfaceY);
      ctx.closePath();
      ctx.fill();

      if (broken) {
        // Jagged snapped top.
        ctx.beginPath();
        ctx.moveTo(cx - colW * 0.42, topY);
        ctx.lineTo(cx - colW * 0.16, topY - 5 * scale);
        ctx.lineTo(cx + colW * 0.1, topY - 1.5 * scale);
        ctx.lineTo(cx + colW * 0.42, topY - 4 * scale);
        ctx.lineTo(cx + colW * 0.42, topY);
        ctx.closePath();
        ctx.fill();
      } else {
        // Capital block + sky-lit top.
        ctx.fillStyle = fill;
        ctx.fillRect(cx - colW * 0.7, topY - 4.5 * scale, colW * 1.4, 4.5 * scale);
        ctx.fillStyle = litFill;
        ctx.fillRect(cx - colW * 0.7, topY - 5 * scale, colW * 1.4, 1.4 * scale);
      }

      tops.push({ cx, topY, broken });
    }

    if (temple) {
      const intact = tops.filter((t) => !t.broken);
      if (intact.length >= 2) {
        const beamTop = baseS - 3.5 * scale - fullH - 5 * scale;
        const lx = Math.min(...intact.map((t) => t.cx)) - 9 * scale;
        const rx = Math.max(...intact.map((t) => t.cx)) + 9 * scale;
        const beamH = 8 * scale;
        // Architrave beam.
        ctx.fillStyle = fill;
        ctx.fillRect(lx, beamTop, rx - lx, beamH);
        ctx.fillStyle = litFill;
        ctx.fillRect(lx, beamTop, rx - lx, 1.5 * scale);
        // Low pediment triangle resting on the beam.
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(lx, beamTop);
        ctx.lineTo((lx + rx) / 2, beamTop - 13 * scale);
        ctx.lineTo(rx, beamTop);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = litFill;
        ctx.lineWidth = 1.3 * scale;
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(lx, beamTop);
        ctx.lineTo((lx + rx) / 2, beamTop - 13 * scale);
        ctx.lineTo(rx, beamTop);
        ctx.stroke();
      }
    } else {
      // Loose pillars: a low fallen block among the stumps.
      ctx.fillStyle = hexA(accent, 0.6);
      ctx.fillRect(-platW * 0.3, baseS - 6 * scale, 14 * scale, 4 * scale);
    }
  }

  // --- Village region: a cluster of little pitched-roof houses on a floating
  // rock. Roof ridges catch the sky like the ruins, and the windows warm up
  // after dark so the hamlet feels lived-in. ---
  private drawVillage(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
    seed: number,
    color: string,
    accent: string
  ) {
    ctx.save();
    ctx.translate(x, y);

    // Floating rock pedestal — same silhouette as the ruins for cohesion.
    const pw = 55 * scale;
    const ph = 14 * scale;
    ctx.fillStyle = hexA(color, 0.9);
    ctx.beginPath();
    ctx.moveTo(-pw, 0);
    ctx.quadraticCurveTo(-pw * 0.4, -ph * 1.3, 0, -ph);
    ctx.quadraticCurveTo(pw * 0.4, -ph * 1.3, pw, 0);
    ctx.quadraticCurveTo(pw * 0.3, ph * 1.8, 0, ph * 2.2);
    ctx.quadraticCurveTo(-pw * 0.3, ph * 1.8, -pw, 0);
    ctx.closePath();
    ctx.fill();

    const seam = 1.5 * scale;
    // Walls pick up the cool stone; roofs lean warm toward the horizon glow.
    const wallCol = mixColor(color, theme.skyGlow, 0.06);
    const wallLit = mixColor(wallCol, theme.skyGlow, 0.22);
    const roofCol = mixColor(color, theme.skyHorizon, 0.22);
    const roofLit = mixColor(roofCol, theme.skyGlow, 0.3);

    // Two or three houses staggered across the plateau top, drawn outermost
    // first so neighbours overlap toward the centre.
    const three = hash01(seed * 17) > 0.45;
    const slots = three ? [-1, 1, 0] : [-0.65, 0.65];
    for (let k = 0; k < slots.length; k++) {
      const t = slots[k];
      const hx = t * 19 * scale;
      const hs = (0.82 + hash01(seed * 7 + k * 5) * 0.5) * scale;
      const surfaceY = this.plateauTopY(hx, pw, ph, 1.3) + seam;
      this.drawHouse(
        ctx,
        hx,
        surfaceY,
        hs,
        seed * 31 + k * 13,
        wallCol,
        wallLit,
        roofCol,
        roofLit,
        accent
      );
    }

    ctx.restore();
  }

  private drawHouse(
    ctx: CanvasRenderingContext2D,
    cx: number,
    baseY: number,
    s: number,
    seed: number,
    wallCol: string,
    wallLit: string,
    roofCol: string,
    roofLit: string,
    accent: string
  ) {
    const hw = (8 + hash01(seed * 3) * 3) * s; // half wall width
    const wallH = (13 + hash01(seed * 5) * 8) * s;
    const roofH = (9 + hash01(seed * 7) * 5) * s;
    const eave = hw * 0.3;
    const wallTop = baseY - wallH;

    // Wall, with a thin sky-lit cap along its upper edge.
    ctx.fillStyle = hexA(wallCol, 0.96);
    ctx.fillRect(cx - hw, wallTop, hw * 2, wallH);
    ctx.fillStyle = hexA(wallLit, 0.9);
    ctx.fillRect(cx - hw, wallTop, hw * 2, 1.1 * s);

    // Pitched roof with eaves.
    ctx.fillStyle = hexA(roofCol, 0.97);
    ctx.beginPath();
    ctx.moveTo(cx - hw - eave, wallTop);
    ctx.lineTo(cx, wallTop - roofH);
    ctx.lineTo(cx + hw + eave, wallTop);
    ctx.closePath();
    ctx.fill();
    // Lit ridge on the sun side (upper-left), echoing the rest of the scene.
    ctx.strokeStyle = hexA(roofLit, 0.95);
    ctx.lineWidth = 1.3 * s;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - hw - eave, wallTop);
    ctx.lineTo(cx, wallTop - roofH);
    ctx.stroke();

    // Door, tucked to one side.
    const dw = hw * 0.5;
    const dh = wallH * 0.52;
    const doorX = cx - hw * 0.42;
    ctx.fillStyle = hexA(mixColor(wallCol, theme.mid, 0.5), 0.92);
    ctx.fillRect(doorX - dw * 0.5, baseY - dh, dw, dh);

    // Window — a quiet sky-lit pane by day, a warm glow after dark.
    if (hw > 6.5 * s) {
      const warm = 0.16 + theme.night * 0.72;
      const winCol = mixColor("#ffce8a", theme.skyGlow, 0.2);
      const ww = hw * 0.4;
      const winX = cx + hw * 0.4 - ww * 0.5;
      const winY = wallTop + wallH * 0.26;
      ctx.fillStyle = hexA(mixColor(accent, theme.mid, 0.4), 0.6);
      ctx.fillRect(winX - 0.8 * s, winY - 0.8 * s, ww + 1.6 * s, ww + 1.6 * s);
      ctx.fillStyle = hexA(winCol, warm);
      ctx.fillRect(winX, winY, ww, ww);
    }

    ctx.lineCap = "butt";
  }

  // --- Forest region: a knoll crowned with layered fir trees. ---

  private drawFir(
    ctx: CanvasRenderingContext2D,
    x: number,
    baseY: number,
    height: number,
    color: string,
    lit: string
  ) {
    const halfW = height * 0.26;
    // Trunk.
    ctx.fillStyle = color;
    ctx.fillRect(x - height * 0.035, baseY - height * 0.12, height * 0.07, height * 0.13);
    // Stacked conical tiers, widest at the bottom.
    const tiers = 4;
    for (let t = 0; t < tiers; t++) {
      const f = t / tiers;
      const ty = baseY - height * 0.08 - height * 0.8 * f;
      const tw = halfW * (1 - f * 0.78);
      const th = height * 0.3;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, ty - th);
      ctx.lineTo(x - tw, ty);
      ctx.lineTo(x + tw, ty);
      ctx.closePath();
      ctx.fill();
      // Thin sky-lit left edge for a touch of form.
      ctx.fillStyle = lit;
      ctx.beginPath();
      ctx.moveTo(x, ty - th);
      ctx.lineTo(x - tw, ty);
      ctx.lineTo(x - tw * 0.6, ty);
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawPineCluster(
    ctx: CanvasRenderingContext2D,
    sx: number,
    baseY: number,
    scale: number,
    seed: number,
    color: string,
    lit: string,
    back: string,
    backLit: string,
    worldX: number
  ) {
    ctx.save();
    ctx.translate(sx, baseY);
    // Spread firs across a wide span; with every cell planted they overlap
    // into one continuous treeline. They stand on the shared ground line, so
    // no per-cluster platform can float free of the land. Positions / heights
    // (and the front row's draw order) come from the cached per-seed layout.
    const L = pineLayout(seed);
    const roll0 = midRoll(worldX); // local ground level is relative to here
    const lift = 2 * scale;

    // Back row — smaller, hazier firs receding toward the fog for depth.
    for (let t = 0; t < L.backX.length; t++) {
      const fx = L.backX[t] * scale;
      this.drawFir(
        ctx,
        fx,
        midRoll(worldX + fx) - roll0 + lift,
        L.backH[t] * scale,
        back,
        backLit
      );
    }

    // Front row — taller, denser firs whose canopies overlap (tall-to-short).
    for (let t = 0; t < L.frontX.length; t++) {
      const fx = L.frontX[t] * scale;
      this.drawFir(
        ctx,
        fx,
        midRoll(worldX + fx) - roll0 + lift,
        L.frontH[t] * scale,
        color,
        lit
      );
    }
    ctx.restore();
  }

  // --- Peaks region: a faceted, snow-capped mountain. ---

  private drawPeak(
    ctx: CanvasRenderingContext2D,
    sx: number,
    baseY: number,
    scale: number,
    seed: number,
    color: string,
    lit: string
  ) {
    ctx.save();
    ctx.translate(sx, baseY);
    const pw = (84 + hash01(seed * 7) * 60) * scale;
    const ph = (150 + hash01(seed * 13) * 130) * scale;
    const apex = (hash01(seed * 17) - 0.5) * pw * 0.5;
    const footY = 70 * scale;

    // Main mass.
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-pw, footY);
    ctx.lineTo(apex, -ph);
    ctx.lineTo(pw, footY);
    ctx.closePath();
    ctx.fill();

    // Shaded right face (low-poly look) — a darker wedge from apex down.
    ctx.fillStyle = mixColor(color, theme.mid, 0.4);
    ctx.beginPath();
    ctx.moveTo(apex, -ph);
    ctx.lineTo(pw, footY);
    ctx.lineTo(apex + pw * 0.18, footY);
    ctx.closePath();
    ctx.fill();

    // Snow cap with a jagged lower edge.
    const capH = ph * 0.34;
    const capW = pw * (capH / (ph + footY)) * 1.05;
    ctx.fillStyle = lit;
    ctx.beginPath();
    ctx.moveTo(apex, -ph);
    ctx.lineTo(apex - capW, -ph + capH);
    ctx.lineTo(apex - capW * 0.45, -ph + capH * 0.7);
    ctx.lineTo(apex - capW * 0.1, -ph + capH * 1.05);
    ctx.lineTo(apex + capW * 0.35, -ph + capH * 0.72);
    ctx.lineTo(apex + capW * 0.7, -ph + capH * 1.0);
    ctx.lineTo(apex + capW, -ph + capH * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // --- Monuments region: towering weathered standing stones. ---

  private drawMonolith(
    ctx: CanvasRenderingContext2D,
    sx: number,
    baseY: number,
    scale: number,
    seed: number,
    color: string,
    lit: string
  ) {
    ctx.save();
    // Plant the stones on the shared ground line — baseY already sits on the
    // crest (no separate base slab, so nothing floats when the camera drops).
    ctx.translate(sx, baseY);

    const type = (hash01(seed * 3) * 3) | 0;

    if (type === 0) {
      // Trilithon — two uprights carrying a heavy lintel (Stonehenge-style).
      const ph = (96 + hash01(seed * 13) * 70) * scale;
      const pw = (13 + hash01(seed * 7) * 6) * scale;
      const gap = (24 + hash01(seed * 17) * 16) * scale;
      const over = pw * 0.55;
      const linH = pw * 0.95;
      const lx = -gap * 0.5 - pw;
      const rx = gap * 0.5;
      ctx.fillStyle = color;
      ctx.fillRect(lx, -ph, pw, ph);
      ctx.fillRect(rx, -ph, pw, ph);
      ctx.fillRect(lx - over, -ph - linH, gap + pw * 2 + over * 2, linH);
      ctx.fillStyle = lit;
      ctx.fillRect(lx, -ph, pw * 0.24, ph);
      ctx.fillRect(rx, -ph, pw * 0.24, ph);
      ctx.fillRect(lx - over, -ph - linH, gap + pw * 2 + over * 2, linH * 0.32);
    } else if (type === 1) {
      // Menhir — a single tall tapered standing stone with a gentle lean, plus
      // a smaller companion stone beside it.
      const sh = (120 + hash01(seed * 13) * 90) * scale;
      const wb = (20 + hash01(seed * 7) * 10) * scale;
      const wt = wb * 0.58;
      const lean = (hash01(seed * 19) - 0.5) * 0.14;
      ctx.save();
      ctx.rotate(lean);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-wb * 0.5, 2 * scale);
      ctx.lineTo(-wt * 0.5, -sh);
      ctx.lineTo(wt * 0.5, -sh * 0.97);
      ctx.lineTo(wb * 0.5, 2 * scale);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = lit;
      ctx.beginPath();
      ctx.moveTo(-wb * 0.5, 2 * scale);
      ctx.lineTo(-wt * 0.5, -sh);
      ctx.lineTo(-wt * 0.22, -sh);
      ctx.lineTo(-wb * 0.2, 2 * scale);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      const ch = sh * (0.42 + hash01(seed * 29) * 0.2);
      const cw = wb * 0.7;
      const cx = (wb * 0.7 + 14 * scale) * (hash01(seed * 31) > 0.5 ? 1 : -1);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx - cw * 0.5, 2 * scale);
      ctx.lineTo(cx - cw * 0.34, -ch);
      ctx.lineTo(cx + cw * 0.34, -ch);
      ctx.lineTo(cx + cw * 0.5, 2 * scale);
      ctx.closePath();
      ctx.fill();
    } else {
      // Obelisk — tapered shaft topped by a small pyramidion.
      const sh = (130 + hash01(seed * 13) * 96) * scale;
      const wb = (16 + hash01(seed * 7) * 7) * scale;
      const wt = wb * 0.52;
      const shaftTop = -sh * 0.86;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-wb * 0.5, 0);
      ctx.lineTo(-wt * 0.5, shaftTop);
      ctx.lineTo(wt * 0.5, shaftTop);
      ctx.lineTo(wb * 0.5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-wt * 0.5, shaftTop);
      ctx.lineTo(0, -sh);
      ctx.lineTo(wt * 0.5, shaftTop);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = lit;
      ctx.beginPath();
      ctx.moveTo(-wb * 0.5, 0);
      ctx.lineTo(-wt * 0.5, shaftTop);
      ctx.lineTo(0, -sh);
      ctx.lineTo(-wt * 0.18, shaftTop);
      ctx.lineTo(-wb * 0.2, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // --- Soft cloud cluster (cauliflower puffs, flat bottom). ---

  private drawCloudCluster(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    alpha: number
  ) {
    // Every puff shares one tinted falloff sprite (see puffSprite) — a
    // drawImage each instead of a fresh radial gradient + shader-filled arc.
    const sprite = puffSprite();
    ctx.save();
    ctx.globalAlpha = alpha;
    for (const p of CLUSTER_PUFFS) {
      const r = p.r * width;
      ctx.drawImage(sprite, x + p.dx * width - r, y + p.dy * width - r, r * 2, r * 2);
    }
    ctx.restore();
  }
}
