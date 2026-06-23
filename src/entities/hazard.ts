import { theme } from "../render/theme";
import { Rng } from "../core/rng";
import { TAU } from "../core/math";
import { hexA } from "./anchor";

// Lethal floating rock. Crash into it and the run ends — unless you're dashing
// through it, which shatters it. The MVP's single hazard type.
export class Hazard {
  x: number; // center
  y: number;
  readonly rx: number;
  readonly ry: number;
  destroyed = false;
  shatter = 0; // > 0 while playing the break effect, then it's culled
  private poly: { x: number; y: number }[] = [];
  private spin: number;

  constructor(x: number, y: number, rx: number, ry: number, rng: Rng) {
    this.x = x;
    this.y = y;
    this.rx = rx;
    this.ry = ry;
    this.spin = rng.range(-0.2, 0.2);

    const pts = rng.int(8, 11);
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * TAU;
      const jag = rng.range(0.62, 1.05);
      this.poly.push({ x: Math.cos(a) * rx * jag, y: Math.sin(a) * ry * jag });
    }
  }

  // Circle-vs-(inset bounding ellipse) test. Slightly forgiving to feel fair.
  hits(px: number, py: number, r: number): boolean {
    if (this.destroyed) return false;
    const nx = (px - this.x) / (this.rx * 0.86 + r);
    const ny = (py - this.y) / (this.ry * 0.86 + r);
    return nx * nx + ny * ny <= 1;
  }

  break_() {
    this.destroyed = true;
    this.shatter = 1;
  }

  update(dt: number) {
    if (this.shatter > 0) this.shatter = Math.max(0, this.shatter - dt * 1.6);
  }

  get gone(): boolean {
    return this.destroyed && this.shatter <= 0;
  }

  draw(ctx: CanvasRenderingContext2D, t: number) {
    if (this.gone) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(Math.sin(t * 0.5 + this.x) * 0.04 + this.spin * t * 0.1);

    if (this.destroyed) ctx.globalAlpha = this.shatter;

    // Body silhouette.
    ctx.beginPath();
    ctx.moveTo(this.poly[0].x, this.poly[0].y);
    for (let i = 1; i < this.poly.length; i++) {
      ctx.lineTo(this.poly[i].x, this.poly[i].y);
    }
    ctx.closePath();
    // Flat dark silhouette (Alto-style), very slightly tinted by the sky depth.
    ctx.fillStyle = hexA(theme.hazard, 0.96);
    ctx.fill();

    // Crisp cool edge.
    ctx.strokeStyle = hexA(theme.hazardEdge, 0.85);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Sun-side rim light: gives form and keeps rocks readable on a night sky.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = hexA(theme.skyGlow, 0.18 + theme.night * 0.35);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.poly[0].x, this.poly[0].y);
    for (let i = 1; i < Math.ceil(this.poly.length / 2); i++) {
      ctx.lineTo(this.poly[i].x, this.poly[i].y);
    }
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }
}
