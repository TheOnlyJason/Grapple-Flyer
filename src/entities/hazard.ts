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
  private litFace: { x: number; y: number }[] = [];
  private shadowFace: { x: number; y: number }[] = [];
  private cracks: { x: number; y: number }[][] = [];
  private spin: number;

  constructor(x: number, y: number, rx: number, ry: number, rng: Rng) {
    this.x = x;
    this.y = y;
    this.rx = rx;
    this.ry = ry;
    this.spin = rng.range(-0.2, 0.2);

    // Silhouette: angular jitter + occasional deep chips make the outline read
    // as fractured stone instead of a smooth blob.
    const pts = rng.int(10, 14);
    for (let i = 0; i < pts; i++) {
      const a = ((i + rng.range(-0.3, 0.3)) / pts) * TAU;
      let jag = rng.range(0.74, 1.06);
      if (rng.chance(0.2)) jag *= rng.range(0.55, 0.72); // a chipped notch
      this.poly.push({ x: Math.cos(a) * rx * jag, y: Math.sin(a) * ry * jag });
    }

    // Shading facets, fanned from an off-centre pivot. Vertices run angle
    // 0..TAU with +y DOWN, so the second half of the list is the top arc.
    const half = Math.floor(pts / 2);
    const pivot = { x: rx * rng.range(-0.24, 0.02), y: -ry * rng.range(0.02, 0.22) };
    this.litFace.push(pivot);
    for (let i = half; i < pts; i++) this.litFace.push(this.poly[i]);
    this.litFace.push(this.poly[0]);

    const pivot2 = { x: rx * rng.range(0.0, 0.2), y: ry * rng.range(0.15, 0.35) };
    this.shadowFace.push(pivot2);
    for (let i = 0; i <= half; i++) this.shadowFace.push(this.poly[i]);

    // A few interior cracks running from the rim toward the middle.
    const crackCount = rng.int(2, 3);
    for (let c = 0; c < crackCount; c++) {
      const v = this.poly[rng.int(0, pts - 1)];
      const j1 = rng.range(-0.18, 0.18);
      const j2 = rng.range(-0.14, 0.14);
      this.cracks.push([
        { x: v.x * 0.94, y: v.y * 0.94 },
        { x: v.x * 0.55 + rx * j1, y: v.y * 0.55 + ry * j1 * 0.7 },
        { x: v.x * 0.2 + rx * j2, y: v.y * 0.2 + ry * j2 * 0.7 },
      ]);
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

    // Faceted shading: a sky-lit upper face and a deeper under-face give the
    // slab a broken-stone read instead of a flat blob.
    ctx.beginPath();
    ctx.moveTo(this.litFace[0].x, this.litFace[0].y);
    for (let i = 1; i < this.litFace.length; i++) {
      ctx.lineTo(this.litFace[i].x, this.litFace[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = hexA(theme.hazardEdge, 0.32);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(this.shadowFace[0].x, this.shadowFace[0].y);
    for (let i = 1; i < this.shadowFace.length; i++) {
      ctx.lineTo(this.shadowFace[i].x, this.shadowFace[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = hexA("#05060f", 0.42);
    ctx.fill();

    // Cracks running in from the rim.
    ctx.strokeStyle = hexA("#05060f", 0.6);
    ctx.lineWidth = 1.3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const crack of this.cracks) {
      ctx.beginPath();
      ctx.moveTo(crack[0].x, crack[0].y);
      for (let i = 1; i < crack.length; i++) ctx.lineTo(crack[i].x, crack[i].y);
      ctx.stroke();
    }

    // Crisp cool edge.
    ctx.beginPath();
    ctx.moveTo(this.poly[0].x, this.poly[0].y);
    for (let i = 1; i < this.poly.length; i++) {
      ctx.lineTo(this.poly[i].x, this.poly[i].y);
    }
    ctx.closePath();
    ctx.strokeStyle = hexA(theme.hazardEdge, 0.85);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Sun-side rim light along the TOP arc (vertices run 0..TAU with +y down,
    // so the second half of the list is the upper edge) — matches the lit
    // facet and keeps rocks readable on a night sky.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = hexA(theme.skyGlow, 0.18 + theme.night * 0.35);
    ctx.lineWidth = 2;
    ctx.beginPath();
    const half = Math.floor(this.poly.length / 2);
    ctx.moveTo(this.poly[half].x, this.poly[half].y);
    for (let i = half + 1; i < this.poly.length; i++) {
      ctx.lineTo(this.poly[i].x, this.poly[i].y);
    }
    ctx.lineTo(this.poly[0].x, this.poly[0].y);
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }
}
