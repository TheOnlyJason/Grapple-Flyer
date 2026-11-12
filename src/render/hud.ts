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
import { TRAILS, type TrailId } from "../characters/trails";
import { NYAN_RAINBOW } from "./drawNyanCat";
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

/** The menus: the home screen, and the pages opened from it. */
export type Page = "home" | "shop" | "settings" | "daily";

type Rect = { x: number; y: number; w: number; h: number };
type Circle = { x: number; y: number; r: number };

export interface HudData {
  state: "menu" | "playing" | "paused" | "crashing" | "gameover";
  score: number;
  distance: number;
  /** The best in view (see bestDaily / bestConserve for which one). */
  best: number;
  bestDistance: number;
  /** The best shown is today's daily-run best. */
  bestDaily: boolean;
  /** The best shown is Conserve momentum's (its own record). */
  bestConserve: boolean;
  /** The day the daily best shown belongs to: "TODAY", or its date ("NOV 11") for a run begun before midnight. */
  bestDay: string;
  /** The daily run just flown beat its day's best: the words for it ("BEST TODAY"), else "". */
  dailyFlag: string;
  /** The menu page in view (menu and game-over states). */
  page: Page;
  /** The shop and the daily run can be opened from the home screen (after the first flight). */
  extras: boolean;
  /** A page shows the result of the run just flown (the daily page, after a daily try). */
  result: boolean;
  /** The daily run: today's date, the tries a day allows and those left, and the time to the next day's world. */
  daily: { label: string; day: number; tries: number; triesLeft: number; nextIn: string; armed: boolean };
  /** The pause screen's RESTART RUN: its words (a daily try says what it costs) and whether it can be used. */
  restartLabel: string;
  canRestart: boolean;
  /** The shop's trails: the one picked and the one worn, and what is owned (per TRAILS entry, on the shop page). */
  trails: {
    pick: TrailId;
    worn: TrailId;
    pickOwned: boolean;
    /** Some locked trail is affordable (a dot on the button says so). */
    canUnlock: boolean;
    owned: readonly boolean[];
  };
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
  /** Rocks about to come in from the right edge: screen y and nearness (0..1). */
  incoming: { y: number; near: number }[];
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
  private homeLabelW = 48;
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
   * The mute button in a run (and on its pause screen): just left of the
   * pause button. There is no keyboard on a phone, so M alone is not enough.
   * (On the menus, sound is a row of the settings page.)
   */
  muteButton(cam: Camera): Circle {
    const p = this.pauseButton(cam);
    const r = Math.round(p.r * 0.85);
    return { x: p.x - p.r - 12 - r, y: p.y, r };
  }

  /** Whether (x, y) hits the mute button: at least a 44 pt target. */
  hitsMute(cam: Camera, x: number, y: number): boolean {
    const b = this.muteButton(cam);
    const r = Math.max(b.r, 22);
    const dx = x - b.x;
    const dy = y - b.y;
    return dx * dx + dy * dy <= r * r;
  }

  private drawMuteButton(ctx: CanvasRenderingContext2D, cam: Camera, d: HudData) {
    const b = this.muteButton(cam);
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
   * The home screen's page buttons: a row of quiet circles in the top-right
   * corner, each with its name under it — SETTINGS, and once the first
   * flight is behind the player (`extras`) SHOP and DAILY. Up there no
   * resting thumb taps them by accident; a tap anywhere else flies.
   */
  navButtons(cam: Camera, extras: boolean): { settings: Circle; shop: Circle | null; daily: Circle | null } {
    const ins = cam.insets;
    const r = 20;
    const pitch = 64;
    const y = ins.top + 20 + r;
    const x = cam.w - ins.right - 44;
    return {
      settings: { x, y, r },
      shop: extras ? { x: x - pitch, y, r } : null,
      daily: extras ? { x: x - 2 * pitch, y, r } : null,
    };
  }

  /**
   * Which page button a tap at (x, y) is for, or null. The buttons' strip,
   * names included, belongs to them: from the first button to the screen's
   * right edge and down past the names, each tap going to the nearest
   * button, so a tap on a name or between two buttons never flies.
   */
  navHit(cam: Camera, extras: boolean, x: number, y: number): "settings" | "shop" | "daily" | null {
    const nav = this.navButtons(cam, extras);
    const all: ["settings" | "shop" | "daily", Circle][] = [["settings", nav.settings]];
    if (nav.shop) all.push(["shop", nav.shop]);
    if (nav.daily) all.push(["daily", nav.daily]);
    const s = nav.settings;
    let left = s.x;
    for (const [, b] of all) left = Math.min(left, b.x);
    if (x < left - 32 || y > s.y + s.r + 24) return null;
    let best: "settings" | "shop" | "daily" = "settings";
    let bestD = Infinity;
    for (const [name, b] of all) {
      const d = Math.abs(x - b.x);
      if (d < bestD) {
        bestD = d;
        best = name;
      }
    }
    return best;
  }

  /**
   * HOME, top left on every page and on a game-over screen: back to the plain
   * home screen (a chevron in a circle and its label; the strip, sized from
   * the drawn label, is the touch target).
   */
  backButton(cam: Camera): Rect {
    return { x: cam.insets.left + 22, y: cam.insets.top + 18, w: 50 + this.homeLabelW + 10, h: 44 };
  }

  /** Where a page's column sits: right of centre, so the gliding character on the left stays in view. */
  private pageCx(cam: Camera, half: number): number {
    return Math.min(cam.w * 0.64, cam.w - cam.insets.right - 16 - half);
  }

  /**
   * The shop: the character (its name between chevrons; the gliding one on
   * the left is the preview) and the trails (the swatches with their prices,
   * the picked trail's name, and its UNLOCK button or WEARING).
   */
  shopPanel(cam: Camera): {
    cx: number;
    pitch: number;
    r: number;
    charLabelY: number;
    charY: number;
    /** Half the distance between the character's chevrons. */
    charHalf: number;
    trailLabelY: number;
    rowY: number;
    nameY: number;
    swatches: { x: number; y: number }[];
    /** UNLOCK's touch target (44 pt tall; the pill drawn in it is slimmer). */
    action: Rect;
  } {
    const n = TRAILS.length;
    const pitch = clamp(cam.w * 0.075, 44, 56);
    const half = (pitch * n) / 2;
    const ins = cam.insets;
    const cx = this.pageCx(cam, half);
    // The column stretches a little on taller screens, and on a tall one
    // (an iPad) sits in the middle of the space under the header.
    const base = ins.top + 76;
    const avail = cam.h - ins.bottom - 16 - base;
    const k = clamp(avail / 214, 1, 1.4);
    const top = base + Math.max(0, (avail - 214 * k) / 2);
    const rowY = top + 96 * k;
    const nameY = rowY + 50;
    const actionY = nameY + 34 * k;
    const swatches = [];
    for (let i = 0; i < n; i++) swatches.push({ x: cx - half + pitch * (i + 0.5), y: rowY });
    return {
      cx,
      pitch,
      r: 16,
      charLabelY: top,
      charY: top + 26 * k,
      charHalf: clamp(cam.w * 0.12, 96, 124),
      trailLabelY: top + 62 * k,
      rowY,
      nameY,
      swatches,
      action: { x: cx - 100, y: actionY - 22, w: 200, h: 44 },
    };
  }

  /** The settings page's rows: sound, the swing option, and the tutorial again. */
  settingsRows(cam: Camera): { cx: number; sound: Rect; momentum: Rect; howTo: Rect; noteY: number } {
    const ins = cam.insets;
    const w = clamp(cam.w * 0.44, 280, 380);
    const h = 46;
    const gap = 12;
    const cx = this.pageCx(cam, w / 2);
    const x = cx - w / 2;
    const total = 3 * h + 2 * gap;
    // Centred in the space under the page's header, with room for the note.
    const top = Math.max(ins.top + 76, (ins.top + 62 + cam.h - ins.bottom - 28 - total) / 2);
    return {
      cx,
      sound: { x, y: top, w, h },
      momentum: { x, y: top + h + gap, w, h },
      howTo: { x, y: top + 2 * (h + gap), w, h },
      noteY: top + total + 18,
    };
  }

  /** The daily page: FLY (one of the day's tries) at the foot of its column. */
  dailyPanel(cam: Camera): { cx: number; top: number; triesY: number; fly: Rect } {
    const ins = cam.insets;
    const cx = this.pageCx(cam, 150);
    // On a phone the column fills the space under the header; on a tall
    // screen (an iPad) it keeps together in the middle of it.
    const base = ins.top + 72;
    const avail = cam.h - ins.bottom - 26 - base;
    const blockH = Math.min(avail, 290);
    const top = base + (avail - blockH) / 2;
    const fly = { x: cx - 110, y: top + blockH - 44, w: 220, h: 44 };
    return { cx, top, triesY: fly.y - 24, fly };
  }

  /** The pause screen's buttons (also their hit-test rectangles): RESTART RUN and HOME side by side, the swing option under them. */
  pauseMenuButtons(cam: Camera): { restart: Rect; home: Rect; momentum: Rect } {
    const w = clamp(cam.w * 0.42, 280, 360);
    const h = 44;
    const gap = 12;
    const x = cam.w / 2 - w / 2;
    const half = (w - gap) / 2;
    // Under the "Tap ▶ or Esc to resume" line, but never off a short screen.
    const top = Math.min(cam.h * 0.42 + 84, cam.h - cam.insets.bottom - 2 * h - gap - 10);
    return {
      restart: { x, y: top, w: half, h },
      home: { x: x + half + gap, y: top, w: half, h },
      momentum: { x, y: top + h + gap, w, h },
    };
  }

  /** Where TAP TO FLY sits (there is no play button: a tap anywhere flies). */
  playButton(cam: Camera): { x: number; y: number; r: number } {
    return { x: cam.w / 2, y: cam.h - cam.insets.bottom - 36, r: 30 };
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
    const run = this.spacedRun(ctx, s, size, weight, trackEm);
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

  /** The glyph widths and total width of a letter-spaced run (cached; leaves the font set). */
  private spacedRun(
    ctx: CanvasRenderingContext2D,
    s: string,
    size: number,
    weight: string,
    trackEm: number
  ): { widths: number[]; track: number; total: number } {
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
    return run;
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
      d.bestDaily && d.best <= 0
        ? `DAILY RUN${d.bestConserve ? " · MOMENTUM" : ""}`
        : `${d.bestDaily ? d.bestDay : "BEST"} ${Math.floor(d.best)}${d.bestConserve ? " · MOMENTUM" : ""}`,
      26 + ins.left,
      84 + ins.top,
      12,
      "600",
      hexA(PALETTE.anchorPerfect, 0.85)
    );
    // Orbs collected this run.
    drawOrbIcon(ctx, 33 + ins.left, 113 + ins.top, 6);
    this.text(ctx, `${d.orbs}`, 46 + ins.left, 105 + ins.top, 14, "700", ORB_COLOR);

    // --- Incoming rocks: a warning puck on the right edge, level with each
    // rock still off screen — a dark disc with a pulsing gold ring and a
    // chevron pointing at it — growing and brightening as it nears (kept
    // clear of the pause and mute buttons above and DASH below).
    if (d.incoming.length) {
      const dash = this.dashButton(cam);
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 110);
      for (const m of d.incoming) {
        const r = 9 + 6 * m.near;
        const a = 0.55 + 0.45 * m.near;
        const x = cam.w - ins.right - 8 - r;
        const top = ins.top + 70 + r;
        const bottom = dash.y - dash.r - 14 - r;
        const y = clamp(m.y, top, Math.max(top, bottom));
        ctx.fillStyle = hexA(PALETTE.anchorPerfect, (0.12 + 0.12 * pulse) * a);
        ctx.beginPath();
        ctx.arc(x, y, r * 1.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hexA(PALETTE.hazard, 0.95 * a);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = hexA(PALETTE.anchorPerfect, (0.6 + 0.4 * pulse) * a);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = hexA(PALETTE.text, 0.9 * a);
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x - r * 0.25, y - r * 0.45);
        ctx.lineTo(x + r * 0.3, y);
        ctx.lineTo(x - r * 0.25, y + r * 0.45);
        ctx.stroke();
        ctx.lineCap = "butt";
      }
    }

    // --- Objectives (top-right) --- (kept out of the way during the tutorial)
    if (!d.tutorial.active) this.drawObjectives(ctx, cam, d);

    if (d.tutorial.active || d.tutorial.alpha > 0.01) this.drawTutorial(ctx, cam, d);

    if (paused) this.drawPauseOverlay(ctx, cam, d);

    // --- Pause / resume and mute (top-right corner, above overlay) ---
    this.drawPauseButton(ctx, cam, paused);
    this.drawMuteButton(ctx, cam, d);

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
    ctx.globalAlpha = d.canRestart ? 1 : 0.45;
    this.pauseButtonBox(ctx, b.restart, d.restartLabel, PALETTE.text);
    ctx.globalAlpha = 1;
    this.pauseButtonBox(ctx, b.home, "HOME", PALETTE.text);
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
   * The menus, in the manner of Alto's Adventure: the live sky is the
   * picture and the type sits quietly on it. The home screen is a light,
   * wide-tracked title, TAP TO FLY (no play button: a tap anywhere flies)
   * and a row of small page buttons; the shop, the settings and the daily
   * run each have a page of their own, with HOME in its top-left corner and
   * its column right of centre, beside the gliding character.
   */
  private drawAttractScreen(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    d: HudData,
    mode: "menu" | "gameover"
  ) {
    const { w, h } = cam;
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

    if (d.page === "shop") this.drawShopPage(ctx, cam, d);
    else if (d.page === "settings") this.drawSettingsPage(ctx, cam, d);
    else if (d.page === "daily") this.drawDailyPage(ctx, cam, d, now);
    else this.drawHomePage(ctx, cam, d, mode === "gameover", breathe, now);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
  }

  /** The home screen; after a run it carries the run's result, and HOME to clear it. */
  private drawHomePage(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    d: HudData,
    over: boolean,
    breathe: number,
    now: number
  ) {
    const { w, h } = cam;
    const ins = cam.insets;
    const white = PALETTE.text;
    ctx.textBaseline = "top";

    // --- Title: light and wide-tracked, upper centre.
    const titleSize = Math.round(clamp(w * 0.075, 40, 70) * (over ? 0.72 : 1));
    const titleInkTop = Math.max(ins.top + 14, h * (over ? 0.07 : 0.15));
    const tBox = this.ink(ctx, "GALE", titleSize, "300");
    const titleY = titleInkTop - tBox.top;
    this.spaced(ctx, "GALE", w / 2, titleY, titleSize, "300", white, 0.32, "center", 0.22);
    const subY = titleY + tBox.bottom + (over ? 8 : 12);
    this.spaced(ctx, "SKY · SAILING", w / 2, subY, over ? 10 : 12, "700", hexA(PALETTE.anchorPerfect, 0.9), 0.5, "center", 0.25);

    // --- The run just flown (game over only).
    if (over) this.drawResult(ctx, cam, d, w / 2, subY + 10 + Math.max(16, h * 0.05), now, 13);

    // --- Top right: the pages. Top left, after a run: HOME.
    this.drawNav(ctx, cam, d);
    if (over) this.drawBackButton(ctx, cam);

    // --- Bottom corners: the best run (left) and the orb bank (right) —
    // plain words, so a resting thumb's tap there just flies.
    this.drawBest(ctx, cam, d);
    this.drawOrbBank(ctx, cam, d, cam.h - ins.bottom - 40);

    // --- Bottom centre: TAP TO FLY. On the narrowest screens the game-over
    // line steps down a size so it clears the corners.
    const tap = this.playButton(cam);
    const tapText = over ? "TAP TO FLY AGAIN" : "TAP TO FLY";
    const tapSize = over && w < 640 ? 12 : 14;
    ctx.textBaseline = "middle";
    this.spaced(ctx, tapText, w / 2, tap.y, tapSize, "700", hexA(white, 0.62 + 0.35 * breathe), over && w < 640 ? 0.3 : 0.42, "center", 0.35);
  }

  /**
   * A run's result: a flag if it set a best, a big light score, POINTS and
   * one line of the rest, on a soft dark wash so a pale day sky cannot
   * swallow it. Centred on `cx`, from `top` down.
   */
  private drawResult(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    d: HudData,
    cx: number,
    top: number,
    now: number,
    statsSize: number
  ) {
    const { w } = cam;
    const white = PALETTE.text;
    ctx.textBaseline = "top";
    let y = top;
    const scoreSize = Math.round(clamp(w * 0.07, 40, 64));
    const flag = d.newBest ? "NEW BEST" : d.dailyFlag;
    const stackH = (flag ? 20 : 0) + scoreSize + 8 + 22 + 16;
    const wash = ctx.createRadialGradient(cx, top + stackH / 2, 10, cx, top + stackH / 2, Math.max(w * 0.34, 190));
    wash.addColorStop(0, hexA("#0a0d24", 0.34));
    wash.addColorStop(1, hexA("#0a0d24", 0));
    ctx.fillStyle = wash;
    ctx.fillRect(0, top - 60, w, stackH + 120);
    if (flag) {
      const a = 0.8 + 0.2 * Math.sin(now / 200);
      this.spaced(ctx, flag, cx, y, 12, "800", hexA(PALETTE.anchorPerfect, a), 0.45, "center", 0.45);
      y += 20;
    }
    const sBox = this.ink(ctx, `${Math.floor(d.score)}`, scoreSize, "300");
    const scoreY = y - sBox.top;
    this.spaced(ctx, `${Math.floor(d.score)}`, cx, scoreY, scoreSize, "300", hexA(PALETTE.anchor, 0.98), 0.06, "center", 0.35);
    y = scoreY + sBox.bottom + 8;
    this.spaced(ctx, "POINTS", cx, y, 11, "700", hexA(white, 0.9), 0.45, "center", 0.45);
    y += 22;
    const gap = statsSize >= 13 ? "   ·   " : "  ·  ";
    const stats = `${Math.floor(d.distance)} M${gap}${d.perfectCount} PERFECT${gap}${d.objectivesDone}/${d.objectives.length} GOALS${gap}+${d.orbs} ORBS`;
    this.spaced(ctx, stats, cx, y, statsSize, "700", white, statsSize >= 13 ? 0.14 : 0.1, "center", 0.45);
  }

  /** The thin circle every control on the menus shares. */
  private circleButton(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
    ctx.fillStyle = hexA(PALETTE.text, 0.14);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexA(PALETTE.text, 0.32);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  /** The home screen's page buttons (see navButtons), each with its name under it. */
  private drawNav(ctx: CanvasRenderingContext2D, cam: Camera, d: HudData) {
    const nav = this.navButtons(cam, d.extras);
    const white = PALETTE.text;
    const ink = hexA(white, 0.9);
    const label = (b: Circle, s: string) => {
      ctx.textBaseline = "middle";
      this.spaced(ctx, s, b.x, b.y + b.r + 12, 9, "700", hexA(white, 0.85), 0.24, "center", 0.3);
    };
    const dot = (b: Circle) => {
      ctx.fillStyle = ORB_COLOR;
      ctx.beginPath();
      ctx.arc(b.x + b.r * 0.72, b.y - b.r * 0.72, 4.5, 0, Math.PI * 2);
      ctx.fill();
    };

    // SETTINGS: a gear.
    {
      const b = nav.settings;
      this.circleButton(ctx, b.x, b.y, b.r);
      ctx.strokeStyle = ink;
      ctx.lineCap = "round";
      ctx.lineWidth = 3.2;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4 + Math.PI / 8;
        ctx.beginPath();
        ctx.moveTo(b.x + Math.cos(a) * 7.5, b.y + Math.sin(a) * 7.5);
        ctx.lineTo(b.x + Math.cos(a) * 10, b.y + Math.sin(a) * 10);
        ctx.stroke();
      }
      ctx.lineCap = "butt";
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 6.2, 0, Math.PI * 2);
      ctx.stroke();
      label(b, "SETTINGS");
    }
    // SHOP: a bag; a gold dot while something locked is affordable.
    if (nav.shop) {
      const b = nav.shop;
      this.circleButton(ctx, b.x, b.y, b.r);
      ctx.fillStyle = ink;
      this.roundRect(ctx, b.x - 8, b.y - 3.5, 16, 12.5, 3);
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y - 3.5, 4.2, Math.PI, 0);
      ctx.stroke();
      if (d.trails.canUnlock) dot(b);
      label(b, "SHOP");
    }
    // DAILY: a calendar face with today's date; a gold dot while a try is left.
    if (nav.daily) {
      const b = nav.daily;
      this.circleButton(ctx, b.x, b.y, b.r);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      this.text(ctx, `${d.daily.day}`, b.x, b.y + 1, 15, "700", ink);
      if (d.daily.triesLeft > 0) dot(b);
      label(b, "DAILY");
    }
  }

  /** HOME, top left: a chevron in a circle and its label (see backButton). */
  private drawBackButton(ctx: CanvasRenderingContext2D, cam: Camera) {
    const r = this.backButton(cam);
    const cx = r.x + 20;
    const cy = r.y + r.h / 2;
    const white = PALETTE.text;
    this.circleButton(ctx, cx, cy, 20);
    ctx.strokeStyle = hexA(white, 0.9);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(cx + 3, cy - 7);
    ctx.lineTo(cx - 4, cy);
    ctx.lineTo(cx + 3, cy + 7);
    ctx.stroke();
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    ctx.textBaseline = "middle";
    this.homeLabelW = this.spaced(ctx, "HOME", cx + 30, cy + 1, 11, "700", hexA(white, 0.9), 0.28, "left", 0.3);
  }

  /** A page's name, level with HOME and centred on the page's column. */
  private drawPageHeader(ctx: CanvasRenderingContext2D, cam: Camera, title: string, cx: number) {
    ctx.textBaseline = "middle";
    this.spaced(ctx, title, cx, cam.insets.top + 41, 22, "300", PALETTE.text, 0.32, "center", 0.25);
  }

  /** The best in view (see HudData.bestDaily / bestConserve), bottom left. */
  private drawBest(ctx: CanvasRenderingContext2D, cam: Camera, d: HudData) {
    const white = PALETTE.text;
    const left = cam.insets.left + 26;
    const baseY = cam.h - cam.insets.bottom - 24;
    ctx.textBaseline = "top";
    const bestLabel = `${d.bestDaily ? d.bestDay : "BEST"}${d.bestConserve ? " · MOMENTUM" : ""}`;
    if (d.bestDistance > 0) {
      const best = `${Math.floor(d.bestDistance)}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      this.spaced(ctx, bestLabel, left, baseY - 40, 11, "700", hexA(white, 0.75), 0.4, "left", 0.3);
      this.spaced(ctx, `${best} m`, left, baseY - 24, 22, "300", white, 0.04, "left", 0.3);
    } else if (d.bestDaily || d.bestConserve) {
      // A record of its own not set yet (today's, or Conserve momentum's).
      this.spaced(ctx, bestLabel, left, baseY - 40, 11, "700", hexA(white, 0.75), 0.4, "left", 0.3);
      this.spaced(ctx, "—", left, baseY - 24, 22, "300", white, 0.04, "left", 0.3);
    } else {
      this.spaced(ctx, "FIRST FLIGHT", left, baseY - 14, 11, "700", hexA(white, 0.75), 0.4, "left", 0.3);
    }
  }

  /** The orb bank against the right edge, its icon centred on `oy`. */
  private drawOrbBank(ctx: CanvasRenderingContext2D, cam: Camera, d: HudData, oy: number) {
    const ox = cam.w - cam.insets.right - 34;
    drawOrbIcon(ctx, ox, oy, 9);
    ctx.textBaseline = "middle";
    this.spaced(ctx, `${d.orbBank}`.replace(/\B(?=(\d{3})+(?!\d))/g, ","), ox - 18, oy + 1, 19, "600", ORB_COLOR, 0.04, "right", 0.3);
    ctx.textBaseline = "top";
    this.spaced(ctx, "ORBS", ox + 9, oy + 14, 10, "700", hexA(PALETTE.text, 0.75), 0.4, "right", 0.3);
  }

  /** A soft dark wash behind a page's column, as under the game-over score. */
  private pageWash(ctx: CanvasRenderingContext2D, cam: Camera, cx: number, cy: number, radius: number) {
    const wash = ctx.createRadialGradient(cx, cy, 10, cx, cy, radius);
    wash.addColorStop(0, hexA("#0a0d24", 0.36));
    wash.addColorStop(1, hexA("#0a0d24", 0));
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, cam.w, cam.h);
  }

  /** A trail's colours for its swatch; "own" shows the character's own trail. */
  private trailColors(id: TrailId, character: CharacterId): readonly string[] {
    if (id !== "own") return TRAILS.find((t) => t.id === id)!.colors;
    if (character === "nyan") return NYAN_RAINBOW;
    if (character === "monkey") return OWN_GOLD;
    return OWN_WHITE;
  }

  /** The shop page (see shopPanel): the character, the trails, and the orbs to spend. */
  private drawShopPage(ctx: CanvasRenderingContext2D, cam: Camera, d: HudData) {
    const P = this.shopPanel(cam);
    const white = PALETTE.text;
    const gold = PALETTE.anchorPerfect;
    this.pageWash(ctx, cam, P.cx, (P.charLabelY + P.action.y + P.action.h) / 2, Math.max(P.pitch * 4.8, 230));
    this.drawBackButton(ctx, cam);
    this.drawPageHeader(ctx, cam, "SHOP", P.cx);
    this.drawOrbBank(ctx, cam, d, cam.insets.top + 36);

    // --- The character: its name between thin chevrons.
    ctx.textBaseline = "middle";
    this.spaced(ctx, "CHARACTER", P.cx, P.charLabelY, 10, "800", hexA(gold, 0.95), 0.45, "center", 0.4);
    this.spaced(ctx, d.characterName.toUpperCase(), P.cx, P.charY, 14, "700", hexA(white, 0.95), 0.3, "center", 0.3);
    ctx.strokeStyle = hexA(white, 0.8);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (const dir of [-1, 1]) {
      const x = P.cx + dir * P.charHalf;
      ctx.beginPath();
      ctx.moveTo(x - dir * 4, P.charY - 8);
      ctx.lineTo(x + dir * 4, P.charY);
      ctx.lineTo(x - dir * 4, P.charY + 8);
      ctx.stroke();
    }
    ctx.lineCap = "butt";

    // --- The trails: swatches (a locked one dimmed, with its price under it).
    this.spaced(ctx, "TRAIL", P.cx, P.trailLabelY, 10, "800", hexA(gold, 0.95), 0.45, "center", 0.4);
    for (let i = 0; i < TRAILS.length; i++) {
      const t = TRAILS[i];
      const s = P.swatches[i];
      const owned = d.trails.owned[i] ?? t.id === "own";
      const cols = this.trailColors(t.id, d.character);
      ctx.save();
      ctx.globalAlpha = owned ? 1 : 0.42;
      ctx.beginPath();
      ctx.arc(s.x, s.y, P.r, 0, Math.PI * 2);
      ctx.clip();
      const bandH = (P.r * 2) / cols.length;
      for (let b = 0; b < cols.length; b++) {
        ctx.fillStyle = cols[b];
        ctx.fillRect(s.x - P.r, s.y - P.r + b * bandH - 0.5, P.r * 2, bandH + 1);
      }
      ctx.restore();
      if (t.id === d.trails.pick) {
        ctx.strokeStyle = hexA(white, 0.95);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, P.r + 5, 0, Math.PI * 2);
        ctx.stroke();
      } else if (t.id === d.trails.worn) {
        // Still worn while a locked one is on preview.
        ctx.fillStyle = hexA(white, 0.85);
        ctx.beginPath();
        ctx.arc(s.x, s.y + P.r + 9, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!owned) {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        this.text(ctx, `${t.price}`, s.x, s.y + P.r + 12, 10, "700", hexA(ORB_COLOR, 0.95));
      }
    }

    const pick = TRAILS.find((t) => t.id === d.trails.pick) ?? TRAILS[0];
    ctx.textBaseline = "middle";
    this.spaced(ctx, pick.name.toUpperCase(), P.cx, P.nameY, 14, "700", hexA(white, 0.95), 0.3, "center", 0.3);

    const a = P.action;
    const ay = a.y + a.h / 2;
    if (d.trails.pickOwned) {
      this.spaced(ctx, pick.id === "own" ? "EACH CHARACTER'S OWN" : "WEARING", P.cx, ay, 11, "700", hexA(white, 0.7), 0.35, "center", 0.3);
    } else if (d.orbBank >= pick.price) {
      const price = `${pick.price}`;
      const lw = this.spacedRun(ctx, "UNLOCK", 12, "800", 0.3).total;
      this.setFont(ctx, "700", 13);
      const pw = ctx.measureText(price).width;
      let x = P.cx - (lw + 14 + 14 + pw) / 2;
      this.goldPill(ctx, a);
      this.spaced(ctx, "UNLOCK", x, ay + 1, 12, "800", INK, 0.3, "left");
      x += lw + 14;
      // The orb glyph in the button's ink (a gold orb would vanish on gold).
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(x + 6, ay, 5.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(x + 6, ay, 2.2, 0, Math.PI * 2);
      ctx.fill();
      x += 14;
      ctx.textAlign = "left";
      this.text(ctx, price, x, ay + 1, 13, "700", INK);
    } else {
      const need = pick.price - d.orbBank;
      this.spaced(ctx, `${pick.price} ORBS  ·  ${need} MORE TO GO`, P.cx, ay, 11, "700", hexA(white, 0.75), 0.25, "center", 0.3);
    }
  }

  /** A gold pill in a touch target (the pill is a little slimmer than the target). */
  private goldPill(ctx: CanvasRenderingContext2D, a: Rect) {
    ctx.fillStyle = hexA(PALETTE.anchorPerfect, 0.95);
    this.roundRect(ctx, a.x, a.y + 4, a.w, a.h - 8, (a.h - 8) / 2);
    ctx.fill();
  }

  /** The settings page (see settingsRows): each row a name and what it is set to. */
  private drawSettingsPage(ctx: CanvasRenderingContext2D, cam: Camera, d: HudData) {
    const R = this.settingsRows(cam);
    const white = PALETTE.text;
    this.pageWash(ctx, cam, R.cx, (R.sound.y + R.noteY) / 2, Math.max(R.sound.w * 0.85, 240));
    this.drawBackButton(ctx, cam);
    this.drawPageHeader(ctx, cam, "SETTINGS", R.cx);
    const row = (r: Rect, name: string, value: string, on: boolean) => {
      ctx.fillStyle = hexA(white, 0.12);
      this.roundRect(ctx, r.x, r.y, r.w, r.h, 12);
      ctx.fill();
      ctx.strokeStyle = hexA(white, 0.45);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.textBaseline = "middle";
      const cy = r.y + r.h / 2 + 1;
      this.spaced(ctx, name, r.x + 18, cy, 12, "800", hexA(white, 0.95), 0.2, "left");
      this.spaced(ctx, value, r.x + r.w - 18, cy, 12, "800", on ? PALETTE.collectible : hexA(white, 0.6), 0.2, "right");
    };
    row(R.sound, COARSE_POINTER ? "SOUND" : "SOUND · M", d.muted ? "OFF" : "ON", !d.muted);
    row(R.momentum, "CONSERVE MOMENTUM", d.conserveMomentum ? "ON" : "OFF", d.conserveMomentum);
    row(R.howTo, "HOW TO PLAY", "›", false);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    this.text(ctx, "Conserve momentum keeps your speed through a swing.", R.cx, R.noteY, 11, "600", hexA(white, 0.7));
    this.text(ctx, "It keeps a best of its own.", R.cx, R.noteY + 15, 11, "600", hexA(white, 0.7));
  }

  /**
   * The daily page (see dailyPanel): the day, its best (or, after a try, that
   * try's result), the tries left, and FLY — the only way to begin a try, so
   * none is ever spent by a stray tap.
   */
  private drawDailyPage(ctx: CanvasRenderingContext2D, cam: Camera, d: HudData, now: number) {
    const P = this.dailyPanel(cam);
    const white = PALETTE.text;
    const gold = PALETTE.anchorPerfect;
    const left = d.daily.triesLeft;
    this.pageWash(ctx, cam, P.cx, (P.top + P.fly.y + P.fly.h) / 2, Math.max(cam.w * 0.3, 230));
    this.drawBackButton(ctx, cam);
    this.drawPageHeader(ctx, cam, "DAILY RUN", P.cx);

    if (d.result) {
      this.drawResult(ctx, cam, d, P.cx, P.top, now, cam.w < 700 ? 10 : 12);
    } else {
      // The day, what it is, and the day's best so far.
      ctx.textBaseline = "top";
      const dateSize = Math.round(clamp(cam.w * 0.05, 30, 42));
      const box = this.ink(ctx, d.daily.label, dateSize, "300");
      const dateY = P.top - box.top;
      this.spaced(ctx, d.daily.label, P.cx, dateY, dateSize, "300", white, 0.2, "center", 0.3);
      let y = dateY + box.bottom + 10;
      this.spaced(ctx, "THE SAME SKY FOR EVERYONE", P.cx, y, 10, "700", hexA(gold, 0.9), 0.4, "center", 0.3);
      y += 28;
      const label = `TODAY'S BEST${d.bestConserve ? " · MOMENTUM" : ""}`;
      this.spaced(ctx, label, P.cx, y, 10, "700", hexA(white, 0.75), 0.4, "center", 0.3);
      y += 15;
      const best = d.bestDistance > 0 ? `${`${Math.floor(d.bestDistance)}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")} m` : "NOT FLOWN YET";
      this.spaced(ctx, best, P.cx, y, d.bestDistance > 0 ? 22 : 13, d.bestDistance > 0 ? "300" : "700", white, d.bestDistance > 0 ? 0.04 : 0.3, "center", 0.3);
    }

    // --- The tries: a pip each (gold while unused), and the count in words.
    ctx.textBaseline = "middle";
    const words = left === 0 ? "NO TRIES LEFT TODAY" : left === 1 ? "1 TRY LEFT" : `${left} TRIES LEFT`;
    const tw = this.spacedRun(ctx, words, 11, "700", 0.3).total;
    const pipsW = d.daily.tries * 16;
    let x = P.cx - (pipsW + 8 + tw) / 2;
    for (let i = 0; i < d.daily.tries; i++) {
      ctx.beginPath();
      ctx.arc(x + 6, P.triesY, 5, 0, Math.PI * 2);
      if (i < left) {
        ctx.fillStyle = hexA(gold, 0.95);
        ctx.fill();
      } else {
        ctx.strokeStyle = hexA(white, 0.5);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      x += 16;
    }
    this.spaced(ctx, words, x + 8, P.triesY + 1, 11, "700", hexA(white, 0.9), 0.3, "left", 0.3);

    // --- FLY, or when the day's tries are spent, when the next sky comes.
    const a = P.fly;
    const ay = a.y + a.h / 2;
    if (left > 0) {
      // Dimmed for the moment after a try ends, until it takes a tap.
      ctx.globalAlpha = d.daily.armed ? 1 : 0.45;
      this.goldPill(ctx, a);
      // Which try this would be, so the count is in the button itself.
      const fly = `FLY · TRY ${d.daily.tries - left + 1} OF ${d.daily.tries}`;
      this.spaced(ctx, fly, P.cx, ay + 1, 13, "800", INK, 0.34, "center");
      ctx.globalAlpha = 1;
    } else {
      this.spaced(ctx, `A NEW SKY IN ${d.daily.nextIn}`, P.cx, ay, 12, "700", hexA(gold, 0.95), 0.34, "center", 0.3);
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

/** The dark ink on a gold button. */
const INK = "#0a0d24";
const OWN_WHITE: readonly string[] = ["#ffffff"];
const OWN_GOLD: readonly string[] = ["#ffd45a"];
