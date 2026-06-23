import { CONFIG } from "../core/config";
import { TAU } from "../core/math";
import { hexA } from "../entities/anchor";

export type LatchArm = "right" | "left";

/** Vertical offset applied so the monkey sits on the nimbus deck. */
export function monkeySitLift(): number {
  return CONFIG.player.radius * 0.34;
}

export function monkeyShoulder(latchArm: LatchArm): { x: number; y: number } {
  const r = CONFIG.player.radius;
  const lift = monkeySitLift();
  return {
    x: latchArm === "right" ? r * 0.12 : -r * 0.12,
    y: -r * 0.2 - lift,
  };
}

export interface MonkeyPose {
  menuPreview: boolean;
  swing?: {
    latchArm: LatchArm;
    latchAngle: number;
    latchLength: number;
  };
}

function armAngles(
  pose: MonkeyPose
): { right: number; left: number; rightLen: number; leftLen: number } {
  const r = CONFIG.player.radius;
  const defaultLen = r * 1.05;
  // Relaxed seated pose — hands at sides while riding the nimbus.
  const armRest = 0.42;

  if (pose.swing) {
    const { latchArm, latchAngle, latchLength } = pose.swing;
    if (latchArm === "right") {
      return {
        right: latchAngle,
        left: armRest,
        rightLen: latchLength,
        leftLen: defaultLen,
      };
    }
    return {
      right: armRest,
      left: latchAngle,
      rightLen: defaultLen,
      leftLen: latchLength,
    };
  }

  return {
    right: armRest,
    left: armRest,
    rightLen: defaultLen,
    leftLen: defaultLen,
  };
}

function drawLimb(
  ctx: CanvasRenderingContext2D,
  shoulderX: number,
  shoulderY: number,
  angle: number,
  length: number,
  thickness: number,
  color: string
) {
  ctx.save();
  ctx.translate(shoulderX, shoulderY);
  ctx.rotate(angle);
  ctx.strokeStyle = color;
  ctx.lineWidth = thickness;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, length);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, length, thickness * 0.62, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// Cauliflower-style puff layout — flat riding deck on top, lumpy underside.
const NIMBUS_PUFFS: { dx: number; dy: number; r: number; layer: number }[] = [
  { dx: 0, dy: -0.08, r: 0.52, layer: 0 },
  { dx: -0.42, dy: -0.04, r: 0.44, layer: 0 },
  { dx: 0.44, dy: -0.02, r: 0.46, layer: 0 },
  { dx: -0.18, dy: -0.18, r: 0.48, layer: 0 },
  { dx: 0.2, dy: -0.15, r: 0.4, layer: 0 },
  { dx: -0.72, dy: 0.06, r: 0.34, layer: 1 },
  { dx: 0.74, dy: 0.08, r: 0.32, layer: 1 },
  { dx: -0.52, dy: 0.14, r: 0.38, layer: 1 },
  { dx: 0.08, dy: 0.12, r: 0.42, layer: 1 },
  { dx: 0.52, dy: 0.16, r: 0.36, layer: 1 },
  { dx: -0.28, dy: 0.22, r: 0.3, layer: 2 },
  { dx: 0.32, dy: 0.24, r: 0.28, layer: 2 },
  { dx: -0.88, dy: 0.1, r: 0.26, layer: 2 },
  { dx: 0.9, dy: 0.12, r: 0.24, layer: 2 },
];

function drawGoldenPuff(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  alpha: number,
  bright = false
) {
  const highlight = bright ? "#fffce8" : "#fff6a8";
  const core = bright ? "#ffe850" : "#ffd830";
  const g = ctx.createRadialGradient(
    cx,
    cy - radius * 0.38,
    radius * 0.06,
    cx,
    cy + radius * 0.14,
    radius
  );
  g.addColorStop(0, hexA(highlight, 0.98 * alpha));
  g.addColorStop(0.38, hexA(core, 0.88 * alpha));
  g.addColorStop(0.72, hexA("#ffb820", 0.45 * alpha));
  g.addColorStop(1, hexA("#ff9800", 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
  ctx.fill();
}

// Golden Flying Nimbus — fluffy cauliflower cloud the monkey rides.
function drawFlyingNimbus(ctx: CanvasRenderingContext2D, time: number, r: number) {
  const bob = Math.sin(time * 4.2) * r * 0.035;
  const cy = r * 1.02 + bob;
  const span = r * 1.38;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const glow = ctx.createRadialGradient(0, cy, r * 0.2, 0, cy, r * 3.2);
  glow.addColorStop(0, hexA("#fff090", 0.26));
  glow.addColorStop(0.55, hexA("#ffc820", 0.1));
  glow.addColorStop(1, hexA("#ff9800", 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(0, cy, r * 2.9, r * 1.15, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  for (const p of NIMBUS_PUFFS) {
    if (p.layer === 0) continue;
    drawGoldenPuff(
      ctx,
      p.dx * span,
      cy + p.dy * r,
      p.r * r,
      p.layer === 2 ? 0.72 : 0.82
    );
  }

  for (const p of NIMBUS_PUFFS) {
    if (p.layer !== 0) continue;
    drawGoldenPuff(ctx, p.dx * span, cy + p.dy * r, p.r * r, 0.94);
  }

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  drawGoldenPuff(ctx, -span * 0.18, cy - r * 0.24, r * 0.34, 0.55, true);
  drawGoldenPuff(ctx, span * 0.12, cy - r * 0.2, r * 0.26, 0.42, true);
  ctx.restore();
}

function drawMonkeyCrown(ctx: CanvasRenderingContext2D, r: number) {
  const hx = r * 0.38;
  const hy = -r * 0.72;
  const headR = r * 0.62;
  const bandY = hy - headR * 0.52;

  const gold = "#ffd830";
  const goldDark = "#b87808";

  ctx.fillStyle = hexA(goldDark, 0.95);
  ctx.beginPath();
  ctx.ellipse(hx, bandY + r * 0.02, headR * 0.5, r * 0.1, 0, 0, TAU);
  ctx.fill();

  ctx.fillStyle = hexA(gold, 0.98);
  ctx.beginPath();
  ctx.ellipse(hx, bandY, headR * 0.46, r * 0.065, 0, 0, TAU);
  ctx.fill();

  for (const t of [-0.38, -0.18, 0, 0.18, 0.38]) {
    const px = hx + t * headR * 0.88;
    const ph = r * (0.11 + (1 - Math.abs(t) * 1.6) * 0.07);
    ctx.fillStyle = hexA(gold, 0.98);
    ctx.beginPath();
    ctx.moveTo(px - r * 0.055, bandY - r * 0.02);
    ctx.lineTo(px, bandY - ph);
    ctx.lineTo(px + r * 0.055, bandY - r * 0.02);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = hexA("#d42020", 0.92);
  ctx.beginPath();
  ctx.arc(hx, bandY + r * 0.01, r * 0.048, 0, TAU);
  ctx.fill();
  ctx.fillStyle = hexA("#ff9898", 0.65);
  ctx.beginPath();
  ctx.arc(hx - r * 0.012, bandY - r * 0.012, r * 0.016, 0, TAU);
  ctx.fill();
}

function drawMonkeyBody(ctx: CanvasRenderingContext2D, pose: MonkeyPose) {
  const r = CONFIG.player.radius;
  const fur = "#8B5E34";
  const furDark = "#5C3A1E";
  const face = "#C9956A";
  const furA = hexA(fur, 0.98);
  const furDarkA = hexA(furDark, 0.94);

  const arms = armAngles(pose);
  const rightShoulder: [number, number] = [r * 0.12, -r * 0.2];
  const leftShoulder: [number, number] = [-r * 0.12, -r * 0.2];

  // Tail.
  ctx.strokeStyle = furDarkA;
  ctx.lineWidth = r * 0.28;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-r * 0.75, r * 0.15);
  ctx.quadraticCurveTo(-r * 1.45, r * 0.55, -r * 1.25, -r * 0.35);
  ctx.stroke();

  // Body.
  ctx.fillStyle = furA;
  ctx.beginPath();
  ctx.ellipse(-r * 0.05, r * 0.12, r * 0.82, r * 0.98, 0, 0, TAU);
  ctx.fill();

  // Back arm (left when facing right).
  drawLimb(
    ctx,
    leftShoulder[0],
    leftShoulder[1],
    arms.left,
    arms.leftLen,
    r * 0.24,
    furDarkA
  );

  // Head.
  ctx.fillStyle = furA;
  ctx.beginPath();
  ctx.arc(r * 0.38, -r * 0.72, r * 0.62, 0, TAU);
  ctx.fill();

  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(r * 0.38 + side * r * 0.48, -r * 0.98, r * 0.22, 0, TAU);
    ctx.fill();
  }

  ctx.fillStyle = hexA(face, 0.95);
  ctx.beginPath();
  ctx.ellipse(r * 0.58, -r * 0.66, r * 0.3, r * 0.36, 0.15, 0, TAU);
  ctx.fill();

  ctx.fillStyle = hexA("#1a1220", 0.85);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(r * 0.52 + side * r * 0.16, -r * 0.74, r * 0.07, 0, TAU);
    ctx.fill();
  }

  drawMonkeyCrown(ctx, r);

  // Front / latch arm (right).
  drawLimb(
    ctx,
    rightShoulder[0],
    rightShoulder[1],
    arms.right,
    arms.rightLen,
    r * 0.27,
    furA
  );

  ctx.fillStyle = hexA(furDark, 0.88);
  ctx.beginPath();
  ctx.ellipse(-r * 0.28, r * 0.72, r * 0.22, r * 0.34, 0.35, 0, TAU);
  ctx.ellipse(r * 0.18, r * 0.78, r * 0.2, r * 0.3, -0.2, 0, TAU);
  ctx.fill();
}

export function drawMonkey(
  ctx: CanvasRenderingContext2D,
  time: number,
  pose: MonkeyPose
) {
  const r = CONFIG.player.radius;
  drawFlyingNimbus(ctx, time, r);

  ctx.save();
  ctx.translate(0, -r * 0.34);
  drawMonkeyBody(ctx, pose);
  ctx.restore();
}

export function computeLatchArmAngle(
  anchorX: number,
  anchorY: number,
  playerX: number,
  playerY: number,
  bodyAngle: number,
  shoulderX: number,
  shoulderY: number
): { angle: number; length: number } {
  const r = CONFIG.player.radius;
  const dx = anchorX - playerX;
  const dy = anchorY - playerY;
  const localX = dx * Math.cos(-bodyAngle) - dy * Math.sin(-bodyAngle);
  const localY = dx * Math.sin(-bodyAngle) + dy * Math.cos(-bodyAngle);
  const toX = localX - shoulderX;
  const toY = localY - shoulderY;
  const dist = Math.hypot(toX, toY);
  return {
    angle: Math.atan2(toY, toX) - Math.PI / 2,
    length: clamp(dist * 0.92, r * 0.55, r * 1.35),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
