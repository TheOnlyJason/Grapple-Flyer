import { CONFIG } from "../core/config";
import { clamp, lerp } from "../core/math";
import { Rng } from "../core/rng";
import { Anchor } from "../entities/anchor";
import { Cloud } from "../entities/cloud";
import { Collectible } from "../entities/collectible";
import { Hazard } from "../entities/hazard";

const SPAWN_BUFFER = 700;
const CULL_BUFFER = 500;

// Procedurally fills the sky with scattered anchors, hazards, and clouds.
// Nothing spawns on a fixed "rail" — placement is random per segment so routes
// vary run to run and rescue anchors never appear mid-fall.
export class World {
  anchors: Anchor[] = [];
  clouds: Cloud[] = [];
  collectibles: Collectible[] = [];
  hazards: Hazard[] = [];

  private rng = new Rng();
  private genX = 0;
  private startX = 0;

  get seaLevel() {
    return CONFIG.world.seaLevel;
  }

  private altitudeBounds() {
    const top = CONFIG.world.skyCeiling + 240;
    const bottom = CONFIG.world.seaLevel - CONFIG.tether.maxRope - 70;
    return { top, bottom };
  }

  reset(rng: Rng, startX: number, startY: number) {
    this.rng = rng;
    this.anchors = [];
    this.clouds = [];
    this.collectibles = [];
    this.hazards = [];
    this.genX = startX;
    this.startX = startX;

    // One guaranteed opening anchor — after that, everything is random.
    const first = new Anchor(startX + 260, startY - 180, "normal");
    this.anchors.push(first);
    this.genX = startX + 280;
  }

  private difficulty(): number {
    return clamp((this.genX - this.startX) / 13000, 0, 1);
  }

  ensure(cameraRight: number) {
    while (this.genX < cameraRight + SPAWN_BUFFER) {
      this.generateSegment();
    }
  }

  private generateSegment() {
    const rng = this.rng;
    const diff = this.difficulty();
    const { top, bottom } = this.altitudeBounds();

    const segW = rng.range(lerp(340, 420, diff), lerp(480, 620, diff));
    const segStart = this.genX;
    const segEnd = this.genX + segW;
    this.genX = segEnd;

    // --- Anchors: 0–2 per segment, scattered. Empty segments = real gaps. ---
    const emptyChance = lerp(0.08, 0.28, diff);
    let anchorCount = 0;
    if (!rng.chance(emptyChance)) {
      anchorCount = rng.int(1, diff > 0.45 ? 2 : 1);
    }

    const segAnchors: Anchor[] = [];
    for (let i = 0; i < anchorCount; i++) {
      const ax = rng.range(segStart + 60, segEnd - 60);
      const ay = rng.range(top, bottom);
      const moving = rng.chance(lerp(0.06, 0.38, diff));
      const anchor = moving
        ? new Anchor(ax, ay, "moving", {
            amp: rng.range(50, 130),
            phase: rng.range(0, Math.PI * 2),
            speed: rng.range(0.7, 1.6),
          })
        : new Anchor(ax, ay, "normal");
      this.anchors.push(anchor);
      segAnchors.push(anchor);
    }

    // Collectibles: scattered in the segment or clustered near an anchor.
    const collectCount = rng.int(0, diff > 0.3 ? 3 : 2);
    for (let i = 0; i < collectCount; i++) {
      let cx: number;
      let cy: number;
      if (segAnchors.length > 0 && rng.chance(0.55)) {
        const a = rng.pick(segAnchors);
        cx = a.x + rng.range(-90, 90);
        cy = a.y + rng.range(-70, 110);
      } else {
        cx = rng.range(segStart + 40, segEnd - 40);
        cy = rng.range(top + 80, bottom - 40);
      }
      this.collectibles.push(new Collectible(cx, cy));
    }

    // --- Clouds: random position and size within the segment. ---
    const cloudCount = rng.chance(0.62) ? rng.int(1, 2) : 0;
    for (let i = 0; i < cloudCount; i++) {
      const cx = rng.range(segStart, segEnd);
      const cy = rng.range(top + 160, bottom + 80);
      this.clouds.push(
        new Cloud(
          cx,
          cy,
          rng.range(120, 280),
          rng.range(38, 72),
          rng
        )
      );
    }

    // --- Hazards: scattered anywhere in the segment (not on a line). ---
    if (segEnd - this.startX > 1400) {
      const hazardChance = lerp(0.12, 0.52, diff);
      if (rng.chance(hazardChance)) {
        const count = rng.chance(diff * 0.5) ? 2 : 1;
        for (let i = 0; i < count; i++) {
          const hx = rng.range(segStart + 30, segEnd - 30);
          const hy = rng.range(top + 60, bottom - 20);
          const r = rng.range(34, 92);
          this.hazards.push(new Hazard(hx, hy, r, r * rng.range(0.75, 1.35), rng));
        }
      }
    }
  }

  update(
    dt: number,
    time: number,
    magnet?: { x: number; y: number; range: number; strength: number }
  ) {
    for (const a of this.anchors) a.update(dt, time);
    for (const c of this.clouds) c.update(dt);
    for (const h of this.hazards) h.update(dt);

    for (const col of this.collectibles) {
      if (magnet && !col.collected) {
        const dx = magnet.x - col.x;
        const dy = magnet.y - col.y;
        const d = Math.hypot(dx, dy);
        if (d < magnet.range) {
          col.vx = (dx / (d || 1)) * magnet.strength;
          col.vy = (dy / (d || 1)) * magnet.strength;
          col.update(dt, time, true);
          continue;
        }
      }
      col.update(dt, time, false);
    }
  }

  cull(cameraLeft: number) {
    const limit = cameraLeft - CULL_BUFFER;
    this.anchors = this.anchors.filter((a) => a.x > limit);
    this.clouds = this.clouds.filter((c) => c.x + c.rx > limit);
    this.collectibles = this.collectibles.filter(
      (c) => c.baseX > limit && !c.collected
    );
    this.hazards = this.hazards.filter((h) => h.x + h.rx > limit && !h.gone);
  }
}
