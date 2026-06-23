import { CONFIG } from "./config";
import { theme, updateTheme } from "../render/theme";
import { Camera } from "./camera";
import { Input } from "./input";
import { Sound } from "./audio";
import { Storage } from "./storage";
import { Rng } from "./rng";
import { clamp } from "./math";
import { Player } from "../entities/player";
import { Hazard } from "../entities/hazard";
import { hexA } from "../entities/anchor";
import { World } from "../systems/world";
import { Particles } from "../systems/particles";
import { Objectives } from "../systems/objectives";
import { Background } from "../render/background";
import { Hud, HudData } from "../render/hud";
import {
  cycleCharacterId,
  characterName,
} from "../characters/registry";

type GameState = "menu" | "playing" | "paused" | "crashing" | "gameover";

export class Game {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;

  private input: Input;
  private camera = new Camera();
  private sound = new Sound();
  private storage = new Storage();
  private rng = new Rng();

  private player = new Player();
  private world = new World();
  private particles = new Particles();
  private objectives = new Objectives();
  private background = new Background();
  private hud = new Hud();

  private state: GameState = "menu";
  private timeInState = 0;
  private time = 0;
  private acc = 0;

  /** Distance scoring origin; resets to 200 on menu, handoff X when play starts. */
  private startX = 200;
  private distance = 0;
  private bonus = 0;
  private perfectCount = 0;
  private skimMeters = 0;
  private wind = 0;
  private newBest = false;
  private hintTimer = 0;

  // True while a tap that began on the dash button is held (suppresses tether).
  private dashLatch = false;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.input = new Input(canvas);
    this.enterMenu();
  }

  resize(w: number, h: number, dpr: number) {
    this.dpr = dpr;
    this.camera.resize(w, h);
  }

  // --- State transitions ---------------------------------------------------

  private resetRunStats() {
    this.distance = 0;
    this.bonus = 0;
    this.perfectCount = 0;
    this.skimMeters = 0;
    this.wind = 0;
    this.newBest = false;
    this.hintTimer = 0;
    this.particles.clear();
    this.objectives.reset(this.rng);
  }

  private seedAndReset(seed?: number | string) {
    this.rng = new Rng(seed ?? Date.now());
    this.resetRunStats();
    this.time = 0;
    this.startX = 200;

    this.world.reset(this.rng, this.startX, CONFIG.world.startY);
    this.player.reset(this.startX, CONFIG.world.startY, this.storage.data.character);
    this.camera.snapTo(this.player.x, this.player.y);
    this.world.ensure(this.camera.right);
  }

  private enterMenu() {
    this.seedAndReset();
    this.state = "menu";
    this.timeInState = 0;
    this.player.animateMenuGlide(0, 0, this.startX);
    this.camera.snapTo(this.player.x, this.player.y);
    this.sound.setWind(0);
  }

  private startRun() {
    if (this.state === "menu") {
      // Sync to the exact menu preview pose for this moment, then continue in place.
      this.player.animateMenuGlide(0, this.time, 200);
      this.startX = this.player.x;
      this.player.beginRun();
      this.resetRunStats();
      this.state = "playing";
      this.timeInState = 0;
      this.sound.resume();
      return;
    }

    this.seedAndReset();
    this.state = "playing";
    this.timeInState = 0;
    this.sound.resume();
  }

  private togglePause() {
    if (this.state === "playing") {
      this.state = "paused";
      this.dashLatch = false;
      this.sound.setWind(0);
      this.sound.setMusicPaused(true);
    } else if (this.state === "paused") {
      this.state = "playing";
      this.sound.setMusicPaused(false);
    }
  }

  private cycleCharacter(dir: 1 | -1) {
    const next = cycleCharacterId(this.storage.data.character, dir);
    this.storage.setCharacter(next);
    this.player.characterId = next;
    this.player.trail.length = 0;
    if (this.state === "menu") {
      this.player.trail.length = 0;
      this.player.x = this.startX;
      this.player.animateMenuGlide(0, this.time, this.startX);
    }
  }

  private hitPlayButton(): boolean {
    const b = this.hud.playButton(this.camera);
    const dx = this.input.pointer.x - b.x;
    const dy = this.input.pointer.y - b.y;
    return dx * dx + dy * dy <= b.r * b.r;
  }

  private hitCharacterCycle(dir: -1 | 1): boolean {
    const b = this.hud.characterCycleButton(this.camera, dir);
    const dx = this.input.pointer.x - b.x;
    const dy = this.input.pointer.y - b.y;
    return dx * dx + dy * dy <= b.r * b.r;
  }

  private hitPauseButton(): boolean {
    const b = this.hud.pauseButton(this.camera);
    const dx = this.input.pointer.x - b.x;
    const dy = this.input.pointer.y - b.y;
    return dx * dx + dy * dy <= b.r * b.r;
  }

  private endRun(opts: { crashSound?: boolean; burst?: boolean } = {}) {
    if (
      this.state !== "playing" &&
      this.state !== "paused" &&
      this.state !== "crashing"
    ) {
      return;
    }
    this.state = "gameover";
    this.timeInState = 0;
    const score = Math.floor(this.score);
    this.newBest = this.storage.recordRun(
      score,
      Math.floor(this.distance),
      this.perfectCount
    );
    this.sound.setWind(0);
    if (opts.crashSound) this.sound.crash();
    this.camera.addShake(16);
    if (opts.burst !== false) {
      this.particles.emit(this.player.x, this.player.y, {
        count: 30,
        speed: [80, 460],
        life: [0.5, 1.1],
        size: [2, 5],
        color: theme.player,
        drag: 1.4,
        gravity: 300,
        additive: false,
      });
    }
  }

  private startGroundCrash() {
    if (this.state !== "playing" && this.state !== "paused") return;
    this.state = "crashing";
    this.dashLatch = false;
    this.sound.setWind(0);
    this.player.startSkid(this.world.seaLevel);
    this.camera.addShake(14);
    this.particles.emit(this.player.x, this.world.seaLevel, {
      count: 28,
      speed: [50, 300],
      life: [0.35, 0.85],
      size: [2, 6],
      color: theme.sea,
      angle: -Math.PI / 2,
      spread: Math.PI * 0.85,
      gravity: 220,
      additive: false,
    });
  }

  private get score(): number {
    return this.distance + this.bonus;
  }

  // --- Main loop -----------------------------------------------------------

  frame(dt: number) {
    this.input.beginFrame();
    // Drift the time-of-day palette. Each run starts at dawn (this.time resets).
    updateTheme(this.time);
    if (this.input.anyInteraction) this.sound.resume();
    if (this.input.tapped.has("KeyM")) {
      this.sound.setMuted(this.sound.enabled);
    }

    this.handleStateInput();

    if (this.state !== "paused") {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= CONFIG.fixedDt && steps < 8) {
        this.step(CONFIG.fixedDt);
        this.acc -= CONFIG.fixedDt;
        steps++;
      }
      if (steps === 8) this.acc = 0; // avoid spiral of death after a long stall
    }

    this.particles.update(dt);
    this.hud.update(dt);
    if (this.state !== "paused") this.objectives.update(dt);
    this.sound.setWind(
      this.state === "playing" ? clamp(this.player.speed / 1100, 0, 1) : 0
    );
    this.timeInState += dt;

    this.render();
  }

  private handleStateInput() {
    if (this.state === "menu") {
      if (
        this.input.tapped.has("KeyC") ||
        this.input.tapped.has("ArrowRight")
      ) {
        this.cycleCharacter(1);
        return;
      }
      if (this.input.tapped.has("ArrowLeft")) {
        this.cycleCharacter(-1);
        return;
      }
      if (this.input.pointerJustDown) {
        if (this.hitCharacterCycle(-1)) {
          this.cycleCharacter(-1);
          return;
        }
        if (this.hitCharacterCycle(1)) {
          this.cycleCharacter(1);
          return;
        }
        if (this.hitPlayButton() || this.input.pressed) {
          this.startRun();
        }
        return;
      }
      return;
    }
    if (this.state === "gameover") {
      if (this.timeInState > 0.6 && (this.input.pressed || this.input.pointerJustDown)) {
        this.startRun();
      }
      return;
    }

    if (this.state === "crashing") return;

    if (this.state === "paused") {
      if (
        this.input.tapped.has("Escape") ||
        this.input.tapped.has("KeyP") ||
        (this.input.pointerJustDown && this.hitPauseButton())
      ) {
        this.togglePause();
      }
      return;
    }

    if (this.input.tapped.has("Escape") || this.input.tapped.has("KeyP")) {
      this.togglePause();
      return;
    }

    // Playing: detect a dash-button tap (suppresses tether for that hold).
    if (this.input.pointerJustDown) {
      if (this.hitPauseButton()) {
        this.togglePause();
        return;
      }
      const b = this.hud.dashButton(this.camera);
      const dx = this.input.pointer.x - b.x;
      const dy = this.input.pointer.y - b.y;
      if (dx * dx + dy * dy <= b.r * b.r) {
        this.dashLatch = true;
        this.tryDash();
      }
    }
    if (!this.input.holding) this.dashLatch = false;
    if (this.input.dashTapped) this.tryDash();
  }

  private tryDash() {
    if (this.state !== "playing") return;
    if (this.wind < CONFIG.wind.dashCost) return;
    if (this.player.startDash()) {
      this.wind = 0;
    }
  }

  private step(dt: number) {
    if (this.state === "paused") return;

    this.time += dt;

    if (this.state === "menu") {
      this.player.animateMenuGlide(dt, this.time, this.startX);
      this.camera.follow(this.player.x, this.player.y, 280, dt);
      this.world.ensure(this.camera.right);
      this.world.cull(this.camera.left);
      this.world.update(dt, this.time);
      return;
    }

    if (this.state === "gameover") {
      this.world.update(dt, this.time);
      this.camera.follow(this.player.x, this.player.y, this.player.speed * 0.2, dt);
      return;
    }

    if (this.state === "crashing") {
      this.world.ensure(this.camera.right);
      this.world.update(dt, this.time);
      const stopped = this.player.stepSkid(dt, this.world.seaLevel);
      this.distance = Math.max(
        0,
        (this.player.x - this.startX) * CONFIG.world.metersPerPixel
      );
      this.camera.follow(
        this.player.x,
        this.player.y,
        Math.max(this.player.speed, 60),
        dt
      );
      this.world.cull(this.camera.left);

      const spd = this.player.speed;
      if (spd > CONFIG.skid.stopSpeed && Math.random() < clamp(spd / 700, 0.06, 0.32)) {
        this.particles.emit(this.player.x - 16, this.player.y + 4, {
          count: 2,
          speed: [20, 100],
          life: [0.25, 0.55],
          size: [2, 4],
          color: theme.seaDeep,
          angle: Math.PI,
          spread: Math.PI * 0.5,
          drag: 2.2,
          gravity: 80,
          additive: false,
        });
      }

      if (stopped) {
        this.endRun({ crashSound: false, burst: false });
      }
      return;
    }

    // --- Playing ---
    this.hintTimer += dt;
    this.world.ensure(this.camera.right);

    const holdForTether = this.input.holding && !this.dashLatch;
    this.player.step(dt, holdForTether, this.world.anchors, this.time);

    const dashing = this.player.state === "dash";
    this.world.update(
      dt,
      this.time,
      dashing
        ? {
            x: this.player.x,
            y: this.player.y,
            range: CONFIG.wind.dashMagnetRange,
            strength: 1000,
          }
        : undefined
    );

    this.handlePlayerEvents();
    this.handleSkim(dt);
    this.handleCollectibles();
    this.handleHazards();

    // Cloud-sea death floor — skid to a stop before run over.
    if (this.player.y >= this.world.seaLevel) {
      this.startGroundCrash();
      return;
    }

    // Scoring + objectives tied to distance.
    this.distance = Math.max(
      0,
      (this.player.x - this.startX) * CONFIG.world.metersPerPixel
    );
    this.objectives.set("distance", this.distance);
    this.objectives.set("skim", this.skimMeters);

    this.wind = clamp(this.wind, 0, CONFIG.wind.max);

    this.camera.follow(this.player.x, this.player.y, this.player.speed, dt);
    this.world.cull(this.camera.left);

    // Highlight the nearest grab candidate so the route reads clearly.
    if (this.player.state === "glide") {
      const target = this.player.findGrabTarget(this.world.anchors);
      if (target) target.highlight = 1;
    }
  }

  private handlePlayerEvents() {
    this.player.drainEvents((e) => {
      switch (e.type) {
        case "grab": {
          this.sound.grab();
          this.particles.emit(e.x, e.y, {
            count: 8,
            speed: [40, 160],
            life: [0.2, 0.5],
            size: [1.5, 3],
            color: theme.anchorRing,
          });
          if (e.moving) this.objectives.report("moving", 1);
          break;
        }
        case "release": {
          const { perfect, x, y } = e.info;
          if (perfect) {
            this.perfectCount += 1;
            this.bonus += CONFIG.scoring.perfectPoints;
            this.wind += CONFIG.wind.perfectGain;
            this.objectives.report("perfect", 1);
            this.hud.popup(x, y - 26, `PERFECT +${CONFIG.scoring.perfectPoints}`, theme.anchorPerfect, 1.25);
            this.hud.triggerFlash(0.6);
            this.camera.addShake(5);
            this.sound.perfect();
            this.particles.emit(x, y, {
              count: 22,
              speed: [120, 460],
              life: [0.3, 0.8],
              size: [2, 4.5],
              color: theme.anchorPerfect,
              drag: 1.6,
            });
          } else {
            this.sound.release();
            this.particles.emit(x, y, {
              count: 6,
              speed: [40, 160],
              life: [0.2, 0.5],
              size: [1.5, 3],
              color: theme.tether,
            });
          }
          break;
        }
        case "dash": {
          this.sound.dash();
          this.objectives.report("dash", 1);
          this.camera.addShake(6);
          this.particles.emit(e.x, e.y, {
            count: 18,
            speed: [120, 380],
            life: [0.25, 0.6],
            size: [2, 5],
            color: theme.collectible,
            angle: Math.PI,
            spread: Math.PI * 0.8,
          });
          break;
        }
      }
    });
  }

  private handleSkim(dt: number) {
    let best = 0;
    let bx = 0;
    let by = 0;
    for (const c of this.world.clouds) {
      const f = c.skimFactor(this.player.x, this.player.y);
      if (f > best) {
        best = f;
        bx = this.player.x;
        by = this.player.y;
        c.glow = 1;
      }
    }
    if (best > 0) {
      this.wind += CONFIG.wind.skimGainPerSec * best * dt;
      this.bonus += CONFIG.scoring.skimPointsPerSec * best * dt;
      this.skimMeters += this.player.speed * dt * CONFIG.world.metersPerPixel * best;
      if (Math.random() < best * 0.5) {
        this.particles.emit(bx, by, {
          count: 1,
          speed: [20, 80],
          life: [0.3, 0.7],
          size: [2, 5],
          color: theme.cloud,
          drag: 1.2,
        });
      }
    }
  }

  private handleCollectibles() {
    const rr = CONFIG.player.radius + 14;
    const r2 = rr * rr;
    for (const c of this.world.collectibles) {
      if (c.collected) continue;
      const dx = c.x - this.player.x;
      const dy = c.y - this.player.y;
      if (dx * dx + dy * dy <= r2) {
        c.collected = true;
        this.bonus += CONFIG.scoring.collectPoints;
        this.wind += CONFIG.wind.collectGain;
        this.objectives.report("collect", 1);
        this.sound.collect();
        this.particles.emit(c.x, c.y, {
          count: 7,
          speed: [60, 220],
          life: [0.25, 0.6],
          size: [1.5, 3.5],
          color: theme.collectible,
        });
      }
    }
  }

  private handleHazards() {
    const invuln = this.player.hazardInvuln > 0;
    for (const h of this.world.hazards) {
      if (h.gone || h.destroyed) continue;

      const dx = h.x - this.player.x;
      const dy = h.y - this.player.y;
      const near =
        dx * dx + dy * dy <
        (CONFIG.wind.dashDebrisRange + h.rx) * (CONFIG.wind.dashDebrisRange + h.rx);
      const hit = h.hits(this.player.x, this.player.y, CONFIG.player.radius);

      if (invuln) {
        if (near || hit) this.smashHazard(h);
        continue;
      }

      if (hit) {
        this.player.kill();
        this.endRun({ crashSound: true });
        return;
      }
    }
  }

  private smashHazard(h: Hazard) {
    h.break_();
    this.bonus += 20;
    this.camera.addShake(4);
    this.particles.emit(h.x, h.y, {
      count: 16,
      speed: [80, 320],
      life: [0.3, 0.7],
      size: [2, 5],
      color: theme.hazardEdge,
      drag: 1.4,
      gravity: 200,
      additive: false,
    });
  }

  // --- Render --------------------------------------------------------------

  private render() {
    const ctx = this.ctx;
    const cam = this.camera;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.background.drawSky(ctx, cam, this.time);
    this.background.drawFar(ctx, cam, this.time);
    this.background.drawMid(ctx, cam);
    this.background.drawSea(ctx, cam, this.time);

    ctx.save();
    cam.apply(ctx);
    for (const c of this.world.clouds) c.draw(ctx);
    for (const c of this.world.collectibles) c.draw(ctx, this.time);
    for (const h of this.world.hazards) h.draw(ctx, this.time);
    for (const a of this.world.anchors) a.draw(ctx, this.time);
    if (
      this.state === "menu" ||
      this.state === "playing" ||
      this.state === "paused" ||
      this.state === "crashing"
    ) {
      this.player.draw(ctx, this.time, this.state === "menu");
    }
    this.particles.draw(ctx);
    this.hud.drawWorldPopups(ctx);
    ctx.restore();

    this.background.drawForeground(ctx, cam, this.time);
    this.background.drawAmbient(ctx, cam, this.time);
    this.drawVignette(ctx, cam);
    this.hud.drawScreen(ctx, cam, this.buildHudData());
  }

  // Cheap post-process: radial vignette + a touch of top/bottom grade for depth
  // and HUD legibility.
  private drawVignette(ctx: CanvasRenderingContext2D, cam: Camera) {
    const { w, h } = cam;
    const onMenu = this.state === "menu";
    const edge = onMenu ? 0.18 : 0.42 - theme.night * 0.14;
    const g = ctx.createRadialGradient(
      w * 0.5,
      h * 0.5,
      Math.min(w, h) * 0.34,
      w * 0.5,
      h * 0.52,
      Math.max(w, h) * 0.75
    );
    g.addColorStop(0, hexA(theme.skyTop, 0));
    g.addColorStop(1, hexA(theme.skyTop, edge));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const top = ctx.createLinearGradient(0, 0, 0, h * 0.22);
    top.addColorStop(0, hexA(theme.skyTop, onMenu ? 0.12 : 0.3));
    top.addColorStop(1, hexA(theme.skyTop, 0));
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, w, h * 0.22);
  }

  private buildHudData(): HudData {
    const hintAlpha = clamp(1 - (this.hintTimer - 5.5) / 2, 0, 1);
    return {
      state: this.state,
      score: this.score,
      distance: this.distance,
      best: this.storage.data.bestScore,
      bestDistance: this.storage.data.bestDistance,
      wind: this.wind / CONFIG.wind.max,
      dashReady: this.wind >= CONFIG.wind.dashCost,
      speed: this.player.speed,
      objectives: this.objectives.list,
      objectivesDone: this.objectives.completedCount,
      muted: !this.sound.enabled,
      newBest: this.newBest,
      perfectCount: this.perfectCount,
      hint: "Hold to swing  ·  release to slingshot",
      hintAlpha: this.state === "playing" ? hintAlpha : 0,
      character: this.storage.data.character,
      characterName: characterName(this.storage.data.character),
    };
  }
}
