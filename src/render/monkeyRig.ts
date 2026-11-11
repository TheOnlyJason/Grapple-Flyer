// The base monkey: a jointed body every monkey is built on. A skeleton of
// points in the body's own frame (units of the player radius; +x is the way
// it faces, -y is up), two poses, and the drawing.
//
//   In flight it leaps: the far arm reaching forward-up past the head for the
//   next anchor, the near one forward-low, legs trailing with bent knees,
//   tail streaming.
//   On the rope it hangs from the gripping hand: the body turns so the rope
//   runs straight up through it, the gripping arm reaches overhead with its
//   shoulder lifted, the free arm hangs at the side with its shoulder
//   dropped, and the legs hang with soft knees — all of it trailing a little
//   behind the swing.
//   In a wind dash it goes long: both arms ahead, legs straight back.
//
// Arms and legs are two bones each (shoulder-elbow-hand, hip-knee-foot)
// solved for where the hand or foot should be, so elbows and knees bend the
// way a body's do. The pose is a pure function of the player's state, and
// the rope is drawn to the very hand computed here.

import { CONFIG } from "../core/config";
import { clamp, TAU } from "../core/math";
import { hexA } from "../entities/anchor";

export interface MonkeyStyle {
  fur: string;
  furDark: string;
  face: string;
  belly: string;
  hands: string;
}

/** The plain monkey's coat (the base model's own). */
export const PLAIN_MONKEY_STYLE: MonkeyStyle = {
  fur: "#8B5E34",
  furDark: "#5C3A1E",
  face: "#C9956A",
  belly: "#A97A4C",
  hands: "#6A4226",
};

type P = { x: number; y: number };

/** What the rig needs from the player. */
export interface RigInput {
  time: number;
  /** The facing angle the player keeps for flight (follows velocity). */
  angle: number;
  /** 0 = flying, 1 = hanging from the rope (eased in and out by the player). */
  hang: number;
  /** Mid wind dash. */
  dash: boolean;
  /** Unit vector from the player toward the anchor, while on a rope. */
  rope: P | null;
  /** Which arm grips: the near one (drawn in front) or the far one. */
  gripNear: boolean;
  /** Speed across the rope (signed): the limbs trail behind it. */
  swingSpeed: number;
  speed: number;
}

/** Joint positions in the body frame, plus the frame's rotation. */
export interface Rig {
  rot: number;
  chest: P;
  pelvis: P;
  head: P;
  headTilt: number;
  nearShoulder: P;
  nearElbow: P;
  nearHand: P;
  farShoulder: P;
  farElbow: P;
  farHand: P;
  nearHip: P;
  nearKnee: P;
  nearFoot: P;
  farHip: P;
  farKnee: P;
  farFoot: P;
  tail: P[];
}

// Bone lengths (units of r).
const UPPER_ARM = 0.52;
const FOREARM = 0.5;
const THIGH = 0.5;
const SHIN = 0.5;
// The gripping hand sits this far up the rope from the body's centre.
const GRIP_REACH = 1.55;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpP = (a: P, b: P, t: number): P => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
const add = (a: P, dx: number, dy: number): P => ({ x: a.x + dx, y: a.y + dy });
function rotateAbout(p: P, o: P, ang: number): P {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const dx = p.x - o.x;
  const dy = p.y - o.y;
  return { x: o.x + dx * c - dy * s, y: o.y + dx * s + dy * c };
}
function lerpAngle(a: number, b: number, t: number) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}

/**
 * Two-bone reach: where the elbow (or knee) goes for a root and a target.
 * `bend` +1 / -1 picks the side the joint pushes out to (relative to the
 * root-to-target line, turning clockwise in screen space for +1).
 */
function joint(root: P, target: P, a: number, b: number, bend: 1 | -1): { mid: P; end: P } {
  let dx = target.x - root.x;
  let dy = target.y - root.y;
  let d = Math.hypot(dx, dy) || 1e-6;
  const max = (a + b) * 0.995;
  if (d > max) {
    dx *= max / d;
    dy *= max / d;
    d = max;
  }
  const min = Math.abs(a - b) + 1e-3;
  if (d < min) {
    dx *= min / d;
    dy *= min / d;
    d = min;
  }
  const along = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - along * along));
  const ux = dx / d;
  const uy = dy / d;
  const mid = { x: root.x + ux * along - uy * h * bend, y: root.y + uy * along + ux * h * bend };
  return { mid, end: { x: root.x + dx, y: root.y + dy } };
}

/** The pose for the player's state. */
export function solveMonkeyRig(input: RigInput): Rig {
  const { time, hang, dash } = input;
  const ripple = Math.sin(time * 9);
  const breathe = Math.sin(time * 4.2);
  // Limbs trail behind the swing: positive when swinging forward.
  const trail = clamp(input.swingSpeed / 1500, -1, 1);

  // --- Flight (a leap) -------------------------------------------------------
  const fly = {
    chest: { x: 0.36, y: -0.06 },
    pelvis: { x: -0.42, y: 0.08 },
    head: { x: 1.02, y: -0.34 },
    headTilt: -0.12,
    nearShoulder: { x: 0.52, y: -0.26 },
    farShoulder: { x: 0.36, y: -0.24 },
    // The far arm reaches forward-up past the head (drawn behind it), the
    // near one forward-low under the chin, so neither crosses the face.
    nearHand: dash ? { x: 1.84, y: 0.02 } : { x: 1.4, y: 0.24 - 0.05 * ripple },
    farHand: dash ? { x: 1.9, y: -0.3 } : { x: 1.66, y: -0.9 + 0.06 * ripple },
    nearHip: { x: -0.56, y: 0.22 },
    farHip: { x: -0.48, y: 0.18 },
    nearFoot: dash ? { x: -1.6, y: 0.14 } : { x: -1.42, y: 0.5 + 0.08 * ripple },
    farFoot: dash ? { x: -1.55, y: 0.3 } : { x: -1.2, y: 0.72 - 0.08 * ripple },
    tail: dash
      ? [{ x: -0.82, y: 0.0 }, { x: -1.4, y: -0.12 }, { x: -1.95, y: -0.08 }, { x: -2.3, y: -0.16 }]
      : [
          { x: -0.82, y: 0.0 },
          { x: -1.35, y: -0.32 + 0.1 * ripple },
          { x: -1.9, y: -0.1 - 0.12 * ripple },
          { x: -2.12, y: -0.42 },
        ],
  };

  // --- Hanging from the rope -------------------------------------------------
  // Frame: the rope runs straight up the body (local -y) to the hand.
  const sway = 0.35 * trail; // the free limbs lag the swing (positive turns a hanging limb back)
  const gripRaise = -0.14; // the gripping shoulder lifts toward the hand
  const freeDrop = 0.08; // the free one settles down
  const nearS = { x: 0.06, y: -0.58 + (input.gripNear ? gripRaise : freeDrop) };
  const farS = { x: -0.1, y: -0.55 + (input.gripNear ? freeDrop : gripRaise) };
  // The hand is straight above its shoulder, so the rope, the arm and the
  // body line up the way a hanging body does.
  const grip = { x: (input.gripNear ? nearS.x : farS.x) - 0.02, y: -GRIP_REACH };
  const freeHand = (s: P) => rotateAbout(add(s, 0.16, 0.92 + 0.02 * breathe), s, sway);
  const hips = { near: { x: 0.08, y: 0.58 }, far: { x: -0.06, y: 0.56 } };
  const footHang = (h: P, fwd: number) => rotateAbout(add(h, fwd, 0.9), h, sway * 0.8);
  const tailHang = (base: P) => [
    base,
    rotateAbout({ x: -0.72, y: 1.0 }, base, sway),
    rotateAbout({ x: -0.5, y: 1.58 }, base, sway * 1.4),
    rotateAbout({ x: -0.1, y: 1.72 }, base, sway * 1.6),
  ];
  const hangPose = {
    chest: { x: 0.02, y: -0.32 },
    pelvis: { x: 0, y: 0.42 },
    // The head sits forward of the raised arm, a little down: it looks ahead
    // past the arm rather than up into it.
    head: { x: 0.5, y: -0.92 },
    headTilt: 0.18,
    nearShoulder: nearS,
    farShoulder: farS,
    nearHand: input.gripNear ? grip : freeHand(nearS),
    farHand: input.gripNear ? freeHand(farS) : grip,
    nearHip: hips.near,
    farHip: hips.far,
    nearFoot: footHang(hips.near, 0.24),
    farFoot: footHang(hips.far, 0.06),
    tail: tailHang({ x: -0.34, y: 0.52 }),
  };

  const t = clamp(hang, 0, 1);
  const pick = (k: keyof typeof fly): P => lerpP(fly[k] as P, hangPose[k] as P, t);

  // Frame rotation: flight keeps the player's facing; hanging turns the body
  // so local up runs along the rope.
  const hangRot = input.rope ? Math.atan2(input.rope.x, -input.rope.y) : input.angle;
  const rot = lerpAngle(input.angle, hangRot, t);

  const nearShoulder = pick("nearShoulder");
  const farShoulder = pick("farShoulder");
  const nearHip = pick("nearHip");
  const farHip = pick("farHip");
  // Elbows: a reaching arm bends out ahead of the line; a hanging arm bends
  // back. Knees bend forward.
  const armBend = (hangT: number): 1 | -1 => (hangT > 0.5 ? 1 : -1);
  const nearArm = joint(nearShoulder, pick("nearHand"), UPPER_ARM, FOREARM, input.gripNear ? -1 : armBend(t));
  const farArm = joint(farShoulder, pick("farHand"), UPPER_ARM, FOREARM, input.gripNear ? armBend(t) : -1);
  const nearLeg = joint(nearHip, pick("nearFoot"), THIGH, SHIN, t > 0.5 ? -1 : 1);
  const farLeg = joint(farHip, pick("farFoot"), THIGH, SHIN, t > 0.5 ? -1 : 1);

  return {
    rot,
    chest: pick("chest"),
    pelvis: pick("pelvis"),
    head: pick("head"),
    headTilt: lerp(fly.headTilt, hangPose.headTilt, t),
    nearShoulder,
    nearElbow: nearArm.mid,
    nearHand: nearArm.end,
    farShoulder,
    farElbow: farArm.mid,
    farHand: farArm.end,
    nearHip,
    nearKnee: nearLeg.mid,
    nearFoot: nearLeg.end,
    farHip,
    farKnee: farLeg.mid,
    farFoot: farLeg.end,
    tail: fly.tail.map((p, i) => lerpP(p, hangPose.tail[i], t)),
  };
}

/** Where the gripping hand is in the world (the rope is drawn to it). */
export function rigGripWorld(rig: Rig, gripNear: boolean, px: number, py: number): P {
  const r = CONFIG.player.radius;
  const h = gripNear ? rig.nearHand : rig.farHand;
  const c = Math.cos(rig.rot);
  const s = Math.sin(rig.rot);
  return { x: px + (h.x * c - h.y * s) * r, y: py + (h.x * s + h.y * c) * r };
}

// The outline every part is drawn over, so overlapping fur still reads as
// separate arms, legs and body.
const OUTLINE = "#3a2412";

function limb(
  ctx: CanvasRenderingContext2D,
  a: P,
  b: P,
  c: P,
  wa: number,
  wb: number,
  color: string,
  outline: number
) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const pass of [0, 1]) {
    ctx.strokeStyle = pass === 0 ? hexA(OUTLINE, 0.85) : color;
    const grow = pass === 0 ? outline * 2 : 0;
    ctx.lineWidth = wa + grow;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.lineWidth = wb + grow;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.stroke();
  }
}

/** A filled ellipse with the outline drawn under it. */
function blob(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot: number, color: string, outline: number) {
  ctx.fillStyle = hexA(OUTLINE, 0.85);
  ctx.beginPath();
  ctx.ellipse(x, y, rx + outline, ry + outline, rot, 0, TAU);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  ctx.fill();
}

/**
 * Draw the rig in the current transform (origin at the body's centre, not
 * yet rotated: the rig's own rotation is applied here).
 */
export function drawMonkeyRig(ctx: CanvasRenderingContext2D, rig: Rig, style: MonkeyStyle, gripNear: boolean) {
  const r = CONFIG.player.radius;
  const S = (p: P): P => ({ x: p.x * r, y: p.y * r });
  const fur = hexA(style.fur, 1);
  const furDark = hexA(style.furDark, 1);
  const hands = hexA(style.hands, 1);
  const ol = r * 0.07; // outline width

  ctx.save();
  ctx.rotate(rig.rot);

  // Tail: a tapering curve from the rump with a curl at the tip.
  {
    const [p0, p1, p2, p3] = rig.tail.map(S);
    ctx.lineCap = "round";
    const steps = 10;
    const pts: P[] = [p0];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      pts.push({
        x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
      });
    }
    for (const pass of [0, 1]) {
      ctx.strokeStyle = pass === 0 ? hexA(OUTLINE, 0.85) : furDark;
      for (let i = 1; i <= steps; i++) {
        ctx.lineWidth = r * (0.22 - 0.12 * (i / steps)) + (pass === 0 ? ol * 2 : 0);
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
    }
  }

  // Far limbs, behind the body.
  limb(ctx, S(rig.farHip), S(rig.farKnee), S(rig.farFoot), r * 0.3, r * 0.25, furDark, ol);
  limb(ctx, S(rig.farShoulder), S(rig.farElbow), S(rig.farHand), r * 0.26, r * 0.22, furDark, ol);
  blob(ctx, rig.farHand.x * r, rig.farHand.y * r, r * (gripNear ? 0.15 : 0.18), r * (gripNear ? 0.15 : 0.18), 0, hands, ol);
  blob(ctx, rig.farFoot.x * r, rig.farFoot.y * r, r * 0.19, r * 0.13, 0, hands, ol);

  // Torso: a broader chest tapering to the hips, with a lighter belly.
  {
    const c = S(rig.chest);
    const p = S(rig.pelvis);
    const ang = Math.atan2(p.y - c.y, p.x - c.x) - Math.PI / 2;
    const mid = { x: (c.x + p.x) / 2, y: (c.y + p.y) / 2 };
    const len = Math.hypot(p.x - c.x, p.y - c.y);
    // One outline under all three, then the fur, so the torso is one shape.
    ctx.fillStyle = hexA(OUTLINE, 0.85);
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, r * 0.56 + ol, r * 0.6 + ol, ang, 0, TAU);
    ctx.ellipse(p.x, p.y, r * 0.48 + ol, r * 0.52 + ol, ang, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(mid.x, mid.y, r * 0.5 + ol, len * 0.62 + ol, ang, 0, TAU);
    ctx.fill();
    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, r * 0.56, r * 0.6, ang, 0, TAU);
    ctx.ellipse(p.x, p.y, r * 0.48, r * 0.52, ang, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(mid.x, mid.y, r * 0.5, len * 0.62, ang, 0, TAU);
    ctx.fill();
    // A lighter belly on the front of the body (+x is the way it faces).
    ctx.fillStyle = hexA(style.belly, 0.9);
    ctx.beginPath();
    ctx.ellipse(mid.x + r * 0.2, mid.y + r * 0.04, r * 0.26, Math.hypot(p.x - c.x, p.y - c.y) * 0.52, ang, 0, TAU);
    ctx.fill();
  }

  // Near leg in front of the body.
  limb(ctx, S(rig.nearHip), S(rig.nearKnee), S(rig.nearFoot), r * 0.33, r * 0.28, fur, ol);
  blob(ctx, rig.nearFoot.x * r, rig.nearFoot.y * r, r * 0.21, r * 0.14, 0, hands, ol);

  // If the far arm grips, the near arm hangs in front of the head; if the
  // near arm grips it reaches up in front of it. Either way the near arm is
  // drawn after the head.
  drawHead(ctx, rig, style, r);

  limb(ctx, S(rig.nearShoulder), S(rig.nearElbow), S(rig.nearHand), r * 0.29, r * 0.25, fur, ol);
  // A rounded shoulder where the near arm meets the body (no outline: it
  // blends the arm into the torso).
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.arc(rig.nearShoulder.x * r, rig.nearShoulder.y * r, r * 0.17, 0, TAU);
  ctx.fill();
  blob(ctx, rig.nearHand.x * r, rig.nearHand.y * r, r * (gripNear ? 0.19 : 0.17), r * (gripNear ? 0.19 : 0.17), 0, hands, ol);

  ctx.restore();
}

function drawHead(ctx: CanvasRenderingContext2D, rig: Rig, style: MonkeyStyle, r: number) {
  const hx = rig.head.x * r;
  const hy = rig.head.y * r;
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(rig.headTilt);
  const fur = hexA(style.fur, 0.98);
  const R = r * 0.52;

  // Ears, then the skull, each over the outline.
  const ol = r * 0.07;
  ctx.fillStyle = hexA(OUTLINE, 0.85);
  ctx.beginPath();
  ctx.arc(0, 0, R + ol, 0, TAU);
  ctx.fill();
  for (const [ex, ey] of [[-0.62, -0.42], [0.42, -0.62]] as const) {
    ctx.beginPath();
    ctx.arc(ex * R, ey * R, R * 0.36 + ol, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = fur;
  for (const [ex, ey] of [[-0.62, -0.42], [0.42, -0.62]] as const) {
    ctx.beginPath();
    ctx.arc(ex * R, ey * R, R * 0.36, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = hexA(style.face, 0.75);
  for (const [ex, ey] of [[-0.62, -0.42], [0.42, -0.62]] as const) {
    ctx.beginPath();
    ctx.arc(ex * R, ey * R, R * 0.19, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fill();

  // Face: a heart-shaped patch toward the front, a muzzle below it.
  ctx.fillStyle = hexA(style.face, 0.96);
  ctx.beginPath();
  ctx.ellipse(R * 0.34, R * 0.02, R * 0.56, R * 0.66, 0.12, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(R * 0.58, R * 0.42, R * 0.4, R * 0.3, 0.2, 0, TAU);
  ctx.fill();

  // Brow, eyes, nostrils, mouth.
  ctx.strokeStyle = hexA(style.furDark, 0.8);
  ctx.lineWidth = R * 0.12;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(R * 0.06, -R * 0.28);
  ctx.quadraticCurveTo(R * 0.4, -R * 0.42, R * 0.78, -R * 0.24);
  ctx.stroke();
  ctx.fillStyle = hexA("#1a1220", 0.9);
  for (const ex of [0.22, 0.62]) {
    ctx.beginPath();
    ctx.arc(ex * R, -R * 0.08, R * 0.12, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = hexA("#ffffff", 0.7);
  for (const ex of [0.25, 0.65]) {
    ctx.beginPath();
    ctx.arc(ex * R, -R * 0.12, R * 0.04, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = hexA("#2a1810", 0.7);
  for (const nx of [0.7, 0.86]) {
    ctx.beginPath();
    ctx.arc(nx * R, R * 0.32, R * 0.045, 0, TAU);
    ctx.fill();
  }
  ctx.strokeStyle = hexA("#2a1810", 0.6);
  ctx.lineWidth = R * 0.06;
  ctx.beginPath();
  ctx.moveTo(R * 0.46, R * 0.56);
  ctx.quadraticCurveTo(R * 0.66, R * 0.64, R * 0.86, R * 0.52);
  ctx.stroke();
  ctx.restore();
}
