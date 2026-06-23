import { CONFIG } from "../core/config";
import { TAU } from "../core/math";
import { hexA } from "../entities/anchor";

export const NYAN_RAINBOW = [
  "#ff3232",
  "#ff9a00",
  "#ffef00",
  "#00e676",
  "#00b0ff",
  "#d500f9",
] as const;

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rad: number
) {
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

/** Procedural Nyan Cat — pop-tart body + gray cat, facing right. */
export function drawNyanCat(ctx: CanvasRenderingContext2D, time: number) {
  const r = CONFIG.player.radius;
  const tartW = r * 2.55;
  const tartH = r * 0.92;
  const tartX = -tartW * 0.48;
  const tartY = r * 0.08;

  // Pop-tart base.
  ctx.fillStyle = hexA("#ffc4e0", 0.98);
  roundRect(ctx, tartX, tartY, tartW, tartH, r * 0.14);
  ctx.fill();
  ctx.strokeStyle = hexA("#ff8fbf", 0.85);
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Sprinkles.
  const sprinkles: [number, number, string][] = [
    [tartX + tartW * 0.18, tartY + tartH * 0.35, "#ff5252"],
    [tartX + tartW * 0.35, tartY + tartH * 0.62, "#ffd740"],
    [tartX + tartW * 0.52, tartY + tartH * 0.28, "#69f0ae"],
    [tartX + tartW * 0.68, tartY + tartH * 0.55, "#448aff"],
    [tartX + tartW * 0.82, tartY + tartH * 0.38, "#ffffff"],
    [tartX + tartW * 0.42, tartY + tartH * 0.48, "#ff5252"],
  ];
  for (const [sx, sy, col] of sprinkles) {
    ctx.fillStyle = hexA(col, 0.95);
    ctx.fillRect(sx, sy, r * 0.11, r * 0.05);
  }

  // Cat torso on the tart.
  const bodyX = tartX + tartW * 0.38;
  const bodyY = tartY - r * 0.08;
  ctx.fillStyle = hexA("#b0b0b0", 0.98);
  ctx.beginPath();
  ctx.ellipse(bodyX, bodyY, r * 0.72, r * 0.48, 0, 0, TAU);
  ctx.fill();

  // Head (front / right).
  const headX = bodyX + r * 0.62;
  const headY = bodyY - r * 0.12;
  const headR = r * 0.52;
  ctx.beginPath();
  ctx.arc(headX, headY, headR, 0, TAU);
  ctx.fill();

  // Ears.
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(headX + side * headR * 0.35, headY - headR * 0.55);
    ctx.lineTo(headX + side * headR * 0.85, headY - headR * 1.05);
    ctx.lineTo(headX + side * headR * 0.15, headY - headR * 0.35);
    ctx.closePath();
    ctx.fill();
  }

  // Pink cheeks.
  ctx.fillStyle = hexA("#ffb0c8", 0.75);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(headX + side * headR * 0.42, headY + headR * 0.12, r * 0.14, 0, TAU);
    ctx.fill();
  }

  // Nyan eyes — vertical happy slits.
  ctx.strokeStyle = hexA("#2a2a2a", 0.9);
  ctx.lineWidth = 1.4;
  ctx.lineCap = "round";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(headX + side * headR * 0.28, headY - headR * 0.08);
    ctx.lineTo(headX + side * headR * 0.28, headY + headR * 0.22);
    ctx.stroke();
  }

  // Tiny nose.
  ctx.fillStyle = hexA("#ffb0c8", 0.9);
  ctx.beginPath();
  ctx.arc(headX + headR * 0.08, headY + headR * 0.08, r * 0.06, 0, TAU);
  ctx.fill();

  // Tail (back / left).
  ctx.strokeStyle = hexA("#b0b0b0", 0.98);
  ctx.lineWidth = r * 0.28;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(bodyX - r * 0.55, bodyY);
  ctx.quadraticCurveTo(bodyX - r * 1.15, bodyY - r * 0.35, bodyX - r * 0.95, bodyY - r * 0.75);
  ctx.stroke();

  // Dangling legs.
  const legPhase = time * 14;
  ctx.lineWidth = r * 0.18;
  for (let i = 0; i < 2; i++) {
    const lx = tartX + tartW * (0.32 + i * 0.22);
    const ly = tartY + tartH;
    const kick = Math.sin(legPhase + i * Math.PI) * r * 0.22;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(lx + kick * 0.3, ly + r * 0.38 + Math.abs(kick) * 0.2);
    ctx.stroke();
  }
}
