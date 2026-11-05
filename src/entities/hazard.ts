import { theme } from "../render/theme";
import { Rng } from "../core/rng";
import { TAU, clamp, lerp } from "../core/math";
import { CONFIG } from "../core/config";
import { hexA } from "./anchor";

interface Pt {
  x: number;
  y: number;
}

// One fragment of a smashed rock: its outline around its own centroid plus a
// rigid-body state. Built once at break time, then mutated in place.
interface Shard {
  pts: Float32Array; // x0,y0,x1,y1,… relative to the centroid, rock rotation baked in
  lit: boolean; // upper-face piece → carries the sky-lit facet tint
  x: number; // world position of the centroid
  y: number;
  vx: number;
  vy: number;
  rot: number;
  rotV: number;
}

const SH = CONFIG.hazard.shatter;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

// Lethal floating rock. Crash into it and the run ends — unless you're dashing
// through it, which shatters it. The MVP's single hazard type.
export class Hazard {
  x: number; // center
  y: number;
  readonly rx: number;
  readonly ry: number;
  destroyed = false;
  shatter = 0; // remaining life of the break effect (1 → 0), then it's culled
  private poly: Pt[] = [];
  private litFace: Pt[] = [];
  private shadowFace: Pt[] = [];
  private cracks: Pt[][] = [];
  private crackIdx: number[] = []; // rim vertex each crack starts from
  private spin: number;
  private rot = 0; // rotation drawn last frame, baked into the shards on break
  private age = 0; // seconds since the break
  private shards: Shard[] = [];

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
      const vi = rng.int(0, pts - 1);
      const v = this.poly[vi];
      this.crackIdx.push(vi);
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

  // Smash the rock. The impact point and the smasher's velocity shape the
  // break: pieces fly away from where they were struck and inherit some of
  // the player's travel so the debris stays in view at smash speed.
  break_(impactX = this.x, impactY = this.y, velX = 0, velY = 0) {
    if (this.destroyed) return;
    this.destroyed = true;
    this.shatter = 1;
    this.age = 0;
    this.buildShards(impactX, impactY, velX, velY);
  }

  // Split the silhouette into wedge-shaped pieces. The drawn cracks become
  // real fracture seams (so the rock breaks where it already looked weak) and
  // extra seams are added in the widest gaps until there are enough pieces.
  private buildShards(impactX: number, impactY: number, velX: number, velY: number) {
    const { poly, rx, ry } = this;
    const n = poly.length;
    const cos = Math.cos(this.rot);
    const sin = Math.sin(this.rot);

    // Impact point in rock-local (unrotated) space, pulled toward the middle
    // so a glancing hit still fractures from inside the slab.
    const dx = impactX - this.x;
    const dy = impactY - this.y;
    let ix = dx * cos + dy * sin;
    let iy = -dx * sin + dy * cos;
    const d = Math.hypot(ix / rx, iy / ry);
    if (d > 0.45) {
      ix *= 0.45 / d;
      iy *= 0.45 / d;
    }
    const fx = ix * 0.6 + rand(-0.06, 0.06) * rx; // fracture focus
    const fy = iy * 0.6 + rand(-0.06, 0.06) * ry;

    // Seam rim vertices: the cracks first, then split the largest gaps.
    const count = Math.round(lerp(SH.shards[0], SH.shards[1], clamp((rx - 34) / 58, 0, 1)));
    // Crack seams sit at least two rim edges apart. The gap-splitting below can
    // still put an added seam one edge from its neighbour, so those get less
    // jitter to keep the two from crossing into a splinter.
    const idx: number[] = [];
    for (const i of [...this.crackIdx].sort((a, b) => a - b)) {
      if (idx.every((j) => Math.min(Math.abs(i - j), n - Math.abs(i - j)) >= 2)) idx.push(i);
    }
    while (idx.length < count) {
      let bestGap = -1;
      let bestAt = 0;
      for (let k = 0; k < idx.length; k++) {
        const a = idx[k];
        const b = k + 1 < idx.length ? idx[k + 1] : idx[0] + n;
        if (b - a > bestGap) {
          bestGap = b - a;
          bestAt = k;
        }
      }
      if (bestGap < 3) break; // every piece keeps at least one full rim edge
      idx.push((idx[bestAt] + Math.floor(bestGap / 2)) % n);
      idx.sort((a, b) => a - b);
    }

    // Each seam runs rim → outer point → inner point → focus. Cracks reuse
    // their drawn outer point so the pieces part along the visible lines; the
    // inner point heads for the focus from the seam's own outer point, so
    // neighbouring seams converge on it without crossing each other.
    const crackFor = new Map<number, Pt[]>();
    this.cracks.forEach((c, k) => crackFor.set(this.crackIdx[k], c));
    const seams = idx.map((i) => {
      const v = poly[i];
      const crack = crackFor.get(i);
      const outer = crack
        ? crack[1]
        : { x: v.x * 0.6 + rand(-0.06, 0.06) * rx, y: v.y * 0.6 + rand(-0.06, 0.06) * ry };
      const inner = {
        x: lerp(outer.x, fx, 0.55) + rand(-0.03, 0.03) * rx,
        y: lerp(outer.y, fy, 0.55) + rand(-0.03, 0.03) * ry,
      };
      return [outer, inner];
    });

    // Travel direction decides which way pieces tumble.
    const vlen = Math.hypot(velX, velY);
    const tx = vlen > 1 ? velX / vlen : 1;
    const ty = vlen > 1 ? velY / vlen : 0;

    this.shards.length = 0;
    const verts: Pt[] = [];
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[k];
      const i1 = k + 1 < idx.length ? idx[k + 1] : idx[0] + n;
      const s0 = seams[k];
      const s1 = seams[(k + 1) % idx.length];
      verts.length = 0;
      verts.push({ x: fx, y: fy }, s0[1], s0[0]);
      for (let i = i0; i <= i1; i++) verts.push(poly[i % n]);
      verts.push(s1[0], s1[1]);

      let cx = 0;
      let cy = 0;
      for (const v of verts) {
        cx += v.x;
        cy += v.y;
      }
      cx /= verts.length;
      cy /= verts.length;

      const pts = new Float32Array(verts.length * 2);
      for (let j = 0; j < verts.length; j++) {
        const px = verts[j].x - cx;
        const py = verts[j].y - cy;
        pts[j * 2] = px * cos - py * sin;
        pts[j * 2 + 1] = px * sin + py * cos;
      }

      // Fly away from the impact point (in world space), plus the carry.
      let ax = cx - ix;
      let ay = cy - iy;
      const al = Math.hypot(ax, ay);
      if (al < 1e-3) {
        const a = Math.random() * TAU;
        ax = Math.cos(a);
        ay = Math.sin(a);
      } else {
        ax /= al;
        ay /= al;
      }
      const wx = ax * cos - ay * sin;
      const wy = ax * sin + ay * cos;
      const speed = rand(SH.speed[0], SH.speed[1]);
      const side = tx * wy - ty * wx >= 0 ? 1 : -1;

      this.shards.push({
        pts,
        lit: cy < -ry * 0.05,
        x: this.x + cx * cos - cy * sin,
        y: this.y + cx * sin + cy * cos,
        vx: wx * speed + velX * SH.carry,
        vy: wy * speed + velY * SH.carry - SH.lift,
        rot: 0,
        rotV: side * rand(SH.spin[0], SH.spin[1]),
      });
    }
  }

  update(dt: number) {
    if (!this.destroyed) return;
    this.age += dt;
    this.shatter = Math.max(0, 1 - this.age / SH.life);
    if (this.age < SH.hold) return; // the cracked slab hangs together for a beat
    const g = SH.gravity * dt;
    const k = 1 - SH.drag * dt;
    for (const s of this.shards) {
      s.vy += g;
      s.vx *= k;
      s.vy *= k;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.rot += s.rotV * dt;
    }
  }

  get gone(): boolean {
    return this.destroyed && this.shatter <= 0;
  }

  draw(ctx: CanvasRenderingContext2D, t: number) {
    if (this.gone) return;
    if (this.destroyed) {
      this.drawShards(ctx);
      return;
    }
    this.rot = Math.sin(t * 0.5 + this.x) * 0.04 + this.spin * t * 0.1;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);

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

  // The pieces keep the rock's flat look: dark body, cool edge, lit tint on
  // the upper-face pieces. Fresh fracture edges glow for a few frames, then
  // the pieces tumble, shrink a touch and fade out over the last 45%.
  private drawShards(ctx: CanvasRenderingContext2D) {
    const life = this.shatter;
    const fade = life > 0.45 ? 1 : life / 0.45;
    const alpha = fade * fade * (3 - 2 * fade);
    const scale = 0.84 + 0.16 * life;
    const flash = Math.max(0, 1 - this.age / SH.flash);
    const body = hexA(theme.hazard, 0.96);
    const edge = hexA(theme.hazardEdge, 0.85);
    const litFill = hexA(theme.hazardEdge, 0.32);
    // Fresh seams glow for a few frames; afterwards the upper-face pieces
    // keep the intact rock's sun-side rim light so they stay readable at night.
    const glow = flash > 0 ? hexA(theme.skyGlow, 0.75 * flash) : "";
    const rim = hexA(theme.skyGlow, 0.14 + theme.night * 0.3);
    ctx.lineJoin = "round";
    for (const s of this.shards) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.scale(scale, scale);
      ctx.globalAlpha = alpha;
      const p = s.pts;
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      for (let j = 2; j < p.length; j += 2) ctx.lineTo(p[j], p[j + 1]);
      ctx.closePath();
      ctx.fillStyle = body;
      ctx.fill();
      if (s.lit) {
        ctx.fillStyle = litFill;
        ctx.fill();
      }
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = edge;
      ctx.stroke();
      if (flash > 0) {
        ctx.globalCompositeOperation = "lighter";
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = glow;
        ctx.stroke();
      } else if (s.lit) {
        ctx.globalCompositeOperation = "lighter";
        ctx.lineWidth = 2;
        ctx.strokeStyle = rim;
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}
