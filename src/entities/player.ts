import { CONFIG } from "../core/config";
import { theme, mixColor } from "../render/theme";
import { getPlayerSprite, isPlayerSpriteReady, PLAYER_SPRITE } from "../render/playerAsset";
import { drawMonkey, computeLatchArmAngle, monkeyShoulder, type LatchArm } from "../render/drawMonkey";
import type { CharacterId } from "../characters/registry";
import { angleDelta, clamp, rad, TAU } from "../core/math";
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

  inPerfectWindow = false;
  perfectQuality = 0;
  swingTime = 0;
  dashTime = 0;
  /** Remaining hazard invulnerability after a wind dash (rocks can't kill). */
  hazardInvuln = 0;
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
    this.latchArm = "right";
    this.nextLatchArm = "right";
    this.events.length = 0;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  // Pick the best anchor to tether to: nearest within range, biased forward.
  findGrabTarget(anchors: Anchor[]): Anchor | null {
    let best: Anchor | null = null;
    let bestScore = Infinity;
    const range = CONFIG.tether.grabRange;
    for (const a of anchors) {
      const dx = a.x - this.x;
      const dy = a.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d > range || d < 6) continue;
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

  private grab(anchor: Anchor) {
    this.latchArm = this.nextLatchArm;
    this.nextLatchArm = this.nextLatchArm === "right" ? "left" : "right";
    this.anchor = anchor;
    const d = Math.hypot(anchor.x - this.x, anchor.y - this.y);
    // Match the rope to the current distance so latch-on doesn't snap position.
    this.ropeLen = Math.max(d, 1e-3);
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

    const boost = perfect ? CONFIG.tether.perfectBoost : CONFIG.tether.releaseBoost;
    this.vx *= boost;
    this.vy *= boost;
    if (perfect) {
      const s = this.speed || 1;
      this.vx += (this.vx / s) * CONFIG.tether.perfectBonusSpeed;
      this.vy += (this.vy / s) * CONFIG.tether.perfectBonusSpeed;
    }
    this.clampSpeed();

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

  // Main fixed-step update. `holding` drives the tether; `anchors` is the live set.
  step(dt: number, holding: boolean, anchors: Anchor[], time: number) {
    if (!this.alive) return;

    if (this.hazardInvuln > 0) {
      this.hazardInvuln = Math.max(0, this.hazardInvuln - dt);
    }

    switch (this.state) {
      case "glide": {
        if (holding) {
          const target = this.findGrabTarget(anchors);
          if (target) {
            this.grab(target);
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

  private stepSwing(dt: number, holding: boolean, _time: number) {
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

  kill() {
    this.alive = false;
  }

  drainEvents(sink: (e: PlayerEvent) => void) {
    for (const e of this.events) sink(e);
    this.events.length = 0;
  }

  // --- Rendering -----------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, time: number, menuPreview = false) {
    if (this.characterId === "plane") {
      this.drawMotionTrail(ctx, time);
    } else {
      this.drawNimbusTrail(ctx, time);
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

    // Bright thin core — ~1px, tapering in opacity toward the tail.
    ctx.shadowColor = hexA(lineCol, 0.9);
    ctx.shadowBlur = 5 * speedT;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      ctx.strokeStyle = hexA(lineCol, (0.1 + t * 0.9) * speedT);
      ctx.lineWidth = 0.75 + t * 0.55;
      ctx.beginPath();
      ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
      ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }

    // Soft bloom where the line meets the plane.
    ctx.shadowBlur = 0;
    const head = pts[n - 1];
    const glowR = CONFIG.player.radius * (1.4 + speedT * 0.6);
    const g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, glowR);
    g.addColorStop(0, hexA(lineCol, isDash ? 0.5 : 0.38));
    g.addColorStop(1, hexA(lineCol, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(head.x, head.y, glowR, 0, TAU);
    ctx.fill();

    // Tiny sparks hugging the line near the head.
    for (let i = Math.floor(n * 0.5); i < n; i++) {
      const t = i / n;
      const p = pts[i];
      const phase = i * 1.9 + time * 3;
      const jx = Math.sin(phase) * 2.5 * t;
      const jy = Math.cos(phase * 1.2) * 2.5 * t;
      ctx.fillStyle = hexA(lineCol, t * 0.45 * speedT);
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
      const alpha = (1 - t) * 0.38 * speedT;

      const g = ctx.createRadialGradient(nx + jx, ny + jy, 0, nx + jx, ny + jy, pr * 2.2);
      g.addColorStop(0, hexA("#fff8b0", alpha));
      g.addColorStop(0.45, hexA("#ffd030", alpha * 0.65));
      g.addColorStop(1, hexA("#ffb020", 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(nx + jx, ny + jy, pr, 0, TAU);
      ctx.fill();
    }

    for (let i = Math.floor(n * 0.35); i < n; i++) {
      const t = i / n;
      const p = pts[i];
      const nx = p.x - nimbusOff * sin;
      const ny = p.y + nimbusOff * cos;
      const phase = i * 2.4 + time * 4.8;
      ctx.fillStyle = hexA(i % 2 === 0 ? "#fff6a0" : "#ffc820", t * 0.5 * speedT);
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

  /** World position of the hand gripping the anchor (monkey only). */
  private latchedHandWorld(): { x: number; y: number } | null {
    if (this.characterId !== "monkey" || this.state !== "swing" || !this.anchor) {
      return null;
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
    if (this.characterId === "monkey") {
      this.drawMonkeyCharacter(ctx, time, menuPreview);
      return;
    }
    this.drawAirplane(ctx);
  }

  private drawMonkeyCharacter(
    ctx: CanvasRenderingContext2D,
    time: number,
    menuPreview: boolean
  ) {
    const isDash = this.state === "dash";
    const isPerfect = this.inPerfectWindow;
    const glowCol = isDash
      ? theme.collectible
      : isPerfect
      ? theme.anchorPerfect
      : theme.playerGlow;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const r = CONFIG.player.radius;
    const glowR = r * (isDash ? 3.6 : 2.4);
    const g = ctx.createRadialGradient(0, 0, 1, 0, 0, glowR);
    g.addColorStop(0, hexA(glowCol, isDash ? 0.4 : 0.18));
    g.addColorStop(1, hexA(glowCol, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, glowR, 0, TAU);
    ctx.fill();
    ctx.restore();

    drawMonkey(ctx, time, this.buildMonkeyPose(menuPreview));
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
    const isPerfect = this.inPerfectWindow;
    const glowCol = isDash
      ? theme.collectible
      : isPerfect
      ? theme.anchorPerfect
      : theme.playerGlow;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const r = CONFIG.player.radius;
    const glowR = r * (isDash ? 4 : 2.8);
    const gx = Math.cos(this.angle) * r * 0.35;
    const gy = Math.sin(this.angle) * r * 0.35;
    const g = ctx.createRadialGradient(gx, gy, 1, gx, gy, glowR);
    g.addColorStop(0, hexA(glowCol, isDash ? 0.45 : 0.22));
    g.addColorStop(1, hexA(glowCol, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(gx, gy, glowR, 0, TAU);
    ctx.fill();
    ctx.restore();

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
