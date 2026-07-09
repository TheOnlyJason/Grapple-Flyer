import { theme, parseColor } from "../render/theme";
import { TAU } from "../core/math";
import { makeScratch } from "../render/rcache";

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
    if (!auraCyan) auraCyan = bakeGlowSprite(theme.anchor, AURA_R);
    if (!auraGold) auraGold = bakeGlowSprite(theme.anchorPerfect, AURA_R);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = baseGlow;
    ctx.drawImage(
      perfect ? auraGold : auraCyan,
      this.x - aura,
      this.y - aura,
      aura * 2,
      aura * 2
    );
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
// Called from nearly every draw routine, so it parses without regexes or
// intermediate allocations (this is a measured hot path on mobile WebKit).
export function hexA(color: string, a: number): string {
  const [r, g, b] = parseColor(color);
  return `rgba(${r},${g},${b},${a})`;
}

// --- Glow sprites ------------------------------------------------------------
// The aura colours (theme.anchor / theme.anchorPerfect / theme.collectible)
// are PALETTE constants — never theme-cycled — so the radial 1->0 falloff is
// baked once per colour instead of allocating a createRadialGradient every
// frame. drawImage scaled to the live radius + globalAlpha for intensity
// composites identically under 'lighter'. Also used by collectible.ts.
export function bakeGlowSprite(color: string, r: number): HTMLCanvasElement {
  const { canvas, ctx } = makeScratch(r * 2, r * 2);
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, hexA(color, 1));
  g.addColorStop(1, hexA(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, TAU);
  ctx.fill();
  return canvas;
}

// Baked at 2x the max on-screen aura radius (~80 CSS px; DPR is clamped to 2)
// so the bloom stays crisp. Lazy — baked on the first draw call, never at
// import time (the headless harnesses mock document before the Game exists).
const AURA_R = 160;
let auraCyan: HTMLCanvasElement | null = null;
let auraGold: HTMLCanvasElement | null = null;
