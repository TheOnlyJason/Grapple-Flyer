import { CONFIG } from "../core/config";
import { theme, mixColor } from "../render/theme";
import { getPlayerSprite, isPlayerSpriteReady, PLAYER_SPRITE } from "../render/playerAsset";
import {
  drawMonkey,
  computeLatchArmAngle,
  monkeyShoulder,
  type LatchArm,
  type MonkeyKind,
} from "../render/drawMonkey";
import { drawMonkeyRig, PLAIN_MONKEY_STYLE, rigGripWorld, solveMonkeyRig, type Rig } from "../render/monkeyRig";
import { drawNyanCat, NYAN_RAINBOW } from "../render/drawNyanCat";
import type { CharacterId } from "../characters/registry";
import { angleDelta, clamp, rad, TAU } from "../core/math";
import { makeScratch, Scratch } from "../render/rcache";
import { Anchor, hexA } from "./anchor";

export type PlayerState = "glide" | "swing" | "dash" | "skid";

export interface ReleaseInfo {
  perfect: boolean;
  quality: number; // 0..1
  speed: number;
  x: number;
  y: number;
}

export type PlayerEvent =
  | { type: "grab"; x: number; y: number; moving: boolean }
  | { type: "release"; info: ReleaseInfo }
  | { type: "dash"; x: number; y: number };

interface TrailPoint {
  x: number;
  y: number;
}

// The player: a paper airplane that converts falling momentum into swing energy, then
// slingshots it back out. This class owns all of its own physics.
export class Player {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  angle = 0; // visual facing, follows velocity
  state: PlayerState = "glide";
  characterId: CharacterId = "plane";
  alive = true;

  anchor: Anchor | null = null;
  ropeLen = 0;
  /**
   * The pause-menu option. Off: the classic rope (the 1.2 swing). On: a
   * pendulum that conserves momentum — the grab keeps the player's speed and
   * nothing but gravity, reeling, a moving pivot and tether.swingDrag changes
   * it. Nothing else differs between the two.
   */
  conserveMomentum = false;
  // Pendulum state while tethered with conserveMomentum on: angle from
  // straight below the anchor (positive toward +x) and angular velocity.
  // x/y/vx/vy are written back from these every step, so everything outside
  // the swing keeps reading plain world position and velocity.
  swingPhi = 0;
  swingOmega = 0;
  // Turned on mid-swing: the pendulum takes over from the rope's motion at
  // its first step, so turning the option on and off again within one pause
  // leaves the rope exactly as it was.
  private pendingSync = false;
  // Net angle the pendulum has turned around lapAnchor, and the laps already
  // charged for (tether.lapSpeedKeep). The count belongs to the anchor, not
  // the grab: letting go and grabbing the same anchor again carries it on.
  private lapAngle = 0;
  private lapsDone = 0;
  private lapAnchor: Anchor | null = null;
  private lapLastPhi = 0;
  // A re-grab of the anchor just let go of, within a second, is the same
  // swing: the release boost it paid out is taken back (Conserve momentum),
  // so tapping around one anchor cannot pump speed.
  private regrabAnchor: Anchor | null = null;
  private regrabBoost = 1;
  private regrabTime = 0;

  inPerfectWindow = false;
  perfectQuality = 0;
  swingTime = 0;
  dashTime = 0;
  /** Remaining hazard invulnerability after a wind dash (rocks can't kill). */
  hazardInvuln = 0;
  private grabLockout = 0; // seconds the tether refuses to attach (after a barrier bounce)
  smashGlow = false; // set by the game while the smash is charged: bigger aura + a mint ring
  /** Which arm grabs the anchor on the current swing. */
  latchArm: LatchArm = "right";
  /** Arm to use on the next anchor grab (alternates each latch). */
  private nextLatchArm: LatchArm = "right";

  readonly events: PlayerEvent[] = [];
  readonly trail: TrailPoint[] = [];

  reset(x: number, y: number, characterId: CharacterId = this.characterId) {
    this.characterId = characterId;
    this.x = x;
    this.y = y;
    this.vx = CONFIG.player.startSpeed;
    this.vy = 0;
    this.angle = 0;
    this.state = "glide";
    this.alive = true;
    this.anchor = null;
    this.ropeLen = 0;
    this.inPerfectWindow = false;
    this.perfectQuality = 0;
    this.swingTime = 0;
    this.dashTime = 0;
    this.hazardInvuln = 0;
    this.grabLockout = 0;
    this.smashGlow = false;
    this.latchArm = "right";
    this.nextLatchArm = "right";
    this.events.length = 0;
    this.trail.length = 0;
  }

  /** Start a run without moving — keeps menu glide position and velocity. */
  beginRun() {
    this.state = "glide";
    this.alive = true;
    this.anchor = null;
    this.ropeLen = 0;
    this.inPerfectWindow = false;
    this.perfectQuality = 0;
    this.swingTime = 0;
    this.dashTime = 0;
    this.hazardInvuln = 0;
    this.grabLockout = 0;
    this.smashGlow = false;
    this.latchArm = "right";
    this.nextLatchArm = "right";
    this.events.length = 0;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  /** The speed at which meteors shatter: higher with Conserve momentum on. */
  get smashThreshold(): number {
    return this.conserveMomentum ? CONFIG.player.conserveSmashSpeed : CONFIG.player.smashSpeed;
  }

  /** The tether refuses to attach right now (just after a barrier or sea bounce). */
  get grabLocked(): boolean {
    return this.grabLockout > 0;
  }

  // Pick the best anchor to tether to: nearest within range, biased forward.
  // When `view` (the camera's visible world rect) is given, only anchors the
  // player can actually SEE are eligible — latching onto something off-screen
  // always reads as a bug, never as skill.
  findGrabTarget(
    anchors: Anchor[],
    view?: { left: number; top: number; right: number; bottom: number }
  ): Anchor | null {
    let best: Anchor | null = null;
    let bestScore = Infinity;
    const range = CONFIG.tether.grabRange;
    const VIS = 12; // anchor centre must be this far inside the screen edge
    for (const a of anchors) {
      const dx = a.x - this.x;
      const dy = a.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d > range || d < 6) continue;
      if (
        view &&
        (a.x < view.left + VIS ||
          a.x > view.right - VIS ||
          a.y < view.top + VIS ||
          a.y > view.bottom - VIS)
      ) {
        continue;
      }
      let score = d;
      if (dx < 0) score += 500; // strongly discourage grabbing behind
      if (dy > 0) score += 120; // mild bias toward anchors above
      if (score < bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return best;
  }

  // `t0` is the time the anchor's current pose belongs to (the previous
  // step: the world moves anchors after the player steps).
  private grab(anchor: Anchor, t0: number) {
    this.latchArm = this.nextLatchArm;
    this.nextLatchArm = this.nextLatchArm === "right" ? "left" : "right";
    this.anchor = anchor;
    const d = Math.hypot(anchor.x - this.x, anchor.y - this.y);
    // Match the rope to the current distance so latch-on doesn't snap position.
    this.ropeLen = Math.max(d, 1e-3);
    this.pendingSync = false;
    if (this.conserveMomentum) {
      if (anchor === this.regrabAnchor && this.regrabTime > 0 && this.regrabBoost > 1) {
        this.vx /= this.regrabBoost;
        this.vy /= this.regrabBoost;
      }
      this.regrabAnchor = null;
      this.syncSwingToVelocity(anchor, t0);
    }
    this.state = "swing";
    this.swingTime = 0;
    anchor.used = true;
    anchor.pulse = 1;
    this.events.push({
      type: "grab",
      x: anchor.x,
      y: anchor.y,
      moving: anchor.kind === "moving",
    });
  }

  private release() {
    if (!this.anchor) return;
    const perfect = this.inPerfectWindow;
    const quality = this.perfectQuality;
    const before = this.speed;

    const boost = perfect ? CONFIG.tether.perfectBoost : CONFIG.tether.releaseBoost;
    this.vx *= boost;
    this.vy *= boost;
    if (perfect) {
      const s = this.speed || 1;
      this.vx += (this.vx / s) * CONFIG.tether.perfectBonusSpeed;
      this.vy += (this.vy / s) * CONFIG.tether.perfectBonusSpeed;
    }
    this.clampSpeed();
    if (this.conserveMomentum) {
      this.regrabAnchor = this.anchor;
      this.regrabBoost = before > 1e-6 ? this.speed / before : 1;
      this.regrabTime = 1;
    }

    this.events.push({
      type: "release",
      info: { perfect, quality, speed: this.speed, x: this.x, y: this.y },
    });

    this.anchor = null;
    this.state = "glide";
    this.inPerfectWindow = false;
    this.perfectQuality = 0;
  }

  startDash(): boolean {
    if (this.state === "dash") return false;
    if (this.anchor) {
      this.anchor = null;
    }
    this.state = "dash";
    this.inPerfectWindow = false; // a dash out of the window must not leave the aura gold
    this.perfectQuality = 0;
    this.dashTime = CONFIG.wind.dashDuration;
    this.hazardInvuln = CONFIG.wind.dashDuration;
    // Aim the dash mostly forward, preserving a little of the current pitch.
    const s = this.speed || 1;
    const dirY = clamp(this.vy / s, -0.3, 0.3);
    this.vx = CONFIG.wind.dashSpeed;
    this.vy = CONFIG.wind.dashSpeed * dirY;
    this.events.push({ type: "dash", x: this.x, y: this.y });
    return true;
  }

  // Main fixed-step update. `holding` drives the tether; `anchors` is the live
  // set; `view` is the camera's visible world rect (grabs are screen-gated).
  step(
    dt: number,
    holding: boolean,
    anchors: Anchor[],
    time: number,
    view?: { left: number; top: number; right: number; bottom: number }
  ) {
    if (!this.alive) return;

    if (this.hazardInvuln > 0) {
      this.hazardInvuln = Math.max(0, this.hazardInvuln - dt);
    }
    if (this.grabLockout > 0) this.grabLockout = Math.max(0, this.grabLockout - dt);
    if (this.regrabTime > 0) this.regrabTime = Math.max(0, this.regrabTime - dt);

    switch (this.state) {
      case "glide": {
        if (holding && this.grabLockout <= 0) {
          const target = this.findGrabTarget(anchors, view);
          if (target) {
            this.grab(target, time - dt);
            this.stepSwing(dt, holding, time);
            break;
          }
        }
        this.stepGlide(dt);
        break;
      }
      case "swing": {
        if (!holding) {
          this.release();
          this.stepGlide(dt);
          break;
        }
        this.stepSwing(dt, holding, time);
        break;
      }
      case "dash": {
        this.stepDash(dt);
        break;
      }
    }

    this.updateAngle(dt);
    this.recordTrail();
  }

  private stepGlide(dt: number) {
    const p = CONFIG.player;
    const g = CONFIG.world.gravityAir;
    // Lift scales with forward speed but never exceeds gravity, so a fast glide
    // flattens out (you soar) without ever climbing on its own.
    const lift = Math.min(
      Math.max(0, this.vx - p.glideLiftBaseSpeed) * p.glideLift,
      g
    );
    this.vy += (g - lift) * dt;
    this.vy -= this.vy * p.vertDrag * dt;
    this.vx += (p.cruiseSpeed - this.vx) * p.forwardDrag * dt;
    this.clampSpeed();
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  private stepSwing(dt: number, holding: boolean, time: number) {
    if (this.conserveMomentum) {
      this.stepPendulum(dt, holding, time);
      return;
    }
    const a = this.anchor;
    if (!a) return;
    this.swingTime += dt;

    // Gravity drives the pendulum.
    this.vy += CONFIG.world.gravitySwing * dt;

    // Reel in slightly while held: pumps energy and lets the player climb.
    if (holding && this.ropeLen > CONFIG.tether.minRope) {
      this.ropeLen = Math.max(
        CONFIG.tether.minRope,
        this.ropeLen - CONFIG.tether.reelRate * dt
      );
    }

    // Integrate, then enforce the rigid-rope distance constraint.
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    let dx = this.x - a.x;
    let dy = this.y - a.y;
    const d = Math.hypot(dx, dy) || 1e-6;
    const nx = dx / d;
    const ny = dy / d;

    // Position correction back onto the circle.
    this.x = a.x + nx * this.ropeLen;
    this.y = a.y + ny * this.ropeLen;

    // Remove the radial velocity component -> motion stays tangent (swinging).
    const vrad = this.vx * nx + this.vy * ny;
    this.vx -= vrad * nx;
    this.vy -= vrad * ny;

    this.clampSpeed();
    this.evaluatePerfect();
    if (this.inPerfectWindow) a.perfectGlow = 1;
  }

  /**
   * Set the pendulum state from the current position and velocity. The hook
   * is a frictionless redirect, not a rope snapping taut: the player's whole
   * speed relative to the anchor becomes swing speed, in the sense of
   * rotation the player was already moving. Nothing is lost.
   */
  private syncSwingToVelocity(anchor: Anchor, t0: number) {
    const rx = this.x - anchor.x;
    const ry = this.y - anchor.y;
    const L = Math.max(Math.hypot(rx, ry), 1e-3);
    this.ropeLen = L;
    this.swingPhi = Math.atan2(rx, ry);
    if (anchor === this.lapAnchor) {
      // Back on the same anchor: the laps carry on from where it was let go.
      this.lapAngle += angleDelta(this.lapLastPhi, this.swingPhi);
    } else {
      this.lapAnchor = anchor;
      this.lapAngle = 0;
      this.lapsDone = 0;
    }
    this.lapLastPhi = this.swingPhi;
    const tx = ry / L;
    const ty = -rx / L; // tangent of increasing phi
    const ux = this.vx;
    const uy = this.vy - anchor.vyAt(t0);
    const u = Math.hypot(ux, uy);
    if (u < 1e-6) {
      this.swingOmega = 0;
      return;
    }
    const ut = ux * tx + uy * ty;
    const s =
      Math.abs(ut) > 1e-3 * u
        ? Math.sign(ut) // keep turning the way we were going
        : Math.abs(tx) > 1e-3
        ? Math.sign(tx) // dead-on radial: take the tangent that heads forward
        : this.swingPhi !== 0
        ? -Math.sign(this.swingPhi) // level with the anchor: swing downward
        : 1;
    this.swingOmega = (s * u) / L;
  }

  /** The pause-menu switch; flipping it mid-swing keeps the motion continuous. */
  setConserveMomentum(on: boolean) {
    if (on === this.conserveMomentum) return;
    this.conserveMomentum = on;
    this.pendingSync = on && this.state === "swing" && this.anchor !== null;
  }

  // The momentum-conserving swing: a pendulum in polar form, integrated with
  // velocity Verlet. The rope is exact by construction, so no energy leaks
  // into a position snap or a velocity projection: the only things that
  // change the swing's energy are gravity, the pivot's motion, reeling in
  // (which conserves angular momentum, so a shorter rope really is faster)
  // and tether.swingDrag. Like the classic rope it has no cap: a fast swing
  // can carry the player over the top of the anchor. `time` is the end of
  // this step; the anchor's pose at the start of it is `time - dt`.
  private stepPendulum(dt: number, holding: boolean, time: number) {
    const a = this.anchor;
    if (!a) return;
    if (this.pendingSync) {
      this.pendingSync = false;
      this.syncSwingToVelocity(a, time - dt);
    }
    this.swingTime += dt;
    const T = CONFIG.tether;
    const g = CONFIG.world.gravitySwing;
    const t0 = time - dt;
    const L0 = this.ropeLen;
    let L = L0;
    let phi = this.swingPhi;
    let omega = this.swingOmega;
    // A pivot accelerating upward feels like extra gravity, and vice versa.
    const acc = (p: number, t: number) => -((g - a.ayAt(t)) / L) * Math.sin(p);

    omega += 0.5 * dt * acc(phi, t0);
    if (holding && L > T.minRope) {
      const Ln = Math.max(T.minRope, L - T.conserveReelRate * dt);
      omega *= (L / Ln) * (L / Ln); // L²ω is conserved: tangential speed scales by L/Ln
      L = Ln;
    }
    phi += omega * dt;
    // A full lap around the anchor (net, either way round) costs speed.
    this.lapAngle += omega * dt;
    const laps = Math.floor(Math.abs(this.lapAngle) / TAU);
    if (laps > this.lapsDone) {
      this.lapsDone = laps;
      omega *= T.lapSpeedKeep;
    }
    if (phi > Math.PI) phi -= TAU;
    else if (phi <= -Math.PI) phi += TAU;
    this.lapLastPhi = phi;
    omega += 0.5 * dt * acc(phi, time);
    if (T.swingDrag > 0) {
      // Exact step of ω' = -c·L·ω|ω| (quadratic air drag on the swing speed).
      omega /= 1 + T.swingDrag * L * Math.abs(omega) * dt;
    }
    const vmax = CONFIG.player.maxSpeed / L;
    if (omega > vmax) omega = vmax;
    else if (omega < -vmax) omega = -vmax;

    this.ropeLen = L;
    this.swingPhi = phi;
    this.swingOmega = omega;

    // Write back where the anchor will be once the world has moved it this step.
    const sin = Math.sin(phi);
    const cos = Math.cos(phi);
    this.x = a.x + L * sin;
    this.y = a.yAt(time) + L * cos;
    // World velocity = anchor velocity + tangential swing + the reel's inward pull.
    const reel = (L0 - L) / dt;
    this.vx = L * omega * cos - reel * sin;
    this.vy = a.vyAt(time) - L * omega * sin - reel * cos;

    this.evaluatePerfect();
    if (this.inPerfectWindow) a.perfectGlow = 1;
  }

  /** Scale the player's speed (the momentum a meteor smash scrubs); keeps a pendulum swing consistent. */
  scaleVelocity(k: number) {
    this.vx *= k;
    this.vy *= k;
    if (this.state === "swing" && this.conserveMomentum) this.swingOmega *= k;
  }

  private stepDash(dt: number) {
    this.dashTime -= dt;
    // Straight-line burst, gravity suspended.
    this.vx += (CONFIG.wind.dashSpeed - this.vx) * Math.min(1, dt * 8);
    this.vy -= this.vy * Math.min(1, dt * 8);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.dashTime <= 0) {
      this.state = "glide";
    }
  }

  // Determine whether the current swing velocity points up-and-forward enough
  // to count as a perfect release.
  private evaluatePerfect() {
    const s = this.speed;
    if (this.vx <= 0 || s < CONFIG.tether.minSwingSpeed + 180) {
      this.inPerfectWindow = false;
      this.perfectQuality = 0;
      return;
    }
    const ang = Math.atan2(this.vy, this.vx);
    const ideal = rad(CONFIG.tether.idealLaunchAngleDeg);
    const off = Math.abs(angleDelta(ang, ideal));
    const tol = rad(CONFIG.tether.perfectToleranceDeg);
    if (off <= tol) {
      this.inPerfectWindow = true;
      this.perfectQuality = 1 - off / tol;
    } else {
      this.inPerfectWindow = false;
      this.perfectQuality = 0;
    }
  }

  private clampSpeed() {
    const s = this.speed;
    if (s > CONFIG.player.maxSpeed) {
      const k = CONFIG.player.maxSpeed / s;
      this.vx *= k;
      this.vy *= k;
    }
  }

  private updateAngle(dt: number) {
    const target = clamp(Math.atan2(this.vy, this.vx), -0.82, 0.82);
    let d = angleDelta(this.angle, target);
    this.angle += d * Math.min(1, dt * 13);
  }

  private recordTrail() {
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(this.x - last.x, this.y - last.y) > 6) {
      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > CONFIG.player.trailMax) this.trail.shift();
    }
  }

  // Idle glide on the home screen — paper plane or monkey preview.
  animateMenuGlide(dt: number, time: number, startX: number) {
    this.alive = true;
    this.state = "glide";
    this.anchor = null;
    this.x = startX + time * 300;
    this.y = CONFIG.world.startY - 110 + Math.sin(time * 0.52) * 42;
    this.vx = 300;
    this.vy = Math.cos(time * 0.52) * 22;
    this.updateAngle(dt);
    this.recordTrail();
  }

  startSkid(groundY: number) {
    this.state = "skid";
    this.alive = false;
    this.anchor = null;
    this.inPerfectWindow = false;
    this.perfectQuality = 0;
    this.dashTime = 0;
    this.hazardInvuln = 0;

    const inset = CONFIG.player.radius * CONFIG.skid.groundInset;
    this.y = groundY - inset;
    if (this.vy > 0) this.vx *= 1.04;
    this.vy = 0;
  }

  // Low-friction ground slide after a crash. Returns true once stopped.
  stepSkid(dt: number, groundY: number): boolean {
    const inset = CONFIG.player.radius * CONFIG.skid.groundInset;
    this.y = groundY - inset;
    this.vy = 0;

    const decay = Math.exp(-CONFIG.skid.friction * dt);
    this.vx *= decay;
    this.x += this.vx * dt;

    const slidePitch = clamp(this.vx / 900, 0, 1) * 0.22;
    const target = slidePitch + 0.06;
    this.angle += (target - this.angle) * Math.min(1, dt * 5);
    this.recordTrail();

    return Math.abs(this.vx) < CONFIG.skid.stopSpeed;
  }

  /** Barrier save: thrown back up off the cloud sea instead of crashing. */
  bounce(groundY: number, speed: number) {
    const p = CONFIG.player;
    const smash = this.smashThreshold;
    const wasFast = this.speed >= smash;
    this.y = groundY - 2;
    this.vy = -speed;
    this.vx = Math.max(this.vx, p.cruiseSpeed * 1.25);
    if (!wasFast) {
      // The save is not a speed smash: a fast shallow entry plus the launch
      // would otherwise cross smash speed and charge it. Stay just under.
      const cap = Math.sqrt(Math.max(0, (smash - 1) ** 2 - speed * speed));
      this.vx = Math.min(this.vx, Math.max(cap, p.cruiseSpeed * 1.25));
    }
    // Fly free: a dash would flatten the launch, and a rope would haul the
    // player straight back under — and a held finger would re-grab the same
    // anchor on the very next step, hence the short lockout.
    this.state = "glide";
    this.dashTime = 0;
    this.anchor = null;
    this.inPerfectWindow = false;
    this.perfectQuality = 0;
    this.grabLockout = 0.3;
  }

  kill() {
    this.alive = false;
    this.inPerfectWindow = false;
    this.perfectQuality = 0;
  }

  drainEvents(sink: (e: PlayerEvent) => void) {
    for (const e of this.events) sink(e);
    this.events.length = 0;
  }

  // --- Rendering -----------------------------------------------------------

  // The base monkey's pose (src/render/monkeyRig.ts), solved once per draw so
  // the rope ends in the very hand that is drawn; `rigHang` eases between
  // flying (0) and hanging from the rope (1).
  private rig: Rig | null = null;
  private rigHang = 0;
  private rigTime = -1;

  private updateRig(time: number, menuPreview: boolean) {
    const dt = this.rigTime < 0 ? 0 : clamp(time - this.rigTime, 0, 0.05);
    this.rigTime = time;
    const onRope = !menuPreview && this.state === "swing" && this.anchor !== null;
    // In over about 0.12 s, out over about 0.2 s.
    this.rigHang = onRope ? Math.min(1, this.rigHang + dt / 0.12) : Math.max(0, this.rigHang - dt / 0.2);
    let rope: { x: number; y: number } | null = null;
    if (this.anchor) {
      const dx = this.anchor.x - this.x;
      const dy = this.anchor.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      rope = { x: dx / d, y: dy / d };
    }
    const angle = menuPreview ? 0 : this.angle;
    const rigProbe = solveMonkeyRig({
      time,
      angle,
      hang: this.rigHang,
      dash: this.state === "dash",
      rope,
      gripNear: this.latchArm === "right",
      swingSpeed: 0,
      speed: this.speed,
    });
    // Speed along the way the body faces: the free limbs trail behind it.
    const swingSpeed = this.vx * Math.cos(rigProbe.rot) + this.vy * Math.sin(rigProbe.rot);
    this.rig = solveMonkeyRig({
      time,
      angle,
      hang: this.rigHang,
      dash: this.state === "dash",
      rope,
      gripNear: this.latchArm === "right",
      swingSpeed,
      speed: this.speed,
    });
  }

  draw(ctx: CanvasRenderingContext2D, time: number, menuPreview = false) {
    if (this.characterId === "baseMonkey") this.updateRig(time, menuPreview);
    if (this.characterId === "plane" || this.characterId === "baseMonkey") {
      this.drawMotionTrail(ctx, time);
    } else if (this.characterId === "monkey") {
      this.drawNimbusTrail(ctx, time);
    } else if (this.characterId === "nyan") {
      this.drawRainbowTrail(ctx, time);
    }
    if (this.state === "swing" && this.anchor) this.drawTether(ctx, time);
    this.drawCharacter(ctx, time, menuPreview);
  }

  // Bright thin line trail with a soft glow at the plane and light taper.
  private drawMotionTrail(ctx: CanvasRenderingContext2D, time: number) {
    if (this.trail.length < 2 || this.speed < 80) return;

    const n = this.trail.length;
    const pts = this.trail;
    const isDash = this.state === "dash";
    const speedT = clamp(this.speed / 520, 0.45, 1);
    const lineCol = isDash ? "#eafff6" : "#ffffff";

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Bright thin core — ~1px, tapering in opacity toward the tail. The taper
    // is quantized into a few alpha buckets so each bucket strokes one
    // polyline instead of ~40 individual segments (which each cost a Gaussian
    // blur pass under the old shadowBlur — brutal on mobile WebKit).
    ctx.strokeStyle = lineCol;
    const buckets = 4;
    for (let b = 0; b < buckets; b++) {
      const p0 = Math.round(((n - 1) * b) / buckets);
      const p1 = Math.round(((n - 1) * (b + 1)) / buckets);
      if (p1 <= p0) continue;
      const t = (p0 + p1 + 1) / (2 * n); // bucket-midpoint taper
      ctx.globalAlpha = (0.1 + t * 0.9) * speedT;
      ctx.lineWidth = 0.75 + t * 0.55;
      ctx.beginPath();
      ctx.moveTo(pts[p0].x, pts[p0].y);
      for (let i = p0 + 1; i <= p1; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }

    // One wide low-alpha pass along the whole trail stands in for the old
    // per-segment shadow glow.
    ctx.globalAlpha = 0.25 * speedT;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Soft bloom where the line meets the plane.
    const head = pts[n - 1];
    const glowR = CONFIG.player.radius * (1.4 + speedT * 0.6);
    const g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, glowR);
    g.addColorStop(0, hexA(lineCol, isDash ? 0.5 : 0.38));
    g.addColorStop(1, hexA(lineCol, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(head.x, head.y, glowR, 0, TAU);
    ctx.fill();

    // Tiny sparks hugging the line near the head — one fillStyle, alpha
    // varied per spark (no per-spark rgba strings).
    ctx.fillStyle = lineCol;
    for (let i = Math.floor(n * 0.5); i < n; i++) {
      const t = i / n;
      const p = pts[i];
      const phase = i * 1.9 + time * 3;
      const jx = Math.sin(phase) * 2.5 * t;
      const jy = Math.cos(phase * 1.2) * 2.5 * t;
      ctx.globalAlpha = t * 0.45 * speedT;
      ctx.beginPath();
      ctx.arc(p.x + jx, p.y + jy, 0.7 + t * 1.2, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  }

  // Golden puff trail left behind the nimbus while flying.
  private drawNimbusTrail(ctx: CanvasRenderingContext2D, time: number) {
    if (this.trail.length < 2 || this.speed < 50) return;

    const n = this.trail.length;
    const pts = this.trail;
    const r = CONFIG.player.radius;
    const nimbusOff = r * 1.02;
    const speedT = clamp(this.speed / 520, 0.25, 1);
    const sin = Math.sin(this.angle);
    const cos = Math.cos(this.angle);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // One pre-baked puff sprite (constant colours) tinted per point via
    // globalAlpha — every gradient stop's alpha was proportional to the point
    // alpha, so this is equivalent to the old per-point radial gradients.
    const puff = getNimbusPuff().canvas;
    const half = NIMBUS_PUFF_R + NIMBUS_PUFF_PAD;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (t < 0.25) continue;
      const p = pts[i];
      const nx = p.x - nimbusOff * sin;
      const ny = p.y + nimbusOff * cos;
      const phase = i * 1.6 + time * 3.5;
      const jx = Math.sin(phase) * 3 * t;
      const jy = Math.cos(phase * 1.15) * 2.5 * t;
      const pr = r * (0.12 + t * 0.28) * speedT;
      const k = pr / NIMBUS_PUFF_R;

      ctx.globalAlpha = (1 - t) * 0.38 * speedT;
      ctx.drawImage(
        puff,
        nx + jx - half * k,
        ny + jy - half * k,
        half * 2 * k,
        half * 2 * k
      );
    }

    // Sparks alternate two constant golds — one fillStyle per parity pass,
    // alpha varied per spark (no per-spark rgba strings).
    const sparkStart = Math.floor(n * 0.35);
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass === 0 ? "#fff6a0" : "#ffc820";
      for (let i = sparkStart + ((sparkStart & 1) ^ pass); i < n; i += 2) {
        const t = i / n;
        const p = pts[i];
        const nx = p.x - nimbusOff * sin;
        const ny = p.y + nimbusOff * cos;
        const phase = i * 2.4 + time * 4.8;
        ctx.globalAlpha = t * 0.5 * speedT;
        ctx.beginPath();
        ctx.arc(
          nx + Math.sin(phase) * 4,
          ny + Math.cos(phase * 0.9) * 3,
          0.8 + t * 1.6,
          0,
          TAU
        );
        ctx.fill();
      }
    }

    ctx.restore();
  }

  // Classic Nyan Cat rainbow streamer trail.
  private drawRainbowTrail(ctx: CanvasRenderingContext2D, time: number) {
    if (this.trail.length < 2 || this.speed < 50) return;

    const n = this.trail.length;
    const pts = this.trail;
    const bandH = CONFIG.player.radius * 0.22;
    const speedT = clamp(this.speed / 520, 0.25, 1);

    // First polyline point — same cutoff as the old per-segment t < 0.2 skip.
    const first = Math.max(0, Math.ceil(n * 0.2) - 1);
    const span = n - 1 - first; // segments drawn
    if (span < 1) return;

    // Per-point unit normals, shared by all six bands (only the offset
    // magnitude differs per band). Central difference keeps the bands
    // parallel through corners; scratch arrays avoid per-frame allocation.
    if (trailNX.length < n) {
      trailNX = new Float32Array(Math.max(n, CONFIG.player.trailMax));
      trailNY = new Float32Array(trailNX.length);
    }
    for (let i = first; i < n; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      trailNX[i] = -dy / len;
      trailNY[i] = dx / len;
    }

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = bandH * 0.82;

    // Each band is one continuous offset polyline stroked in three alpha
    // chunks — 18 strokes total instead of ~200 per-segment strokes. The
    // scroll pulse depends only on time and band, so it folds into the band
    // alpha exactly; the (1 - t) taper is quantized per chunk.
    const chunks = 3;
    for (let b = 0; b < NYAN_RAINBOW.length; b++) {
      const offset = (b - (NYAN_RAINBOW.length - 1) / 2) * bandH;
      const scroll = (time * 2.4 + b * 0.15) % 1;
      const bandAlpha = 0.88 * speedT * (0.85 + scroll * 0.15);
      ctx.strokeStyle = NYAN_RAINBOW[b];
      for (let c = 0; c < chunks; c++) {
        const pA = first + Math.floor((span * c) / chunks);
        const pB = first + Math.floor((span * (c + 1)) / chunks);
        if (pB <= pA) continue;
        const t = (pA + pB + 1) / (2 * n); // chunk-midpoint taper
        ctx.globalAlpha = (1 - t) * bandAlpha;
        ctx.beginPath();
        ctx.moveTo(pts[pA].x + trailNX[pA] * offset, pts[pA].y + trailNY[pA] * offset);
        for (let i = pA + 1; i <= pB; i++) {
          ctx.lineTo(pts[i].x + trailNX[i] * offset, pts[i].y + trailNY[i] * offset);
        }
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  private drawTether(ctx: CanvasRenderingContext2D, time: number) {
    const a = this.anchor!;
    const perfect = this.inPerfectWindow;
    const col = perfect ? theme.anchorPerfect : theme.tether;
    const hand = this.latchedHandWorld();
    const endX = hand?.x ?? this.x;
    const endY = hand?.y ?? this.y;

    // Taut rope.
    ctx.strokeStyle = hexA(col, 0.8);
    ctx.lineWidth = perfect ? 2.5 : 1.6;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    // Additive energy along the rope; glows in the perfect window.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = hexA(col, perfect ? 0.6 : 0.18);
    ctx.lineWidth = perfect ? 5 : 2.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    if (perfect) {
      const beads = 4;
      for (let i = 0; i < beads; i++) {
        const f = (time * 1.8 + i / beads) % 1;
        const bx = a.x + (endX - a.x) * f;
        const by = a.y + (endY - a.y) * f;
        ctx.fillStyle = hexA(theme.anchorPerfect, 0.95);
        ctx.beginPath();
        ctx.arc(bx, by, 3.2, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** Which monkey the character is, if it is one: the crowned cloud-rider or the plain one. */
  private get monkeyKind(): MonkeyKind | null {
    return this.characterId === "monkey" ? "king" : this.characterId === "baseMonkey" ? "plain" : null;
  }

  /** World position of the hand gripping the anchor (the monkeys only). */
  private latchedHandWorld(): { x: number; y: number } | null {
    const kind = this.monkeyKind;
    if (!kind || this.state !== "swing" || !this.anchor) {
      return null;
    }
    if (kind === "plain") {
      return this.rig ? rigGripWorld(this.rig, this.latchArm === "right", this.x, this.y) : null;
    }
    const { x: shoulderX, y: shoulderY } = monkeyShoulder(this.latchArm);
    const latch = computeLatchArmAngle(
      this.anchor.x,
      this.anchor.y,
      this.x,
      this.y,
      this.angle,
      shoulderX,
      shoulderY
    );
    const handLocalX = shoulderX - latch.length * Math.sin(latch.angle);
    const handLocalY = shoulderY + latch.length * Math.cos(latch.angle);
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    return {
      x: this.x + handLocalX * c - handLocalY * s,
      y: this.y + handLocalX * s + handLocalY * c,
    };
  }

  private drawCharacter(
    ctx: CanvasRenderingContext2D,
    time: number,
    menuPreview: boolean
  ) {
    if (this.monkeyKind) {
      this.drawMonkeyCharacter(ctx, time, menuPreview);
      return;
    }
    if (this.characterId === "nyan") {
      this.drawNyanCatCharacter(ctx, time);
      return;
    }
    this.drawAirplane(ctx);
  }

  // The additive halo washes out to white on bright skies, so a charged smash
  // (or a dash) also gets a plain mint ring that reads the same in every mood.
  private drawChargeRing(ctx: CanvasRenderingContext2D, x: number, y: number, glowR: number) {
    ctx.strokeStyle = hexA(theme.collectible, 0.85);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, glowR * 0.5, 0, TAU);
    ctx.stroke();
  }

  private drawNyanCatCharacter(ctx: CanvasRenderingContext2D, time: number) {
    const isDash = this.state === "dash";
    // (the flag can be stale after a dash that began inside the window)
    const isPerfect = this.inPerfectWindow && this.state === "swing";
    const charged = isDash || this.smashGlow; // dash and a charged smash both break meteors
    const glowCol = isPerfect
      ? theme.anchorPerfect
      : charged
      ? theme.collectible
      : "#ff99cc";

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const r = CONFIG.player.radius;
    const glowR = r * (charged ? 3.4 : 2.2);
    const g = ctx.createRadialGradient(0, 0, 1, 0, 0, glowR);
    g.addColorStop(0, hexA(glowCol, charged ? 0.38 : 0.16));
    g.addColorStop(1, hexA(glowCol, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, glowR, 0, TAU);
    ctx.fill();
    ctx.restore();
    if (charged) this.drawChargeRing(ctx, 0, 0, glowR);

    drawNyanCat(ctx, time);
    ctx.restore();
  }

  private drawMonkeyCharacter(
    ctx: CanvasRenderingContext2D,
    time: number,
    menuPreview: boolean
  ) {
    const isDash = this.state === "dash";
    // (the flag can be stale after a dash that began inside the window)
    const isPerfect = this.inPerfectWindow && this.state === "swing";
    const charged = isDash || this.smashGlow; // dash and a charged smash both break meteors
    const glowCol = isPerfect
      ? theme.anchorPerfect
      : charged
      ? theme.collectible
      : theme.playerGlow;

    ctx.save();
    ctx.translate(this.x, this.y);
    // The base monkey turns itself (hanging from the rope it follows the rope).
    if (this.monkeyKind !== "plain") ctx.rotate(this.angle);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const r = CONFIG.player.radius;
    const glowR = r * (charged ? 3.6 : 2.4);
    const g = ctx.createRadialGradient(0, 0, 1, 0, 0, glowR);
    g.addColorStop(0, hexA(glowCol, charged ? 0.4 : 0.18));
    g.addColorStop(1, hexA(glowCol, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, glowR, 0, TAU);
    ctx.fill();
    ctx.restore();
    if (charged) this.drawChargeRing(ctx, 0, 0, glowR);

    if (this.monkeyKind === "plain" && this.rig) drawMonkeyRig(ctx, this.rig, PLAIN_MONKEY_STYLE, this.latchArm === "right");
    else drawMonkey(ctx, time, this.buildMonkeyPose(menuPreview));
    ctx.restore();
  }

  private buildMonkeyPose(menuPreview: boolean) {
    if (menuPreview) {
      return { menuPreview: true as const };
    }

    if (this.state === "swing" && this.anchor) {
      const { x: shoulderX, y: shoulderY } = monkeyShoulder(this.latchArm);
      const latch = computeLatchArmAngle(
        this.anchor.x,
        this.anchor.y,
        this.x,
        this.y,
        this.angle,
        shoulderX,
        shoulderY
      );
      return {
        menuPreview: false as const,
        swing: {
          latchArm: this.latchArm,
          latchAngle: latch.angle,
          latchLength: latch.length,
        },
      };
    }

    return {
      menuPreview: false as const,
    };
  }

  private drawAirplane(ctx: CanvasRenderingContext2D) {
    const isDash = this.state === "dash";
    // (the flag can be stale after a dash that began inside the window)
    const isPerfect = this.inPerfectWindow && this.state === "swing";
    const charged = isDash || this.smashGlow; // dash and a charged smash both break meteors
    const glowCol = isPerfect
      ? theme.anchorPerfect
      : charged
      ? theme.collectible
      : theme.playerGlow;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const r = CONFIG.player.radius;
    const glowR = r * (charged ? 4 : 2.8);
    const gx = Math.cos(this.angle) * r * 0.35;
    const gy = Math.sin(this.angle) * r * 0.35;
    const g = ctx.createRadialGradient(gx, gy, 1, gx, gy, glowR);
    g.addColorStop(0, hexA(glowCol, charged ? 0.45 : 0.22));
    g.addColorStop(1, hexA(glowCol, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(gx, gy, glowR, 0, TAU);
    ctx.fill();
    ctx.restore();
    if (charged) this.drawChargeRing(ctx, gx, gy, glowR);

    const sprite = getPlayerSprite();
    if (isPlayerSpriteReady() && sprite) {
      const scale =
        ((CONFIG.player.radius * PLAYER_SPRITE.scale) / PLAYER_SPRITE.height);
      const w = PLAYER_SPRITE.width * scale;
      const h = PLAYER_SPRITE.height * scale;
      const ax = PLAYER_SPRITE.anchorX * scale;
      ctx.drawImage(sprite, -ax, -h * 0.5, w, h);
      ctx.restore();
      return;
    }

    this.drawAirplaneFallback(ctx);
    ctx.restore();
  }

  private drawAirplaneFallback(ctx: CanvasRenderingContext2D) {
    const r = CONFIG.player.radius * 0.72;
    const paper = theme.player;
    const fold = mixColor(paper, "#1a6a96", 0.45);
    const underside = mixColor(paper, "#1a6a96", 0.62);
    const highlight = mixColor(paper, "#ffffff", 0.5);

    const nose: [number, number] = [r * 1.45, 0];
    const topTip: [number, number] = [-r * 0.55, -r * 1.05];
    const topRoot: [number, number] = [-r * 1.45, -r * 0.24];
    const botTip: [number, number] = [-r * 0.55, r * 1.05];
    const botRoot: [number, number] = [-r * 1.45, r * 0.24];
    const tail: [number, number] = [-r * 1.62, 0];

    const fillPoly = (pts: [number, number][], fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fill();
    };

    fillPoly([nose, botTip, botRoot, tail], underside);
    fillPoly([nose, topTip, topRoot, tail], paper);

    ctx.strokeStyle = hexA(fold, 0.85);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(nose[0], nose[1]);
    ctx.lineTo(topTip[0], topTip[1]);
    ctx.moveTo(nose[0], nose[1]);
    ctx.lineTo(botTip[0], botTip[1]);
    ctx.stroke();

    ctx.strokeStyle = hexA(highlight, 0.85);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(nose[0], nose[1]);
    ctx.lineTo(topTip[0], topTip[1]);
    ctx.stroke();
  }
}

// --- Trail render scratch (module-level: render-only, never gameplay state) --

/** Per-point trail normals for the rainbow bands, reused across frames. */
let trailNX = new Float32Array(0);
let trailNY = new Float32Array(0);

/** Nimbus puff circle radius in sprite px — max on-screen size at 2x DPR. */
const NIMBUS_PUFF_R = Math.ceil(CONFIG.player.radius * 0.4 * 2);
const NIMBUS_PUFF_PAD = 2; // keep edge antialiasing off the canvas border
let nimbusPuff: Scratch | null = null;

// Golden nimbus puff, baked once — the colours are constant literals, so
// unlike the theme-keyed caches this never needs rebuilding. The gradient
// reaches 2.2x past the filled circle, matching the old per-point
// createRadialGradient exactly.
function getNimbusPuff(): Scratch {
  if (nimbusPuff) return nimbusPuff;
  const R = NIMBUS_PUFF_R;
  const c = R + NIMBUS_PUFF_PAD;
  nimbusPuff = makeScratch(c * 2, c * 2);
  const g = nimbusPuff.ctx.createRadialGradient(c, c, 0, c, c, R * 2.2);
  g.addColorStop(0, "#fff8b0");
  g.addColorStop(0.45, hexA("#ffd030", 0.65));
  g.addColorStop(1, hexA("#ffb020", 0));
  nimbusPuff.ctx.fillStyle = g;
  nimbusPuff.ctx.beginPath();
  nimbusPuff.ctx.arc(c, c, R, 0, TAU);
  nimbusPuff.ctx.fill();
  return nimbusPuff;
}
