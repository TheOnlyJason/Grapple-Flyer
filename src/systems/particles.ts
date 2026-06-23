import { TAU } from "../core/math";
import { hexA } from "../entities/anchor";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
  drag: number;
  active: boolean;
  additive: boolean;
}

// Fixed-capacity particle pool — no per-emit allocations in the hot loop.
export class Particles {
  private pool: Particle[] = [];
  private cursor = 0;

  constructor(capacity = 400) {
    for (let i = 0; i < capacity; i++) {
      this.pool.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 1,
        size: 1,
        color: "#fff",
        gravity: 0,
        drag: 0,
        active: false,
        additive: true,
      });
    }
  }

  private spawn(): Particle {
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    return p;
  }

  emit(
    x: number,
    y: number,
    opts: {
      count: number;
      speed: [number, number];
      life: [number, number];
      size: [number, number];
      color: string;
      gravity?: number;
      drag?: number;
      angle?: number; // base direction
      spread?: number; // +/- around base
      additive?: boolean; // glow blending (default true)
    }
  ) {
    for (let i = 0; i < opts.count; i++) {
      const p = this.spawn();
      const base = opts.angle ?? Math.random() * TAU;
      const spread = opts.spread ?? TAU;
      const a = base + (Math.random() - 0.5) * spread;
      const sp = rand(opts.speed);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.maxLife = rand(opts.life);
      p.life = p.maxLife;
      p.size = rand(opts.size);
      p.color = opts.color;
      p.gravity = opts.gravity ?? 0;
      p.drag = opts.drag ?? 1.2;
      p.additive = opts.additive ?? true;
      p.active = true;
    }
  }

  update(dt: number) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.vy += p.gravity * dt;
      p.vx -= p.vx * p.drag * dt;
      p.vy -= p.vy * p.drag * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    // Non-additive pass (debris, spray).
    for (const p of this.pool) {
      if (!p.active || p.additive) continue;
      const t = p.life / p.maxLife;
      ctx.fillStyle = hexA(p.color, t);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + t * 0.6), 0, TAU);
      ctx.fill();
    }
    // Additive bloom pass (energy, sparks).
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.pool) {
      if (!p.active || !p.additive) continue;
      const t = p.life / p.maxLife;
      ctx.fillStyle = hexA(p.color, t * 0.9);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + t * 0.6), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  clear() {
    for (const p of this.pool) p.active = false;
  }
}

function rand([a, b]: [number, number]): number {
  return a + Math.random() * (b - a);
}
