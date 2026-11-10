// First-flight tutorial, in the manner of Alto's Adventure: no screens of
// text up front, just one move at a time, prompted as the moment for it
// arrives, with time slowed to a crawl until the player does it. The
// lessons follow the game's own loop:
//
//   grab   — an anchor glows: hold to grab it
//   swing  — swinging up into the gold window: let go for a PERFECT launch
//   chain  — the next anchor glows mid-air: hold again
//   (a second swing; the gold-release prompt again if the first was missed)
//   dash   — the gauge is full and a rock is ahead: tap DASH
//   sea    — a word about the cloud sea
//   done   — "You're ready", and the run carries on for real
//
// While it runs the game is forgiving (the cloud sea throws the player back
// up, a rock only breaks); the game reads `active` for that. This class is
// pure bookkeeping: the game feeds it what happened and asks it how fast
// time should run, whether a held finger may grab, and what to show.

export type TutorialKey = "grab" | "release" | "chain" | "dash" | "sea" | "done";

type Step = "off" | "grab" | "swing" | "chain" | "dash" | "dashing" | "sea" | "done";

/** What the game observed this physics step. */
export interface TutorialFacts {
  /** The finger (or hold key) is down. */
  holding: boolean;
  playerState: "glide" | "swing" | "dash" | "skid";
  /** A glide grab target exists right now (an anchor is glowing). */
  grabLit: boolean;
  inPerfectWindow: boolean;
  /** Swinging up toward the gold window (from the bottom of the swing to its edge). */
  releaseApproach: boolean;
  /** Horizontal distance from the player to the staged rock, or null. */
  rockAhead: number | null;
}

// Time scale while a prompt waits for the player: slow enough to read and
// act, never a full stop (a frozen world reads as a hang).
const SLOW_GRAB = 0.12;
// The gold window lasts about 0.15 s of game time, far less than a reaction:
// time starts slowing at the bottom of the swing and all but stops inside
// the window, so it waits for the player (about 2.5 s of real time).
const SLOW_RELEASE_APPROACH = 0.3;
const SLOW_RELEASE = 0.06;
const SLOW_CHAIN = 0.25;
const SLOW_DASH = 0.1;
// The dash prompt waits until the rock is this close (world px).
const DASH_PROMPT_DIST = 440;
// How long the closing info cards stay up (real seconds).
const SEA_CARD = 3.0;
const DONE_CARD = 2.6;
// A release that misses the gold window counts as a try; after this many the
// lesson moves on anyway.
const RELEASE_TRIES = 2;

export class Tutorial {
  active = false;
  /** Set for one step when the tutorial ends by itself (the game saves it). */
  justFinished = false;

  private step: Step = "off";
  /** The finger has been lifted since the run began (the tap that started it is not a grab). */
  private fresh = false;
  private swings = 0;
  private releasePassed = false;
  private releaseMisses = 0;
  private cardTime = 0;

  /** Wanted time scale (the game eases toward it). */
  slow = 1;
  /** The prompt the tutorial wants on screen right now. */
  want: TutorialKey | null = null;

  // Display state, eased in real time by animate(): what is drawn and how opaque.
  shown: TutorialKey | null = null;
  alpha = 0;

  start() {
    this.active = true;
    this.justFinished = false;
    this.step = "grab";
    this.fresh = false;
    this.swings = 0;
    this.releasePassed = false;
    this.releaseMisses = 0;
    this.cardTime = 0;
    this.slow = 1;
    this.want = null;
    this.shown = null;
    this.alpha = 0;
  }

  stop() {
    this.active = false;
    this.step = "off";
    this.slow = 1;
    this.want = null;
  }

  /** The dash lesson wants a full gauge and a rock to blast. */
  get wantsRock(): boolean {
    return this.active && this.step === "dash";
  }

  /** The dash prompt is up: the rock stays where it is from now on. */
  get dashPrompting(): boolean {
    return this.active && this.step === "dash" && this.want === "dash";
  }

  /** May a held finger tether right now? The tap that started the run may not. */
  allowTether(): boolean {
    return !this.active || this.fresh;
  }

  onGrab() {
    if (!this.active) return;
    if (this.step === "grab" || this.step === "chain") this.step = "swing";
  }

  onRelease(perfect: boolean) {
    if (!this.active || this.step !== "swing") return;
    this.swings++;
    if (perfect) this.releasePassed = true;
    else if (++this.releaseMisses >= RELEASE_TRIES) this.releasePassed = true;
    this.step = this.swings >= 2 ? "dash" : "chain";
  }

  onDashStart() {
    if (!this.active) return;
    // Dashing is the last move to learn, whenever it happens.
    if (this.step === "dash") this.step = "dashing";
  }

  /** Once per physics step while playing (dt is real game time, already slowed). */
  update(dt: number, f: TutorialFacts) {
    this.justFinished = false;
    if (!this.active) return;
    if (!f.holding) this.fresh = true;

    let want: TutorialKey | null = null;
    let slow = 1;
    switch (this.step) {
      case "grab":
        if (f.playerState === "swing") {
          this.step = "swing";
        } else if (f.grabLit && this.fresh) {
          want = "grab";
          slow = SLOW_GRAB;
        }
        break;
      case "swing":
        if (f.playerState === "swing" && !this.releasePassed) {
          if (f.inPerfectWindow) {
            want = "release";
            slow = SLOW_RELEASE;
          } else if (f.releaseApproach) {
            want = "release";
            slow = SLOW_RELEASE_APPROACH;
          }
        }
        break;
      case "chain":
        if (f.playerState === "swing") {
          this.step = "swing";
        } else if (f.grabLit && f.playerState === "glide") {
          want = "chain";
          slow = SLOW_CHAIN;
        }
        break;
      case "dash":
        if (f.playerState === "glide" && f.rockAhead !== null && f.rockAhead < DASH_PROMPT_DIST && f.rockAhead > 0) {
          want = "dash";
          slow = SLOW_DASH;
        }
        break;
      case "dashing":
        if (f.playerState !== "dash") {
          this.step = "sea";
          this.cardTime = 0;
        }
        break;
      case "sea":
        want = "sea";
        this.cardTime += dt;
        if (this.cardTime >= SEA_CARD) {
          this.step = "done";
          this.cardTime = 0;
        }
        break;
      case "done":
        want = "done";
        this.cardTime += dt;
        if (this.cardTime >= DONE_CARD) {
          this.stop();
          this.justFinished = true;
          return;
        }
        break;
    }
    this.want = want;
    this.slow = slow;
  }

  /** Ease the prompt in and out in real time (independent of the slow motion). */
  animate(dt: number) {
    if (this.want === this.shown) {
      this.alpha = Math.min(1, this.alpha + dt * 5);
    } else {
      this.alpha = Math.max(0, this.alpha - dt * 7);
      if (this.alpha === 0) this.shown = this.want;
    }
  }
}
