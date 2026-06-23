import { theme } from "../render/theme";
import { TAU } from "../core/math";

export type AnchorKind = "normal" | "moving";

// A tether target floating in the sky.
export class Anchor {
  x: number;
  y: number;
  readonly baseY: number;
  readonly kind: AnchorKind;
  private amp = 0;
  private phase = 0;
  private speed = 0;

  used = false; // tethered to at least once (objective tracking)
  pulse = 0; // grab feedback, decays to 0
  highlight = 0; // 0..1 grab-candidate emphasis (cyan), set by player each frame
  perfectGlow = 0; // 0..1 perfect-release window (gold), set while tethered

  constructor(
    x: number,
    y: number,
    kind: AnchorKind = "normal",
    opts?: { amp?: number; phase?: number; speed?: number }
  ) {
    this.x = x;
    this.y = y;
    this.baseY = y;
    this.kind = kind;
    if (kind === "moving") {
      this.amp = opts?.amp ?? 90;
      this.phase = opts?.phase ?? 0;
      this.speed = opts?.speed ?? 1.1;
    }
  }

  update(dt: number, t: number) {
    if (this.kind === "moving") {
      this.y = this.baseY + Math.sin(t * this.speed + this.phase) * this.amp;
    }
    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dt * 2.2);
    // highlight / perfectGlow are set externally each frame; ease them down here.
    this.highlight *= Math.max(0, 1 - dt * 8);
    this.perfectGlow *= Math.max(0, 1 - dt * 10);
  }

  draw(ctx: CanvasRenderingContext2D, t: number) {
    const moving = this.kind === "moving";
    const pulseR = 1 + this.pulse * 0.6;
    const baseR = 9;

    const emphasis = Math.max(this.highlight, this.perfectGlow);
    const perfect = this.perfectGlow > 0.02;
    const core = perfect ? theme.anchorPerfect : theme.anchor;

    // Soft outer aura (additive bloom). Gentle by default, a touch stronger at
    // night so anchors read like lanterns; brighter when a grab candidate.
    const aura = 22 + emphasis * 30 + this.pulse * 28;
    const baseGlow = 0.26 + theme.night * 0.18 + emphasis * 0.4;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(this.x, this.y, 2, this.x, this.y, aura);
    g.addColorStop(0, hexA(core, baseGlow));
    g.addColorStop(1, hexA(core, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, this.y, aura, 0, TAU);
    ctx.fill();
    ctx.restore();

    // Rotating ring (gives anchors a living, mechanical feel).
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(t * (moving ? 1.6 : 0.8) + this.x * 0.01);
    ctx.strokeStyle = hexA(theme.anchorRing, 0.85);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    const ringR = 15 * pulseR;
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * TAU + 0.25;
      const a1 = a0 + TAU * 0.16;
      ctx.moveTo(Math.cos(a0) * ringR, Math.sin(a0) * ringR);
      ctx.arc(0, 0, ringR, a0, a1);
    }
    ctx.stroke();
    ctx.restore();

    // Solid core.
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(this.x, this.y, baseR * pulseR, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(this.x - 2, this.y - 2, baseR * pulseR * 0.4, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (moving) {
      // Little orbit dots to telegraph movement.
      ctx.fillStyle = hexA(theme.anchorRing, 0.5);
      for (let i = 0; i < 2; i++) {
        const a = t * 2.2 + i * Math.PI;
        ctx.beginPath();
        ctx.arc(this.x + Math.cos(a) * 24, this.y + Math.sin(a) * 24, 2.2, 0, TAU);
        ctx.fill();
      }
    }
  }
}

// Colour + alpha -> rgba() string. Handles both "#rrggbb" and "rgb()/rgba()"
// inputs so it works with static palettes and the live (interpolated) theme.
export function hexA(color: string, a: number): string {
  let r: number, g: number, b: number;
  if (color[0] === "#") {
    const h = color.slice(1);
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  } else {
    const m = color.match(/[\d.]+/g);
    r = m ? +m[0] : 0;
    g = m ? +m[1] : 0;
    b = m ? +m[2] : 0;
  }
  return `rgba(${r},${g},${b},${a})`;
}
