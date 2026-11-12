import { CONFIG } from "../core/config";
import { clamp, lerp } from "../core/math";
import { Rng } from "../core/rng";
import { Anchor } from "../entities/anchor";
import { Cloud } from "../entities/cloud";
import { Collectible } from "../entities/collectible";
import { Hazard } from "../entities/hazard";
import { PowerUp, POWERUP_KINDS } from "../entities/powerup";

const SPAWN_BUFFER = 700;
const CULL_BUFFER = 500;
// On a restart, how far past the right screen edge the old world is kept.
// It must exceed the furthest anything can hang to the LEFT of the segment
// that created it, or regenerated scenery lands inside the frame and pops in:
// a cloud's puffs reach 0.85*rx + 0.56*ry (up to ~278 px) left of its centre,
// an orb arc ~200 px left of its anchor.
const RESTART_KEEP_MARGIN = 300;

// Procedurally fills the sky with scattered anchors, hazards, and clouds.
// Nothing spawns on a fixed "rail" — placement is random per segment so routes
// vary run to run and rescue anchors never appear mid-fall.
export class World {
  anchors: Anchor[] = [];
  clouds: Cloud[] = [];
  collectibles: Collectible[] = [];
  hazards: Hazard[] = [];
  powerups: PowerUp[] = [];

  private rng = new Rng();
  private genX = 0;
  /** World-x of the most recent anchor — used to cap anchor droughts. */
  private lastAnchorX = 0;
  /** World-x where the current run began: the difficulty ramp is measured from here. */
  private runOriginX = 0;
  /** World-x past which the next power-up pickup spawns. */
  private nextPowerX = 0;
  private powerCount = 0;
  /** The run's assist (0..CONFIG.difficulty.assistMax), and the distance (px) by which it has faded out. */
  private assist = 0;
  private assistFadePx = 0;

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
    this.assist = 0;
    this.assistFadePx = 0;
    this.anchors = [];
    this.clouds = [];
    this.collectibles = [];
    this.hazards = [];
    this.powerups = [];
    this.genX = startX;
    this.runOriginX = startX;
    this.nextPowerX = startX + CONFIG.powerups.firstAt;
    this.powerCount = rng.int(0, POWERUP_KINDS.length - 1); // random first kind

    // One guaranteed opening anchor — after that, everything is random.
    const first = new Anchor(startX + 260, startY - 180, "normal");
    this.anchors.push(first);
    this.lastAnchorX = first.x;
    this.genX = startX + 280;
  }

  /**
   * Guarantee a fair first grab: runs start wherever the attract glide
   * happens to be, so make sure an anchor sits just ahead of (px, py) at a
   * comfortable height. If the random world already provides one, do nothing.
   */
  ensureOpeningAnchor(px: number, py: number) {
    // The acceptance window must stay inside the tether's practical reach for
    // a player cruising forward from (px, py) — a "nearby" anchor outside it
    // is a death sentence dressed up as fairness.
    for (const a of this.anchors) {
      if (a.x > px + 100 && a.x < px + 600 && a.y > py - 240 && a.y < py + 40) {
        return;
      }
    }
    const anchor = new Anchor(
      px + this.rng.range(260, 380),
      py - this.rng.range(110, 180),
      "normal"
    );
    this.anchors.push(anchor);
    this.lastAnchorX = Math.max(this.lastAnchorX, anchor.x);
  }

  /**
   * Clear rocks around a run's starting position. The attract preview glides
   * through the world without collision, so "tap to play" could otherwise
   * drop the player inside (or a frame away from) a hazard — an instant,
   * unavoidable death.
   */
  removeHazardsNear(px: number, py: number, radius: number) {
    let w = 0;
    for (const h of this.hazards) {
      const dx = h.x - px;
      const dy = h.y - py;
      if (dx * dx + dy * dy > (radius + h.rx) * (radius + h.rx)) {
        this.hazards[w++] = h;
      }
    }
    this.hazards.length = w;
  }

  /**
   * No run in progress (menu / game over): park the difficulty ramp at the
   * gliding plane, so the sky that scrolls in behind the attract screen —
   * which becomes the opening of the next run — stays at opening difficulty
   * however long the player waits.
   */
  holdRamp(x: number) {
    this.runOriginX = x;
  }

  /**
   * A new run starts at `originX`: the difficulty ramp restarts there. The
   * world itself carries on — nothing on screen (or within a margin past
   * `viewRight`) is touched — but what lies beyond was generated for the
   * previous run's difficulty, so it is dropped and regenerated on the fresh
   * ramp.
   */
  beginRun(originX: number, viewRight: number) {
    this.runOriginX = originX;
    const keepUntilX = viewRight + RESTART_KEEP_MARGIN;
    if (keepUntilX >= this.genX) return;
    let w = 0;
    for (const a of this.anchors) if (a.x <= keepUntilX) this.anchors[w++] = a;
    this.anchors.length = w;
    w = 0;
    for (const c of this.clouds) if (c.x - c.rx <= keepUntilX) this.clouds[w++] = c;
    this.clouds.length = w;
    // An orb trail that starts inside the kept region is kept whole — a trail
    // that leads off the edge must not stop one orb later. Trail orbs are
    // stored contiguously, left to right; neighbours on a steep wave can be
    // up to ~77 px apart, hence the slack on the spacing.
    w = 0;
    let prevOrb: Collectible | null = null; // last kept orb while still walking its trail
    for (const c of this.collectibles) {
      const tail =
        c.kind === "orb" &&
        prevOrb !== null &&
        Math.hypot(c.baseX - prevOrb.baseX, c.baseY - prevOrb.baseY) <= CONFIG.orbs.spacing + 32;
      if (c.baseX <= keepUntilX || tail) {
        this.collectibles[w++] = c;
        prevOrb = c.kind === "orb" ? c : null;
      } else {
        prevOrb = null;
      }
    }
    this.collectibles.length = w;
    w = 0;
    for (const h of this.hazards) if (h.x - h.rx <= keepUntilX) this.hazards[w++] = h;
    this.hazards.length = w;
    w = 0;
    for (const p of this.powerups) if (p.x <= keepUntilX) this.powerups[w++] = p;
    this.powerups.length = w;

    this.genX = keepUntilX;
    this.lastAnchorX = originX;
    for (const a of this.anchors) if (a.x > this.lastAnchorX) this.lastAnchorX = a.x;
    // A dropped pickup must not push the next one a whole gap further out.
    this.nextPowerX = Math.min(this.nextPowerX, this.genX + CONFIG.powerups.firstAt);
  }

  /**
   * The run's assist: `assist` (0..assistMax) eases the difficulty, fading
   * out linearly to nothing at `fadePx` into the run (the player's best).
   * Set before beginRun; a reset (and so every daily run) has none.
   */
  setAssist(assist: number, fadePx: number) {
    this.assist = clamp(assist, 0, CONFIG.difficulty.assistMax);
    this.assistFadePx = fadePx > 0 ? fadePx : 0;
  }

  /**
   * How hard the segment being built is: 0 at the run's start, 1 at the 1.2
   * game's hardest, up to CONFIG.difficulty.scale far out (see config).
   */
  difficulty(): number {
    const D = CONFIG.difficulty;
    const d = Math.max(0, this.genX - this.runOriginX);
    if (D.legacy) return clamp(d / 13000, 0, 1);
    const base = d / (d + D.halfPx);
    const fade = this.assistFadePx > 0 ? Math.max(0, 1 - d / this.assistFadePx) : 0;
    return base * D.scale * (1 - this.assist * fade);
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

    // --- Anchors: 0–2 per segment, scattered. Empty segments = real gaps —
    // but capped: a long anchor drought is a guaranteed unavoidable death.
    // Checked against the segment END so the rescue lands before the gap
    // outgrows a good slingshot, and the rescue spawns EARLY in the segment
    // at a mid-altitude band the player can actually reach.
    const drought = segEnd - this.lastAnchorX > 850;
    const emptyChance = Math.min(lerp(0.08, 0.28, diff), 0.38);
    let anchorCount = 0;
    if (drought || !rng.chance(emptyChance)) {
      anchorCount = rng.int(1, diff > 0.45 ? 2 : 1);
    }

    const segAnchors: Anchor[] = [];
    for (let i = 0; i < anchorCount; i++) {
      const rescue = drought && i === 0;
      const ax = rescue
        ? rng.range(segStart + 40, Math.min(segEnd - 60, segStart + 260))
        : rng.range(segStart + 60, segEnd - 60);
      const ay = rescue
        ? rng.range(-650, Math.min(bottom, 350))
        : rng.range(top, bottom);
      const moving = rng.chance(Math.min(lerp(0.06, 0.38, diff), 0.55));
      const anchor = moving
        ? new Anchor(ax, ay, "moving", {
            amp: rng.range(50, 130),
            phase: rng.range(0, Math.PI * 2),
            speed: rng.range(0.7, 1.6),
          })
        : new Anchor(ax, ay, "normal");
      this.anchors.push(anchor);
      segAnchors.push(anchor);
      if (ax > this.lastAnchorX) this.lastAnchorX = ax;
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
    if (segEnd - this.runOriginX > 1400) {
      const hazardChance = Math.min(lerp(0.12, 0.52, diff), 0.7);
      if (rng.chance(hazardChance)) {
        const count = rng.chance(Math.min(diff * 0.5, 0.7)) ? 2 : 1;
        for (let i = 0; i < count; i++) {
          const hx = rng.range(segStart + 30, segEnd - 30);
          const hy = rng.range(top + 60, bottom - 20);
          const r = rng.range(34, 92);
          const rock = new Hazard(hx, hy, r, r * rng.range(0.75, 1.35), rng);
          // A pickup placed by an earlier segment may already sit here; a
          // power-up must stay collectable, so this rock simply doesn't spawn.
          let onPickup = false;
          for (let k = this.powerups.length - 1; k >= 0 && k >= this.powerups.length - 3; k--) {
            const p = this.powerups[k];
            if (rock.hits(p.x, p.baseY, 60)) onPickup = true;
          }
          if (onPickup) continue;
          this.hazards.push(rock);
          // An orb trail from an earlier segment can reach in here: no orb
          // may sit inside a rock, so clear this one's footprint.
          const cs = this.collectibles;
          for (let k = cs.length - 1; k >= 0 && k >= cs.length - 40; k--) {
            const c = cs[k];
            if (c.kind === "orb" && rock.hits(c.baseX, c.baseY, 22)) c.collected = true;
          }
        }
      }
    }

    // --- Orbs (the currency): a trail per segment, most of the time. Either
    // an arc hung under an anchor — it traces the swing — or a gentle wave
    // across open sky. Placed after the rocks so none spawns inside one.
    if (rng.chance(CONFIG.orbs.trailChance)) {
      const n = rng.int(CONFIG.orbs.trailCount[0], CONFIG.orbs.trailCount[1]);
      const gap = CONFIG.orbs.spacing;
      if (segAnchors.length > 0 && rng.chance(0.5)) {
        const a = rng.pick(segAnchors);
        const radius = rng.range(150, 250);
        const span = ((n - 1) * gap) / radius; // radians covered by the arc
        const mid = Math.PI / 2 + rng.range(-0.25, 0.25); // straight down (+y)
        for (let i = 0; i < n; i++) {
          const ang = mid + span / 2 - (i * span) / (n - 1);
          this.addOrb(a.x + Math.cos(ang) * radius, a.y + Math.sin(ang) * radius);
        }
      } else {
        const x0 = rng.range(segStart + 20, segEnd - 20);
        const y0 = rng.range(top + 140, bottom + 120);
        const amp = rng.range(-70, 70);
        for (let i = 0; i < n; i++) {
          this.addOrb(x0 + i * gap, y0 + Math.sin((i / (n - 1)) * Math.PI) * amp);
        }
      }
    }

    // --- Power-up: one rare pickup every few thousand px, kinds alternating,
    // near an anchor when the segment has one so it is reachable by a swing.
    if (segEnd >= this.nextPowerX) {
      const kind = POWERUP_KINDS[this.powerCount++ % POWERUP_KINDS.length];
      let px: number;
      let py: number;
      if (segAnchors.length > 0) {
        const a = rng.pick(segAnchors);
        px = a.x + rng.range(70, 170);
        py = a.y + rng.range(60, 170);
      } else {
        px = rng.range(segStart + 60, segEnd - 60);
        py = rng.range(top + 220, bottom);
      }
      // Never inside (or hugging) a rock: lift it clear.
      for (let tries = 0; tries < 4 && this.insideHazard(px, py, 60); tries++) py -= 150;
      this.powerups.push(new PowerUp(px, py, kind));
      this.nextPowerX = segEnd + rng.range(CONFIG.powerups.gap[0], CONFIG.powerups.gap[1]);
    }
  }

  private addOrb(x: number, y: number) {
    // Keep clear of rocks and above the cloud sea.
    if (y > CONFIG.world.seaLevel - 60 || this.insideHazard(x, y, 22)) return;
    this.collectibles.push(new Collectible(x, y, "orb"));
  }

  /** True if (x, y) with padding `r` overlaps one of the most recent rocks. */
  private insideHazard(x: number, y: number, r: number): boolean {
    const hs = this.hazards;
    for (let i = hs.length - 1; i >= 0 && i >= hs.length - 8; i--) {
      if (hs[i].hits(x, y, r)) return true;
    }
    return false;
  }

  update(
    dt: number,
    time: number,
    magnet?: { x: number; y: number; range: number; strength: number }
  ) {
    for (const a of this.anchors) a.update(dt, time);
    for (const c of this.clouds) c.update(dt);
    for (const h of this.hazards) h.update(dt);
    for (const p of this.powerups) p.update(time);

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

  // In-place compaction (single write-index pass per array) — culling runs
  // every frame, so it must not allocate the way Array.filter does.
  cull(cameraLeft: number) {
    const limit = cameraLeft - CULL_BUFFER;

    const anchors = this.anchors;
    let w = 0;
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      if (a.x > limit) anchors[w++] = a;
    }
    anchors.length = w;

    const clouds = this.clouds;
    w = 0;
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      if (c.x + c.rx > limit) clouds[w++] = c;
    }
    clouds.length = w;

    const collectibles = this.collectibles;
    w = 0;
    for (let i = 0; i < collectibles.length; i++) {
      const c = collectibles[i];
      if (c.baseX > limit && !c.collected) collectibles[w++] = c;
    }
    collectibles.length = w;

    const powerups = this.powerups;
    w = 0;
    for (let i = 0; i < powerups.length; i++) {
      const p = powerups[i];
      if (p.x > limit && !p.collected) powerups[w++] = p;
    }
    powerups.length = w;

    const hazards = this.hazards;
    w = 0;
    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i];
      // A shattering rock stays until its pieces finish: they inherit the
      // player's travel and can still be on screen after the rock's own
      // position has scrolled out.
      if ((h.x + h.rx > limit || h.destroyed) && !h.gone) hazards[w++] = h;
    }
    hazards.length = w;
  }
}
