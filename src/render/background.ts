import { CONFIG } from "../core/config";
import { Camera } from "../core/camera";
import { clamp, TAU } from "../core/math";
import { hexA } from "../entities/anchor";
import { theme, mixColor, CYCLE_SECONDS } from "./theme";

// Deterministic [0,1) value from an integer cell index — keeps procedural
// silhouettes stable as they scroll (no popping).
function hash01(i: number): number {
  let h = (i ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

// Flat, layered, fog-faded sky in the spirit of Alto's Adventure. All colours
// come from the live time-of-day `theme`, so the whole scene re-grades together
// through dawn / day / golden hour / dusk / night.
export class Background {
  drawSky(ctx: CanvasRenderingContext2D, cam: Camera, time: number) {
    const { w, h } = cam;
    const horizon = h * 0.72 - cam.y * 0.04;
    const daylight = 1 - theme.night;
    const celestial = this.getCelestialPos(cam, horizon, time);

    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, theme.skyTop);
    g.addColorStop(0.45, theme.skyMid);
    g.addColorStop(clamp(horizon / h, 0.4, 0.95), theme.skyHorizon);
    g.addColorStop(1, mixColor(theme.skyHorizon, theme.skyGlow, 0.6));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    if (daylight > 0.08) {
      this.drawSkyLightWash(ctx, cam, celestial, daylight);
    }

    if (theme.night > 0.05) this.drawStars(ctx, cam, horizon);
    this.drawSunMoon(ctx, cam, celestial);
  }

  // Sun / moon arc across the sky over the day-night cycle.
  private getCelestialPos(cam: Camera, horizon: number, time: number) {
    const { w, h } = cam;
    const phase = (time / CYCLE_SECONDS) % 1;
    const isMoon = theme.night > 0.6;
    const travel = isMoon
      ? clamp((phase - 0.48) / 0.48, 0, 1)
      : clamp(phase / 0.58, 0, 1);
    const sx = w * (0.1 + travel * 0.8) - cam.x * 0.02;
    const sy =
      horizon - 24 - Math.sin(travel * Math.PI) * h * 0.36 - cam.y * 0.03;
    return { sx, sy, travel, isMoon, phase };
  }

  private drawSkyLightWash(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    celestial: { sx: number; sy: number; travel: number },
    daylight: number
  ) {
    const { w, h } = cam;
    const { sx, sy } = celestial;
    const reach = Math.max(w, h) * 0.92;

    ctx.save();
    const wash = ctx.createRadialGradient(sx, sy, 24, sx, sy, reach);
    wash.addColorStop(0, hexA(theme.sun, 0.14 * daylight));
    wash.addColorStop(0.2, hexA(theme.skyGlow, 0.08 * daylight));
    wash.addColorStop(0.45, hexA(theme.skyHorizon, 0.035 * daylight));
    wash.addColorStop(0.7, hexA(theme.skyMid, 0.012 * daylight));
    wash.addColorStop(1, hexA(theme.skyTop, 0));
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  private drawStars(ctx: CanvasRenderingContext2D, cam: Camera, horizon: number) {
    const { w } = cam;
    const cell = Math.max(42, w / 26);
    const offX = cam.x * 0.05;
    const offY = cam.y * 0.05;
    const startI = Math.floor((offX - w) / cell);
    const endI = Math.ceil((offX + w) / cell);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = startI; i <= endI; i++) {
      for (let j = -2; j < 13; j++) {
        const r = hash01(i * 131 + j * 977 + 17);
        if (r < 0.6) continue;
        const sx = i * cell - offX + ((hash01(i * 7 + j) * cell) | 0);
        const sy = j * cell - offY + hash01(i + j * 53) * cell;
        if (sy > horizon - 24) continue;
        const tw = 0.4 + 0.6 * hash01(i * 3 + j * 11);
        const fade = clamp((horizon - sy) / horizon, 0, 1);
        ctx.fillStyle = hexA("#e6ecff", (r - 0.6) * 2 * tw * fade * theme.night);
        ctx.fillRect(sx, sy, 1.7, 1.7);
      }
    }
    ctx.restore();
  }

  private drawSunMoon(
    ctx: CanvasRenderingContext2D,
    _cam: Camera,
    celestial: { sx: number; sy: number; isMoon: boolean }
  ) {
    const { sx, sy, isMoon } = celestial;

    if (isMoon) {
      this.drawMoon(ctx, sx, sy);
      return;
    }

    ctx.save();
    const daylight = 1 - theme.night;

    const halo = ctx.createRadialGradient(sx, sy, 20, sx, sy, 300);
    halo.addColorStop(0, hexA(theme.sun, 0.28 * daylight));
    halo.addColorStop(0.35, hexA(theme.skyGlow, 0.12 * daylight));
    halo.addColorStop(0.72, hexA(theme.skyHorizon, 0.04 * daylight));
    halo.addColorStop(1, hexA(theme.skyTop, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(sx, sy, 300, 0, TAU);
    ctx.fill();

    const core = ctx.createRadialGradient(sx, sy - 8, 1, sx, sy, 54);
    core.addColorStop(0, hexA("#ffffff", 0.72));
    core.addColorStop(0.4, hexA(theme.sun, 0.55));
    core.addColorStop(0.78, hexA(theme.skyGlow, 0.18));
    core.addColorStop(1, hexA(theme.skyGlow, 0));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(sx, sy, 54, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // Crescent moon — single filled path (two arcs). Cannot use destination-out
  // because the game canvas is created with alpha:false, which leaves black holes.
  private drawMoon(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
    const r = 34;
    const biteX = 15;
    const biteY = -2;
    const biteR = r * 0.9;
    const limbStart = Math.PI * 0.56;
    const limbEnd = Math.PI * 1.44;

    ctx.save();
    const halo = ctx.createRadialGradient(sx, sy, r * 0.35, sx, sy, r * 2.8);
    halo.addColorStop(0, hexA(theme.sun, 0.22));
    halo.addColorStop(0.55, hexA(theme.skyGlow, 0.08));
    halo.addColorStop(1, hexA(theme.skyGlow, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(sx, sy, r * 2.8, 0, TAU);
    ctx.fill();
    ctx.restore();

    const crescentPath = () => {
      ctx.beginPath();
      ctx.arc(sx, sy, r, limbStart, limbEnd);
      ctx.arc(sx + biteX, sy + biteY, biteR, limbEnd - 0.04, limbStart + 0.04, true);
      ctx.closePath();
    };

    ctx.fillStyle = hexA(theme.sun, 0.96);
    crescentPath();
    ctx.fill();

    ctx.save();
    const sheen = ctx.createRadialGradient(
      sx - r * 0.25,
      sy - r * 0.05,
      r * 0.05,
      sx,
      sy,
      r * 1.05
    );
    sheen.addColorStop(0, hexA("#ffffff", 0.45));
    sheen.addColorStop(0.55, hexA(theme.sun, 0.12));
    sheen.addColorStop(1, hexA(theme.sun, 0));
    ctx.fillStyle = sheen;
    crescentPath();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = hexA("#ffffff", 0.32);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(sx - 1, sy, r - 1.5, limbStart + 0.06, limbEnd - 0.06);
    ctx.stroke();
    ctx.restore();
  }

  drawFar(ctx: CanvasRenderingContext2D, cam: Camera, time: number) {
    const { w, h } = cam;
    const spacing = 620;
    const offset = cam.x * 0.1;
    const startIdx = Math.floor((offset - w) / spacing);
    const endIdx = Math.ceil((offset + w) / spacing);

    for (let i = startIdx; i <= endIdx; i++) {
      const r1 = hash01(i * 2 + 1);
      const r2 = hash01(i * 2 + 7);
      const sx = i * spacing - offset + w * 0.5;
      const sy = h * (0.58 + r1 * 0.08) - cam.y * 0.1;
      const scale = 0.55 + r2 * 0.45;
      this.drawFloatingIsland(ctx, sx, sy, scale, i, mixColor(theme.far, theme.fog, 0.55), r2 > 0.35);
    }

    this.drawBirds(ctx, cam, time);

    // Closer ridge — slightly larger islands, less fog.
    const spacing2 = 480;
    const offset2 = cam.x * 0.16;
    const start2 = Math.floor((offset2 - w) / spacing2);
    const end2 = Math.ceil((offset2 + w) / spacing2);
    for (let i = start2; i <= end2; i++) {
      const r1 = hash01(i * 3 + 11);
      if (r1 < 0.25) continue;
      const r2 = hash01(i * 3 + 19);
      const sx = i * spacing2 - offset2 + w * 0.5;
      const sy = h * (0.66 + r1 * 0.06) - cam.y * 0.16;
      const scale = 0.7 + r2 * 0.55;
      this.drawFloatingIsland(ctx, sx, sy, scale, i + 50, mixColor(theme.far, theme.fog, 0.28), r2 > 0.6);
    }
  }

  private drawBirdGlyph(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    flap: number
  ) {
    const lift = size * (0.42 + flap * 0.38);
    const dip = size * 0.14;
    ctx.beginPath();
    ctx.moveTo(x - size, y + size * 0.04);
    ctx.quadraticCurveTo(x - size * 0.3, y - lift, x, y + dip);
    ctx.quadraticCurveTo(x + size * 0.3, y - lift, x + size, y + size * 0.04);
    ctx.closePath();
    ctx.fill();
  }

  private drawBirds(ctx: CanvasRenderingContext2D, cam: Camera, time: number) {
    const daylight = 1 - theme.night;
    if (daylight < 0.35) return;
    const { w, h } = cam;
    const span = w * 3;
    ctx.fillStyle = hexA(theme.mid, 0.62 * daylight);
    for (let k = 0; k < 2; k++) {
      const fx =
        (((time * 26 + k * 760 - cam.x * 0.18) % span) + span) % span - w * 0.4;
      const fy = h * 0.24 + k * 46 - cam.y * 0.07 + Math.sin(time * 0.4 + k) * 12;
      for (let b = 0; b < 4; b++) {
        const bx = fx + b * 26 - (b % 2) * 6;
        const by = fy + (b % 2) * 10 + Math.sin(time * 6 + b) * 1.5;
        const s = 5.5 + (b % 3) * 0.8;
        const flap = 0.5 + Math.sin(time * 7 + b * 1.7 + k) * 0.5;
        this.drawBirdGlyph(ctx, bx, by, s, flap);
      }
    }
  }

  drawMid(ctx: CanvasRenderingContext2D, cam: Camera) {
    const { w, h } = cam;
    const factor = 0.28;
    const spacing = 440;
    const baseY = h * 0.84 - cam.y * factor;
    const offset = cam.x * factor;
    const startIdx = Math.floor((offset - w) / spacing);
    const endIdx = Math.ceil((offset + w) / spacing);
    const col = mixColor(theme.mid, theme.fog, 0.15);
    const accent = mixColor(theme.mid, theme.skyHorizon, 0.2);

    for (let i = startIdx; i <= endIdx; i++) {
      const r1 = hash01(i * 5 + 3);
      const r2 = hash01(i * 5 + 11);
      if (r1 < 0.28) continue;
      const sx = i * spacing - offset + w * 0.5;
      const sy = baseY + (r1 - 0.5) * 40;
      const scale = 0.85 + r2 * 0.5;
      const kind = r2 > 0.55 ? "arch" : r2 > 0.3 ? "temple" : "pillars";
      this.drawRuin(ctx, sx, sy, scale, i, kind, col, accent);
    }
  }

  drawSea(ctx: CanvasRenderingContext2D, cam: Camera, time: number) {
    const { w, h } = cam;
    const surfaceY = CONFIG.world.seaLevel - cam.y;
    if (surfaceY > h + 200) return;

    const top = Math.max(0, surfaceY - 100);

    // Deep fill beneath the dunes — warm vertical gradient into the haze.
    const body = ctx.createLinearGradient(0, top, 0, h);
    body.addColorStop(0, hexA(theme.sea, 0));
    body.addColorStop(0.12, hexA(theme.sea, 0.5));
    body.addColorStop(0.4, theme.sea);
    body.addColorStop(1, theme.seaDeep);
    ctx.fillStyle = body;
    ctx.fillRect(0, top, w, h - top);

    this.drawSandGrain(ctx, cam, surfaceY, top);

    // Parallax dune layers — back to front, Alto-style rolling sand hills.
    const layers = [
      {
        offset: -72,
        parallax: 0.14,
        layer: 0,
        color: mixColor(theme.sea, theme.fog, 0.62),
        dark: mixColor(theme.seaDeep, theme.fog, 0.5),
        alpha: 0.48,
        ripples: { spacing: 5.5, depth: 32, alpha: 0.07 },
      },
      {
        offset: -42,
        parallax: 0.3,
        layer: 1,
        color: mixColor(theme.sea, theme.fog, 0.35),
        dark: mixColor(theme.seaDeep, theme.fog, 0.25),
        alpha: 0.68,
        ripples: { spacing: 4.2, depth: 48, alpha: 0.1 },
      },
      {
        offset: -14,
        parallax: 0.56,
        layer: 2,
        color: mixColor(theme.sea, theme.seaDeep, 0.18),
        dark: mixColor(theme.seaDeep, theme.fog, 0.08),
        alpha: 0.86,
        ripples: { spacing: 3.2, depth: 68, alpha: 0.13 },
      },
      {
        offset: 0,
        parallax: 0.9,
        layer: 3,
        color: theme.sea,
        dark: theme.seaDeep,
        alpha: 1.0,
        ripples: { spacing: 2.4, depth: 92, alpha: 0.17 },
      },
    ];
    for (const L of layers) {
      this.duneLayer(ctx, cam, surfaceY + L.offset, L.parallax, L.layer, time, L.color, L.dark, L.alpha);
      this.drawDuneGrain(ctx, cam, surfaceY + L.offset, L.parallax, L.layer, time, L.dark);
      this.drawSandRipples(
        ctx,
        cam,
        surfaceY + L.offset,
        L.parallax,
        L.layer,
        time,
        L.color,
        L.dark,
        L.ripples
      );
    }

    this.drawDuneCrestHighlight(ctx, cam, surfaceY, 0.9, 3, time);
    this.drawHorizonHaze(ctx, cam, surfaceY);
  }

  // Fine stipple grain across the whole ground body (base layer beneath dunes).
  private drawSandGrain(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    surfaceY: number,
    top: number
  ) {
    const { w, h } = cam;
    const parallax = 0.35;
    const offX = cam.x * parallax;
    const cell = 14;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, w, h - top);
    ctx.clip();

    const startI = Math.floor((offX - w) / cell);
    const endI = Math.ceil((offX + w) / cell);
    const startJ = Math.floor((surfaceY - top) / cell);
    const endJ = Math.ceil((h - top) / cell) + startJ + 1;

    for (let i = startI; i <= endI; i++) {
      for (let j = startJ; j <= endJ; j++) {
        const r = hash01(i * 113 + j * 197);
        if (r < 0.42) continue;
        const gx = i * cell - offX + hash01(i * 9 + j) * cell;
        const gy = top + j * cell + hash01(i + j * 13) * cell;
        if (gy < surfaceY + 4) continue;
        const bright = r > 0.78;
        ctx.fillStyle = hexA(
          bright ? theme.cloud : theme.seaDeep,
          (r - 0.42) * (bright ? 0.16 : 0.12)
        );
        ctx.fillRect(gx, gy, bright ? 1.4 : 1, bright ? 1.4 : 1);
      }
    }
    ctx.restore();
  }

  // Per-dune grain — clipped stipple on each sand layer for a tactile sandy surface.
  private drawDuneGrain(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    baseY: number,
    parallax: number,
    layer: number,
    time: number,
    dark: string
  ) {
    const { w, h } = cam;
    const cell = 10 + layer;
    const offX = cam.x * parallax;

    ctx.save();
    this.clipToDune(ctx, cam, baseY, parallax, layer, time, h);

    const startI = Math.floor((offX - w) / cell);
    const endI = Math.ceil((offX + w) / cell);
    for (let i = startI; i <= endI; i++) {
      for (let j = 0; j < 14; j++) {
        const r = hash01(i * 89 + j * 157 + layer * 31);
        if (r < 0.48) continue;
        const gx = i * cell - offX + hash01(i * 5 + j) * cell;
        const wx = gx + offX;
        const surface = baseY + this.waveHeight(wx, time, layer);
        const gy = surface + 4 + j * (5 + layer) + hash01(i + j * 11) * 8;
        const bright = r > 0.76;
        ctx.fillStyle = hexA(
          bright ? theme.cloud : dark,
          (r - 0.48) * (bright ? 0.14 : 0.1) * (1 - layer * 0.08)
        );
        ctx.fillRect(gx, gy, bright ? 1.3 : 0.9, bright ? 1.3 : 0.9);
      }
    }
    ctx.restore();
  }

  // Wind-blown sand ripples — dense wavy lines following each dune face (Alto-style).
  private drawSandRipples(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    baseY: number,
    parallax: number,
    layer: number,
    time: number,
    sandLight: string,
    sandDark: string,
    ripples: { spacing: number; depth: number; alpha: number }
  ) {
    const { w, h } = cam;
    const step = 4;
    const { spacing, depth, alpha } = ripples;

    ctx.save();
    this.clipToDune(ctx, cam, baseY, parallax, layer, time, h);

    const rippleDark = mixColor(sandDark, sandLight, 0.15);
    const rippleLight = mixColor(sandLight, theme.cloud, 0.45);

    for (let d = 4; d < depth; d += spacing) {
      const t = d / depth;
      const fade = 1 - t * 0.72;
      const lineAlpha = alpha * fade;
      if (lineAlpha < 0.015) continue;

      // Wind ripples bunch and spread — organic convergence like real sand.
      const freq = 18 + layer * 3 + Math.sin(d * 0.08 + layer) * 4;
      const amp = 1.6 + layer * 0.35 + Math.sin(d * 0.12) * 0.6;
      const phase = d * 0.24 + layer * 1.9;
      const isLight = Math.floor(d / spacing) % 2 === 0;

      ctx.strokeStyle = hexA(isLight ? rippleLight : rippleDark, lineAlpha);
      ctx.lineWidth = isLight ? 0.65 : 0.95;
      ctx.beginPath();
      for (let x = 0; x <= w; x += step) {
        const wx = x + cam.x * parallax;
        const surface = baseY + this.waveHeight(wx, time, layer);
        const ripple =
          Math.sin(wx / freq + phase) * amp +
          Math.sin(wx / (freq * 0.38) + phase * 1.4 + 0.8) * amp * 0.42 +
          Math.sin(wx / (freq * 2.1) + phase * 0.6) * amp * 0.18;
        const y = surface + d + ripple;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  private clipToDune(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    baseY: number,
    parallax: number,
    layer: number,
    time: number,
    bottom: number
  ) {
    const { w } = cam;
    const step = 6;
    ctx.beginPath();
    ctx.moveTo(0, bottom);
    for (let x = 0; x <= w; x += step) {
      const wx = x + cam.x * parallax;
      ctx.lineTo(x, baseY + this.waveHeight(wx, time, layer));
    }
    ctx.lineTo(w, bottom);
    ctx.closePath();
    ctx.clip();
  }

  // Bright rim light along the front dune crest — Alto's glowing sand edge.
  private drawDuneCrestHighlight(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    surfaceY: number,
    parallax: number,
    layer: number,
    time: number
  ) {
    const { w } = cam;
    const step = 4;
    const daylight = 1 - theme.night * 0.7;
    const crestY = (x: number) => {
      const wx = x + cam.x * parallax;
      return surfaceY + this.waveHeight(wx, time, layer);
    };

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // Soft outer glow ribbon.
    ctx.shadowBlur = 14;
    ctx.shadowColor = hexA(theme.cloud, 0.55 * daylight);
    ctx.strokeStyle = hexA(theme.cloud, 0.35 * daylight);
    ctx.lineWidth = 14;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let x = 0; x <= w; x += step) {
      const y = crestY(x) - 1;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Bright sharp crest line.
    ctx.shadowBlur = 6;
    ctx.shadowColor = hexA(theme.cloud, 0.75 * daylight);
    ctx.strokeStyle = hexA(theme.cloud, 0.82 * daylight);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let x = 0; x <= w; x += step) {
      const y = crestY(x) - 1;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Warm shadow band just below the crest — sells the lit ridge.
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = hexA(theme.seaDeep, 0.07 * daylight);
    ctx.lineWidth = 8;
    ctx.beginPath();
    for (let x = 0; x <= w; x += step) {
      const y = crestY(x) + 5;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.restore();
  }

  // Soft haze where the dunes meet the sky — distant layers fade into atmosphere.
  private drawHorizonHaze(ctx: CanvasRenderingContext2D, cam: Camera, surfaceY: number) {
    const { w } = cam;
    const haze = ctx.createLinearGradient(0, surfaceY - 110, 0, surfaceY + 50);
    haze.addColorStop(0, hexA(theme.fog, 0));
    haze.addColorStop(0.35, hexA(theme.fog, 0.08));
    haze.addColorStop(0.65, hexA(theme.fog, 0.18));
    haze.addColorStop(1, hexA(theme.fog, 0));
    ctx.fillStyle = haze;
    ctx.fillRect(0, surfaceY - 110, w, 160);
  }

  // Gentle rolling dune silhouettes — long smooth swells like Alto's sand hills.
  private waveHeight(wx: number, time: number, layer: number): number {
    const t = time * (0.06 + layer * 0.04);
    const a = 1 - layer * 0.14;

    let y = 0;
    y += Math.sin(wx / 680 + t) * 34 * a;
    y += Math.sin(wx / 360 + t * 0.85 + 1.1) * 19 * a;
    y += Math.sin(wx / 185 + t * 1.05 + 2.4) * 9 * a;
    y += Math.sin(wx / 95 + t * 1.2 + 0.5) * 4 * a;

    return y;
  }

  private duneLayer(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    baseY: number,
    parallax: number,
    layer: number,
    time: number,
    color: string,
    dark: string,
    alpha: number
  ) {
    const { w, h } = cam;
    ctx.save();
    ctx.globalAlpha = alpha;
    this.clipToDune(ctx, cam, baseY, parallax, layer, time, h);

    const grad = ctx.createLinearGradient(0, baseY - 60, 0, h);
    grad.addColorStop(0, mixColor(color, theme.cloud, 0.38));
    grad.addColorStop(0.12, mixColor(color, theme.cloud, 0.12));
    grad.addColorStop(0.35, color);
    grad.addColorStop(1, dark);
    ctx.fillStyle = grad;
    ctx.fillRect(0, baseY - 50, w, h - baseY + 50);

    ctx.restore();
  }

  // Drifting motes by day; fireflies by night. World-anchored so they stay in
  // the sky instead of sticking to the screen as the player moves.
  drawAmbient(ctx: CanvasRenderingContext2D, cam: Camera, time: number) {
    const { w, h } = cam;
    const parallaxX = 0.22;
    const parallaxY = 0.18;
    const cell = 320;
    const offX = cam.x * parallaxX;
    const offY = cam.y * parallaxY;
    const startI = Math.floor((offX - w) / cell);
    const endI = Math.ceil((offX + w) / cell);
    const startJ = Math.floor((offY - h) / cell);
    const endJ = Math.ceil((offY + h) / cell);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = startI; i <= endI; i++) {
      for (let j = startJ; j <= endJ; j++) {
        const r = hash01(i * 131 + j * 977 + 17);
        if (r < 0.62) continue;
        const sx = i * cell - offX + hash01(i * 7 + j) * cell;
        const sy = j * cell - offY + hash01(i + j * 53) * cell;
        const tw = 0.4 + 0.6 * Math.sin(time * 1.5 + i + j);
        const a = (0.05 + theme.night * 0.22) * tw * (r - 0.62) * 2.5;
        if (a <= 0.01) continue;
        ctx.fillStyle = hexA(theme.ambient, a);
        ctx.beginPath();
        ctx.arc(sx, sy, 1.1 + r * 1.4, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawForeground(ctx: CanvasRenderingContext2D, cam: Camera, time: number) {
    const { w, h } = cam;
    const parallaxX = 1.15;
    const parallaxY = 0.45;
    const spacing = 580;
    const offsetX = cam.x * parallaxX;
    const startIdx = Math.floor((offsetX - w) / spacing);
    const endIdx = Math.ceil((offsetX + w) / spacing);

    for (let i = startIdx; i <= endIdx; i++) {
      const r1 = hash01(i * 13 + 5);
      if (r1 < 0.42) continue;
      const worldX = i * spacing + hash01(i * 7) * 120;
      const worldY = hash01(i * 19 + 3) * 1800 - 400;
      const sx = worldX - offsetX + w * 0.5;
      const sy = worldY - cam.y * parallaxY + Math.sin(time * 0.5 + i) * 10;
      if (sy < -120 || sy > h + 120) continue;
      this.drawCloudCluster(ctx, sx, sy, 180 + r1 * 140, 0.14 + r1 * 0.06);
    }
  }

  // --- Floating island: flat plateau top, rocky sides, tapered underside. ---

  private drawFloatingIsland(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
    seed: number,
    color: string,
    withTrees: boolean
  ) {
    const rw = (90 + hash01(seed * 7) * 70) * scale;
    const rh = (24 + hash01(seed * 13) * 18) * scale;
    const hang = (28 + hash01(seed * 19) * 38) * scale;
    const skew = (hash01(seed * 23) - 0.5) * rw * 0.12;

    ctx.save();
    ctx.translate(x, y);

    // One continuous silhouette — plateau curves straight into the cliff and
    // underside. No inset corners or separate pieces that leave a visible seam.
    ctx.beginPath();
    ctx.moveTo(-rw, 0);
    ctx.quadraticCurveTo(-rw * 0.4, -rh * 1.2, 0, -rh);
    ctx.quadraticCurveTo(rw * 0.4, -rh * 1.2, rw, 0);
    ctx.quadraticCurveTo(rw * 0.62 + skew, hang * 0.4, rw * 0.22, hang * 0.78);
    ctx.quadraticCurveTo(0, hang, -rw * 0.22, hang * 0.78);
    ctx.quadraticCurveTo(-rw * 0.62 + skew, hang * 0.4, -rw, 0);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, -rh, 0, hang);
    grad.addColorStop(0, mixColor(color, theme.skyGlow, 0.38));
    grad.addColorStop(0.18, mixColor(color, theme.skyGlow, 0.12));
    grad.addColorStop(0.45, color);
    grad.addColorStop(1, mixColor(color, theme.mid, 0.25));
    ctx.fillStyle = grad;
    ctx.fill();

    this.drawIslandVines(ctx, rw, hang, skew, seed, color, scale);

    if (withTrees) {
      const treeCount = 1 + (hash01(seed * 29) * 3) | 0;
      const treeCol = hexA(mixColor(color, theme.mid, 0.45), 0.92);
      const trunkCol = hexA(mixColor(color, theme.mid, 0.65), 0.88);
      for (let t = 0; t < treeCount; t++) {
        const tx = (hash01(seed * 31 + t * 7) - 0.5) * rw * 1.2;
        const surfaceY = this.plateauTopY(tx, rw, rh, 1.2);
        const th = (18 + hash01(seed * 41 + t) * 24) * scale;
        this.drawCypressTree(ctx, tx, surfaceY, th, treeCol, trunkCol);
      }
    }

    ctx.restore();
  }

  // Y on the island underside at a given local X (matches the fill path).
  private islandUndersideY(
    x: number,
    rw: number,
    hang: number,
    skew: number
  ): number | null {
    const segs: [[number, number], [number, number], [number, number]][] = [
      [[rw, 0], [rw * 0.62 + skew, hang * 0.4], [rw * 0.22, hang * 0.78]],
      [[rw * 0.22, hang * 0.78], [0, hang], [-rw * 0.22, hang * 0.78]],
      [[-rw * 0.22, hang * 0.78], [-rw * 0.62 + skew, hang * 0.4], [-rw, 0]],
    ];

    for (const [p0, p1, p2] of segs) {
      const y = this.quadBezierYAtX(p0, p1, p2, x);
      if (y !== null) return y;
    }
    return null;
  }

  private quadBezierYAtX(
    p0: [number, number],
    p1: [number, number],
    p2: [number, number],
    x: number
  ): number | null {
    const [x0, y0] = p0;
    const [x1, y1] = p1;
    const [x2, y2] = p2;
    const a = x0 - 2 * x1 + x2;
    const b = 2 * (x1 - x0);
    const c = x0 - x;

    const ts: number[] = [];
    if (Math.abs(a) < 1e-6) {
      if (Math.abs(b) > 1e-6) {
        const t = -c / b;
        if (t >= 0 && t <= 1) ts.push(t);
      }
    } else {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const s = Math.sqrt(disc);
        for (const t of [(-b - s) / (2 * a), (-b + s) / (2 * a)]) {
          if (t >= 0 && t <= 1) ts.push(t);
        }
      }
    }

    for (const t of ts) {
      const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * y1 + t * t * y2;
      return y;
    }
    return null;
  }

  // Y on the domed plateau top at local X (matches ruin + island fill paths).
  private plateauTopY(
    x: number,
    halfW: number,
    peakH: number,
    controlMul = 1.2
  ): number {
    const yLeft = this.quadBezierYAtX(
      [-halfW, 0],
      [-halfW * 0.4, -peakH * controlMul],
      [0, -peakH],
      x
    );
    if (yLeft !== null) return yLeft;

    const yRight = this.quadBezierYAtX(
      [0, -peakH],
      [halfW * 0.4, -peakH * controlMul],
      [halfW, 0],
      x
    );
    if (yRight !== null) return yRight;

    return -peakH;
  }

  // Wispy vines dangling from the island underside.
  private drawIslandVines(
    ctx: CanvasRenderingContext2D,
    rw: number,
    hang: number,
    skew: number,
    seed: number,
    color: string,
    scale: number
  ) {
    const vineCount = 2 + ((hash01(seed * 53) * 5) | 0);
    const vineCol = hexA(mixColor(color, theme.mid, 0.4), 0.62);
    const leafCol = hexA(mixColor(color, theme.fog, 0.25), 0.5);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (let v = 0; v < vineCount; v++) {
      const along = hash01(seed * 59 + v * 11);
      const anchorX = (along - 0.5) * rw * 1.15;
      const surfaceY = this.islandUndersideY(anchorX, rw, hang, skew);
      if (surfaceY === null) continue;

      const anchorY = surfaceY + 0.5;
      const len = (10 + hash01(seed * 67 + v) * 22) * scale;
      const sway = (hash01(seed * 71 + v) - 0.5) * 14 * scale;
      const curl = (hash01(seed * 73 + v) - 0.5) * 8 * scale;

      ctx.strokeStyle = vineCol;
      ctx.lineWidth = Math.max(0.7, 1.1 * scale);
      ctx.beginPath();
      ctx.moveTo(anchorX, anchorY);
      ctx.bezierCurveTo(
        anchorX + sway * 0.4,
        anchorY + len * 0.35,
        anchorX + sway + curl,
        anchorY + len * 0.72,
        anchorX + sway * 0.55,
        anchorY + len
      );
      ctx.stroke();

      const tipX = anchorX + sway * 0.55;
      const tipY = anchorY + len;
      const leafR = Math.max(1.2, 2.2 * scale);
      ctx.fillStyle = leafCol;
      ctx.beginPath();
      ctx.ellipse(tipX, tipY + leafR * 0.3, leafR, leafR * 1.6, sway * 0.04, 0, TAU);
      ctx.fill();
      if (len > 14 * scale) {
        ctx.beginPath();
        ctx.ellipse(
          anchorX + sway * 0.25,
          anchorY + len * 0.55,
          leafR * 0.75,
          leafR * 1.2,
          curl * 0.05,
          0,
          TAU
        );
        ctx.fill();
      }
    }
  }

  // Stylized cypress / pine — tapered trunk + overlapping frond layers (no gaps).
  private drawCypressTree(
    ctx: CanvasRenderingContext2D,
    x: number,
    baseY: number,
    height: number,
    color: string,
    trunkColor: string
  ) {
    const trunkW = height * 0.14;
    const trunkH = height * 0.34;

    ctx.fillStyle = trunkColor;
    ctx.beginPath();
    ctx.moveTo(x - trunkW * 0.65, baseY);
    ctx.lineTo(x - trunkW * 0.32, baseY - trunkH);
    ctx.lineTo(x + trunkW * 0.32, baseY - trunkH);
    ctx.lineTo(x + trunkW * 0.65, baseY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = color;
    const base = baseY - trunkH;
    const fronds = [
      { yBot: base, yTop: base - height * 0.22, halfW: height * 0.38 },
      { yBot: base - height * 0.16, yTop: base - height * 0.38, halfW: height * 0.31 },
      { yBot: base - height * 0.31, yTop: base - height * 0.52, halfW: height * 0.23 },
      { yBot: base - height * 0.45, yTop: base - height * 0.72, halfW: height * 0.11 },
    ];
    for (const f of fronds) {
      ctx.beginPath();
      ctx.moveTo(x, f.yTop);
      ctx.lineTo(x - f.halfW, f.yBot);
      ctx.lineTo(x + f.halfW, f.yBot);
      ctx.closePath();
      ctx.fill();
    }
  }

  // --- Ancient ruin on a small floating rock base. ---

  private drawRuin(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
    seed: number,
    kind: "pillars" | "temple" | "arch",
    color: string,
    accent: string
  ) {
    ctx.save();
    ctx.translate(x, y);

    // Small floating rock pedestal.
    const pw = 55 * scale;
    const ph = 14 * scale;
    ctx.fillStyle = hexA(color, 0.9);
    ctx.beginPath();
    ctx.moveTo(-pw, 0);
    ctx.quadraticCurveTo(-pw * 0.4, -ph * 1.3, 0, -ph);
    ctx.quadraticCurveTo(pw * 0.4, -ph * 1.3, pw, 0);
    ctx.quadraticCurveTo(pw * 0.3, ph * 1.8, 0, ph * 2.2);
    ctx.quadraticCurveTo(-pw * 0.3, ph * 1.8, -pw, 0);
    ctx.closePath();
    ctx.fill();

    const seam = 1.5 * scale;

    if (kind === "pillars" || kind === "temple") {
      const cols = kind === "temple" ? 3 : 2;
      for (let c = 0; c < cols; c++) {
        const cx = (c - (cols - 1) / 2) * 28 * scale;
        const surfaceY = this.plateauTopY(cx, pw, ph, 1.3);
        const colW = (10 + hash01(seed + c * 3) * 6) * scale;
        const fullH = (80 + hash01(seed + c * 7) * 120) * scale;
        const broken = hash01(seed + c * 11) > 0.45;
        const colH = broken ? fullH * (0.35 + hash01(seed + c * 13) * 0.35) : fullH;

        ctx.fillStyle = hexA(color, 0.95);
        ctx.beginPath();
        ctx.moveTo(cx - colW * 0.5, surfaceY + seam);
        ctx.lineTo(cx - colW * 0.38, surfaceY - colH);
        ctx.lineTo(cx + colW * 0.38, surfaceY - colH);
        ctx.lineTo(cx + colW * 0.5, surfaceY + seam);
        ctx.closePath();
        ctx.fill();

        if (!broken) {
          ctx.fillRect(
            cx - colW * 0.65,
            surfaceY - colH - 8 * scale,
            colW * 1.3,
            8 * scale
          );
        } else {
          ctx.beginPath();
          ctx.moveTo(cx - colW * 0.38, surfaceY - colH);
          ctx.lineTo(cx - colW * 0.2, surfaceY - colH - 6 * scale);
          ctx.lineTo(cx + colW * 0.1, surfaceY - colH - 3 * scale);
          ctx.lineTo(cx + colW * 0.38, surfaceY - colH);
          ctx.closePath();
          ctx.fill();
        }

        if (broken) {
          ctx.fillStyle = hexA(accent, 0.5);
          ctx.fillRect(cx - colW, surfaceY + seam - 4 * scale, colW * 2.1, 4 * scale);
        }
      }
    }

    if (kind === "arch" || kind === "temple") {
      const archW = (kind === "arch" ? 70 : 55) * scale;
      const ax = kind === "arch" ? 0 : 28 * scale;
      const archR = archW * 0.55;
      const footLx = ax - archR;
      const footRx = ax + archR;
      const footY =
        (this.plateauTopY(footLx, pw, ph, 1.3) +
          this.plateauTopY(footRx, pw, ph, 1.3)) *
        0.5;
      ctx.strokeStyle = hexA(color, 0.95);
      ctx.lineWidth = (kind === "arch" ? 12 : 9) * scale;
      ctx.lineCap = "butt";
      const broken = kind === "arch" && hash01(seed * 43) > 0.4;
      if (broken) {
        ctx.beginPath();
        ctx.arc(ax, footY, archR, Math.PI, Math.PI * 1.35);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ax, footY, archR, Math.PI * 1.55, TAU);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(ax, footY, archR, Math.PI, TAU);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  // --- Soft cloud cluster (cauliflower puffs, flat bottom). ---

  private drawCloudCluster(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    alpha: number
  ) {
    const puffs = [
      { dx: 0, dy: 0, r: width * 0.28 },
      { dx: -width * 0.22, dy: width * 0.04, r: width * 0.22 },
      { dx: width * 0.24, dy: width * 0.02, r: width * 0.24 },
      { dx: -width * 0.08, dy: -width * 0.1, r: width * 0.26 },
      { dx: width * 0.1, dy: -width * 0.08, r: width * 0.2 },
      { dx: width * 0.38, dy: width * 0.06, r: width * 0.16 },
      { dx: -width * 0.35, dy: width * 0.05, r: width * 0.15 },
    ];
    ctx.save();
    ctx.globalAlpha = alpha;
    for (const p of puffs) {
      const cx = x + p.dx;
      const cy = y + p.dy;
      const g = ctx.createRadialGradient(
        cx,
        cy - p.r * 0.3,
        p.r * 0.1,
        cx,
        cy + p.r * 0.15,
        p.r
      );
      g.addColorStop(0, hexA(theme.cloud, 0.95));
      g.addColorStop(0.55, hexA(theme.cloud, 0.55));
      g.addColorStop(1, hexA(theme.cloud, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, p.r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}
