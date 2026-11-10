import { Camera } from "../core/camera";
import { CONFIG } from "../core/config";
import { theme } from "./theme";
import { clamp } from "../core/math";
import { hexA } from "../entities/anchor";
import {
  Objective,
  OBJECTIVE_EXIT,
  OBJECTIVE_HOLD,
  OBJECTIVE_STRIKE,
} from "../systems/objectives";
import type { CharacterId } from "../characters/registry";
import type { TutorialKey } from "../systems/tutorial";
import {
  drawOrbIcon,
  drawPowerIcon,
  ORB_COLOR,
  POWERUP_COLOR,
  type PowerUpKind,
} from "../entities/powerup";

const PALETTE = theme; // HUD reads the live theme for cohesive colour grading

// Touch devices don't have a keyboard — skip keyboard-only hints. Guarded for
// the headless test harnesses, which don't define matchMedia.
const COARSE_POINTER =
  typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

// The tutorial's words, one card per lesson. Written for a phone — touch,
// hold, lift your finger, tap the button — which also reads right with a
// mouse (a click and hold anywhere is the same as a touch).
const TUTORIAL_COPY: Record<TutorialKey, { title: string; sub: string }> = {
  grab: { title: "Hold to grab", sub: "Touch and hold when an anchor glows" },
  release: { title: "Let go on gold", sub: "Lift your finger on the gold glow" },
  letgo: { title: "Let go", sub: "Lift your finger to fly on" },
  chain: { title: "Grab the next one", sub: "Touch and hold again in mid-air" },
  dash: { title: "Tap DASH", sub: "It blasts you through rocks" },
  sea: { title: "Stay above the clouds", sub: "The cloud sea below ends the run" },
  done: { title: "You're ready", sub: "Fly as far as you can" },
};

// Assigning ctx.font triggers a CSS shorthand parse + font-cache lookup in
// WebKit, so compose each string once. HUD sizes are a small fixed set;
// animated popup sizes are quantized to 0.5px so keys repeat.
const fontCache = new Map<string, string>();
function fontFor(weight: string, size: number): string {
  const key = `${weight}|${size}`;
  let font = fontCache.get(key);
  if (!font) {
    font = `${weight} ${size}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
    fontCache.set(key, font);
  }
  return font;
}

export interface HudData {
  state: "menu" | "playing" | "paused" | "crashing" | "gameover";
  score: number;
  distance: number;
  best: number;
  bestDistance: number;
  wind: number; // 0..1
  dashReady: boolean;
  speed: number;
  smashReady: boolean; // smash is charged: a meteor hit shatters it
  smashCharge: number; // 0..1 of the smash window left
  orbs: number; // orbs picked up this run
  orbBank: number; // banked total (includes this run once it has ended)
  magnet: number; // 0..1 of the magnet power-up left (0 = off)
  barrier: boolean; // barrier power-up is up
  objectives: Objective[];
  objectivesDone: number;
  muted: boolean;
  newBest: boolean;
  perfectCount: number;
  hint: string;
  hintAlpha: number;
  character: CharacterId;
  characterName: string;
  conserveMomentum: boolean; // shown on the pause screen's swing option
  /** The first-flight tutorial: the card to show (fading by alpha), and whether it is running. */
  tutorial: { active: boolean; key: TutorialKey | null; alpha: number; holding: boolean; gold: boolean };
}

interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  scale: number;
}

export class Hud {
  private popups: Popup[] = [];
  flash = 0; // screen-wide flash on perfect / big moments
  // Last font set on ctx *within the current HUD pass*. Other draw code can
  // change ctx.font between passes, so each entry point resets this.
  private lastFont = "";
  // Attract-screen edge gradients — fixed colours, rebuilt only on resize.
  private attractTop: CanvasGradient | null = null;
  private attractBottom: CanvasGradient | null = null;
  private attractGradH = 0;
  // Width of the run-start hint at its full 18px size, measured once per string.
  private hintWidth = 0;
  private hintWidthFor = "";
  // Measured ink (visible glyph) box per (weight, size, string) — see ink().
  private inkCache = new Map<string, { top: number; bottom: number; width: number }>();

  popup(x: number, y: number, text: string, color: string, scale = 1) {
    this.popups.push({ x, y, text, color, life: 1.1, maxLife: 1.1, scale });
    if (this.popups.length > 24) this.popups.shift();
  }

  triggerFlash(amount = 0.5) {
    this.flash = Math.min(1, this.flash + amount);
  }

  update(dt: number) {
    for (const p of this.popups) {
      p.life -= dt;
      p.y -= 34 * dt;
    }
    this.popups = this.popups.filter((p) => p.life > 0);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.2);
  }

  // Drawn INSIDE the world transform so popups track world positions. `zoom`
  // is the camera's world scale — text is counter-scaled so popups stay the
  // same on-screen size when the camera zooms out.
  drawWorldPopups(ctx: CanvasRenderingContext2D, zoom = 1) {
    this.lastFont = ""; // new pass — ctx.font may have changed since the last one
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const inv = 1 / zoom;
    for (const p of this.popups) {
      const t = p.life / p.maxLife;
      // Quantize the animated size to 0.5px so font-cache keys repeat.
      const size = Math.round(18 * inv * p.scale * (1.2 - t * 0.2) * 2) / 2;
      this.setFont(ctx, "700", size);
      ctx.fillStyle = hexA("#0a0d24", 0.5 * t);
      ctx.fillText(p.text, p.x + 2 * inv, p.y + 2 * inv);
      ctx.fillStyle = hexA(p.color, t);
      ctx.fillText(p.text, p.x, p.y);
    }
  }

  dashButton(cam: Camera): { x: number; y: number; r: number } {
    const r = clamp(cam.w * 0.06, 40, 56);
    const ins = cam.insets;
    return {
      x: cam.w - ins.right - r - 26,
      y: cam.h - ins.bottom - r - 30,
      r,
    };
  }

  pauseButton(cam: Camera): { x: number; y: number; r: number } {
    const r = clamp(cam.w * 0.026, 18, 23);
    const ins = cam.insets;
    return { x: cam.w - ins.right - r - 20, y: ins.top + r + 20, r };
  }

  /**
   * The mute button: on the menu and game-over screens bottom right; during
   * a run (and paused) just left of the pause button. There is no keyboard
   * on a phone, so M alone is not enough.
   */
  muteButton(cam: Camera, attract: boolean): { x: number; y: number; r: number } {
    const ins = cam.insets;
    if (attract) {
      const r = 20;
      return { x: cam.w - ins.right - 28 - r, y: cam.h - ins.bottom - 26 - r, r };
    }
    const p = this.pauseButton(cam);
    const r = Math.round(p.r * 0.85);
    return { x: p.x - p.r - 12 - r, y: p.y, r };
  }

  private drawMuteButton(ctx: CanvasRenderingContext2D, cam: Camera, d: HudData, attract: boolean) {
    const b = this.muteButton(cam, attract);
    ctx.fillStyle = hexA(PALETTE.text, 0.14);
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexA(PALETTE.text, 0.32);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // A speaker: a box and a cone, then sound waves — or a cross when muted.
    const s = b.r / 20;
    const cx = b.x - 4 * s;
    const col = hexA(PALETTE.text, 0.88);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(cx - 7 * s, b.y - 3.5 * s);
    ctx.lineTo(cx - 3 * s, b.y - 3.5 * s);
    ctx.lineTo(cx + 3 * s, b.y - 8.5 * s);
    ctx.lineTo(cx + 3 * s, b.y + 8.5 * s);
    ctx.lineTo(cx - 3 * s, b.y + 3.5 * s);
    ctx.lineTo(cx - 7 * s, b.y + 3.5 * s);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2 * s;
    ctx.lineCap = "round";
    ctx.beginPath();
    if (d.muted) {
      ctx.moveTo(cx + 7 * s, b.y - 4.5 * s);
      ctx.lineTo(cx + 15 * s, b.y + 4.5 * s);
      ctx.moveTo(cx + 15 * s, b.y - 4.5 * s);
      ctx.lineTo(cx + 7 * s, b.y + 4.5 * s);
    } else {
      ctx.arc(cx + 4 * s, b.y, 6 * s, -0.75, 0.75);
      ctx.moveTo(cx + 4 * s + 11 * s * Math.cos(-0.8), b.y + 11 * s * Math.sin(-0.8));
      ctx.arc(cx + 4 * s, b.y, 11 * s, -0.8, 0.8);
    }
    ctx.stroke();
    ctx.lineCap = "butt";
  }

  /** SKIP during the tutorial: top centre, clear of the score and the pause button. */
  tutorialSkipButton(cam: Camera): { x: number; y: number; w: number; h: number } {
    const w = 132;
    const h = 30;
    return { x: cam.w / 2 - w / 2, y: cam.insets.top + 14, w, h };
  }

  /** HOW TO PLAY on the menu and game-over screens: top left, opposite the orb bank. */
  howToPlayButton(cam: Camera): { x: number; y: number; w: number; h: number } {
    const w = 132;
    const h = 34;
    return { x: cam.insets.left + 22, y: cam.insets.top + 22, w, h };
  }

  /** The pause screen's two buttons (also their hit-test rectangles). */
  pauseMenuButtons(cam: Camera): {
    restart: { x: number; y: number; w: number; h: number };
    momentum: { x: number; y: number; w: number; h: number };
  } {
    const w = clamp(cam.w * 0.3, 220, 300);
    const h = 44;
    const gap = 12;
    const x = cam.w / 2 - w / 2;
    // Under the "Tap ▶ or Esc to resume" line, but never off a short screen.
    const top = Math.min(cam.h * 0.42 + 84, cam.h - cam.insets.bottom - 2 * h - gap - 10);
    return {
      restart: { x, y: top, w, h },
      momentum: { x, y: top + h + gap, w, h },
    };
  }

  playButton(cam: Camera): { x: number; y: number; r: number } {
    const r = clamp(cam.w * 0.055, 36, 48);
    // Bottom-anchored cap: the button and its TAP TO PLAY label must always
    // fit inside the frame with margin, even on short or clipped viewports
    // (proportional-only placement used to push the label off screen).
    const y = Math.min(cam.h * 0.78, cam.h - cam.insets.bottom - r - 72);
    return { x: cam.w / 2, y, r };
  }

  characterCycleButton(
    cam: Camera,
    dir: -1 | 1
  ): { x: number; y: number; r: number } {
    const r = clamp(cam.w * 0.034, 22, 28);
    const play = this.playButton(cam);
    const cx = cam.w / 2 + dir * clamp(cam.w * 0.19, 110, 150);
    // Ride above the play button, but never so high that the picker collides
    // with the game-over stats block on short screens.
    const y = Math.max(play.y - play.r - 64, cam.h * 0.56);
    return { x: cx, y, r };
  }

  // Screen-space HUD during a run.
  drawScreen(ctx: CanvasRenderingContext2D, cam: Camera, d: HudData) {
    this.lastFont = ""; // new pass — ctx.font may have changed since the last one
    if (this.flash > 0) {
      ctx.fillStyle = hexA(PALETTE.anchorPerfect, this.flash * 0.18);
      ctx.fillRect(0, 0, cam.w, cam.h);
    }

    if (d.state === "menu") return this.drawAttractScreen(ctx, cam, d, "menu");
    if (d.state === "gameover") return this.drawAttractScreen(ctx, cam, d, "gameover");
    if (d.state === "crashing") return;

    const paused = d.state === "paused";
    const ins = cam.insets;

    // --- Score (top-left) ---
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    this.text(ctx, `${Math.floor(d.score)}`, 24 + ins.left, 20 + ins.top, 38, "800", PALETTE.text);
    this.text(
      ctx,
      `${Math.floor(d.distance)} m`,
      26 + ins.left,
      62 + ins.top,
      16,
      "600",
      PALETTE.textDim
    );
    this.text(
      ctx,
      `BEST ${Math.floor(d.best)}`,
      26 + ins.left,
      84 + ins.top,
      12,
      "600",
      hexA(PALETTE.anchorPerfect, 0.85)
    );
    // Orbs collected this run.
    drawOrbIcon(ctx, 33 + ins.left, 113 + ins.top, 6);
    this.text(ctx, `${d.orbs}`, 46 + ins.left, 105 + ins.top, 14, "700", ORB_COLOR);

    // --- Objectives (top-right) --- (kept out of the way during the tutorial)
    if (!d.tutorial.active) this.drawObjectives(ctx, cam, d);

    if (d.tutorial.active || d.tutorial.alpha > 0.01) this.drawTutorial(ctx, cam, d);

    if (paused) this.drawPauseOverlay(ctx, cam, d);

    // --- Pause / resume and mute (top-right corner, above overlay) ---
    this.drawPauseButton(ctx, cam, paused);
    this.drawMuteButton(ctx, cam, d, false);

    // --- Wind gauge / dash button (bottom-right) ---
    this.drawDashButton(ctx, cam, d);

    // --- Speed pips (bottom-left) ---
    const spd = clamp(d.speed / 1200, 0, 1);
    const barW = 120;
    const spX = 26 + ins.left;
    const spY = cam.h - 36 - ins.bottom;
    ctx.fillStyle = hexA(PALETTE.text, 0.12);
    this.roundRect(ctx, spX, spY, barW, 8, 4);
    ctx.fill();
    ctx.fillStyle = d.smashReady
      ? hexA(PALETTE.collectible, 0.95)
      : hexA(PALETTE.tether, 0.9);
    this.roundRect(ctx, spX, spY, barW * spd, 8, 4);
    ctx.fill();
    // drawDashButton leaves textAlign centred; the speed label is left-aligned.
    ctx.textAlign = "left";
    // Threshold tick: reach this mark to charge the smash.
    const tickX = spX + barW * clamp(CONFIG.player.smashSpeed / 1200, 0, 1);
    ctx.fillStyle = hexA(PALETTE.text, 0.55);
    ctx.fillRect(tickX - 1, spY - 3, 2, 14);
    // The smash window, draining under the speed bar once it is charged.
    if (d.smashCharge > 0) {
      ctx.fillStyle = hexA(PALETTE.collectible, 0.95);
      this.roundRect(ctx, spX, spY + 11, barW * d.smashCharge, 3, 1.5);
      ctx.fill();
    }
    this.text(
      ctx,
      d.smashReady ? "SPEED · SMASH" : "SPEED",
      spX,
      spY - 18,
      10,
      "700",
      d.smashReady ? PALETTE.collectible : PALETTE.textDim
    );

    // --- Active power-ups: chips beside the speed bar ---
    // (On the shortest screens the pause buttons reach down to this row; a
    // chip that would sit on one is left out while paused.)
    const pauseRects = paused ? Object.values(this.pauseMenuButtons(cam)) : [];
    const chipClear = (cx: number, cy: number) =>
      pauseRects.every((r) => cx + 18 < r.x || cx - 18 > r.x + r.w || cy + 18 < r.y || cy - 18 > r.y + r.h);
    let chipX = spX + barW + 34;
    if (d.magnet > 0) {
      if (chipClear(chipX, spY - 2)) this.drawPowerChip(ctx, chipX, spY - 2, "magnet", d.magnet);
      chipX += 42;
    }
    if (d.barrier && chipClear(chipX, spY - 2)) this.drawPowerChip(ctx, chipX, spY - 2, "barrier", 1);

    // --- Centered fading hint ---
    if (d.hintAlpha > 0.01 && d.hint) {
      ctx.textAlign = "center";
      this.setFont(ctx, "600", 18);
      if (this.hintWidthFor !== d.hint) {
        this.hintWidthFor = d.hint;
        this.hintWidth = ctx.measureText(d.hint).width;
      }
      const hintCol = hexA(PALETTE.text, d.hintAlpha * 0.9);
      // Top centre by default. Where that would run into the objectives
      // column (phones), the hint drops to the free strip between the speed
      // bar with its power-up chips and the dash button, shrunk to fit.
      const objectivesLeft = cam.w - 250 - ins.right;
      if (cam.w / 2 + this.hintWidth / 2 + 16 <= objectivesLeft) {
        ctx.fillStyle = hintCol;
        ctx.fillText(d.hint, cam.w / 2, cam.h * 0.2);
      } else {
        const dash = this.dashButton(cam);
        const left = spX + barW + 34 + 42 + 16 + 12; // clear of both chips
        const right = dash.x - dash.r - 16;
        const size = clamp(Math.floor((18 * (right - left)) / this.hintWidth), 11, 18);
        const hx = (left + right) / 2;
        const hy = cam.h - ins.bottom - 37 - size / 2;
        this.setFont(ctx, "600", size);
        // Down here the backdrop can be the pale cloud sea: a shadow that
        // fades with the text keeps it readable.
        ctx.fillStyle = hexA("#0a0d24", 0.5 * d.hintAlpha);
        ctx.fillText(d.hint, hx + 1.5, hy + 1.5);
        ctx.fillStyle = hintCol;
        ctx.fillText(d.hint, hx, hy);
      }
    }

    ctx.textAlign = "left"; // the hint block above may have left it centred
  }

  // A worn power-up: dark badge, its glyph, and a ring showing what is left
  // (a full ring for the barrier, which lasts until it is used).
  private drawPowerChip(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    kind: PowerUpKind,
    frac: number
  ) {
    const r = 16;
    const col = POWERUP_COLOR[kind];
    ctx.fillStyle = hexA("#10143a", 0.6);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = hexA(PALETTE.text, 0.16);
    ctx.stroke();
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(frac, 0, 1));
    ctx.stroke();
    drawPowerIcon(ctx, kind, cx, cy, r * 1.3, col);
  }

  private drawPauseButton(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    paused: boolean
  ) {
    const b = this.pauseButton(cam);
    ctx.fillStyle = hexA(PALETTE.text, 0.14);
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexA(PALETTE.text, 0.32);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = hexA(PALETTE.text, 0.88);
    if (paused) {
      const s = b.r * 0.55;
      ctx.beginPath();
      ctx.moveTo(b.x - s * 0.35, b.y - s);
      ctx.lineTo(b.x + s * 0.75, b.y);
      ctx.lineTo(b.x - s * 0.35, b.y + s);
      ctx.closePath();
      ctx.fill();
    } else {
      const barW = b.r * 0.22;
      const barH = b.r * 0.9;
      const gap = b.r * 0.18;
      ctx.fillRect(b.x - gap - barW, b.y - barH / 2, barW, barH);
      ctx.fillRect(b.x + gap, b.y - barH / 2, barW, barH);
    }
  }

  /**
   * The tutorial: one card at a time, low in the frame — a big line, a small
   * one, and a gesture beside them (a ring that fills for a hold, one that
   * springs outward for a let-go) — plus a ring around DASH for the dash
   * lesson and a SKIP button while it runs.
   */
  private drawTutorial(ctx: CanvasRenderingContext2D, cam: Camera, d: HudData) {
    const t = d.tutorial;
    const ins = cam.insets;
    const now = performance.now() / 1000;
    const baseline = ctx.textBaseline;

    if (t.active && d.state === "playing") {
      const r = this.tutorialSkipButton(cam);
      ctx.fillStyle = hexA("#0a0d24", 0.28);
      this.roundRect(ctx, r.x, r.y, r.w, r.h, r.h / 2);
      ctx.fill();
      ctx.strokeStyle = hexA(PALETTE.text, 0.35);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      this.text(ctx, "SKIP TUTORIAL", r.x + r.w / 2, r.y + r.h / 2 + 1, 11, "800", hexA(PALETTE.text, 0.8));
    }

    const a = t.alpha;
    if (!t.key || a <= 0.01) {
      ctx.textBaseline = baseline;
      return;
    }
    const copy = TUTORIAL_COPY[t.key];
    const title = copy.title;
    const sub = copy.sub;
    const titleSize = clamp(cam.w * 0.036, 22, 34);
    const gesture = t.key === "grab" || t.key === "chain" || t.key === "release" || t.key === "letgo";
    const glyph = gesture ? 36 + 14 : 0; // the gesture sits left of the words
    this.setFont(ctx, "800", titleSize);
    const tw = ctx.measureText(title).width;
    this.setFont(ctx, "600", 15);
    const sw = ctx.measureText(sub).width;
    const cw = glyph + Math.max(tw, sw) + 48;
    const ch = titleSize + 56;
    // Low in the frame, between the speed bar and DASH: the camera keeps the
    // plane near the middle and anchors, ropes and rocks above or level with
    // it, so the strip above the HUD's bottom row is the sky nothing happens in.
    const cy = cam.h - ins.bottom - 64 - ch / 2;
    const x0 = cam.w / 2 - cw / 2;
    const y0 = cy - ch / 2;
    ctx.fillStyle = hexA("#0a0d24", 0.3 * a);
    this.roundRect(ctx, x0, y0, cw, ch, 18);
    ctx.fill();

    const textX = x0 + 24 + glyph;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    // The release card's title turns gold with the rope: now.
    const titleCol = t.key === "release" && t.gold ? PALETTE.anchorPerfect : PALETTE.text;
    this.text(ctx, title, textX, y0 + 16, titleSize, "800", hexA(titleCol, a), true);
    this.text(ctx, sub, textX, y0 + 22 + titleSize, 15, "600", hexA(PALETTE.text, 0.85 * a), true);

    if (gesture) {
      const gx = x0 + 24 + 18;
      const gy = cy;
      ctx.lineWidth = 3;
      if ((t.key === "release" && t.gold) || t.key === "letgo") {
        // Let go: a ring springing outward from the fingertip, over and over.
        const p = (now % 0.9) / 0.9;
        ctx.strokeStyle = hexA(PALETTE.anchorPerfect, (1 - p) * a);
        ctx.beginPath();
        ctx.arc(gx, gy, 8 + 14 * p, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = hexA(PALETTE.anchorPerfect, 0.9 * a);
      } else {
        // Hold: a ring that fills around the fingertip (full while held).
        const p = t.holding ? 1 : (now % 1.3) / 1.3;
        ctx.strokeStyle = hexA(PALETTE.text, 0.25 * a);
        ctx.beginPath();
        ctx.arc(gx, gy, 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = hexA(PALETTE.anchor, a);
        ctx.beginPath();
        ctx.arc(gx, gy, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
        ctx.stroke();
        ctx.fillStyle = hexA(PALETTE.text, 0.9 * a);
      }
      ctx.beginPath();
      ctx.arc(gx, gy, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    if (t.key === "dash") {
      // Point at the button itself: a pulsing ring, and an arrow from the
      // card to it that nudges toward the button.
      const b = this.dashButton(cam);
      const pulse = 0.5 + 0.5 * Math.sin(now * 7);
      ctx.strokeStyle = hexA(PALETTE.collectible, (0.45 + 0.45 * pulse) * a);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 10 + pulse * 6, 0, Math.PI * 2);
      ctx.stroke();
      const ax0 = x0 + cw + 10;
      const ay0 = cy;
      const ring = b.r + 22;
      const dx = b.x - ax0;
      const dy = b.y - ay0;
      const len = Math.hypot(dx, dy);
      if (len > ring + 24) {
        const ux = dx / len;
        const uy = dy / len;
        const nudge = 6 * pulse;
        const ex = b.x - ux * (ring - nudge);
        const ey = b.y - uy * (ring - nudge);
        const sx = ax0 + ux * nudge;
        const sy = ay0 + uy * nudge;
        ctx.strokeStyle = hexA(PALETTE.collectible, 0.85 * a);
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.moveTo(ex - ux * 11 - uy * 7, ey - uy * 11 + ux * 7);
        ctx.lineTo(ex, ey);
        ctx.lineTo(ex - ux * 11 + uy * 7, ey - uy * 11 - ux * 7);
        ctx.stroke();
        ctx.lineCap = "butt";
      }
    }
    ctx.textBaseline = baseline;
  }

  private drawPauseOverlay(ctx: CanvasRenderingContext2D, cam: Camera, d: HudData) {
    ctx.fillStyle = hexA("#0a0d24", 0.42);
    ctx.fillRect(0, 0, cam.w, cam.h);

    ctx.textAlign = "center";
    this.text(
      ctx,
      "PAUSED",
      cam.w / 2,
      cam.h * 0.42,
      44,
      "800",
      PALETTE.text,
      true
    );
    const pulse = 0.55 + Math.sin(performance.now() / 400) * 0.35;
    this.text(
      ctx,
      COARSE_POINTER ? "Tap ▶ to resume" : "Tap ▶ or Esc to resume",
      cam.w / 2,
      cam.h * 0.42 + 52,
      15,
      "600",
      hexA(PALETTE.textDim, pulse),
      true
    );

    // Restart the run, and the swing option: the classic rope, or a pendulum
    // that keeps your momentum (remembered between sessions).
    const b = this.pauseMenuButtons(cam);
    const baseline = ctx.textBaseline;
    this.pauseButtonBox(ctx, b.restart, "RESTART RUN", PALETTE.text);
    const on = d.conserveMomentum;
    this.pauseButtonBox(ctx, b.momentum, on ? "CONSERVE MOMENTUM: ON" : "CONSERVE MOMENTUM: OFF", on ? PALETTE.collectible : PALETTE.text);
    ctx.textBaseline = baseline;
  }

  private pauseButtonBox(
    ctx: CanvasRenderingContext2D,
    r: { x: number; y: number; w: number; h: number },
    label: string,
    color: string
  ) {
    ctx.fillStyle = hexA(PALETTE.text, 0.12);
    this.roundRect(ctx, r.x, r.y, r.w, r.h, 12);
    ctx.fill();
    ctx.strokeStyle = hexA(color, 0.7);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    this.text(ctx, label, r.x + r.w / 2, r.y + r.h / 2, 13, "800", color);
  }

  private drawObjectives(ctx: CanvasRenderingContext2D, cam: Camera, d: HudData) {
    const ins = cam.insets;
    const x = cam.w - 250 - ins.right;
    let y = 54 + ins.top;
    ctx.textAlign = "left";
    const allDone = d.objectives.length > 0 && d.objectivesDone === d.objectives.length;
    this.text(
      ctx,
      `OBJECTIVES  ${d.objectivesDone}/${d.objectives.length}`,
      x,
      y,
      12,
      "700",
      allDone ? PALETTE.collectible : PALETTE.textDim
    );
    y += 22;
    const w = 224;
    for (const o of d.objectives) {
      if (o.gone) continue;
      // A finished objective is crossed out, holds for a beat, then fades
      // while its row closes up so the ones below slide into place.
      const exit = o.done
        ? clamp((o.doneFor - OBJECTIVE_STRIKE - OBJECTIVE_HOLD) / OBJECTIVE_EXIT, 0, 1)
        : 0;
      const ease = exit * exit * (3 - 2 * exit);
      ctx.globalAlpha = 1 - ease;
      // Track
      ctx.fillStyle = hexA(PALETTE.text, 0.1);
      this.roundRect(ctx, x, y + 16, w, 6, 3);
      ctx.fill();
      const frac = clamp(o.progress / o.target, 0, 1);
      ctx.fillStyle = o.done
        ? hexA(PALETTE.collectible, 0.95)
        : hexA(PALETTE.anchor, 0.85);
      this.roundRect(ctx, x, y + 16, w * frac, 6, 3);
      ctx.fill();
      this.text(ctx, o.label, x, y, 13, "600", o.done ? PALETTE.collectible : PALETTE.text);
      if (o.done) {
        // The strike runs left to right through the middle of the lettering
        // (measured: the platform font decides how low the text sits).
        const box = this.ink(ctx, o.label, 13, "600");
        const k = clamp(o.doneFor / OBJECTIVE_STRIKE, 0, 1);
        const run = (box.width + 8) * (1 - (1 - k) * (1 - k));
        ctx.fillStyle = PALETTE.collectible;
        ctx.fillRect(x - 4, Math.round(y + (box.top + box.bottom) / 2), run, 2);
      }
      y += 38 * (1 - ease);
    }
    ctx.globalAlpha = 1;
  }

  private drawDashButton(ctx: CanvasRenderingContext2D, cam: Camera, d: HudData) {
    const b = this.dashButton(cam);
    // Gauge ring.
    ctx.lineWidth = 6;
    ctx.strokeStyle = hexA(PALETTE.text, 0.14);
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.stroke();

    const start = -Math.PI / 2;
    ctx.strokeStyle = d.dashReady
      ? hexA(PALETTE.collectible, 0.95)
      : hexA(PALETTE.tether, 0.9);
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, start, start + Math.PI * 2 * d.wind);
    ctx.stroke();

    // Core.
    const pulse = d.dashReady ? 0.5 + Math.sin(performance.now() / 200) * 0.2 : 0.2;
    ctx.fillStyle = d.dashReady
      ? hexA(PALETTE.collectible, pulse)
      : hexA(PALETTE.text, 0.08);
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r - 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    this.setFont(ctx, "800", 13);
    ctx.fillStyle = d.dashReady ? "#06241a" : PALETTE.textDim;
    ctx.fillText("DASH", b.x, b.y);
    ctx.textBaseline = "top";
  }

  private drawAttractScreen(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    d: HudData,
    mode: "menu" | "gameover"
  ) {
    const { w, h } = cam;
    const ins = cam.insets;
    const pulse = 0.82 + Math.sin(performance.now() / 420) * 0.18;

    // Light edge gradients — scene stays visible (Alto-style). Fixed colours,
    // so they only rebuild when the viewport size changes.
    if (!this.attractTop || this.attractGradH !== h) {
      this.attractGradH = h;
      const top = ctx.createLinearGradient(0, 0, 0, h * 0.32);
      top.addColorStop(0, hexA("#0a0d24", 0.28));
      top.addColorStop(1, hexA("#0a0d24", 0));
      this.attractTop = top;
      const bottom = ctx.createLinearGradient(0, h * 0.5, 0, h);
      bottom.addColorStop(0, hexA("#0a0d24", 0));
      bottom.addColorStop(0.5, hexA("#0a0d24", 0.1));
      bottom.addColorStop(1, hexA("#0a0d24", 0.42));
      this.attractBottom = bottom;
    }
    ctx.fillStyle = this.attractTop;
    ctx.fillRect(0, 0, w, h * 0.32);
    ctx.fillStyle = this.attractBottom!;
    ctx.fillRect(0, h * 0.5, w, h * 0.5);

    // Title block — upper centre, stacked by measured ink so the lines keep
    // the same gaps whatever the platform font's metrics are.
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const titleSize = clamp(w * 0.105, 54, 82);
    const titleTop = h * 0.09 + titleSize * 0.04;
    const titleBottom = this.textFromInkTop(
      ctx,
      "GALE",
      w / 2,
      titleTop,
      titleSize,
      "900",
      PALETTE.text,
      true
    );

    if (mode === "menu") {
      this.textFromInkTop(
        ctx,
        "SKY-SAILING",
        w / 2,
        titleBottom + 10,
        12,
        "700",
        hexA(PALETTE.anchorPerfect, 0.88),
        true
      );
    } else {
      if (d.newBest) {
        // Above the title: between the title and the score there is no room
        // for a third line on phone-height screens.
        const banner = "★ NEW BEST ★";
        const box = this.ink(ctx, banner, 13, "800");
        const bestPulse = 0.6 + Math.sin(performance.now() / 200) * 0.4;
        this.textFromInkTop(
          ctx,
          banner,
          w / 2,
          Math.max(ins.top + 4, titleTop - 8 - (box.bottom - box.top)),
          13,
          "800",
          hexA(PALETTE.anchorPerfect, bestPulse),
          true
        );
      }
      const scoreBottom = this.textFromInkTop(
        ctx,
        `${Math.floor(d.score)} pts  ·  ${Math.floor(d.distance)} m`,
        w / 2,
        titleBottom + 10,
        clamp(w * 0.055, 32, 48),
        "800",
        hexA(PALETTE.anchor, 0.98),
        true
      );
      this.textFromInkTop(
        ctx,
        `${d.perfectCount} perfect  ·  ${d.objectivesDone}/${d.objectives.length} objectives  ·  +${d.orbs} orbs`,
        w / 2,
        scoreBottom + 9,
        clamp(w * 0.022, 15, 18),
        "700",
        PALETTE.text,
        true
      );
    }

    // HOW TO PLAY — top left, opposite the orb bank: replays the tutorial.
    {
      const r = this.howToPlayButton(cam);
      ctx.fillStyle = hexA(PALETTE.text, 0.12);
      this.roundRect(ctx, r.x, r.y, r.w, r.h, r.h / 2);
      ctx.fill();
      ctx.strokeStyle = hexA(PALETTE.text, 0.4);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      this.text(ctx, "HOW TO PLAY", r.x + r.w / 2, r.y + r.h / 2 + 1, 12, "800", hexA(PALETTE.text, 0.9));
      ctx.textBaseline = "top";
    }

    // Orb bank — top right. Number right-aligned against the orb glyph.
    {
      const coinX = w - 40 - ins.right;
      const coinY = 38 + ins.top;
      drawOrbIcon(ctx, coinX, coinY, 11);
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      this.text(ctx, `${d.orbBank}`, coinX - 20, coinY - 13, 24, "800", ORB_COLOR, true);
      this.text(ctx, "ORBS", coinX + 12, coinY + 18, 10, "700", PALETTE.textDim);
      ctx.textAlign = "center";
    }

    // Character picker — placement derives from the play button so the two
    // never drift apart (characterCycleButton is also the hit-test).
    const play = this.playButton(cam);
    const pickY = this.characterCycleButton(cam, 1).y;
    for (const dir of [-1, 1] as const) {
      const b = this.characterCycleButton(cam, dir);
      ctx.fillStyle = hexA(PALETTE.text, 0.14);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = hexA(PALETTE.text, 0.42);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = hexA(PALETTE.text, 0.9);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      this.setFont(ctx, "700", b.r * 0.95);
      ctx.fillText(dir < 0 ? "‹" : "›", b.x, b.y + 1);
    }
    ctx.textBaseline = "top";
    this.text(
      ctx,
      d.characterName.toUpperCase(),
      w / 2,
      pickY - 34,
      14,
      "800",
      PALETTE.text,
      true
    );
    // Keyboard hint: pointless on touch screens, and hidden whenever the
    // layout is too cramped for it to clear the play button.
    if (!COARSE_POINTER && pickY + 50 < play.y - play.r) {
      this.text(
        ctx,
        "C  or  ← →  to change",
        w / 2,
        pickY + 34,
        11,
        "600",
        hexA(PALETTE.textDim, 0.85),
        true
      );
    }

    // Play button — bottom center circle with triangle.
    ctx.fillStyle = hexA(PALETTE.text, 0.16 * pulse);
    ctx.beginPath();
    ctx.arc(play.x, play.y, play.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexA(PALETTE.text, 0.55);
    ctx.lineWidth = 2.5;
    ctx.stroke();

    const tri = play.r * 0.38;
    ctx.fillStyle = hexA(PALETTE.text, 0.92);
    ctx.beginPath();
    ctx.moveTo(play.x - tri * 0.45, play.y - tri);
    ctx.lineTo(play.x + tri * 0.85, play.y);
    ctx.lineTo(play.x - tri * 0.45, play.y + tri);
    ctx.closePath();
    ctx.fill();

    this.text(
      ctx,
      "TAP TO PLAY",
      play.x,
      play.y + play.r + 18,
      12,
      "700",
      hexA(PALETTE.textDim, pulse),
      true
    );

    // Best run — bottom left.
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    if (d.bestDistance > 0) {
      this.text(
        ctx,
        `${Math.floor(d.bestDistance)} m`,
        28 + ins.left,
        h - 82 - ins.bottom,
        30,
        "800",
        PALETTE.text,
        true
      );
      this.text(ctx, "BEST RUN", 28 + ins.left, h - 48 - ins.bottom, 11, "700", PALETTE.textDim);
    } else {
      this.text(ctx, "FIRST FLIGHT", 28 + ins.left, h - 58 - ins.bottom, 11, "700", PALETTE.textDim);
    }

    // Mute — bottom right (M on a keyboard too).
    this.drawMuteButton(ctx, cam, d, true);
    if (!COARSE_POINTER) {
      const m = this.muteButton(cam, true);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      this.text(ctx, "M", m.x, m.y + m.r + 4, 10, "700", hexA(PALETTE.textDim, 0.7));
    }
  }

  /**
   * Where a line of text actually puts ink, relative to the y it is drawn at
   * (textBaseline "top"), plus its width. Fonts disagree badly about this:
   * iOS's system font sits about 0.2em lower than the headless renderer's, so
   * anything stacked against text — the title block, the objective strike —
   * is laid out from measured ink rather than the nominal font size.
   * Requires ctx.textBaseline === "top". Cached; leaves the font set.
   */
  private ink(
    ctx: CanvasRenderingContext2D,
    s: string,
    size: number,
    weight: string
  ): { top: number; bottom: number; width: number } {
    const key = `${weight}|${size}|${s}`;
    let box = this.inkCache.get(key);
    if (!box) {
      this.setFont(ctx, weight, size);
      const m = ctx.measureText(s);
      const asc = m.actualBoundingBoxAscent;
      const desc = m.actualBoundingBoxDescent;
      box =
        Number.isFinite(asc) && Number.isFinite(desc) && desc > 0
          ? { top: -asc, bottom: desc, width: m.width }
          : // No glyph metrics (the test harnesses' canvas mock): nominal box.
            { top: size * 0.05, bottom: size * 0.78, width: m.width };
      if (this.inkCache.size > 96) this.inkCache.clear(); // score strings come and go
      this.inkCache.set(key, box);
    }
    return box;
  }

  /** Draw `s` so its visible top edge lands on `inkTop`; returns its visible bottom edge. */
  private textFromInkTop(
    ctx: CanvasRenderingContext2D,
    s: string,
    x: number,
    inkTop: number,
    size: number,
    weight: string,
    color: string,
    shadow = false
  ): number {
    const box = this.ink(ctx, s, size, weight);
    const y = inkTop - box.top;
    this.text(ctx, s, x, y, size, weight, color, shadow);
    return y + box.bottom;
  }

  private setFont(ctx: CanvasRenderingContext2D, weight: string, size: number) {
    const font = fontFor(weight, size);
    if (font !== this.lastFont) {
      ctx.font = font;
      this.lastFont = font;
    }
  }

  private text(
    ctx: CanvasRenderingContext2D,
    s: string,
    x: number,
    y: number,
    size: number,
    weight: string,
    color: string,
    shadow = false
  ) {
    this.setFont(ctx, weight, size);
    if (shadow) {
      ctx.fillStyle = hexA("#0a0d24", 0.5);
      ctx.fillText(s, x + 2, y + 2);
    }
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
}
