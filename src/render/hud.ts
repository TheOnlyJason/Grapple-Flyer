import { Camera } from "../core/camera";
import { theme } from "./theme";
import { clamp } from "../core/math";
import { hexA } from "../entities/anchor";
import { Objective } from "../systems/objectives";
import type { CharacterId } from "../characters/registry";

const PALETTE = theme; // HUD reads the live theme for cohesive colour grading

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
  objectives: Objective[];
  objectivesDone: number;
  muted: boolean;
  newBest: boolean;
  perfectCount: number;
  hint: string;
  hintAlpha: number;
  character: CharacterId;
  characterName: string;
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

  playButton(cam: Camera): { x: number; y: number; r: number } {
    const r = clamp(cam.w * 0.055, 36, 48);
    return { x: cam.w / 2, y: cam.h * 0.82, r };
  }

  characterCycleButton(
    cam: Camera,
    dir: -1 | 1
  ): { x: number; y: number; r: number } {
    const r = clamp(cam.w * 0.034, 22, 28);
    const cx = cam.w / 2 + dir * clamp(cam.w * 0.19, 110, 150);
    return { x: cx, y: cam.h * 0.68, r };
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

    // --- Objectives (top-right) ---
    this.drawObjectives(ctx, cam, d);

    if (paused) this.drawPauseOverlay(ctx, cam);

    // --- Pause / resume (top-right corner, above overlay) ---
    this.drawPauseButton(ctx, cam, paused);

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
    ctx.fillStyle = hexA(PALETTE.tether, 0.9);
    this.roundRect(ctx, spX, spY, barW * spd, 8, 4);
    ctx.fill();
    this.text(ctx, "SPEED", spX, spY - 18, 10, "700", PALETTE.textDim);

    // --- Centered fading hint ---
    if (d.hintAlpha > 0.01 && d.hint) {
      ctx.textAlign = "center";
      this.setFont(ctx, "600", 18);
      ctx.fillStyle = hexA(PALETTE.text, d.hintAlpha * 0.9);
      ctx.fillText(d.hint, cam.w / 2, cam.h * 0.2);
    }

    // Mute indicator.
    this.text(
      ctx,
      d.muted ? "♪ off (M)" : "♪ on (M)",
      cam.w - 96 - ins.right,
      cam.h - 22 - ins.bottom,
      11,
      "600",
      hexA(PALETTE.textDim, 0.7)
    );
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

  private drawPauseOverlay(ctx: CanvasRenderingContext2D, cam: Camera) {
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
      "Tap ▶ or Esc to resume",
      cam.w / 2,
      cam.h * 0.42 + 52,
      15,
      "600",
      hexA(PALETTE.textDim, pulse),
      true
    );
  }

  private drawObjectives(ctx: CanvasRenderingContext2D, cam: Camera, d: HudData) {
    const ins = cam.insets;
    const x = cam.w - 250 - ins.right;
    let y = 54 + ins.top;
    ctx.textAlign = "left";
    this.text(
      ctx,
      `OBJECTIVES  ${d.objectivesDone}/${d.objectives.length}`,
      x,
      y,
      12,
      "700",
      PALETTE.textDim
    );
    y += 22;
    for (const o of d.objectives) {
      const w = 224;
      const flash = o.justCompleted > 0 ? o.justCompleted / 1.5 : 0;
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
      const col = o.done
        ? PALETTE.collectible
        : flash > 0
        ? PALETTE.anchorPerfect
        : PALETTE.text;
      this.text(
        ctx,
        `${o.done ? "✓ " : ""}${o.label}`,
        x,
        y,
        13,
        "600",
        col
      );
      y += 38;
    }
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

    // Title — stacked, upper center.
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const titleSize = clamp(w * 0.105, 54, 82);
    this.text(ctx, "GALE", w / 2, h * 0.09, titleSize, "900", PALETTE.text, true);

    const subtitleY = h * 0.09 + titleSize * 0.78;
    if (mode === "menu") {
      this.text(
        ctx,
        "SKY-SAILING",
        w / 2,
        subtitleY,
        12,
        "700",
        hexA(PALETTE.anchorPerfect, 0.88),
        true
      );
    } else {
      const scoreSize = clamp(w * 0.055, 32, 48);
      const statsY = subtitleY + scoreSize * 1.05;
      if (d.newBest) {
        const bestPulse = 0.6 + Math.sin(performance.now() / 200) * 0.4;
        this.text(
          ctx,
          "★ NEW BEST ★",
          w / 2,
          subtitleY - scoreSize * 0.55,
          13,
          "800",
          hexA(PALETTE.anchorPerfect, bestPulse),
          true
        );
      }
      this.text(
        ctx,
        `${Math.floor(d.score)} pts  ·  ${Math.floor(d.distance)} m`,
        w / 2,
        subtitleY,
        scoreSize,
        "800",
        hexA(PALETTE.anchor, 0.98),
        true
      );
      this.text(
        ctx,
        `${d.perfectCount} perfect  ·  ${d.objectivesDone}/${d.objectives.length} objectives`,
        w / 2,
        statsY,
        clamp(w * 0.022, 15, 18),
        "700",
        PALETTE.text,
        true
      );
    }

    // Character picker — above the play button.
    const pickY = h * 0.68;
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

    // Play button — bottom center circle with triangle.
    const play = this.playButton(cam);
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

    // Mute — bottom right.
    ctx.textAlign = "right";
    this.text(
      ctx,
      d.muted ? "♪ off   M" : "♪ on   M",
      w - 28 - ins.right,
      h - 48 - ins.bottom,
      11,
      "600",
      hexA(PALETTE.textDim, 0.75)
    );
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
