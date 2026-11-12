// Storm zone: lightning marks a column of sky (a faint flickering band, for
// CONFIG.zones.lightning.warn seconds once it is in view), then strikes it
// (a bright bolt from the top of the sky to the cloud sea). Being in the
// column while it strikes ends a run, as a rock would.

import { CONFIG } from "../core/config";

export class Lightning {
  readonly x: number;
  readonly width: number;
  /** Seconds since it came into view (< 0: not yet). */
  t = -1;

  constructor(x: number) {
    this.x = x;
    this.width = CONFIG.zones.lightning.width;
  }

  get warning(): boolean {
    return this.t >= 0 && this.t < CONFIG.zones.lightning.warn;
  }

  get striking(): boolean {
    const L = CONFIG.zones.lightning;
    return this.t >= L.warn && this.t < L.warn + L.strike;
  }

  get done(): boolean {
    const L = CONFIG.zones.lightning;
    return this.t >= L.warn + L.strike + 0.4;
  }

  update(dt: number, viewRight: number) {
    if (this.t < 0) {
      if (this.x < viewRight - 40) this.t = 0;
      return;
    }
    this.t += dt;
  }

  /** Whether a circle at (x, r) is inside the column. */
  hits(x: number, r: number): boolean {
    return Math.abs(x - this.x) < this.width / 2 + r * 0.6;
  }

  draw(ctx: CanvasRenderingContext2D, top: number, bottom: number) {
    if (this.t < 0 || this.done) return;
    const L = CONFIG.zones.lightning;
    const half = this.width / 2;
    ctx.save();
    if (this.warning) {
      // The marked column: a faint band whose edges flicker faster as the strike nears.
      const k = this.t / L.warn;
      const flick = 0.5 + 0.5 * Math.sin(this.t * (10 + 30 * k));
      ctx.fillStyle = `rgba(200,215,255,${(0.1 + 0.16 * k) * (0.6 + 0.4 * flick)})`;
      ctx.fillRect(this.x - half, top, this.width, bottom - top);
      ctx.strokeStyle = `rgba(230,238,255,${0.25 + 0.5 * k * flick})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([10, 10]);
      ctx.beginPath();
      ctx.moveTo(this.x - half, top);
      ctx.lineTo(this.x - half, bottom);
      ctx.moveTo(this.x + half, top);
      ctx.lineTo(this.x + half, bottom);
      ctx.stroke();
    } else {
      // The strike, then its afterglow.
      const s = (this.t - L.warn) / L.strike;
      const a = s < 1 ? 1 : Math.max(0, 1 - (s - 1) * (L.strike / 0.4));
      ctx.fillStyle = `rgba(220,230,255,${0.45 * a})`;
      ctx.fillRect(this.x - half, top, this.width, bottom - top);
      ctx.strokeStyle = `rgba(255,248,210,${0.35 * a})`;
      ctx.lineWidth = 18;
      ctx.lineJoin = "round";
      ctx.beginPath();
      const steps0 = 9;
      for (let i = 0; i <= steps0; i++) {
        const y = top + ((bottom - top) * i) / steps0;
        const jag = i === 0 || i === steps0 ? 0 : Math.sin(i * 12.9898 + this.x * 0.01) * half * 0.6;
        if (i === 0) ctx.moveTo(this.x + jag, y);
        else ctx.lineTo(this.x + jag, y);
      }
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,252,230,${a})`;
      ctx.lineWidth = 6;
      ctx.lineJoin = "round";
      ctx.beginPath();
      const steps = 9;
      for (let i = 0; i <= steps; i++) {
        const y = top + ((bottom - top) * i) / steps;
        const jag = i === 0 || i === steps ? 0 : Math.sin(i * 12.9898 + this.x * 0.01) * half * 0.6;
        if (i === 0) ctx.moveTo(this.x + jag, y);
        else ctx.lineTo(this.x + jag, y);
      }
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${a})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    ctx.restore();
  }
}
