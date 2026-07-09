import { theme } from "../render/theme";
import { TAU } from "../core/math";
import { bakeGlowSprite } from "./anchor";

// Glow sprite: theme.collectible is a PALETTE constant (never theme-cycled),
// so the radial falloff is baked exactly once — lazily on the first draw call.
// Baked at 2x the max on-screen radius (r*3 tops out at ~25.5 CSS px; DPR is
// clamped to 2) so it stays crisp.
const GLOW_R = 52;
let glowSprite: HTMLCanvasElement | null = null;

// Wind wisp: small floating pickup that grants score + Wind Gauge.
export class Collectible {
  x: number;
  y: number;
  readonly baseX: number;
  readonly baseY: number;
  collected = false;
  vx = 0; // velocity used when magnetised during a dash
  vy = 0;
  private phase: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.baseX = x;
    this.baseY = y;
    this.phase = x * 0.05;
  }

  update(dt: number, t: number, magnet: boolean) {
    if (this.collected) return;
    if (magnet) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
    } else {
      // Gentle idle bob around the spawn point.
      this.x = this.baseX;
      this.y = this.baseY + Math.sin(t * 2 + this.phase) * 6;
    }
  }

  draw(ctx: CanvasRenderingContext2D, t: number) {
    if (this.collected) return;
    const r = 7 + Math.sin(t * 4 + this.phase) * 1.5;
    if (!glowSprite) glowSprite = bakeGlowSprite(theme.collectible, GLOW_R);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const glowR = r * 3;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(glowSprite, this.x - glowR, this.y - glowR, glowR * 2, glowR * 2);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#eafff6";
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 0.55, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}
