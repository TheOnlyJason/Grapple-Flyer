import { Camera } from "../core/camera";
import { theme } from "./theme";
import { clamp } from "../core/math";
import { hexA } from "../entities/anchor";
import { Objective } from "../systems/objectives";
import type { CharacterId } from "../characters/registry";

const PALETTE = theme; // HUD reads the live theme for cohesive colour grading

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

  // Drawn INSIDE the world transform so popups track world positions.
  drawWorldPopups(ctx: CanvasRenderingContext2D) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const p of this.popups) {
      const t = p.life / p.maxLife;
      const size = 18 * p.scale * (1.2 - t * 0.2);
      ctx.font = `700 ${size}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillStyle = hexA("#0a0d24", 0.5 * t);
      ctx.fillText(p.text, p.x + 2, p.y + 2);
      ctx.fillStyle = hexA(p.color, t);
      ctx.fillText(p.text, p.x, p.y);
    }
  }

  dashButton(cam: Camera): { x: number; y: number; r: number } {
    const r = clamp(cam.w * 0.06, 40, 56);
    return { x: cam.w - r - 26, y: cam.h - r - 30, r };
  }

  pauseButton(cam: Camera): { x: number; y: number; r: number } {
    const r = clamp(cam.w * 0.026, 18, 23);
    return { x: cam.w - r - 20, y: r + 20, r };
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
    if (this.flash > 0) {
      ctx.fillStyle = hexA(PALETTE.anchorPerfect, this.flash * 0.18);
      ctx.fillRect(0, 0, cam.w, cam.h);
    }

    if (d.state === "menu") return this.drawMenu(ctx, cam, d);
    if (d.state === "gameover") return this.drawGameOver(ctx, cam, d);
    if (d.state === "crashing") return;

    const paused = d.state === "paused";

    // --- Score (top-left) ---
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    this.text(ctx, `${Math.floor(d.score)}`, 24, 20, 38, "800", PALETTE.text);
    this.text(
      ctx,
      `${Math.floor(d.distance)} m`,
      26,
      62,
      16,
      "600",
      PALETTE.textDim
    );
    this.text(
      ctx,
      `BEST ${Math.floor(d.best)}`,
      26,
      84,
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
    ctx.fillStyle = hexA(PALETTE.text, 0.12);
    this.roundRect(ctx, 26, cam.h - 36, barW, 8, 4);
    ctx.fill();
    ctx.fillStyle = hexA(PALETTE.tether, 0.9);
    this.roundRect(ctx, 26, cam.h - 36, barW * spd, 8, 4);
    ctx.fill();
    this.text(ctx, "SPEED", 26, cam.h - 54, 10, "700", PALETTE.textDim);

    // --- Centered fading hint ---
    if (d.hintAlpha > 0.01 && d.hint) {
      ctx.textAlign = "center";
      ctx.font = `600 18px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillStyle = hexA(PALETTE.text, d.hintAlpha * 0.9);
      ctx.fillText(d.hint, cam.w / 2, cam.h * 0.2);
    }

    // Mute indicator.
    this.text(
      ctx,
      d.muted ? "♪ off (M)" : "♪ on (M)",
      cam.w - 96,
      cam.h - 22,
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
    const x = cam.w - 250;
    let y = 54;
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
    ctx.font = `800 13px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = d.dashReady ? "#06241a" : PALETTE.textDim;
    ctx.fillText("DASH", b.x, b.y);
    ctx.textBaseline = "top";
  }

  private drawMenu(ctx: CanvasRenderingContext2D, cam: Camera, d: HudData) {
    const { w, h } = cam;
    const pulse = 0.82 + Math.sin(performance.now() / 420) * 0.18;

    // Light edge gradients — scene stays visible (Alto-style).
    const top = ctx.createLinearGradient(0, 0, 0, h * 0.32);
    top.addColorStop(0, hexA("#0a0d24", 0.28));
    top.addColorStop(1, hexA("#0a0d24", 0));
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, w, h * 0.32);

    const bottom = ctx.createLinearGradient(0, h * 0.5, 0, h);
    bottom.addColorStop(0, hexA("#0a0d24", 0));
    bottom.addColorStop(0.5, hexA("#0a0d24", 0.1));
    bottom.addColorStop(1, hexA("#0a0d24", 0.42));
    ctx.fillStyle = bottom;
    ctx.fillRect(0, h * 0.5, w, h * 0.5);

    // Title — stacked, upper center.
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const titleSize = clamp(w * 0.105, 54, 82);
    this.text(ctx, "GALE", w / 2, h * 0.09, titleSize, "900", PALETTE.text, true);
    this.text(
      ctx,
      "SKY-SAILING",
      w / 2,
      h * 0.09 + titleSize * 0.78,
      12,
      "700",
      hexA(PALETTE.anchorPerfect, 0.88),
      true
    );

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
      ctx.font = `700 ${b.r * 0.95}px ui-sans-serif, system-ui, sans-serif`;
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
        28,
        h - 82,
        30,
        "800",
        PALETTE.text,
        true
      );
      this.text(ctx, "BEST RUN", 28, h - 48, 11, "700", PALETTE.textDim);
    } else {
      this.text(ctx, "FIRST FLIGHT", 28, h - 58, 11, "700", PALETTE.textDim);
    }

    // Mute — bottom right.
    ctx.textAlign = "right";
    this.text(
      ctx,
      d.muted ? "♪ off   M" : "♪ on   M",
      w - 28,
      h - 48,
      11,
      "600",
      hexA(PALETTE.textDim, 0.75)
    );
  }

  private drawGameOver(ctx: CanvasRenderingContext2D, cam: Camera, d: HudData) {
    const cx = cam.w / 2;
    const cy = cam.h * 0.3;
    ctx.textAlign = "center";

    ctx.fillStyle = hexA("#0a0d24", 0.45);
    ctx.fillRect(0, 0, cam.w, cam.h);

    this.text(ctx, "RUN OVER", cx, cy, 52, "900", PALETTE.text, true);
    if (d.newBest) {
      const pulse = 0.6 + Math.sin(performance.now() / 200) * 0.4;
      this.text(
        ctx,
        "★ NEW BEST ★",
        cx,
        cy + 58,
        20,
        "800",
        hexA(PALETTE.anchorPerfect, pulse),
        true
      );
    }

    const sy = cy + 110;
    this.text(ctx, `${Math.floor(d.score)}`, cx, sy, 60, "900", PALETTE.anchor, true);
    this.text(ctx, "SCORE", cx, sy + 64, 13, "700", PALETTE.textDim, true);

    const statY = sy + 104;
    this.text(
      ctx,
      `${Math.floor(d.distance)} m flown   ·   ${d.perfectCount} perfect   ·   ${d.objectivesDone}/${d.objectives.length} objectives`,
      cx,
      statY,
      15,
      "600",
      PALETTE.textDim,
      true
    );

    const pulse = 0.6 + Math.sin(performance.now() / 320) * 0.4;
    this.text(
      ctx,
      "tap / hold to fly again",
      cx,
      cam.h * 0.82,
      22,
      "700",
      hexA(PALETTE.text, pulse),
      true
    );
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
    ctx.font = `${weight} ${size}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
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
