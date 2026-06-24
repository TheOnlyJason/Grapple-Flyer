import { CONFIG } from "../core/config";
import { TAU } from "../core/math";

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
  const k = Math.min(rad, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.lineTo(x + w - k, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + k);
  ctx.lineTo(x + w, y + h - k);
  ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
  ctx.lineTo(x + k, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - k);
  ctx.lineTo(x, y + k);
  ctx.quadraticCurveTo(x, y, x + k, y);
  ctx.closePath();
}

/**
 * Procedural Nyan Cat — the classic frosted pop-tart body with a gray cat
 * head, ears, four dangling legs and a tail, facing right. Chunky dark
 * outlines keep the pixel-art read at small sizes.
 */
export function drawNyanCat(ctx: CanvasRenderingContext2D, time: number) {
  const r = CONFIG.player.radius;
  const px = r / 8; // chunky "pixel" unit

  const OUTLINE = "#2b2b33";
  const GRAY = "#9b9b9b";
  const GRAY_D = "#7c7c7c";
  const CRUST = "#f5c178"; // tan pastry edge
  const FROST = "#ff9ed8"; // pink frosting
  const DOT = "#ff3ea5"; // magenta sprinkle
  const CHEEK = "#ff8ec6";

  // --- Pop-tart body (shifted left so the head pokes out the right) ---
  const bw = r * 1.95;
  const bh = r * 1.5;
  const bx = -r * 1.5;
  const by = -bh / 2;
  const rad = r * 0.2;

  // --- Tail (back / left), drawn first so it sits behind the body ---
  const wag = Math.sin(time * 6) * px * 1.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(bx + px * 2, by + bh * 0.55);
  ctx.quadraticCurveTo(
    bx - r * 0.55,
    by + bh * 0.5 + wag,
    bx - r * 0.62,
    by + bh * 0.1 + wag
  );
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = px * 4;
  ctx.stroke();
  ctx.strokeStyle = GRAY;
  ctx.lineWidth = px * 2.4;
  ctx.stroke();

  // --- Four dangling legs (behind the tart) ---
  const legPhase = time * 12;
  const legW = px * 2.4;
  const legTop = by + bh - px * 2;
  for (let i = 0; i < 4; i++) {
    const lx = bx + bw * (0.18 + i * 0.2);
    const lh = r * 0.62 + Math.sin(legPhase + i * 1.3) * px * 1.6;
    ctx.fillStyle = OUTLINE;
    roundRect(ctx, lx - px * 0.5, legTop, legW + px, lh + px, px * 1.2);
    ctx.fill();
    ctx.fillStyle = GRAY_D;
    roundRect(ctx, lx, legTop, legW, lh, px);
    ctx.fill();
  }

  // --- Pop-tart: dark outline, tan crust, pink frosting inset ---
  ctx.fillStyle = OUTLINE;
  roundRect(ctx, bx - px, by - px, bw + px * 2, bh + px * 2, rad + px);
  ctx.fill();
  ctx.fillStyle = CRUST;
  roundRect(ctx, bx, by, bw, bh, rad);
  ctx.fill();
  const inset = px * 2;
  ctx.fillStyle = FROST;
  roundRect(ctx, bx + inset, by + inset, bw - inset * 2, bh - inset * 2, rad * 0.7);
  ctx.fill();

  // Sprinkles — evenly spaced magenta squares across the frosting.
  ctx.fillStyle = DOT;
  const sq = px * 1.5;
  const gx0 = bx + inset * 1.6;
  const gy0 = by + inset * 1.6;
  const gw = bw - inset * 3.2;
  const gh = bh - inset * 3.2;
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 3; j++) {
      if ((i + j) % 2 === 1) continue;
      const sx = gx0 + ((i + 0.5) / 5) * gw - sq / 2;
      const sy = gy0 + ((j + 0.5) / 3) * gh - sq / 2;
      ctx.fillRect(sx, sy, sq, sq);
    }
  }

  // --- Head (front / right), overlapping the tart's right edge ---
  const hw = r * 1.0;
  const hh = r * 0.95;
  const hx = bx + bw - px * 2.5; // head left edge
  const hyTop = -hh / 2 - px;

  // Ears (drawn before head so the base tucks under the head outline).
  const ear = (cxRatio: number) => {
    const cx = hx + hw * cxRatio;
    ctx.fillStyle = OUTLINE;
    ctx.beginPath();
    ctx.moveTo(cx - px * 2.4, hyTop + px * 2);
    ctx.lineTo(cx, hyTop - r * 0.34);
    ctx.lineTo(cx + px * 2.4, hyTop + px * 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = GRAY;
    ctx.beginPath();
    ctx.moveTo(cx - px * 1.5, hyTop + px * 2);
    ctx.lineTo(cx, hyTop - r * 0.34 + px * 1.6);
    ctx.lineTo(cx + px * 1.5, hyTop + px * 2);
    ctx.closePath();
    ctx.fill();
  };
  ear(0.32);
  ear(0.72);

  // Head block.
  ctx.fillStyle = OUTLINE;
  roundRect(ctx, hx - px, hyTop, hw + px * 2, hh + px * 2, r * 0.28 + px);
  ctx.fill();
  ctx.fillStyle = GRAY;
  roundRect(ctx, hx, hyTop + px, hw, hh, r * 0.28);
  ctx.fill();

  // Rosy cheeks.
  ctx.fillStyle = CHEEK;
  for (const cxr of [0.3, 0.84]) {
    ctx.beginPath();
    ctx.arc(hx + hw * cxr, hyTop + hh * 0.66, r * 0.12, 0, TAU);
    ctx.fill();
  }

  // Eyes — black ovals with a white catch-light.
  const eyeR = r * 0.1;
  const eyeY = hyTop + hh * 0.46;
  for (const exr of [0.42, 0.74]) {
    const ex = hx + hw * exr;
    ctx.fillStyle = OUTLINE;
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeR, eyeR * 1.25, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(ex - eyeR * 0.35, eyeY - eyeR * 0.45, eyeR * 0.42, 0, TAU);
    ctx.fill();
  }

  // Little cat mouth (a soft downward "v").
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = px * 0.9;
  ctx.lineCap = "round";
  const mx = hx + hw * 0.58;
  const my = hyTop + hh * 0.74;
  ctx.beginPath();
  ctx.moveTo(mx - px * 1.6, my - px);
  ctx.lineTo(mx, my);
  ctx.lineTo(mx + px * 1.6, my - px);
  ctx.stroke();
}
