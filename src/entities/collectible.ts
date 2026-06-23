import { theme } from "../render/theme";
import { TAU } from "../core/math";
import { hexA } from "./anchor";

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
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(this.x, this.y, 1, this.x, this.y, r * 3);
    g.addColorStop(0, hexA(theme.collectible, 0.9));
    g.addColorStop(1, hexA(theme.collectible, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#eafff6";
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 0.55, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}
