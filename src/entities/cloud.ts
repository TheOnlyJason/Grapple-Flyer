import { theme } from "../render/theme";
import { Rng } from "../core/rng";
import { TAU } from "../core/math";
import { hexA } from "./anchor";

interface Puff {
  dx: number;
  dy: number;
  r: number;
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
    ctx.save();
    ctx.globalAlpha = 0.72 + this.glow * 0.28;

    // Back layer — larger, softer puffs.
    for (const p of this.puffs) {
      this.drawPuff(ctx, p, 1.08, 0.75);
    }
    // Front layer — brighter highlights on top edges.
    for (const p of this.puffs) {
      if (p.dy <= this.ry * 0.15) {
        this.drawPuff(ctx, p, 1.0, 1.0);
      }
    }

    ctx.restore();

    if (this.glow > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const p of this.puffs) {
        const cx = this.x + p.dx;
        const cy = this.y + p.dy;
        const g = ctx.createRadialGradient(cx, cy, p.r * 0.3, cx, cy, p.r * 1.2);
        g.addColorStop(0, hexA(theme.collectible, 0.16 * this.glow));
        g.addColorStop(1, hexA(theme.collectible, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, p.r * 1.2, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawPuff(
    ctx: CanvasRenderingContext2D,
    p: Puff,
    scale: number,
    alpha: number
  ) {
    const cx = this.x + p.dx;
    const cy = this.y + p.dy;
    const r = p.r * scale;
    const g = ctx.createRadialGradient(
      cx,
      cy - r * 0.38,
      r * 0.08,
      cx,
      cy + r * 0.12,
      r
    );
    g.addColorStop(0, hexA(theme.cloud, 0.98 * alpha));
    g.addColorStop(0.45, hexA(theme.cloud, 0.68 * alpha));
    g.addColorStop(0.85, hexA(theme.cloud, 0.22 * alpha));
    g.addColorStop(1, hexA(theme.seaDeep, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
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
