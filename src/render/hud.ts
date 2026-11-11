import { Camera } from "../core/camera";
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
  smashSpeed: number; // the threshold in force (higher with Conserve momentum)
  speedBarMax: number;
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
  tutorial: {
    active: boolean;
    key: TutorialKey | null;
    alpha: number;
    holding: boolean;
    gold: boolean;
    /** Screen-y span of what the card is about (the card keeps clear of it). */
    focus: { top: number; bottom: number } | null;
  };
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
  // Which band the tutorial card took (see drawTutorial), per card.
  private tutBandFor: TutorialKey | null = null;
  private tutBandTop = false;
  /** Where the last tutorial card was drawn (screen CSS px), for the probes. */
  lastTutorialCard: { x: number; y: number; w: number; h: number } | null = null;
  private popups: Popup[] = [];
  flash = 0; // screen-wide flash on perfect / big moments
  // Last font set on ctx *within the current HUD pass*. Other draw code can
  // change ctx.font between passes, so each entry point resets this.
  private lastFont = "";
  // Attract-screen edge gradients — fixed colours, rebuilt only on resize.
  private spacedCache = new Map<string, { widths: number[]; track: number; total: number }>();
  // Drawn widths of the corner labels, so their touch targets cover them.
  private howLabelW = 120;
  private soundLabelW = 70;
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
   * The mute button: on the menu and game-over screens top right (where the
   * pause button sits in a run — the bottom corners are where the thumbs
   * rest); during a run (and paused) just left of the pause button. There is
   * no keyboard on a phone, so M alone is not enough.
   */
  muteButton(cam: Camera, attract: boolean): { x: number; y: number; r: number } {
    const ins = cam.insets;
    if (attract) {
      const r = 20;
      return { x: cam.w - ins.right - 24 - r, y: ins.top + 20 + r, r };
    }
    const p = this.pauseButton(cam);
    const r = Math.round(p.r * 0.85);
    return { x: p.x - p.r - 12 - r, y: p.y, r };
  }

  /**
   * Whether (x, y) hits the mute button: at least a 44 pt target, and on the
   * menu screens the label beside the circle counts too.
   */
  hitsMute(cam: Camera, attract: boolean, x: number, y: number): boolean {
    const b = this.muteButton(cam, attract);
    const r = Math.max(b.r, 22);
    const dx = x - b.x;
    const dy = y - b.y;
    if (dx * dx + dy * dy <= r * r) return true;
    return attract && Math.abs(dy) <= 22 && x <= b.x && x >= b.x - b.r - 10 - this.soundLabelW - 8;
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

  /**
   * HOW TO PLAY on the menu and game-over screens: top left, mirroring the
   * sound button (a "?" in a circle and its label; the whole strip, sized
   * from the drawn label, is the touch target). Kept out of the bottom
   * corners, where a resting thumb taps to fly again.
   */
  howToPlayButton(cam: Camera): { x: number; y: number; w: number; h: number } {
    const h = 44;
    return { x: cam.insets.left + 22, y: cam.insets.top + 18, w: 50 + this.howLabelW + 10, h };
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

  /** Where TAP TO FLY sits (there is no play button: a tap anywhere flies). */
  playButton(cam: Camera): { x: number; y: number; r: number } {
    return { x: cam.w / 2, y: cam.h - cam.insets.bottom - 36, r: 30 };
  }

  /** The thin chevrons either side of the character's name, above TAP TO FLY. */
  characterCycleButton(
    cam: Camera,
    dir: -1 | 1
  ): { x: number; y: number; r: number } {
    const r = 22;
    const cx = cam.w / 2 + dir * clamp(cam.w * 0.12, 96, 124);
    return { x: cx, y: cam.h - cam.insets.bottom - 82, r };
  }

  /**
   * Letter-spaced text, the home screen's voice (wide-tracked capitals in
   * the manner of Alto's Adventure). Drawn a glyph at a time — canvas
   * letterSpacing is missing from older iOS — with the widths cached.
   * `align` places the whole run; returns its width.
   */
  private spaced(
    ctx: CanvasRenderingContext2D,
    s: string,
    x: number,
    y: number,
    size: number,
    weight: string,
    color: string,
    trackEm: number,
    align: "left" | "center" | "right" = "center",
    shadowAlpha = 0
  ): number {
    const key = `${weight}|${size}|${trackEm}|${s}`;
    this.setFont(ctx, weight, size);
    let run = this.spacedCache.get(key);
    if (!run) {
      const widths = [...s].map((ch) => ctx.measureText(ch).width);
      const track = size * trackEm;
      const total = widths.reduce((a, b) => a + b, 0) + track * Math.max(0, widths.length - 1);
      run = { widths, track, total };
      if (this.spacedCache.size > 64) this.spacedCache.clear();
      this.spacedCache.set(key, run);
    }
    let cx = align === "center" ? x - run.total / 2 : align === "right" ? x - run.total : x;
    const align0 = ctx.textAlign;
    ctx.textAlign = "left";
    const chars = [...s];
    for (let i = 0; i < chars.length; i++) {
      if (shadowAlpha > 0) {
        ctx.fillStyle = hexA("#0a0d24", shadowAlpha);
        ctx.fillText(chars[i], cx + 1.5, y + 1.5);
      }
      ctx.fillStyle = color;
      ctx.fillText(chars[i], cx, y);
      cx += run.widths[i] + run.track;
    }
    ctx.textAlign = align0;
    return run.total;
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
    const spd = clamp(d.speed / d.speedBarMax, 0, 1);
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
    const tickX = spX + barW * clamp(d.smashSpeed / d.speedBarMax, 0, 1);
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
    // Two places for a card: low in the frame between the speed bar and
    // DASH (the usual one — the camera keeps the plane near the middle with
    // its anchors above), or up top under SKIP. Whichever covers none of
    // what the card is about wins (bottom on a tie), chosen once per card so
    // it does not jump about while it waits.
    const skipB = this.tutorialSkipButton(cam);
    const bottomCy = cam.h - ins.bottom - 64 - ch / 2;
    const topCy = skipB.y + skipB.h + 12 + ch / 2;
    if (this.tutBandFor !== t.key) {
      this.tutBandFor = t.key;
      const f = t.focus;
      const cover = (c: number) => {
        if (!f) return 0;
        const lo = Math.max(c - ch / 2, f.top - 28);
        const hi = Math.min(c + ch / 2, f.bottom + 28);
        return Math.max(0, hi - lo);
      };
      const cb = cover(bottomCy);
      this.tutBandTop = cb > 0 && cover(topCy) < cb;
    }
    const top = this.tutBandTop;
    const cy = top ? topCy : bottomCy;
    const x0 = cam.w / 2 - cw / 2;
    const y0 = cy - ch / 2;
    this.lastTutorialCard = { x: x0, y: y0, w: cw, h: ch };
    ctx.fillStyle = hexA("#0a0d24", 0.3 * a);
    this.roundRect(ctx, x0, y0, cw, ch, 18);
    ctx.fill();

    const textX = x0 + 24 + glyph;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    // The release card's title turns gold with the rope: now.
    const titleCol = t.key === "release" && t.gold ? PALETTE.anchorPerfect : PALETTE.text;
    this.text(ctx, title, textX, y0 + 16, titleSize, "800", hexA(titleCol, a), true, 0.5 * a);
    this.text(ctx, sub, textX, y0 + 22 + titleSize, 15, "600", hexA(PALETTE.text, 0.85 * a), true, 0.5 * a);

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
      const ax0 = x0 + cw + 6;
      const ay0 = top ? y0 + ch - 6 : cy;
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

  /**
   * The menu and game-over screens, in the manner of Alto's Adventure: the
   * live sky is the picture and the type sits quietly on it — a light,
   * wide-tracked title, small spaced capitals, no play button (a tap
   * anywhere flies), and the few controls tucked into the corners.
   */
  private drawAttractScreen(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    d: HudData,
    mode: "menu" | "gameover"
  ) {
    const { w, h } = cam;
    const ins = cam.insets;
    const now = performance.now();
    const breathe = 0.5 + 0.5 * Math.sin(now / 520);

    // Soft edge gradients — the scene stays the picture. Fixed colours, so
    // they only rebuild when the viewport size changes.
    if (!this.attractTop || this.attractGradH !== h) {
      this.attractGradH = h;
      const top = ctx.createLinearGradient(0, 0, 0, h * 0.4);
      top.addColorStop(0, hexA("#0a0d24", 0.3));
      top.addColorStop(1, hexA("#0a0d24", 0));
      this.attractTop = top;
      const bottom = ctx.createLinearGradient(0, h * 0.55, 0, h);
      bottom.addColorStop(0, hexA("#0a0d24", 0));
      bottom.addColorStop(1, hexA("#0a0d24", 0.38));
      this.attractBottom = bottom;
    }
    ctx.fillStyle = this.attractTop;
    ctx.fillRect(0, 0, w, h * 0.4);
    ctx.fillStyle = this.attractBottom!;
    ctx.fillRect(0, h * 0.55, w, h * 0.45);

    ctx.textBaseline = "top";
    const white = PALETTE.text;

    // --- Title: light and wide-tracked, upper centre.
    const over = mode === "gameover";
    const titleSize = Math.round(clamp(w * 0.075, 40, 70) * (over ? 0.72 : 1));
    const titleInkTop = Math.max(ins.top + 14, h * (over ? 0.07 : 0.15));
    const tBox = this.ink(ctx, "GALE", titleSize, "300");
    const titleY = titleInkTop - tBox.top;
    this.spaced(ctx, "GALE", w / 2, titleY, titleSize, "300", white, 0.32, "center", 0.22);
    const titleBottom = titleY + tBox.bottom;
    const subY = titleBottom + (over ? 8 : 12);
    this.spaced(ctx, "SKY · SAILING", w / 2, subY, over ? 10 : 12, "700", hexA(PALETTE.anchorPerfect, 0.9), 0.5, "center", 0.25);

    // --- The run just flown (game over only): a big light score, one line of
    // the rest, on a soft dark wash so a pale day sky cannot swallow it.
    if (over) {
      let y = subY + 10 + Math.max(16, h * 0.05);
      const stackTop = y;
      const scoreSize = Math.round(clamp(w * 0.07, 40, 64));
      const stackH = (d.newBest ? 20 : 0) + scoreSize + 8 + 22 + 16;
      const wash = ctx.createRadialGradient(w / 2, stackTop + stackH / 2, 10, w / 2, stackTop + stackH / 2, Math.max(w * 0.34, 190));
      wash.addColorStop(0, hexA("#0a0d24", 0.34));
      wash.addColorStop(1, hexA("#0a0d24", 0));
      ctx.fillStyle = wash;
      ctx.fillRect(0, stackTop - 60, w, stackH + 120);
      if (d.newBest) {
        const a = 0.8 + 0.2 * Math.sin(now / 200);
        this.spaced(ctx, "NEW BEST", w / 2, y, 12, "800", hexA(PALETTE.anchorPerfect, a), 0.45, "center", 0.45);
        y += 20;
      }
      const sBox = this.ink(ctx, `${Math.floor(d.score)}`, scoreSize, "300");
      const scoreY = y - sBox.top;
      this.spaced(ctx, `${Math.floor(d.score)}`, w / 2, scoreY, scoreSize, "300", hexA(PALETTE.anchor, 0.98), 0.06, "center", 0.35);
      y = scoreY + sBox.bottom + 8;
      this.spaced(ctx, "POINTS", w / 2, y, 11, "700", hexA(white, 0.9), 0.45, "center", 0.45);
      y += 22;
      const stats = `${Math.floor(d.distance)} M   ·   ${d.perfectCount} PERFECT   ·   ${d.objectivesDone}/${d.objectives.length} GOALS   ·   +${d.orbs} ORBS`;
      this.spaced(ctx, stats, w / 2, y, 13, "700", white, 0.14, "center", 0.45);
    }

    // --- Top corners: HOW TO PLAY (left) and the sound (right) — the
    // controls, up where no resting thumb taps them by accident.
    {
      const r = this.howToPlayButton(cam);
      const cx = r.x + 20;
      const cy = r.y + r.h / 2;
      ctx.fillStyle = hexA(white, 0.14);
      ctx.beginPath();
      ctx.arc(cx, cy, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = hexA(white, 0.32);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      this.text(ctx, "?", cx, cy + 1, 18, "600", hexA(white, 0.9));
      this.howLabelW = this.spaced(ctx, "HOW TO PLAY", cx + 30, cy + 1, 11, "700", hexA(white, 0.9), 0.28, "left", 0.3);
    }
    this.drawMuteButton(ctx, cam, d, true);
    {
      const m = this.muteButton(cam, true);
      const label = d.muted ? "SOUND OFF" : "SOUND";
      ctx.textBaseline = "middle";
      this.soundLabelW = this.spaced(ctx, COARSE_POINTER ? label : `${label} · M`, m.x - m.r - 10, m.y + 1, 11, "700", hexA(white, 0.9), 0.28, "right", 0.3);
    }

    // --- Bottom corners: the best run (left) and the orb bank (right) —
    // plain words, so a resting thumb's tap there just flies.
    ctx.textBaseline = "top";
    const left = ins.left + 26;
    const baseY = h - ins.bottom - 24;
    if (d.bestDistance > 0) {
      const best = `${Math.floor(d.bestDistance)}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      this.spaced(ctx, "BEST", left, baseY - 40, 11, "700", hexA(white, 0.75), 0.4, "left", 0.3);
      this.spaced(ctx, `${best} m`, left, baseY - 24, 22, "300", white, 0.04, "left", 0.3);
    } else {
      this.spaced(ctx, "FIRST FLIGHT", left, baseY - 14, 11, "700", hexA(white, 0.75), 0.4, "left", 0.3);
    }
    {
      const ox = w - ins.right - 34;
      const oy = baseY - 16;
      drawOrbIcon(ctx, ox, oy, 9);
      ctx.textBaseline = "middle";
      this.spaced(ctx, `${d.orbBank}`.replace(/\B(?=(\d{3})+(?!\d))/g, ","), ox - 18, oy + 1, 19, "600", ORB_COLOR, 0.04, "right", 0.3);
      ctx.textBaseline = "top";
      this.spaced(ctx, "ORBS", ox + 9, oy + 14, 10, "700", hexA(white, 0.75), 0.4, "right", 0.3);
    }

    // --- Bottom centre: the character, then TAP TO FLY. On the narrowest
    // screens the game-over line steps down a size so it clears the corners.
    const lb = this.characterCycleButton(cam, -1);
    const rb = this.characterCycleButton(cam, 1);
    ctx.textBaseline = "middle";
    this.spaced(ctx, d.characterName.toUpperCase(), w / 2, lb.y, 14, "700", hexA(white, 0.95), 0.3, "center", 0.3);
    ctx.strokeStyle = hexA(white, 0.8);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (const [b, dir] of [[lb, -1], [rb, 1]] as const) {
      ctx.beginPath();
      ctx.moveTo(b.x - dir * 4, b.y - 8);
      ctx.lineTo(b.x + dir * 4, b.y);
      ctx.lineTo(b.x - dir * 4, b.y + 8);
      ctx.stroke();
    }
    ctx.lineCap = "butt";
    const tap = this.playButton(cam);
    const tapText = over ? "TAP TO FLY AGAIN" : "TAP TO FLY";
    const tapSize = over && w < 640 ? 12 : 14;
    this.spaced(ctx, tapText, w / 2, tap.y, tapSize, "700", hexA(white, 0.62 + 0.35 * breathe), over && w < 640 ? 0.3 : 0.42, "center", 0.35);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
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
    shadow = false,
    shadowAlpha = 0.5
  ) {
    this.setFont(ctx, weight, size);
    if (shadow) {
      ctx.fillStyle = hexA("#0a0d24", shadowAlpha);
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
