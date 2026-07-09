import { theme } from "../render/theme";
import { Rng } from "../core/rng";
import { TAU } from "../core/math";
import { makeScratch, Scratch, VersionCache } from "../render/rcache";

interface Puff {
  dx: number;
  dy: number;
  r: number;
}

// --- Shared puff sprite ------------------------------------------------------
// Every puff used to fill a fresh 4-stop radial gradient per frame (~100-250
// createRadialGradient allocations/frame across the cloud systems). Instead the
// soft-puff profile is baked once, in white, and re-tinted to theme.cloud only
// when the quantized palette changes; each puff is then a single drawImage with
// a per-puff globalAlpha. Baked at 2x the max on-screen puff radius (~80 CSS
// px; DPR is clamped to 2) so puffs stay crisp. Init is lazy — first draw
// call, never at import time.
const PUFF_R = 160;

let basePuff: HTMLCanvasElement | null = null;

function getBasePuff(): HTMLCanvasElement {
  if (!basePuff) {
    const R = PUFF_R;
    const { canvas, ctx } = makeScratch(R * 2, R * 2);
    // Same geometry as the old per-puff gradient (offset centre = lit top).
    const g = ctx.createRadialGradient(R, R - R * 0.38, R * 0.08, R, R + R * 0.12, R);
    g.addColorStop(0, "rgba(255,255,255,0.98)");
    g.addColorStop(0.45, "rgba(255,255,255,0.68)");
    g.addColorStop(0.85, "rgba(255,255,255,0.22)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(R, R, R, 0, TAU);
    ctx.fill();
    basePuff = canvas;
  }
  return basePuff;
}

// Re-colour the white base puff via 'source-in' — keeps the baked alpha
// falloff, swaps the RGB.
function tintInto(target: Scratch, color: string): HTMLCanvasElement {
  const { canvas, ctx } = target;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(getBasePuff(), 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "source-over";
  return canvas;
}

let cloudScratch: Scratch | null = null;
const cloudTint = new VersionCache<HTMLCanvasElement>();

function cloudPuffSprite(): HTMLCanvasElement {
  return cloudTint.get(theme.version, theme.cloud, () => {
    if (!cloudScratch) cloudScratch = makeScratch(PUFF_R * 2, PUFF_R * 2);
    return tintInto(cloudScratch, theme.cloud);
  });
}

// Skim-glow puff. theme.collectible is a PALETTE constant (never cycled), so
// this one is tinted exactly once.
let glowPuff: HTMLCanvasElement | null = null;

function glowPuffSprite(): HTMLCanvasElement {
  if (!glowPuff) {
    glowPuff = tintInto(makeScratch(PUFF_R * 2, PUFF_R * 2), theme.collectible);
  }
  return glowPuff;
}

// Soft cloud bank. Skimming its surface ring builds the Wind Gauge.
// Puffs are arranged in a lumpy, flat-bottomed cluster — not a random blob.
export class Cloud {
  x: number;
  y: number;
  readonly rx: number;
  readonly ry: number;
  private puffs: Puff[] = [];
  glow = 0; // lights up briefly while being skimmed

  constructor(x: number, y: number, rx: number, ry: number, rng: Rng) {
    this.x = x;
    this.y = y;
    this.rx = rx;
    this.ry = ry;
    this.puffs = buildCloudPuffs(rx, ry, rng);
  }

  update(dt: number) {
    if (this.glow > 0) this.glow = Math.max(0, this.glow - dt * 2.5);
  }

  // Returns 0 when not skimming, up to 1 right at the surface ring.
  skimFactor(px: number, py: number): number {
    const nx = (px - this.x) / this.rx;
    const ny = (py - this.y) / this.ry;
    const n = Math.hypot(nx, ny);
    const d = Math.abs(n - 1);
    if (d > 0.28) return 0;
    return 1 - d / 0.28;
  }

  draw(ctx: CanvasRenderingContext2D) {
    const sprite = cloudPuffSprite();
    const base = 0.72 + this.glow * 0.28;
    ctx.save();

    // Back layer — larger, softer puffs.
    for (const p of this.puffs) {
      this.drawPuff(ctx, sprite, p, 1.08, 0.75 * base);
    }
    // Front layer — brighter highlights on top edges.
    for (const p of this.puffs) {
      if (p.dy <= this.ry * 0.15) {
        this.drawPuff(ctx, sprite, p, 1.0, base);
      }
    }

    ctx.restore();

    if (this.glow > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.16 * this.glow;
      const glow = glowPuffSprite();
      for (const p of this.puffs) {
        const r = p.r * 1.2;
        ctx.drawImage(glow, this.x + p.dx - r, this.y + p.dy - r, r * 2, r * 2);
      }
      ctx.restore();
    }
  }

  private drawPuff(
    ctx: CanvasRenderingContext2D,
    sprite: HTMLCanvasElement,
    p: Puff,
    scale: number,
    alpha: number
  ) {
    const r = p.r * scale;
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, this.x + p.dx - r, this.y + p.dy - r, r * 2, r * 2);
  }
}

// Build a cauliflower cloud: big puffs on top, medium in the middle, small at
// the sides; bottom stays relatively flat for a readable skim surface.
function buildCloudPuffs(rx: number, ry: number, rng: Rng): Puff[] {
  const puffs: Puff[] = [];

  // Core crown puffs (billowy top).
  const crowns = rng.int(2, 4);
  for (let i = 0; i < crowns; i++) {
    const t = crowns === 1 ? 0.5 : i / (crowns - 1);
    puffs.push({
      dx: (t - 0.5) * rx * 1.1 + rng.range(-rx * 0.08, rx * 0.08),
      dy: -ry * rng.range(0.15, 0.45),
      r: rng.range(ry * 0.55, ry * 0.95),
    });
  }

  // Mid-body puffs fill the width.
  const mid = rng.int(3, 5);
  for (let i = 0; i < mid; i++) {
    const t = (i + 0.5) / mid;
    puffs.push({
      dx: (t - 0.5) * rx * 1.6 + rng.range(-rx * 0.06, rx * 0.06),
      dy: rng.range(-ry * 0.12, ry * 0.22),
      r: rng.range(ry * 0.4, ry * 0.72),
    });
  }

  // Side lobes.
  for (const side of [-1, 1]) {
    if (rng.chance(0.75)) {
      puffs.push({
        dx: side * rx * rng.range(0.55, 0.85),
        dy: rng.range(0, ry * 0.18),
        r: rng.range(ry * 0.32, ry * 0.52),
      });
    }
  }

  // Wispy underside (small, low) — keeps the bottom edge soft but flat-ish.
  const wisps = rng.int(2, 4);
  for (let i = 0; i < wisps; i++) {
    const t = (i + 0.5) / wisps;
    puffs.push({
      dx: (t - 0.5) * rx * 1.3,
      dy: ry * rng.range(0.18, 0.38),
      r: rng.range(ry * 0.22, ry * 0.38),
    });
  }

  return puffs;
}
