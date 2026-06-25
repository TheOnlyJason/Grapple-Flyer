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

// Distinct scenery biomes the run travels through, in the spirit of Alto's
// Odyssey. Each region swaps the mid-ground silhouette features (the sky and
// dunes keep re-grading with the time of day on top). Regions cycle by world
// distance and cross-fade at their seams.
const REGION_KINDS = ["sanctuary", "forest", "village", "peaks", "monuments"] as const;
type RegionKind = (typeof REGION_KINDS)[number];
const REGION_LEN = 3000; // world units per region band

// Flat, layered, fog-faded sky in the spirit of Alto's Adventure. All colours
// come from the live time-of-day `theme`, so the whole scene re-grades together
// through dawn / day / golden hour / dusk / night.
export class Background {
  drawSky(ctx: CanvasRenderingContext2D, cam: Camera, time: number) {
    const { w, h } = cam;
    const horizon = h * 0.72 - cam.y * 0.04;
    const daylight = 1 - theme.night;
    const sky = this.celestialPositions(cam, horizon, time);

    ctx.fillStyle = this.skyGradient(ctx, cam, horizon);
    ctx.fillRect(0, 0, w, h);

    if (daylight > 0.08 && sky.sun.alt > 0) {
      this.drawSkyLightWash(ctx, cam, sky.sun, daylight * sky.sun.alt);
    }

    if (theme.night > 0.05) this.drawStars(ctx, cam, horizon, time);

    // The moon rises in the east as the sun sets in the west — both share the
    // sky through dusk and dawn. Moon under the sun so a faint daytime moon
    // reads softly behind the brighter disc.
    this.drawMoon(ctx, sky.moon);
    this.drawSun(ctx, sky.sun, daylight);
  }

  // Independent sun + moon arcs across the day-night cycle. Each rises from one
  // side, sails over, and sets at the other — so as the sun goes down the moon
  // is already climbing. `alt` is height above the horizon (0 = on the horizon).
  private celestialPositions(cam: Camera, horizon: number, time: number) {
    const { w, h } = cam;
    const phase = (((time / CYCLE_SECONDS) % 1) + 1) % 1;
    const arc = h * 0.4;
    const baseY = horizon - 16 - cam.y * 0.03;
    const xL = w * 0.06 - cam.x * 0.02;
    const xR = w * 0.94 - cam.x * 0.02;

    const body = (rise: number, set: number) => {
      let p = (phase - rise) / (set - rise);
      if (p < 0 || p > 1) {
        const pw = (phase + 1 - rise) / (set - rise);
        if (pw >= 0 && pw <= 1) p = pw;
      }
      const above = p >= 0 && p <= 1;
      const alt = above ? Math.sin(p * Math.PI) : 0;
      const cp = clamp(p, 0, 1);
      return { x: xL + (xR - xL) * cp, y: baseY - alt * arc, alt };
    };

    // Sun: dawn -> dusk. Moon: dusk -> the next dawn (rises as the sun sets).
    return { sun: body(0.0, 0.6), moon: body(0.52, 1.12) };
  }

  private drawSkyLightWash(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    sun: { x: number; y: number },
    daylight: number
  ) {
    const { w, h } = cam;
    const sx = sun.x;
    const sy = sun.y;
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

  private drawStars(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    horizon: number,
    time: number
  ) {
    const { w } = cam;
    const cell = Math.max(32, w / 36); // denser grid = more stars
    const offX = cam.x * 0.05;
    const offY = cam.y * 0.05;
    const startI = Math.floor((offX - w) / cell);
    const endI = Math.ceil((offX + w) / cell);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = startI; i <= endI; i++) {
      for (let j = -2; j < 15; j++) {
        const r = hash01(i * 131 + j * 977 + 17);
        if (r < 0.45) continue; // lower threshold = many more stars
        const sx = i * cell - offX + ((hash01(i * 7 + j) * cell) | 0);
        const sy = j * cell - offY + hash01(i + j * 53) * cell;
        if (sy > horizon - 18) continue;
        // Each star twinkles on its own phase.
        const phase = hash01(i * 17 + j * 5) * TAU;
        const tw = 0.55 + 0.45 * Math.sin(time * 2.2 + phase);
        const fade = clamp((horizon - sy) / horizon, 0, 1);
        const a = (r - 0.45) * 1.7 * tw * fade * theme.night;
        if (a <= 0.01) continue;
        const bright = r > 0.9; // a few standout stars get size + glow
        const size = bright ? 2.4 : 1 + r * 0.9;
        ctx.fillStyle = hexA("#eef2ff", clamp(a, 0, 1));
        ctx.fillRect(sx, sy, size, size);
        if (bright) {
          const g = ctx.createRadialGradient(sx + 1, sy + 1, 0, sx + 1, sy + 1, 6);
          g.addColorStop(0, hexA("#dce6ff", clamp(a * 0.9, 0, 1)));
          g.addColorStop(1, hexA("#dce6ff", 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(sx + 1, sy + 1, 6, 0, TAU);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  private drawSun(
    ctx: CanvasRenderingContext2D,
    sun: { x: number; y: number; alt: number },
    daylight: number
  ) {
    if (sun.alt <= 0 || daylight <= 0.02) return;
    const { x: sx, y: sy } = sun;
    // Dim as it nears the horizon (low altitude = setting / rising).
    const vis = daylight * clamp(sun.alt * 1.5, 0, 1);
    const core = 0.4 + vis * 0.6;

    ctx.save();
    const halo = ctx.createRadialGradient(sx, sy, 20, sx, sy, 300);
    halo.addColorStop(0, hexA(theme.sun, 0.28 * vis));
    halo.addColorStop(0.35, hexA(theme.skyGlow, 0.12 * vis));
    halo.addColorStop(0.72, hexA(theme.skyHorizon, 0.04 * vis));
    halo.addColorStop(1, hexA(theme.skyTop, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(sx, sy, 300, 0, TAU);
    ctx.fill();

    const disc = ctx.createRadialGradient(sx, sy - 8, 1, sx, sy, 54);
    disc.addColorStop(0, hexA("#ffffff", 0.72 * core));
    disc.addColorStop(0.4, hexA(theme.sun, 0.6 * core));
    disc.addColorStop(0.78, hexA(theme.skyGlow, 0.18 * vis));
    disc.addColorStop(1, hexA(theme.skyGlow, 0));
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(sx, sy, 54, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private skyGradient(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    horizon: number
  ): CanvasGradient {
    const { h } = cam;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, theme.skyTop);
    g.addColorStop(0.45, theme.skyMid);
    g.addColorStop(clamp(horizon / h, 0.4, 0.95), theme.skyHorizon);
    g.addColorStop(1, mixColor(theme.skyHorizon, theme.skyGlow, 0.6));
    return g;
  }

  // Full moon — a pale cratered disc with limb darkening and a soft glow.
  // Bold at night, a faint ghost in daylight; fades in as it clears the horizon.
  private drawMoon(
    ctx: CanvasRenderingContext2D,
    moon: { x: number; y: number; alt: number }
  ) {
    if (moon.alt <= 0) return;
    const { x: sx, y: sy } = moon;
    const vis = clamp(moon.alt * 1.7, 0, 1) * (0.26 + 0.74 * theme.night);
    if (vis < 0.02) return;
    const r = 30;

    ctx.save();

    // Soft moonglow halo.
    const halo = ctx.createRadialGradient(sx, sy, r * 0.4, sx, sy, r * 3.2);
    halo.addColorStop(0, hexA(theme.sun, 0.5 * vis));
    halo.addColorStop(0.5, hexA(theme.skyGlow, 0.16 * vis));
    halo.addColorStop(1, hexA(theme.skyGlow, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(sx, sy, r * 3.2, 0, TAU);
    ctx.fill();

    ctx.globalAlpha = vis;

    // Disc with gentle limb darkening (lit from the upper-left).
    const disc = ctx.createRadialGradient(
      sx - r * 0.28,
      sy - r * 0.3,
      r * 0.15,
      sx,
      sy,
      r * 1.08
    );
    disc.addColorStop(0, "#fdfdf6");
    disc.addColorStop(0.55, "#e9edf6");
    disc.addColorStop(0.85, "#cdd4e4");
    disc.addColorStop(1, "#a7afc6");
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, TAU);
    ctx.fill();

    // Craters / maria — clipped to the disc so nothing spills past the rim.
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, TAU);
    ctx.clip();
    const craters: [number, number, number][] = [
      [-0.32, -0.2, 0.26],
      [0.22, -0.32, 0.15],
      [0.36, 0.16, 0.2],
      [-0.06, 0.34, 0.16],
      [-0.44, 0.24, 0.11],
      [0.04, 0.0, 0.1],
      [0.52, -0.12, 0.08],
    ];
    for (const [cx, cy, cr] of craters) {
      const px = sx + cx * r;
      const py = sy + cy * r;
      const pr = cr * r;
      const cg = ctx.createRadialGradient(
        px - pr * 0.3,
        py - pr * 0.3,
        pr * 0.1,
        px,
        py,
        pr
      );
      cg.addColorStop(0, hexA("#bcc4d8", 0.85));
      cg.addColorStop(0.7, hexA("#a7afc8", 0.7));
      cg.addColorStop(1, hexA("#a7afc8", 0));
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, TAU);
      ctx.fill();
      // Bright sunlit rim along the lower-right of each crater.
      ctx.strokeStyle = hexA("#ffffff", 0.3);
      ctx.lineWidth = Math.max(0.6, pr * 0.16);
      ctx.beginPath();
      ctx.arc(px, py, pr * 0.9, Math.PI * 0.08, Math.PI * 0.92);
      ctx.stroke();
    }
    ctx.restore();

    // Crisp highlight arc on the lit edge.
    ctx.strokeStyle = hexA("#ffffff", 0.4);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(sx, sy, r - 1.2, Math.PI * 0.95, Math.PI * 1.78);
    ctx.stroke();

    ctx.restore();
  }

  // Which region a world-X falls in, plus a 0..1 fade that dips to 0 at the
  // seams so neighbouring biomes cross-dissolve as you scroll between them.
  private regionAt(worldX: number): { kind: RegionKind; fade: number } {
    const t = worldX / REGION_LEN;
    const idx = Math.floor(t);
    const frac = t - idx;
    const FADE = 0.13;
    let fade = 1;
    if (frac < FADE) fade = frac / FADE;
    else if (frac > 1 - FADE) fade = (1 - frac) / FADE;
    const n = REGION_KINDS.length;
    const kind = REGION_KINDS[((idx % n) + n) % n];
    return { kind, fade: clamp(fade, 0, 1) };
  }

  // Deep, layered mountain ranges fading into haze behind everything — the
  // single biggest "depth" cue from Alto. Three ridges at increasing parallax.
  drawMountains(ctx: CanvasRenderingContext2D, cam: Camera) {
    const { w, h } = cam;
    const layers = [
      { parallax: 0.035, baseY: 0.6, height: 130, cell: 240, mix: 0.72, alpha: 0.5 },
      { parallax: 0.065, baseY: 0.65, height: 180, cell: 300, mix: 0.52, alpha: 0.66 },
      { parallax: 0.1, baseY: 0.71, height: 240, cell: 360, mix: 0.32, alpha: 0.82 },
    ];
    layers.forEach((L, li) => {
      const baseY = h * L.baseY - cam.y * L.parallax;
      const offX = cam.x * L.parallax;
      const color = mixColor(theme.far, theme.fog, L.mix);
      const snow = mixColor(color, theme.cloud, 0.62);
      const startI = Math.floor((offX - w) / L.cell) - 1;
      const endI = Math.ceil((offX + w) / L.cell) + 1;

      // Peak / valley vertices for this ridge (valley sits to a peak's right).
      const pts: { x: number; apexY: number; ph: number; valX: number; valY: number }[] = [];
      for (let i = startI; i <= endI; i++) {
        const px = i * L.cell - offX + w * 0.5;
        const ph = (0.45 + hash01(i * 131 + li * 17) * 0.55) * L.height;
        const valX = px + L.cell * 0.5;
        const valY = baseY - ph * (0.1 + hash01(i * 71 + li) * 0.18);
        pts.push({ x: px, apexY: baseY - ph, ph, valX, valY });
      }

      ctx.save();
      ctx.globalAlpha = L.alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, h);
      for (const p of pts) {
        ctx.lineTo(p.x, p.apexY);
        ctx.lineTo(p.valX, p.valY);
      }
      ctx.lineTo(pts[pts.length - 1].valX, h);
      ctx.closePath();
      ctx.fill();

      // Snow caps that hug the peak: they ride down the real left/right slopes
      // to a snow line, with a softly jagged lower edge (no sideways "brims").
      if (li >= 1) {
        ctx.globalAlpha = L.alpha * (li === 2 ? 0.6 : 0.4);
        ctx.fillStyle = snow;
        const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
        for (let j = 1; j < pts.length; j++) {
          const p = pts[j];
          if (p.ph < L.height * 0.55) continue;
          const f = 0.26 + hash01(j * 53 + li) * 0.1; // snow line depth
          // Left slope runs from the apex back to the previous valley.
          const lvX = pts[j - 1].valX;
          const lvY = pts[j - 1].valY;
          const Lx = lerp(p.x, lvX, f);
          const Ly = lerp(p.apexY, lvY, f);
          const Rx = lerp(p.x, p.valX, f);
          const Ry = lerp(p.apexY, p.valY, f);
          const dip = p.ph * 0.05;
          ctx.beginPath();
          ctx.moveTo(p.x, p.apexY);
          ctx.lineTo(Lx, Ly);
          ctx.lineTo(lerp(Lx, Rx, 0.3), lerp(Ly, Ry, 0.3) + dip);
          ctx.lineTo(lerp(Lx, Rx, 0.52), lerp(Ly, Ry, 0.52) - dip * 0.4);
          ctx.lineTo(lerp(Lx, Rx, 0.74), lerp(Ly, Ry, 0.74) + dip);
          ctx.lineTo(Rx, Ry);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
    });
  }

  // Soft, slow-drifting cloud banks high in the sky, well behind the mountains.
  // Low parallax keeps them feeling far away; they thin out at night.
  drawSkyClouds(ctx: CanvasRenderingContext2D, cam: Camera, time: number) {
    const { w, h } = cam;
    const dayish = 1 - theme.night * 0.55;
    const layers = [
      { parallax: 0.05, y: 0.15, speed: 4, scale: 1.35, alpha: 0.1, spacing: 780, seed: 0 },
      { parallax: 0.09, y: 0.29, speed: 8, scale: 1.0, alpha: 0.14, spacing: 600, seed: 64 },
    ];
    for (const L of layers) {
      const offX = cam.x * L.parallax + time * L.speed;
      const startI = Math.floor((offX - w) / L.spacing) - 1;
      const endI = Math.ceil((offX + w) / L.spacing) + 1;
      for (let i = startI; i <= endI; i++) {
        const r = hash01(i * 13 + L.seed);
        if (r < 0.38) continue;
        const sx = i * L.spacing - offX + w * 0.5;
        const sy = h * L.y - cam.y * L.parallax + (r - 0.5) * 70;
        const width = (180 + r * 170) * L.scale;
        this.drawCloudCluster(ctx, sx, sy, width, L.alpha * dayish);
      }
    }
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
      this.drawFloatingIsland(ctx, sx, sy, scale, i, mixColor(theme.far, theme.fog, 0.55), r2 > 0.35, time);
    }

    this.drawBirds(ctx, cam, time);
    this.drawBats(ctx, cam, time);
    this.drawButterflies(ctx, cam, time);

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
      this.drawFloatingIsland(ctx, sx, sy, scale, i + 50, mixColor(theme.far, theme.fog, 0.28), r2 > 0.6, time);
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
    // A few loose flocks drifting at different heights and speeds.
    const flocks = [
      { y: 0.2, speed: 26, count: 5, size: 6.2, drift: 12 },
      { y: 0.3, speed: 19, count: 4, size: 5.2, drift: 9 },
      { y: 0.14, speed: 33, count: 6, size: 4.6, drift: 7 },
    ];
    for (let k = 0; k < flocks.length; k++) {
      const F = flocks[k];
      const fx =
        (((time * F.speed + k * 760 - cam.x * 0.18) % span) + span) % span -
        w * 0.4;
      const fy =
        h * F.y - cam.y * 0.07 + Math.sin(time * 0.4 + k) * F.drift;
      for (let b = 0; b < F.count; b++) {
        // V-formation: birds fan back and down from the leader.
        const bx = fx + b * 24 - (b % 2) * 6;
        const by = fy + b * 7 + (b % 2) * 4 + Math.sin(time * 6 + b) * 1.5;
        const s = F.size + (b % 3) * 0.7;
        const flap = 0.5 + Math.sin(time * 7 + b * 1.7 + k) * 0.5;
        this.drawBirdGlyph(ctx, bx, by, s, flap);
      }
    }
  }

  // Nocturnal flyers — small bat silhouettes that come out once it's dark, so
  // the night sky isn't empty after the birds turn in.
  private drawBats(ctx: CanvasRenderingContext2D, cam: Camera, time: number) {
    if (theme.night < 0.45) return;
    const { w, h } = cam;
    const span = w * 3.2;
    ctx.save();
    ctx.fillStyle = hexA(theme.mid, 0.85 * theme.night);
    for (let k = 0; k < 6; k++) {
      const seed = k * 97 + 13;
      const speed = 18 + (k % 3) * 10;
      const x =
        (((time * speed + seed * 31 - cam.x * 0.16) % span) + span) % span -
        w * 0.5;
      const y =
        h * (0.14 + hash01(seed) * 0.26) -
        cam.y * 0.06 +
        Math.sin(time * (0.9 + (k % 2) * 0.5) + k) * 26;
      const s = 5 + hash01(seed * 3) * 4;
      const flap = Math.sin(time * 11 + k * 1.3);
      this.drawBatGlyph(ctx, x, y, s, flap);
    }
    ctx.restore();
  }

  private drawBatGlyph(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    s: number,
    flap: number
  ) {
    const up = s * (0.35 + (flap * 0.5 + 0.5) * 0.65);
    ctx.beginPath();
    ctx.moveTo(x, y - s * 0.1);
    // Left scalloped wing.
    ctx.quadraticCurveTo(x - s * 0.7, y - up, x - s * 1.6, y - up * 0.15);
    ctx.quadraticCurveTo(x - s * 1.05, y + s * 0.05, x - s * 0.72, y + s * 0.1);
    ctx.quadraticCurveTo(x - s * 0.5, y + s * 0.05, x - s * 0.28, y + s * 0.22);
    // Little body dip.
    ctx.quadraticCurveTo(x, y + s * 0.42, x + s * 0.28, y + s * 0.22);
    // Right scalloped wing (mirror).
    ctx.quadraticCurveTo(x + s * 0.5, y + s * 0.05, x + s * 0.72, y + s * 0.1);
    ctx.quadraticCurveTo(x + s * 1.05, y + s * 0.05, x + s * 1.6, y - up * 0.15);
    ctx.quadraticCurveTo(x + s * 0.7, y - up, x, y - s * 0.1);
    ctx.closePath();
    ctx.fill();
  }

  // Daytime butterflies — small flecks of colour that flutter past closer to
  // the player than the birds, bobbing and beating their wings.
  private drawButterflies(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    time: number
  ) {
    const daylight = 1 - theme.night;
    if (daylight < 0.4) return;
    const { w, h } = cam;
    const cols = ["#ff7eb3", "#ffd166", "#7ec8ff", "#c89bff", "#ff9f6b"];
    const span = w * 2.4;
    ctx.save();
    for (let k = 0; k < 7; k++) {
      const seed = k * 53 + 7;
      const col = cols[k % cols.length];
      const speed = 16 + (k % 3) * 9;
      const x =
        (((time * speed + seed * 40 - cam.x * 0.5) % span) + span) % span -
        w * 0.3;
      const y =
        h * (0.3 + hash01(seed) * 0.22) -
        cam.y * 0.22 +
        Math.sin(time * 1.7 + k) * 26;
      const s = 4 + hash01(seed * 5) * 3;
      const flap = Math.abs(Math.sin(time * 9 + k));
      this.drawButterflyGlyph(ctx, x, y, s, flap, col, daylight);
    }
    ctx.restore();
  }

  private drawButterflyGlyph(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    s: number,
    flap: number,
    col: string,
    daylight: number
  ) {
    const wingW = s * (0.35 + flap * 0.7);
    ctx.globalAlpha = 0.85 * daylight;
    ctx.fillStyle = col;
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(x + sgn * wingW, y - s * 0.32, wingW, s * 0.72, sgn * 0.5, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + sgn * wingW * 0.78, y + s * 0.4, wingW * 0.7, s * 0.5, sgn * -0.4, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = hexA("#2a1d12", daylight);
    ctx.fillRect(x - s * 0.09, y - s * 0.5, s * 0.18, s);
    ctx.globalAlpha = 1;
  }

  // Mid-ground biome features. The active region (by world distance) decides
  // what stands here — drifting ruins, fir forests, snow peaks or monoliths —
  // cross-fading at the seams between regions.
  drawMid(ctx: CanvasRenderingContext2D, cam: Camera) {
    const { w, h } = cam;
    const factor = 0.28;
    const spacing = 300;
    const baseY = h * 0.84 - cam.y * factor;
    const offset = cam.x * factor;
    const startIdx = Math.floor((offset - w) / spacing) - 1;
    const endIdx = Math.ceil((offset + w) / spacing) + 1;
    const base = mixColor(theme.mid, theme.fog, 0.15);
    const accent = mixColor(theme.mid, theme.skyHorizon, 0.2);

    // One continuous, gently rolling ground line shared by every feature, as a
    // smooth function of world X so neighbouring cells line up seamlessly.
    const roll = (wx: number) =>
      Math.sin(wx * 0.0017) * 15 +
      Math.sin(wx * 0.0043 + 1.3) * 8 +
      Math.sin(wx * 0.0111 + 0.7) * 3;
    const screenX = (wx: number) => wx - offset + w * 0.5;
    const crestY = (wx: number) => baseY + roll(wx);

    // Fill the ground far below the crest so it always runs into the dune sea —
    // features stand on solid land instead of floating on cut-off platforms.
    const left = startIdx * spacing;
    const right = endIdx * spacing;
    const grad = ctx.createLinearGradient(0, baseY - 40, 0, h);
    grad.addColorStop(0, mixColor(base, theme.skyGlow, 0.12));
    grad.addColorStop(0.22, base);
    grad.addColorStop(1, mixColor(base, theme.fog, 0.4));
    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(screenX(left), h * 3);
    for (let wx = left; wx <= right; wx += 36) ctx.lineTo(screenX(wx), crestY(wx));
    ctx.lineTo(screenX(right), h * 3);
    ctx.closePath();
    ctx.fill();
    // Soft sky-lit rim along the crest.
    ctx.strokeStyle = mixColor(base, theme.skyGlow, 0.24);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let wx = left; wx <= right; wx += 36) {
      const x = screenX(wx);
      const y = crestY(wx);
      if (wx === left) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    for (let i = startIdx; i <= endIdx; i++) {
      const r1 = hash01(i * 5 + 3);
      const r2 = hash01(i * 5 + 11);
      const worldX = i * spacing;
      const { kind, fade } = this.regionAt(worldX);
      if (fade <= 0.02) continue;
      // Forest is a continuous treeline (every cell); other biomes leave gaps.
      if (kind !== "forest" && r1 < 0.32) continue;

      const sx = screenX(worldX);
      const sy = crestY(worldX); // sit on the shared ground line
      const scale = 0.85 + r2 * 0.5;
      // Local rolling ground level, relative to this feature's origin.
      const groundY = (lx: number) => crestY(worldX + lx) - sy;

      ctx.save();
      ctx.globalAlpha = fade;
      if (kind === "forest") {
        const col = mixColor(base, "#1f4d3e", 0.4); // teal-green pines
        const lit = mixColor(col, theme.skyGlow, 0.25);
        this.drawPineCluster(ctx, sx, sy, scale, i, col, lit, groundY);
      } else if (kind === "peaks") {
        const col = mixColor(base, theme.far, 0.4);
        const lit = mixColor(col, theme.cloud, 0.55);
        this.drawPeak(ctx, sx, sy, scale * 1.1, i, col, lit);
      } else if (kind === "monuments") {
        // Warm, dark stone — deliberately off the cool blue of the ranges so
        // the monoliths read clearly against the mountains behind them.
        const col = mixColor(theme.mid, "#4a3a3e", 0.55);
        const lit = mixColor(col, theme.skyGlow, 0.32);
        this.drawMonolith(ctx, sx, sy, scale, i, col, lit, groundY);
      } else if (kind === "village") {
        this.drawVillage(ctx, sx, sy, scale, i, base, accent);
      } else {
        const kr = r2 > 0.55 ? "arch" : r2 > 0.3 ? "temple" : "pillars";
        this.drawRuin(ctx, sx, sy, scale, i, kr, base, accent);
      }
      ctx.restore();
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
    withTrees: boolean,
    time: number
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

    // A little critter grazing on the plateau every so often.
    if (scale > 0.62 && hash01(seed * 37) > 0.5) {
      const cx = (hash01(seed * 43) - 0.5) * rw * 0.9;
      const surfaceY = this.plateauTopY(cx, rw, rh, 1.2);
      const critterCol = hexA(mixColor(color, theme.mid, 0.62), 0.95);
      this.drawIslandCritter(ctx, cx, surfaceY + 1, scale, seed, critterCol, time);
    }

    ctx.restore();
  }

  // Tiny grazing silhouettes (deer / rabbit / perched bird) that give the
  // floating islands a sense of life. Procedurally chosen and seed-stable.
  private drawIslandCritter(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
    seed: number,
    col: string,
    time: number
  ) {
    const pick = hash01(seed * 47);
    const ph = hash01(seed * 59) * TAU; // per-critter phase so they're out of sync
    const L = (a: number, b: number, t: number) => a + (b - a) * t;

    ctx.save();
    ctx.fillStyle = col;
    ctx.strokeStyle = col;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (pick > 0.66) {
      // Deer — lowers its head to graze, then lifts it again.
      const s = (12 + hash01(seed * 53) * 6) * scale;
      const dip = Math.sin(time * 0.8 + ph) * 0.5 + 0.5; // 0 = head up, 1 = grazing
      ctx.lineWidth = Math.max(1, s * 0.1);
      for (const lx of [-0.3, -0.12, 0.12, 0.3]) {
        ctx.beginPath();
        ctx.moveTo(x + lx * s, y - s * 0.42);
        ctx.lineTo(x + lx * s, y);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(x, y - s * 0.58, s * 0.42, s * 0.2, 0, 0, TAU);
      ctx.fill();
      // Neck swings down toward the ground as it grazes.
      const tipX = L(x + s * 0.5, x + s * 0.62, dip);
      const tipY = L(y - s * 1.04, y - s * 0.46, dip);
      ctx.lineWidth = s * 0.15;
      ctx.beginPath();
      ctx.moveTo(x + s * 0.32, y - s * 0.62);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      const headX = L(x + s * 0.55, x + s * 0.68, dip);
      const headY = L(y - s * 1.12, y - s * 0.34, dip);
      ctx.beginPath();
      ctx.ellipse(headX, headY, s * 0.16, s * 0.1, 0.4 + dip * 0.5, 0, TAU);
      ctx.fill();
      ctx.lineWidth = Math.max(0.8, s * 0.05);
      ctx.beginPath();
      ctx.moveTo(headX - s * 0.05, headY - s * 0.08);
      ctx.lineTo(headX - s * 0.11, headY - s * 0.3);
      ctx.moveTo(headX + s * 0.03, headY - s * 0.08);
      ctx.lineTo(headX + s * 0.09, headY - s * 0.32);
      ctx.stroke();
    } else if (pick > 0.33) {
      // Rabbit — bobs up and down with little ear twitches.
      const s = (8 + hash01(seed * 53) * 4) * scale;
      const bob = -Math.abs(Math.sin(time * 2 + ph)) * s * 0.14;
      const tw = Math.sin(time * 3 + ph * 1.3) * 0.14; // ear flick
      ctx.save();
      ctx.translate(0, bob);
      ctx.beginPath();
      ctx.ellipse(x, y - s * 0.4, s * 0.5, s * 0.4, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + s * 0.45, y - s * 0.62, s * 0.27, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + s * 0.4, y - s * 1.05, s * 0.09, s * 0.32, -0.15 + tw, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + s * 0.56, y - s * 1.02, s * 0.09, s * 0.3, 0.2 + tw, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x - s * 0.52, y - s * 0.36, s * 0.14, 0, TAU);
      ctx.fill();
      ctx.restore();
    } else {
      // Perched bird — pecks the ground, tail flicking up as the head dips.
      const s = (6 + hash01(seed * 53) * 3) * scale;
      const peck = Math.pow(Math.sin(time * 1.6 + ph) * 0.5 + 0.5, 3);
      ctx.beginPath();
      ctx.ellipse(x, y - s * 0.5, s * 0.5, s * 0.33, -0.2, 0, TAU);
      ctx.fill();
      const hX = L(x + s * 0.46, x + s * 0.6, peck);
      const hY = L(y - s * 0.82, y - s * 0.52, peck);
      ctx.beginPath();
      ctx.arc(hX, hY, s * 0.23, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(hX + s * 0.18, hY - s * 0.03);
      ctx.lineTo(hX + s * 0.46, hY + s * 0.02);
      ctx.lineTo(hX + s * 0.18, hY + s * 0.09);
      ctx.closePath();
      ctx.fill();
      const tailUp = peck * s * 0.14;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.46, y - s * 0.52);
      ctx.lineTo(x - s * 0.95, y - s * 0.78 - tailUp);
      ctx.lineTo(x - s * 0.5, y - s * 0.32);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = Math.max(0.6, s * 0.09);
      ctx.beginPath();
      ctx.moveTo(x - s * 0.05, y - s * 0.2);
      ctx.lineTo(x - s * 0.05, y);
      ctx.moveTo(x + s * 0.14, y - s * 0.2);
      ctx.lineTo(x + s * 0.14, y);
      ctx.stroke();
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
    const lit = mixColor(color, theme.skyGlow, 0.22); // catches the sky on top edges

    if (kind === "arch") {
      this.drawRuinArch(ctx, seed, scale, pw, ph, seam, color, lit);
    } else {
      this.drawRuinColumns(ctx, seed, scale, pw, ph, seam, color, accent, lit, kind === "temple");
    }

    ctx.restore();
  }

  // Stone gateway — two piers carrying a semicircular arch with a keystone.
  // Sometimes ruined: one side crumbled, the span broken mid-air.
  private drawRuinArch(
    ctx: CanvasRenderingContext2D,
    seed: number,
    scale: number,
    pw: number,
    ph: number,
    seam: number,
    color: string,
    lit: string
  ) {
    const pierW = (8 + hash01(seed * 3) * 4) * scale;
    const openW = (24 + hash01(seed * 7) * 16) * scale;
    const R = openW / 2 + pierW / 2; // arch radius (pier center to centre)
    const legH = (30 + hash01(seed * 5) * 40) * scale;
    const baseS = this.plateauTopY(0, pw, ph, 1.3) + seam;
    const springY = baseS - legH;
    const broken = hash01(seed * 43) > 0.45;

    const fill = hexA(color, 0.95);
    const litFill = hexA(lit, 0.95);

    // Piers (slight base flare). Right pier is a low stub when broken.
    const drawPier = (cx: number, top: number) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(cx - pierW * 0.6, baseS);
      ctx.lineTo(cx - pierW * 0.5, top);
      ctx.lineTo(cx + pierW * 0.5, top);
      ctx.lineTo(cx + pierW * 0.6, baseS);
      ctx.closePath();
      ctx.fill();
    };
    drawPier(-R, springY);
    drawPier(R, broken ? baseS - legH * 0.32 : springY);

    // Arch band riding on the piers.
    ctx.strokeStyle = fill;
    ctx.lineWidth = pierW;
    ctx.lineCap = "butt";
    ctx.beginPath();
    if (broken) {
      ctx.arc(0, springY, R, Math.PI, Math.PI * 1.46); // springs from left, snaps off
    } else {
      ctx.arc(0, springY, R, Math.PI, TAU);
    }
    ctx.stroke();

    if (!broken) {
      // Keystone wedge at the apex.
      const ksW = pierW * 1.4;
      const ksH = pierW * 1.1;
      const apexY = springY - R - pierW * 0.5;
      ctx.fillStyle = litFill;
      ctx.beginPath();
      ctx.moveTo(-ksW * 0.5, apexY + ksH);
      ctx.lineTo(-ksW * 0.32, apexY);
      ctx.lineTo(ksW * 0.32, apexY);
      ctx.lineTo(ksW * 0.5, apexY + ksH);
      ctx.closePath();
      ctx.fill();
      // Thin sky-lit rim across the pier tops.
      ctx.fillStyle = litFill;
      ctx.fillRect(-R - pierW * 0.5, springY - 1.5 * scale, pierW, 1.5 * scale);
      ctx.fillRect(R - pierW * 0.5, springY - 1.5 * scale, pierW, 1.5 * scale);
    } else {
      // A little fallen rubble at the foot of the broken side.
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(R + pierW * 0.4, baseS - 2 * scale, pierW * 0.5, 0, TAU);
      ctx.fill();
    }
  }

  // A row of columns on a stylobate. Temples keep an architrave + pediment
  // across the intact columns; loose "pillars" are mostly weathered stumps.
  private drawRuinColumns(
    ctx: CanvasRenderingContext2D,
    seed: number,
    scale: number,
    pw: number,
    ph: number,
    seam: number,
    color: string,
    accent: string,
    lit: string,
    temple: boolean
  ) {
    const cols = temple ? 4 : 3;
    const gap = (temple ? 19 : 26) * scale;
    const fullH = (temple ? 70 : 64) * scale;
    const fill = hexA(color, 0.95);
    const litFill = hexA(lit, 0.95);

    // Stylobate (base platform).
    const platW = ((cols - 1) * gap) / 2 + 11 * scale;
    const baseS = this.plateauTopY(0, pw, ph, 1.3) + seam;
    ctx.fillStyle = fill;
    ctx.fillRect(-platW, baseS - 3.5 * scale, platW * 2, 5 * scale);
    ctx.fillStyle = litFill;
    ctx.fillRect(-platW, baseS - 4 * scale, platW * 2, 1.2 * scale);

    const tops: { cx: number; topY: number; broken: boolean }[] = [];
    for (let c = 0; c < cols; c++) {
      const cx = (c - (cols - 1) / 2) * gap;
      const colW = (7 + hash01(seed + c * 3) * 4) * scale;
      const broken = hash01(seed + c * 11) > (temple ? 0.62 : 0.4);
      const colH = broken
        ? fullH * (0.28 + hash01(seed + c * 13) * 0.4)
        : fullH;
      const surfaceY = baseS - 3.5 * scale;
      const topY = surfaceY - colH;

      // Fluted shaft with a touch of entasis (mid bulge via tapered trapezoid).
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(cx - colW * 0.5, surfaceY);
      ctx.lineTo(cx - colW * 0.42, topY);
      ctx.lineTo(cx + colW * 0.42, topY);
      ctx.lineTo(cx + colW * 0.5, surfaceY);
      ctx.closePath();
      ctx.fill();

      if (broken) {
        // Jagged snapped top.
        ctx.beginPath();
        ctx.moveTo(cx - colW * 0.42, topY);
        ctx.lineTo(cx - colW * 0.16, topY - 5 * scale);
        ctx.lineTo(cx + colW * 0.1, topY - 1.5 * scale);
        ctx.lineTo(cx + colW * 0.42, topY - 4 * scale);
        ctx.lineTo(cx + colW * 0.42, topY);
        ctx.closePath();
        ctx.fill();
      } else {
        // Capital block + sky-lit top.
        ctx.fillStyle = fill;
        ctx.fillRect(cx - colW * 0.7, topY - 4.5 * scale, colW * 1.4, 4.5 * scale);
        ctx.fillStyle = litFill;
        ctx.fillRect(cx - colW * 0.7, topY - 5 * scale, colW * 1.4, 1.4 * scale);
      }

      tops.push({ cx, topY, broken });
    }

    if (temple) {
      const intact = tops.filter((t) => !t.broken);
      if (intact.length >= 2) {
        const beamTop = baseS - 3.5 * scale - fullH - 5 * scale;
        const lx = Math.min(...intact.map((t) => t.cx)) - 9 * scale;
        const rx = Math.max(...intact.map((t) => t.cx)) + 9 * scale;
        const beamH = 8 * scale;
        // Architrave beam.
        ctx.fillStyle = fill;
        ctx.fillRect(lx, beamTop, rx - lx, beamH);
        ctx.fillStyle = litFill;
        ctx.fillRect(lx, beamTop, rx - lx, 1.5 * scale);
        // Low pediment triangle resting on the beam.
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(lx, beamTop);
        ctx.lineTo((lx + rx) / 2, beamTop - 13 * scale);
        ctx.lineTo(rx, beamTop);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = litFill;
        ctx.lineWidth = 1.3 * scale;
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(lx, beamTop);
        ctx.lineTo((lx + rx) / 2, beamTop - 13 * scale);
        ctx.lineTo(rx, beamTop);
        ctx.stroke();
      }
    } else {
      // Loose pillars: a low fallen block among the stumps.
      ctx.fillStyle = hexA(accent, 0.6);
      ctx.fillRect(-platW * 0.3, baseS - 6 * scale, 14 * scale, 4 * scale);
    }
  }

  // --- Village region: a cluster of little pitched-roof houses on a floating
  // rock. Roof ridges catch the sky like the ruins, and the windows warm up
  // after dark so the hamlet feels lived-in. ---
  private drawVillage(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
    seed: number,
    color: string,
    accent: string
  ) {
    ctx.save();
    ctx.translate(x, y);

    // Floating rock pedestal — same silhouette as the ruins for cohesion.
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
    // Walls pick up the cool stone; roofs lean warm toward the horizon glow.
    const wallCol = mixColor(color, theme.skyGlow, 0.06);
    const wallLit = mixColor(wallCol, theme.skyGlow, 0.22);
    const roofCol = mixColor(color, theme.skyHorizon, 0.22);
    const roofLit = mixColor(roofCol, theme.skyGlow, 0.3);

    // Two or three houses staggered across the plateau top, drawn outermost
    // first so neighbours overlap toward the centre.
    const three = hash01(seed * 17) > 0.45;
    const slots = three ? [-1, 1, 0] : [-0.65, 0.65];
    for (let k = 0; k < slots.length; k++) {
      const t = slots[k];
      const hx = t * 19 * scale;
      const hs = (0.82 + hash01(seed * 7 + k * 5) * 0.5) * scale;
      const surfaceY = this.plateauTopY(hx, pw, ph, 1.3) + seam;
      this.drawHouse(
        ctx,
        hx,
        surfaceY,
        hs,
        seed * 31 + k * 13,
        wallCol,
        wallLit,
        roofCol,
        roofLit,
        accent
      );
    }

    ctx.restore();
  }

  private drawHouse(
    ctx: CanvasRenderingContext2D,
    cx: number,
    baseY: number,
    s: number,
    seed: number,
    wallCol: string,
    wallLit: string,
    roofCol: string,
    roofLit: string,
    accent: string
  ) {
    const hw = (8 + hash01(seed * 3) * 3) * s; // half wall width
    const wallH = (13 + hash01(seed * 5) * 8) * s;
    const roofH = (9 + hash01(seed * 7) * 5) * s;
    const eave = hw * 0.3;
    const wallTop = baseY - wallH;

    // Wall, with a thin sky-lit cap along its upper edge.
    ctx.fillStyle = hexA(wallCol, 0.96);
    ctx.fillRect(cx - hw, wallTop, hw * 2, wallH);
    ctx.fillStyle = hexA(wallLit, 0.9);
    ctx.fillRect(cx - hw, wallTop, hw * 2, 1.1 * s);

    // Pitched roof with eaves.
    ctx.fillStyle = hexA(roofCol, 0.97);
    ctx.beginPath();
    ctx.moveTo(cx - hw - eave, wallTop);
    ctx.lineTo(cx, wallTop - roofH);
    ctx.lineTo(cx + hw + eave, wallTop);
    ctx.closePath();
    ctx.fill();
    // Lit ridge on the sun side (upper-left), echoing the rest of the scene.
    ctx.strokeStyle = hexA(roofLit, 0.95);
    ctx.lineWidth = 1.3 * s;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - hw - eave, wallTop);
    ctx.lineTo(cx, wallTop - roofH);
    ctx.stroke();

    // Door, tucked to one side.
    const dw = hw * 0.5;
    const dh = wallH * 0.52;
    const doorX = cx - hw * 0.42;
    ctx.fillStyle = hexA(mixColor(wallCol, theme.mid, 0.5), 0.92);
    ctx.fillRect(doorX - dw * 0.5, baseY - dh, dw, dh);

    // Window — a quiet sky-lit pane by day, a warm glow after dark.
    if (hw > 6.5 * s) {
      const warm = 0.16 + theme.night * 0.72;
      const winCol = mixColor("#ffce8a", theme.skyGlow, 0.2);
      const ww = hw * 0.4;
      const winX = cx + hw * 0.4 - ww * 0.5;
      const winY = wallTop + wallH * 0.26;
      ctx.fillStyle = hexA(mixColor(accent, theme.mid, 0.4), 0.6);
      ctx.fillRect(winX - 0.8 * s, winY - 0.8 * s, ww + 1.6 * s, ww + 1.6 * s);
      ctx.fillStyle = hexA(winCol, warm);
      ctx.fillRect(winX, winY, ww, ww);
    }

    ctx.lineCap = "butt";
  }

  // --- Forest region: a knoll crowned with layered fir trees. ---

  private drawFir(
    ctx: CanvasRenderingContext2D,
    x: number,
    baseY: number,
    height: number,
    color: string,
    lit: string
  ) {
    const halfW = height * 0.26;
    // Trunk.
    ctx.fillStyle = color;
    ctx.fillRect(x - height * 0.035, baseY - height * 0.12, height * 0.07, height * 0.13);
    // Stacked conical tiers, widest at the bottom.
    const tiers = 4;
    for (let t = 0; t < tiers; t++) {
      const f = t / tiers;
      const ty = baseY - height * 0.08 - height * 0.8 * f;
      const tw = halfW * (1 - f * 0.78);
      const th = height * 0.3;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, ty - th);
      ctx.lineTo(x - tw, ty);
      ctx.lineTo(x + tw, ty);
      ctx.closePath();
      ctx.fill();
      // Thin sky-lit left edge for a touch of form.
      ctx.fillStyle = lit;
      ctx.beginPath();
      ctx.moveTo(x, ty - th);
      ctx.lineTo(x - tw, ty);
      ctx.lineTo(x - tw * 0.6, ty);
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawPineCluster(
    ctx: CanvasRenderingContext2D,
    sx: number,
    baseY: number,
    scale: number,
    seed: number,
    color: string,
    lit: string,
    groundY: (localX: number) => number
  ) {
    ctx.save();
    ctx.translate(sx, baseY);
    // Spread firs across a wide span; with every cell planted they overlap
    // into one continuous treeline. They stand on the shared ground line, so
    // no per-cluster platform can float free of the land.
    const mw = 180 * scale;

    // Back row — smaller, hazier firs receding toward the fog for depth.
    const back = mixColor(color, theme.fog, 0.34);
    const backLit = mixColor(back, theme.skyGlow, 0.2);
    const nb = 6 + ((hash01(seed * 7) * 5) | 0);
    for (let t = 0; t < nb; t++) {
      const fx = (hash01(seed * 11 + t * 3) - 0.5) * mw * 1.95;
      const fh = (32 + hash01(seed * 17 + t) * 30) * scale;
      this.drawFir(ctx, fx, groundY(fx) + 2 * scale, fh, back, backLit);
    }

    // Front row — taller, denser firs whose canopies overlap (tall-to-short).
    const nf = 7 + ((hash01(seed * 13) * 5) | 0);
    const trees: { fx: number; fh: number }[] = [];
    for (let t = 0; t < nf; t++) {
      const fx = (hash01(seed * 23 + t * 5) - 0.5) * mw * 1.85;
      const fh = (50 + hash01(seed * 29 + t) * 66) * scale;
      trees.push({ fx, fh });
    }
    trees.sort((a, b) => b.fh - a.fh);
    for (const tr of trees) {
      this.drawFir(ctx, tr.fx, groundY(tr.fx) + 2 * scale, tr.fh, color, lit);
    }
    ctx.restore();
  }

  // --- Peaks region: a faceted, snow-capped mountain. ---

  private drawPeak(
    ctx: CanvasRenderingContext2D,
    sx: number,
    baseY: number,
    scale: number,
    seed: number,
    color: string,
    lit: string
  ) {
    ctx.save();
    ctx.translate(sx, baseY);
    const pw = (84 + hash01(seed * 7) * 60) * scale;
    const ph = (150 + hash01(seed * 13) * 130) * scale;
    const apex = (hash01(seed * 17) - 0.5) * pw * 0.5;
    const footY = 70 * scale;

    // Main mass.
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-pw, footY);
    ctx.lineTo(apex, -ph);
    ctx.lineTo(pw, footY);
    ctx.closePath();
    ctx.fill();

    // Shaded right face (low-poly look) — a darker wedge from apex down.
    ctx.fillStyle = mixColor(color, theme.mid, 0.4);
    ctx.beginPath();
    ctx.moveTo(apex, -ph);
    ctx.lineTo(pw, footY);
    ctx.lineTo(apex + pw * 0.18, footY);
    ctx.closePath();
    ctx.fill();

    // Snow cap with a jagged lower edge.
    const capH = ph * 0.34;
    const capW = pw * (capH / (ph + footY)) * 1.05;
    ctx.fillStyle = lit;
    ctx.beginPath();
    ctx.moveTo(apex, -ph);
    ctx.lineTo(apex - capW, -ph + capH);
    ctx.lineTo(apex - capW * 0.45, -ph + capH * 0.7);
    ctx.lineTo(apex - capW * 0.1, -ph + capH * 1.05);
    ctx.lineTo(apex + capW * 0.35, -ph + capH * 0.72);
    ctx.lineTo(apex + capW * 0.7, -ph + capH * 1.0);
    ctx.lineTo(apex + capW, -ph + capH * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // --- Monuments region: towering weathered standing stones. ---

  private drawMonolith(
    ctx: CanvasRenderingContext2D,
    sx: number,
    baseY: number,
    scale: number,
    seed: number,
    color: string,
    lit: string,
    groundY: (localX: number) => number
  ) {
    ctx.save();
    // Plant the stones on the shared ground line (no separate base slab, so
    // nothing floats when the camera drops).
    ctx.translate(sx, baseY + groundY(0));

    const type = (hash01(seed * 3) * 3) | 0;

    if (type === 0) {
      // Trilithon — two uprights carrying a heavy lintel (Stonehenge-style).
      const ph = (96 + hash01(seed * 13) * 70) * scale;
      const pw = (13 + hash01(seed * 7) * 6) * scale;
      const gap = (24 + hash01(seed * 17) * 16) * scale;
      const over = pw * 0.55;
      const linH = pw * 0.95;
      const lx = -gap * 0.5 - pw;
      const rx = gap * 0.5;
      ctx.fillStyle = color;
      ctx.fillRect(lx, -ph, pw, ph);
      ctx.fillRect(rx, -ph, pw, ph);
      ctx.fillRect(lx - over, -ph - linH, gap + pw * 2 + over * 2, linH);
      ctx.fillStyle = lit;
      ctx.fillRect(lx, -ph, pw * 0.24, ph);
      ctx.fillRect(rx, -ph, pw * 0.24, ph);
      ctx.fillRect(lx - over, -ph - linH, gap + pw * 2 + over * 2, linH * 0.32);
    } else if (type === 1) {
      // Menhir — a single tall tapered standing stone with a gentle lean, plus
      // a smaller companion stone beside it.
      const sh = (120 + hash01(seed * 13) * 90) * scale;
      const wb = (20 + hash01(seed * 7) * 10) * scale;
      const wt = wb * 0.58;
      const lean = (hash01(seed * 19) - 0.5) * 0.14;
      ctx.save();
      ctx.rotate(lean);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-wb * 0.5, 2 * scale);
      ctx.lineTo(-wt * 0.5, -sh);
      ctx.lineTo(wt * 0.5, -sh * 0.97);
      ctx.lineTo(wb * 0.5, 2 * scale);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = lit;
      ctx.beginPath();
      ctx.moveTo(-wb * 0.5, 2 * scale);
      ctx.lineTo(-wt * 0.5, -sh);
      ctx.lineTo(-wt * 0.22, -sh);
      ctx.lineTo(-wb * 0.2, 2 * scale);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      const ch = sh * (0.42 + hash01(seed * 29) * 0.2);
      const cw = wb * 0.7;
      const cx = (wb * 0.7 + 14 * scale) * (hash01(seed * 31) > 0.5 ? 1 : -1);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx - cw * 0.5, 2 * scale);
      ctx.lineTo(cx - cw * 0.34, -ch);
      ctx.lineTo(cx + cw * 0.34, -ch);
      ctx.lineTo(cx + cw * 0.5, 2 * scale);
      ctx.closePath();
      ctx.fill();
    } else {
      // Obelisk — tapered shaft topped by a small pyramidion.
      const sh = (130 + hash01(seed * 13) * 96) * scale;
      const wb = (16 + hash01(seed * 7) * 7) * scale;
      const wt = wb * 0.52;
      const shaftTop = -sh * 0.86;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-wb * 0.5, 0);
      ctx.lineTo(-wt * 0.5, shaftTop);
      ctx.lineTo(wt * 0.5, shaftTop);
      ctx.lineTo(wb * 0.5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-wt * 0.5, shaftTop);
      ctx.lineTo(0, -sh);
      ctx.lineTo(wt * 0.5, shaftTop);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = lit;
      ctx.beginPath();
      ctx.moveTo(-wb * 0.5, 0);
      ctx.lineTo(-wt * 0.5, shaftTop);
      ctx.lineTo(0, -sh);
      ctx.lineTo(-wt * 0.18, shaftTop);
      ctx.lineTo(-wb * 0.2, 0);
      ctx.closePath();
      ctx.fill();
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
