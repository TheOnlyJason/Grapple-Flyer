import { TAU } from "../core/math";
import { makeScratch } from "../render/rcache";
import { hexA } from "./anchor";

// Power-ups are rare floating pickups. Touch one and its effect switches on:
//   magnet  — orbs and wind wisps fly to the player for a few seconds
//   barrier — a bubble that absorbs one fatal hit (a meteor, or the cloud sea)
// Add a kind here, give it a colour + icon below, and handle it in Game.
export type PowerUpKind = "magnet" | "barrier";
export const POWERUP_KINDS: PowerUpKind[] = ["magnet", "barrier"];

// Fixed colours (not theme-cycled) chosen to stay distinct from everything
// else that glows: anchors are cyan, wisps mint, orbs gold.
export const POWERUP_COLOR: Record<PowerUpKind, string> = {
  magnet: "#ff8fb1",
  barrier: "#b9a8ff",
};
export const POWERUP_NAME: Record<PowerUpKind, string> = {
  magnet: "MAGNET",
  barrier: "BARRIER",
};
export const ORB_COLOR = "#ffce6b";

// The colours above never change, so every rgba() string the draw code needs
// is built once here — nothing is allocated per frame.
const HALO: Record<PowerUpKind, string> = {
  magnet: hexA(POWERUP_COLOR.magnet, 0.2),
  barrier: hexA(POWERUP_COLOR.barrier, 0.2),
};
const ORBIT: Record<PowerUpKind, string> = {
  magnet: hexA(POWERUP_COLOR.magnet, 0.75),
  barrier: hexA(POWERUP_COLOR.barrier, 0.75),
};
const BADGE = hexA("#10143a", 0.72);
const BUBBLE_FILL = hexA(POWERUP_COLOR.barrier, 0.12);
const BUBBLE_EDGE = hexA(POWERUP_COLOR.barrier, 0.9);
const BUBBLE_GLINT = hexA("#ffffff", 0.8);

/**
 * Flat glyph for a power-up, centred on (x, y) and fitting a box of side `s`.
 * Shared by the world pickup and the HUD chip so the two always match.
 */
export function drawPowerIcon(
  ctx: CanvasRenderingContext2D,
  kind: PowerUpKind,
  x: number,
  y: number,
  s: number,
  color: string
) {
  // save/restore: the glyph sets line caps/joins, and the HUD pass draws
  // outside any other save block, where a leaked state would stick.
  ctx.save();
  if (kind === "magnet") {
    // Horseshoe: two legs joined by an arch, with pale pole tips.
    const r = s * 0.27;
    const top = y - s * 0.06;
    const foot = y + s * 0.36;
    ctx.lineWidth = s * 0.2;
    ctx.lineCap = "butt";
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - r, foot);
    ctx.lineTo(x - r, top);
    ctx.arc(x, top, r, Math.PI, 0);
    ctx.lineTo(x + r, foot);
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(x - r, foot - s * 0.15);
    ctx.lineTo(x - r, foot);
    ctx.moveTo(x + r, foot - s * 0.15);
    ctx.lineTo(x + r, foot);
    ctx.stroke();
  } else {
    // Shield: flat top, pointed base, with a pale inner chevron.
    const w = s * 0.36;
    const top = y - s * 0.38;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - w, top);
    ctx.lineTo(x + w, top);
    ctx.lineTo(x + w, y + s * 0.04);
    ctx.lineTo(x, y + s * 0.44);
    ctx.lineTo(x - w, y + s * 0.04);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = s * 0.09;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(x - w * 0.5, y - s * 0.1);
    ctx.lineTo(x, y + s * 0.14);
    ctx.lineTo(x + w * 0.5, y - s * 0.1);
    ctx.stroke();
  }
  ctx.restore();
}

// --- Orb (the currency) ------------------------------------------------------

// Built like the sky's other lights (anchors, wind wisps): a soft halo around
// a bright core, in the game's gold, with a thin ring so it reads as an orb
// rather than a wisp. Unlike those it is blended normally, not additively —
// an additive gold washes out to white on a day sky, and the currency has to
// stay recognisably gold in every light. Baked once, lazily (the headless
// harnesses mock `document` before the Game exists, so never at import).
const ORB_SPRITE_R = 72; // sprite radius; the ring sits at 1/3 of it
let orbSprite: HTMLCanvasElement | null = null;
function bakeOrbSprite(): HTMLCanvasElement {
  const R = ORB_SPRITE_R;
  const { canvas, ctx } = makeScratch(R * 2, R * 2);
  const g = ctx.createRadialGradient(R, R, 0, R, R, R);
  g.addColorStop(0, hexA(ORB_COLOR, 0.7));
  g.addColorStop(0.42, hexA(ORB_COLOR, 0.26));
  g.addColorStop(1, hexA(ORB_COLOR, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(R, R, R, 0, TAU);
  ctx.fill();
  ctx.lineWidth = R * 0.05;
  ctx.strokeStyle = ORB_COLOR;
  ctx.beginPath();
  ctx.arc(R, R, R / 3, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = "#fff0c2"; // bright core
  ctx.beginPath();
  ctx.arc(R, R, R * 0.17, 0, TAU);
  ctx.fill();
  return canvas;
}

/** A world orb whose ring has radius `r`, centred on (x, y): one sprite blit, no state changes. */
export function drawOrb(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  if (!orbSprite) orbSprite = bakeOrbSprite();
  const R = r * 3;
  ctx.drawImage(orbSprite, x - R, y - R, R * 2, R * 2);
}

/** The same orb as a flat HUD glyph (ring + core, no glow), ring radius `r`. */
export function drawOrbIcon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = ORB_COLOR;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.48, 0, TAU);
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, r * 0.2);
  ctx.strokeStyle = ORB_COLOR;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
}

// --- World pickup --------------------------------------------------------------

export const POWERUP_RADIUS = 22;

export class PowerUp {
  readonly x: number;
  y: number;
  readonly baseY: number;
  readonly kind: PowerUpKind;
  collected = false;
  private phase: number;

  constructor(x: number, y: number, kind: PowerUpKind) {
    this.x = x;
    this.y = y;
    this.baseY = y;
    this.kind = kind;
    this.phase = x * 0.03;
  }

  update(t: number) {
    if (this.collected) return;
    this.y = this.baseY + Math.sin(t * 1.6 + this.phase) * 9;
  }

  draw(ctx: CanvasRenderingContext2D, t: number) {
    if (this.collected) return;
    const col = POWERUP_COLOR[this.kind];
    const r = POWERUP_RADIUS;
    const pulse = 1 + Math.sin(t * 3 + this.phase) * 0.07;
    const { x, y } = this;

    // Soft halo, dark badge, bright ring.
    ctx.fillStyle = HALO[this.kind];
    ctx.beginPath();
    ctx.arc(x, y, r * 1.5 * pulse, 0, TAU);
    ctx.fill();
    ctx.fillStyle = BADGE;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.lineCap = "butt";
    ctx.strokeStyle = col;
    ctx.stroke();

    // Three orbiting arcs — reads as "pick me up" from across the screen.
    ctx.lineWidth = 2;
    ctx.strokeStyle = ORBIT[this.kind];
    const a0 = t * 1.4 + this.phase;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = a0 + (k * TAU) / 3;
      ctx.moveTo(x + Math.cos(a) * r * 1.3, y + Math.sin(a) * r * 1.3);
      ctx.arc(x, y, r * 1.3, a, a + 0.85);
    }
    ctx.stroke();

    drawPowerIcon(ctx, this.kind, x, y, r * 1.5, col);
  }
}

// --- Effects worn by the player ------------------------------------------------

/** Barrier bubble around the player (sits outside the smash-charge ring). */
export function drawBarrier(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  const r = 37 + Math.sin(t * 4) * 1.5;
  ctx.fillStyle = BUBBLE_FILL;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.strokeStyle = BUBBLE_EDGE;
  ctx.stroke();
  // A highlight that sweeps round the bubble.
  const a = t * 2.2;
  ctx.lineWidth = 3;
  ctx.strokeStyle = BUBBLE_GLINT;
  ctx.beginPath();
  ctx.arc(x, y, r, a, a + 0.9);
  ctx.stroke();
}

/** Magnet field: rings that shrink in toward the player, brightening as they close. */
export function drawMagnetField(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = POWERUP_COLOR.magnet;
  for (let k = 0; k < 3; k++) {
    const p = 1 - ((t * 0.9 + k / 3) % 1); // 1 → 0 as the ring closes in
    ctx.globalAlpha = (1 - p) * 0.9;
    ctx.beginPath();
    ctx.arc(x, y, 46 + p * 90, 0, TAU); // 0–26 smash ring, 37 bubble, 46+ magnet
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
