// The base monkey: a jointed body every monkey is built on. A skeleton of
// points in the body's own frame (units of the player radius; +x is the way
// it faces, -y is up), two poses, and the drawing — in the game's flat,
// soft style, the same shapes and colours as the Monkey King (its very head,
// round-capped limbs ending in a dot, one body ellipse, one tail stroke).
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
import { drawMonkeyHead } from "./drawMonkey";

export interface MonkeyStyle {
  fur: string;
  furDark: string;
  face: string;
}

/** The plain monkey's coat: the Monkey King's own colours. */
export const PLAIN_MONKEY_STYLE: MonkeyStyle = {
  fur: "#8B5E34",
  furDark: "#5C3A1E",
  face: "#C9956A",
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
    head: { x: 1.0, y: -0.36 },
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
    head: { x: 0.6, y: -0.98 },
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

  // Each pose solves its own elbows and knees with its own natural bends
  // (in flight the reaching arms bend out ahead and the trailing legs bend
  // down; hanging, a free arm bends back and the knees forward), and the two
  // solutions blend, so no joint flips to its other side mid-grab.
  type Limbs = { ns: P; ne: P; nh: P; fs: P; fe: P; fh: P; nhip: P; nk: P; nf: P; fhip: P; fk: P; ff: P };
  const solve = (q: typeof fly, hanging: boolean): Limbs => {
    const nArm = joint(q.nearShoulder, q.nearHand, UPPER_ARM, FOREARM, hanging ? (input.gripNear ? -1 : 1) : -1);
    const fArm = joint(q.farShoulder, q.farHand, UPPER_ARM, FOREARM, hanging ? (input.gripNear ? 1 : -1) : -1);
    const nLeg = joint(q.nearHip, q.nearFoot, THIGH, SHIN, hanging ? -1 : 1);
    const fLeg = joint(q.farHip, q.farFoot, THIGH, SHIN, hanging ? -1 : 1);
    return {
      ns: q.nearShoulder, ne: nArm.mid, nh: nArm.end,
      fs: q.farShoulder, fe: fArm.mid, fh: fArm.end,
      nhip: q.nearHip, nk: nLeg.mid, nf: nLeg.end,
      fhip: q.farHip, fk: fLeg.mid, ff: fLeg.end,
    };
  };
  const a = solve(fly, false);
  const b = solve(hangPose, true);
  const L = (k: keyof Limbs) => lerpP(a[k], b[k], t);

  return {
    rot,
    chest: pick("chest"),
    pelvis: pick("pelvis"),
    head: pick("head"),
    headTilt: lerp(fly.headTilt, hangPose.headTilt, t),
    nearShoulder: L("ns"),
    nearElbow: L("ne"),
    nearHand: L("nh"),
    farShoulder: L("fs"),
    farElbow: L("fe"),
    farHand: L("fh"),
    nearHip: L("nhip"),
    nearKnee: L("nk"),
    nearFoot: L("nf"),
    farHip: L("fhip"),
    farKnee: L("fk"),
    farFoot: L("ff"),
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

/**
 * A two-bone limb in the Monkey King's style: one round-capped stroke per
 * bone, the same width throughout, and a dot for the hand or foot.
 */
function limb(ctx: CanvasRenderingContext2D, a: P, b: P, c: P, width: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(c.x, c.y, width * 0.62, 0, TAU);
  ctx.fill();
}

/**
 * Draw the rig in the current transform (origin at the body's centre, not
 * yet rotated: the rig's own rotation is applied here).
 */
export function drawMonkeyRig(ctx: CanvasRenderingContext2D, rig: Rig, style: MonkeyStyle) {
  const r = CONFIG.player.radius;
  const S = (p: P): P => ({ x: p.x * r, y: p.y * r });
  const fur = hexA(style.fur, 0.98);
  const furDark = hexA(style.furDark, 0.94);

  ctx.save();
  ctx.rotate(rig.rot);

  // Tail: one round-capped stroke from the rump, like the Monkey King's.
  {
    const [p0, p1, p2, p3] = rig.tail.map(S);
    ctx.strokeStyle = furDark;
    ctx.lineWidth = r * 0.26;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    ctx.stroke();
  }

  // The far leg and arm, in the darker fur, behind the body.
  limb(ctx, S(rig.farHip), S(rig.farKnee), S(rig.farFoot), r * 0.27, furDark);
  limb(ctx, S(rig.farShoulder), S(rig.farElbow), S(rig.farHand), r * 0.24, furDark);

  // Body: one soft ellipse along the spine.
  {
    const c = S(rig.chest);
    const p = S(rig.pelvis);
    const len = Math.hypot(p.x - c.x, p.y - c.y);
    const ang = Math.atan2(p.y - c.y, p.x - c.x) - Math.PI / 2;
    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.ellipse((c.x + p.x) / 2, (c.y + p.y) / 2, r * 0.68, len / 2 + r * 0.4, ang, 0, TAU);
    ctx.fill();
  }

  // The near leg, the head (the Monkey King's own), the near arm.
  limb(ctx, S(rig.nearHip), S(rig.nearKnee), S(rig.nearFoot), r * 0.3, fur);
  ctx.save();
  ctx.translate(rig.head.x * r, rig.head.y * r);
  ctx.rotate(rig.headTilt);
  drawMonkeyHead(ctx, r, 0, 0, fur, style.face);
  ctx.restore();
  limb(ctx, S(rig.nearShoulder), S(rig.nearElbow), S(rig.nearHand), r * 0.27, fur);

  ctx.restore();
}
