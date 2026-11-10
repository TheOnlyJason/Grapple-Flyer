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
import { Anchor, hexA } from "../entities/anchor";
import {
  drawBarrier,
  drawMagnetField,
  ORB_COLOR,
  POWERUP_COLOR,
  POWERUP_NAME,
} from "../entities/powerup";
import { makeScratch, Scratch, VersionCache } from "../render/rcache";
import { World } from "../systems/world";
import { Particles } from "../systems/particles";
import { Objectives } from "../systems/objectives";
import { Tutorial } from "../systems/tutorial";
import { Background } from "../render/background";
import { Hud, HudData } from "../render/hud";
import {
  cycleCharacterId,
  characterName,
} from "../characters/registry";

type GameState = "menu" | "playing" | "paused" | "crashing" | "gameover";

/** A pull toward (x, y) applied to collectibles by World.update. */
interface MagnetField {
  x: number;
  y: number;
  range: number;
  strength: number;
}

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
  /** Preview glide origin on menu / game-over attract screens. */
  private attractGlideX = 200;
  /** Time origin for attract-screen preview glide. */
  private attractGlideStartTime = 0;
  private distance = 0;
  private bonus = 0;
  private perfectCount = 0;
  private skimMeters = 0;
  private wind = 0;
  private newBest = false;
  private hintTimer = 0;

  // True while a tap that began on the dash button is held (suppresses tether).
  private dashLatch = false;
  // One-time "SMASH SPEED" nudge per run, shown the first time the player
  // gets fast enough to plow through meteors.
  private smashHintShown = false;
  private smashCharge = 0; // seconds of meteor-smashing left since last reaching smash speed
  private lastShatterSfx = -1; // game clock of the last crunch, to de-stack a multi-rock dash

  // Orbs picked up this run (banked into the save when the run ends) and the
  // power-up effects currently worn.
  private runOrbs = 0;
  private magnetTime = 0; // seconds of magnet left
  private barrier = false; // absorbs one fatal hit
  private barrierGrace = 0; // seconds rocks still break on contact after it bursts
  private objectivesChimed = 0; // completed objectives already announced this run
  // First-flight tutorial (src/systems/tutorial.ts): its slow motion, and the
  // rock it stages for the dash lesson.
  private tutorial = new Tutorial();
  private tutorialRock: Hazard | null = null;
  private tutorialAnchor: Anchor | null = null;
  private tutorialWaitGrab = 0;
  private tutorialGaugeGiven = false;
  private tutorialSeaWarned = false;
  private timeScale = 1;

  // Reused dash-magnet params for world.update — mutated per sub-step instead
  // of allocating a fresh object literal 120x/sec for the duration of a dash.
  private dashMagnet: MagnetField = {
    x: 0,
    y: 0,
    range: CONFIG.wind.dashMagnetRange,
    strength: 1000,
  };
  // Same idea for the magnet power-up's wider, longer pull.
  private powerMagnet: MagnetField = {
    x: 0,
    y: 0,
    range: CONFIG.powerups.magnet.range,
    strength: CONFIG.powerups.magnet.strength,
  };

  // Baked vignette + top grade, rebuilt only on palette / size / menu changes.
  private vignette = new VersionCache<Scratch>();
  private vignetteScratch: Scratch | null = null;

  constructor(canvas: HTMLCanvasElement) {
    // desynchronized lets Chromium present without compositor sync (saves a
    // buffer copy + up to a frame of latency); Safari/WKWebView ignores it.
    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.input = new Input(canvas);
    this.sound.setMuted(this.storage.data.muted);
    this.enterMenu();
  }

  resize(
    w: number,
    h: number,
    dpr: number,
    insets = { top: 0, right: 0, bottom: 0, left: 0 }
  ) {
    this.dpr = dpr;
    this.camera.resize(w, h);
    this.camera.insets = insets;
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
    this.smashHintShown = false;
    this.clearSmash();
    this.runOrbs = 0;
    this.magnetTime = 0;
    this.barrier = false;
    this.particles.clear();
    this.objectives.reset(this.rng);
    this.objectivesChimed = 0;
  }

  private seedAndReset(seed?: number | string) {
    this.rng = new Rng(seed ?? Date.now());
    this.resetRunStats();
    this.time = 0;
    this.startX = 200;

    this.world.reset(this.rng, this.startX, CONFIG.world.startY);
    this.player.reset(this.startX, CONFIG.world.startY, this.storage.data.character);
    this.player.conserveMomentum = this.storage.data.conserveMomentum;
    this.camera.snapTo(this.player.x, this.player.y);
    this.world.ensure(this.camera.right);
  }

  private enterMenu() {
    this.stopTutorial();
    this.seedAndReset();
    this.state = "menu";
    this.timeInState = 0;
    this.attractGlideX = this.startX;
    this.attractGlideStartTime = 0;
    this.player.animateMenuGlide(0, 0, this.attractGlideX);
    this.camera.snapTo(this.player.x, this.player.y);
    this.sound.setWind(0);
  }

  /**
   * `tutorial`: the HOW TO PLAY button. A brand-new player's first run is
   * the tutorial anyway, and a restart during it starts it over.
   */
  private startRun(tutorial = false) {
    const firstFlight = !this.storage.data.tutorialDone && this.storage.data.runs === 0;
    const withTutorial = tutorial || firstFlight || this.tutorial.active;
    if (this.state === "menu" || this.state === "gameover") {
      // Sync to the exact preview pose, then continue in place — no world reset.
      const glideTime = this.time - this.attractGlideStartTime;
      this.player.animateMenuGlide(0, glideTime, this.attractGlideX);
      this.startX = this.player.x;
      // The difficulty ramp restarts with the run. The world does not: what
      // is on screen stays and the sky keeps its time of day; only the part
      // not yet in view is rebuilt on the fresh ramp.
      this.world.beginRun(this.player.x, this.camera.right);
      this.world.ensure(this.camera.right);
      // The world here is whatever the attract glide flew into — guarantee a
      // reachable first anchor and a rock-free launch corridor so the run
      // can't end before it begins.
      this.world.ensureOpeningAnchor(this.player.x, this.player.y);
      this.world.removeHazardsNear(this.player.x + 180, this.player.y, 320);
      this.player.beginRun();
      this.resetRunStats();
      this.beginTutorial(withTutorial);
      this.state = "playing";
      this.timeInState = 0;
      this.sound.resume();
      return;
    }

    this.seedAndReset();
    this.beginTutorial(withTutorial);
    this.state = "playing";
    this.timeInState = 0;
    this.sound.resume();
  }

  private beginTutorial(on: boolean) {
    this.stopTutorial();
    if (on) this.tutorial.start();
  }

  private stopTutorial() {
    this.tutorial.stop();
    this.tutorialRock = null;
    this.tutorialAnchor = null;
    this.tutorialWaitGrab = 0;
    this.tutorialGaugeGiven = false;
    this.tutorialSeaWarned = false;
    this.timeScale = 1;
  }

  /** SKIP during the tutorial: done for good, and the run goes on for real. */
  private skipTutorial() {
    const rock = this.tutorialRock;
    // The lesson's rock is right in the path; with the safety net gone it
    // would be a cheap death.
    if (rock && !rock.destroyed) {
      const i = this.world.hazards.indexOf(rock);
      if (i >= 0) this.world.hazards.splice(i, 1);
    }
    this.stopTutorial();
    this.storage.setTutorialDone();
  }

  /** The tutorial's half of a playing step: its bookkeeping and its staged rock. */
  private stepTutorial(dt: number) {
    const t = this.tutorial;
    const p = this.player;
    // No rocks but the lesson's own until the tutorial is over.
    {
      const hs = this.world.hazards;
      let w = 0;
      for (const h of hs) {
        if (h === this.tutorialRock || h.destroyed || h.x < p.x - 300) hs[w++] = h;
      }
      hs.length = w;
    }
    if (t.wantsRock) {
      if (!this.tutorialGaugeGiven) {
        this.tutorialGaugeGiven = true;
        this.hud.popup(p.x, p.y - 40, "WIND GAUGE FULL", theme.collectible, 1.15);
      }
      if (this.wind < CONFIG.wind.dashCost) this.wind = CONFIG.wind.max;
      let rock = this.tutorialRock;
      if (!rock || rock.destroyed || rock.gone || rock.x < p.x - 160) {
        // Off the right edge of the view, at the player's height.
        rock = new Hazard(this.camera.right + 90, p.y, 46, 42, this.rng);
        this.world.hazards.push(rock);
        this.tutorialRock = rock;
      } else if (!t.dashPrompting) {
        // Drift onto the line a dash from here would take (a dash keeps a
        // little of the current pitch), so the lesson's dash lands.
        const s = p.speed || 1;
        const pitch = clamp(p.vy / s, -0.3, 0.3);
        const lineY = p.y + (rock.x - p.x) * pitch;
        rock.y += (lineY - rock.y) * Math.min(1, dt * 3);
      }
    }
    // A grab lesson needs a good anchor: above and ahead (the 1.2 rope also
    // grabs a level one, and that swing hangs dead). If none has glowed for
    // a moment, one is hung just off the right edge of the view and drifts
    // (off screen briskly, on screen gently, like a moving anchor) to stay a
    // reachable height above the glide until it is in reach.
    const target = p.state === "glide" && t.allowTether() ? p.findGrabTarget(this.world.anchors, this.camera) : null;
    const grabGood = target !== null && target.y < p.y - 60 && target.x > p.x + 20;
    if (t.wantsGrab && p.state === "glide") {
      this.tutorialWaitGrab = grabGood ? 0 : this.tutorialWaitGrab + dt;
      let a = this.tutorialAnchor;
      if (a && a.x < p.x - 120) a = this.tutorialAnchor = null;
      if (!a && this.tutorialWaitGrab > 0.8) {
        a = new Anchor(this.camera.right + 60, p.y - 150, "normal");
        this.world.anchors.push(a);
        this.tutorialAnchor = a;
      }
      if (a && Math.hypot(a.x - p.x, a.y - p.y) > CONFIG.tether.grabRange) {
        // Where the glide will be when the anchor is about 250 px ahead,
        // and a comfortable 150 px above that.
        const lead = Math.max(0, (a.x - p.x - 250) / Math.max(p.vx, 200));
        const y = Math.min(this.world.seaLevel - 320, p.y + clamp(p.vy, -150, 250) * lead - 150);
        const rate = a.x > this.camera.right - 30 ? 4 : 1.5;
        a.y += (y - a.y) * Math.min(1, dt * rate); // a "normal" anchor is wherever y says
      }
    } else {
      this.tutorialWaitGrab = 0;
    }

    const rock = this.tutorialRock;
    // Rising forward from the bottom of the swing toward the gold window's
    // near edge (the window is a launch direction: idealLaunchAngleDeg ±
    // perfectToleranceDeg, screen-space, up is negative).
    const T = CONFIG.tether;
    const launchDeg = (Math.atan2(p.vy, p.vx) * 180) / Math.PI;
    const releaseApproach =
      p.state === "swing" &&
      p.vx > 0 &&
      p.vy < 0 &&
      p.speed >= T.minSwingSpeed + 180 &&
      launchDeg > T.idealLaunchAngleDeg + T.perfectToleranceDeg;
    t.update(dt, {
      holding: this.input.holding,
      playerState: p.state,
      grabLit: grabGood,
      inPerfectWindow: p.inPerfectWindow,
      releaseApproach,
      rockAhead: rock && !rock.destroyed && !rock.gone ? rock.x - p.x : null,
    });
    if (t.justFinished) {
      this.tutorialRock = null;
      this.storage.setTutorialDone();
      this.sound.objective();
    }
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
    if (this.isAttractScreen()) {
      this.player.trail.length = 0;
      this.player.x = this.attractGlideX;
      this.player.animateMenuGlide(0, this.time - this.attractGlideStartTime, this.attractGlideX);
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

  private hitRect(r: { x: number; y: number; w: number; h: number }): boolean {
    const p = this.input.pointer;
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  }

  /** Abandon the current run (nothing is recorded) and start a fresh one in place. */
  private restartRun() {
    if (this.state !== "playing" && this.state !== "paused") return;
    this.clearSmash();
    this.magnetTime = 0;
    this.barrier = false;
    this.sound.setMusicPaused(false);
    this.sound.setWind(0);
    // Hand off exactly as a run's end does, then start straight away.
    this.state = "gameover";
    this.timeInState = 0;
    this.player.trail.length = 0;
    this.attractGlideX = this.player.x;
    this.attractGlideStartTime = this.time;
    this.player.animateMenuGlide(0, 0, this.attractGlideX);
    // The plane is back at the start altitude, wherever the run was: bring
    // the view with it, or the new run would start off-screen, with the
    // finger still on the button free to latch an old anchor the player
    // cannot see (a death has the game-over screen for the camera to catch
    // up; a restart has no frame in between). x stays: the run restarts in place.
    this.camera.y = this.player.y - this.camera.viewH * CONFIG.camera.anchorY;
    this.startRun();
  }

  /** The mute button (or M): sound off or on, remembered in the save. */
  private toggleMute() {
    const muted = this.sound.enabled;
    this.sound.setMuted(muted);
    this.storage.setMuted(muted);
  }

  private hitMuteButton(): boolean {
    const b = this.hud.muteButton(this.camera, this.isAttractScreen());
    const dx = this.input.pointer.x - b.x;
    const dy = this.input.pointer.y - b.y;
    return dx * dx + dy * dy <= b.r * b.r;
  }

  /** The pause-menu swing option (remembered in the save). */
  private toggleConserveMomentum() {
    const next = !this.storage.data.conserveMomentum;
    this.storage.setConserveMomentum(next);
    this.player.setConserveMomentum(next);
  }

  private hitPauseButton(): boolean {
    const b = this.hud.pauseButton(this.camera);
    const dx = this.input.pointer.x - b.x;
    const dy = this.input.pointer.y - b.y;
    return dx * dx + dy * dy <= b.r * b.r;
  }

  /** True while a meteor hit will smash it instead of ending the run. */
  get smashArmed(): boolean {
    return this.smashCharge > 0;
  }

  private clearSmash() {
    this.barrierGrace = 0;
    this.smashCharge = 0;
    this.player.smashGlow = false;
  }

  private endRun(opts: { crashSound?: boolean; burst?: boolean } = {}) {
    if (
      this.state !== "playing" &&
      this.state !== "paused" &&
      this.state !== "crashing"
    ) {
      return;
    }
    this.clearSmash();
    this.stopTutorial();
    this.state = "gameover";
    this.timeInState = 0;
    const score = Math.floor(this.score);
    this.newBest = this.storage.recordRun(
      score,
      Math.floor(this.distance),
      this.perfectCount,
      this.runOrbs
    );
    this.magnetTime = 0;
    this.barrier = false;
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
    this.player.trail.length = 0;
    this.attractGlideX = this.player.x;
    this.attractGlideStartTime = this.time;
    this.player.animateMenuGlide(0, 0, this.attractGlideX);
  }

  private isAttractScreen(): boolean {
    return this.state === "menu" || this.state === "gameover";
  }

  private handleAttractInput() {
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
      if (this.hitMuteButton()) {
        this.toggleMute();
        return;
      }
      if (this.hitRect(this.hud.howToPlayButton(this.camera))) {
        this.startRun(true);
        return;
      }
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
    }
  }

  private startGroundCrash() {
    if (this.state !== "playing" && this.state !== "paused") return;
    this.state = "crashing";
    this.clearSmash();
    this.magnetTime = 0;
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
    if (this.input.tapped.has("KeyM")) this.toggleMute();

    this.handleStateInput();

    if (this.state !== "paused") {
      // World streaming runs once per rendered frame, not per 120 Hz sub-step:
      // the 700px spawn / 500px cull buffers dwarf per-frame camera movement.
      // ensure() before the step loop so anchors exist for the physics steps;
      // cull() after it, once the camera has settled for this frame.
      this.world.ensure(this.camera.right);
      // The tutorial slows time while a prompt waits for the player; outside
      // it the scale is exactly 1 and nothing here changes the game.
      const slowTarget = this.state === "playing" && this.tutorial.active ? this.tutorial.slow : 1;
      if (slowTarget !== 1 || this.timeScale !== 1) {
        const rate = slowTarget < this.timeScale ? 12 : 6;
        this.timeScale += (slowTarget - this.timeScale) * Math.min(1, dt * rate);
        if (slowTarget === 1 && this.timeScale > 0.995) this.timeScale = 1;
      }
      this.acc += dt * this.timeScale;
      let steps = 0;
      while (this.acc >= CONFIG.fixedDt && steps < 8) {
        this.step(CONFIG.fixedDt);
        this.acc -= CONFIG.fixedDt;
        steps++;
      }
      if (steps === 8) this.acc = 0; // avoid spiral of death after a long stall
      this.world.cull(this.camera.left);
    }

    this.particles.update(dt * this.timeScale);
    this.tutorial.animate(dt);
    this.hud.update(dt);
    if (this.state !== "paused") this.objectives.update(dt);
    const objectivesDone = this.objectives.completedCount;
    if (objectivesDone > this.objectivesChimed && this.state === "playing") {
      this.sound.objective();
    }
    this.objectivesChimed = objectivesDone;
    this.sound.setWind(
      this.state === "playing" ? clamp(this.player.speed / 1100, 0, 1) : 0
    );
    this.timeInState += dt;

    this.render();
  }

  private handleStateInput() {
    if (this.state === "menu") {
      this.handleAttractInput();
      return;
    }
    if (this.state === "gameover") {
      this.handleAttractInput();
      return;
    }

    if (this.state === "crashing") return;

    if (this.state === "paused") {
      if (this.input.pointerJustDown && this.hitMuteButton()) {
        this.toggleMute();
        return;
      }
      if (this.input.pointerJustDown) {
        const b = this.hud.pauseMenuButtons(this.camera);
        if (this.hitRect(b.restart)) {
          this.restartRun();
          return;
        }
        if (this.hitRect(b.momentum)) {
          this.toggleConserveMomentum();
          return;
        }
      }
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
      if (this.hitMuteButton()) {
        this.dashLatch = true; // this press is not a grab
        this.toggleMute();
        return;
      }
      if (this.tutorial.active && this.hitRect(this.hud.tutorialSkipButton(this.camera))) {
        this.dashLatch = true; // this press is not a grab
        this.skipTutorial();
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

    if (this.state === "menu" || this.state === "gameover") {
      const glideTime = this.time - this.attractGlideStartTime;
      this.player.animateMenuGlide(dt, glideTime, this.attractGlideX);
      // No run in progress: keep the difficulty ramp parked at the plane so
      // the sky scrolling in behind the menu stays at opening difficulty.
      this.world.holdRamp(this.player.x);
      this.camera.follow(this.player.x, this.player.y, 280, dt);
      this.world.update(dt, this.time);
      return;
    }

    if (this.state === "crashing") {
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

    const holdForTether = this.input.holding && !this.dashLatch && this.tutorial.allowTether();
    this.player.step(dt, holdForTether, this.world.anchors, this.time, this.camera);

    // Reaching smash speed charges the smash for a short while, so the meteor
    // the player was aiming at still breaks after drag bleeds the launch off.
    if (this.player.speed >= CONFIG.player.smashSpeed) {
      this.smashCharge = CONFIG.player.smashHold;
    } else if (this.smashCharge > 0) {
      this.smashCharge = Math.max(0, this.smashCharge - dt);
    }
    if (this.barrierGrace > 0) this.barrierGrace = Math.max(0, this.barrierGrace - dt);
    // The aura swells and gains a mint ring while charged, blinking out at the end.
    this.player.smashGlow =
      this.smashCharge > 0 &&
      (this.smashCharge > 0.35 || Math.floor(this.smashCharge * 16) % 2 === 0);

    const dashing = this.player.state === "dash";
    if (dashing) {
      this.dashMagnet.x = this.player.x;
      this.dashMagnet.y = this.player.y;
    }
    // The magnet power-up pulls orbs and wisps in; a dash keeps its own pull.
    let magnet: MagnetField | undefined;
    if (this.magnetTime > 0) {
      this.magnetTime = Math.max(0, this.magnetTime - dt);
      this.powerMagnet.x = this.player.x;
      this.powerMagnet.y = this.player.y;
      magnet = this.powerMagnet;
    } else if (dashing) {
      magnet = this.dashMagnet;
    }
    this.world.update(dt, this.time, magnet);

    this.handlePlayerEvents();
    this.handleSkim(dt);
    this.handleCollectibles();
    this.handlePowerUps();
    this.handleHazards();

    // Cloud-sea death floor — skid to a stop before run over.
    if (this.player.y >= this.world.seaLevel && this.tutorial.active) {
      // The tutorial's safety net: thrown back up, with a word of warning.
      this.player.bounce(this.world.seaLevel, CONFIG.powerups.barrier.seaBounce);
      this.particles.emit(this.player.x, this.world.seaLevel, {
        count: 22,
        speed: [60, 320],
        life: [0.35, 0.8],
        size: [2, 5.5],
        color: theme.sea,
        angle: -Math.PI / 2,
        spread: Math.PI * 0.8,
        gravity: 240,
        additive: false,
      });
      if (!this.tutorialSeaWarned) {
        this.tutorialSeaWarned = true;
        this.hud.popup(this.player.x, this.player.y - 40, "THE CLOUD SEA ENDS A RUN", theme.text, 1);
      }
    } else if (this.player.y >= this.world.seaLevel) {
      if (!this.barrier) {
        this.startGroundCrash();
        return;
      }
      // The barrier takes the hit: it bursts and throws the player back up.
      this.breakBarrier(this.player.x, this.world.seaLevel);
      this.player.bounce(this.world.seaLevel, CONFIG.powerups.barrier.seaBounce);
      this.particles.emit(this.player.x, this.world.seaLevel, {
        count: 22,
        speed: [60, 320],
        life: [0.35, 0.8],
        size: [2, 5.5],
        color: theme.sea,
        angle: -Math.PI / 2,
        spread: Math.PI * 0.8,
        gravity: 240,
        additive: false,
      });
    }

    // Scoring + objectives tied to distance.
    this.distance = Math.max(
      0,
      (this.player.x - this.startX) * CONFIG.world.metersPerPixel
    );
    this.objectives.set("distance", this.distance);
    this.objectives.set("skim", this.skimMeters);

    this.wind = clamp(this.wind, 0, CONFIG.wind.max);

    // One-time nudge per run the first time the player reaches smash speed.
    if (!this.smashHintShown && this.smashCharge > 0) {
      this.smashHintShown = true;
      this.hud.popup(this.player.x, this.player.y - 40, "SMASH SPEED", theme.collectible, 1.2);
    }

    if (this.tutorial.active) this.stepTutorial(dt);

    this.camera.follow(this.player.x, this.player.y, this.player.speed, dt);

    // Highlight the nearest grab candidate so the route reads clearly. Same
    // view gate as the actual grab, so the glow never lies.
    if (this.player.state === "glide") {
      const target = this.player.findGrabTarget(this.world.anchors, this.camera);
      if (target) target.highlight = 1;
    }
  }

  private handlePlayerEvents() {
    this.player.drainEvents((e) => {
      switch (e.type) {
        case "grab": {
          this.tutorial.onGrab();
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
          this.tutorial.onRelease(perfect);
          // The launch speed itself counts: by the time the step's own speed
          // check runs, one step of glide drag has already come off it.
          if (e.info.speed >= CONFIG.player.smashSpeed) {
            this.smashCharge = CONFIG.player.smashHold;
          }
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
          this.tutorial.onDashStart();
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
    const wispR = CONFIG.player.radius + 14;
    const orbR = CONFIG.player.radius + CONFIG.orbs.pickupRadius;
    for (const c of this.world.collectibles) {
      if (c.collected) continue;
      const dx = c.x - this.player.x;
      const dy = c.y - this.player.y;
      const rr = c.kind === "orb" ? orbR : wispR;
      if (dx * dx + dy * dy > rr * rr) continue;
      c.collected = true;
      if (c.kind === "orb") {
        this.runOrbs += 1;
        this.bonus += CONFIG.orbs.points;
        this.objectives.report("orb", 1);
        this.sound.orb();
        this.particles.emit(c.x, c.y, {
          count: 4,
          speed: [50, 170],
          life: [0.2, 0.45],
          size: [1.5, 3],
          color: ORB_COLOR,
        });
        continue;
      }
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

  private handlePowerUps() {
    const rr = CONFIG.player.radius + CONFIG.powerups.pickupRadius;
    for (const p of this.world.powerups) {
      if (p.collected) continue;
      const dx = p.x - this.player.x;
      const dy = p.y - this.player.y;
      if (dx * dx + dy * dy > rr * rr) continue;
      p.collected = true;
      if (p.kind === "magnet") this.magnetTime = CONFIG.powerups.magnet.duration;
      else this.barrier = true;
      const col = POWERUP_COLOR[p.kind];
      this.hud.popup(p.x, p.y - 34, POWERUP_NAME[p.kind], col, 1.25);
      this.sound.powerUp();
      this.camera.addShake(3);
      this.particles.emit(p.x, p.y, {
        count: 18,
        speed: [90, 380],
        life: [0.3, 0.75],
        size: [2, 4.5],
        color: col,
      });
    }
  }

  // The barrier absorbs a fatal hit and is gone. A short grace follows so a
  // second rock overlapping the first can't end the run on the next step. It
  // has its own timer: it is not a speed smash, so it must not light the
  // smash HUD, fire the smash hint or count toward the smash objective.
  private breakBarrier(x: number, y: number) {
    this.barrier = false;
    this.barrierGrace = CONFIG.powerups.barrier.grace;
    const col = POWERUP_COLOR.barrier;
    this.hud.popup(x, y - 40, "BARRIER BROKEN", col, 1.2);
    this.sound.barrierBreak();
    this.camera.addShake(9);
    this.particles.emit(this.player.x, this.player.y, {
      count: 20,
      speed: [140, 460],
      life: [0.3, 0.7],
      size: [2, 4.5],
      color: col,
    });
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

      if (!hit) continue;

      // A charged smash turns a fatal collision into a smash-through: the
      // meteor shatters and the player keeps most of their momentum.
      if (this.smashCharge > 0) {
        this.smashHazard(h, 40, 6);
        this.player.scaleVelocity(1 - CONFIG.player.smashSpeedLoss);
        this.objectives.report("smash", 1);
        this.hud.popup(h.x, h.y - 24, "SMASH +40", theme.collectible, 1.15);
        continue;
      }

      // The barrier takes the hit instead: the rock breaks, the bubble bursts
      // — and for a beat afterwards a second rock breaks the same way.
      if (this.barrier || this.barrierGrace > 0) {
        if (this.barrier) this.breakBarrier(h.x, h.y);
        this.smashHazard(h, 20, 6);
        continue;
      }

      // Nothing ends a run during the tutorial: the rock just breaks.
      if (this.tutorial.active) {
        this.smashHazard(h, 20, 6);
        continue;
      }

      this.player.kill();
      this.endRun({ crashSound: true });
      return;
    }
  }

  private smashHazard(h: Hazard, bonus = 20, shake = 4) {
    const p = this.player;
    // The rock fractures away from where the player struck it and the pieces
    // inherit some of the player's travel, so the debris stays on screen.
    h.break_(p.x, p.y, p.vx, p.vy);
    this.bonus += bonus;
    this.camera.addShake(shake);
    // Dust from the fracture…
    this.particles.emit(h.x, h.y, {
      count: 14,
      speed: [60, 240],
      life: [0.3, 0.7],
      size: [1.5, 3.5],
      color: theme.hazardEdge,
      drag: 1.6,
      gravity: 240,
      additive: false,
    });
    // …and a few hot sparks thrown forward along the player's travel.
    this.particles.emit(p.x, p.y, {
      count: 6,
      speed: [320, 640],
      life: [0.12, 0.26],
      size: [1.5, 2.6],
      color: theme.skyGlow,
      angle: Math.atan2(p.vy, p.vx),
      spread: 1.3,
      drag: 2.5,
    });
    // A dash can break several rocks in one step — one crunch covers them.
    if (Math.abs(this.time - this.lastShatterSfx) > 0.05) {
      this.lastShatterSfx = this.time;
      this.sound.shatter();
    }
  }

  // --- Render --------------------------------------------------------------

  private render() {
    const ctx = this.ctx;
    const cam = this.camera;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.background.drawSky(ctx, cam, this.time);
    this.background.drawSkyClouds(ctx, cam, this.time);
    this.background.drawMountains(ctx, cam);
    this.background.drawFar(ctx, cam, this.time);
    this.background.drawMid(ctx, cam);
    this.background.drawSea(ctx, cam, this.time);

    ctx.save();
    cam.apply(ctx);
    for (const c of this.world.clouds) c.draw(ctx);
    for (const c of this.world.collectibles) c.draw(ctx, this.time);
    for (const p of this.world.powerups) p.draw(ctx, this.time);
    for (const h of this.world.hazards) h.draw(ctx, this.time);
    for (const a of this.world.anchors) a.draw(ctx, this.time);
    if (
      this.state === "menu" ||
      this.state === "playing" ||
      this.state === "paused" ||
      this.state === "crashing" ||
      this.state === "gameover"
    ) {
      this.player.draw(ctx, this.time, this.isAttractScreen());
      // Worn power-ups. The magnet's rings blink over its last 1.5 s.
      if (this.magnetTime > 1.5 || (this.magnetTime > 0 && Math.floor(this.magnetTime * 8) % 2 === 0)) {
        drawMagnetField(ctx, this.player.x, this.player.y, this.time);
      }
      if (this.barrier) drawBarrier(ctx, this.player.x, this.player.y, this.time);
    }
    this.particles.draw(ctx);
    this.hud.drawWorldPopups(ctx, cam.zoom);
    ctx.restore();

    this.background.drawForeground(ctx, cam, this.time);
    this.background.drawAmbient(ctx, cam, this.time);
    this.drawVignette(ctx, cam);
    this.hud.drawScreen(ctx, cam, this.buildHudData());
  }

  // Cheap post-process: radial vignette + a touch of top/bottom grade for depth
  // and HUD legibility. Baked at quarter resolution (bilinear upscale is
  // invisible on smooth gradients) and rebuilt only when the palette, canvas
  // size, or menu edge value changes — per-frame cost is one drawImage.
  private drawVignette(ctx: CanvasRenderingContext2D, cam: Camera) {
    const { w, h } = cam;
    const onMenu = this.isAttractScreen();
    const sprite = this.vignette.get(theme.version, `${w}|${h}|${onMenu}`, () =>
      this.bakeVignette(w, h, onMenu)
    );
    ctx.drawImage(sprite.canvas, 0, 0, w, h);
  }

  private bakeVignette(w: number, h: number, onMenu: boolean): Scratch {
    // Reuse one scratch canvas across rebakes (a rebake happens on every
    // palette step, so allocating here would churn ~5 canvases/sec).
    const tw = Math.max(1, Math.ceil(w / 4));
    const th = Math.max(1, Math.ceil(h / 4));
    let s = this.vignetteScratch;
    if (!s || s.canvas.width !== tw || s.canvas.height !== th) {
      s = this.vignetteScratch = makeScratch(tw, th);
    }
    const c = s.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, tw, th);
    // Draw in CSS-pixel coordinates; the scratch is a quarter-res target.
    c.scale(s.canvas.width / w, s.canvas.height / h);

    const edge = onMenu ? 0.18 : 0.42 - theme.night * 0.14;
    const g = c.createRadialGradient(
      w * 0.5,
      h * 0.5,
      Math.min(w, h) * 0.34,
      w * 0.5,
      h * 0.52,
      Math.max(w, h) * 0.75
    );
    g.addColorStop(0, hexA(theme.skyTop, 0));
    g.addColorStop(1, hexA(theme.skyTop, edge));
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);

    const top = c.createLinearGradient(0, 0, 0, h * 0.22);
    top.addColorStop(0, hexA(theme.skyTop, onMenu ? 0.12 : 0.3));
    top.addColorStop(1, hexA(theme.skyTop, 0));
    c.fillStyle = top;
    c.fillRect(0, 0, w, h * 0.22);

    return s;
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
      smashReady: this.smashCharge > 0,
      smashCharge: this.smashCharge / CONFIG.player.smashHold,
      orbs: this.runOrbs,
      orbBank: this.storage.data.orbs,
      magnet: this.magnetTime / CONFIG.powerups.magnet.duration,
      barrier: this.barrier,
      objectives: this.objectives.list,
      objectivesDone: this.objectives.completedCount,
      muted: !this.sound.enabled,
      newBest: this.newBest,
      perfectCount: this.perfectCount,
      hint: "Hold to swing  ·  release to slingshot",
      hintAlpha: this.state === "playing" && !this.tutorial.active ? hintAlpha : 0,
      character: this.storage.data.character,
      characterName: characterName(this.storage.data.character),
      conserveMomentum: this.storage.data.conserveMomentum,
      tutorial: {
        active: this.tutorial.active,
        key: this.tutorial.shown,
        alpha: this.state === "playing" || this.state === "paused" ? this.tutorial.alpha : 0,
        holding: this.input.holding,
        gold: this.player.inPerfectWindow,
      },
    };
  }
}
