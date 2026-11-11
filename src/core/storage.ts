// Minimal local persistence (the seed of a future progression/save manager).

import { isCharacterId, type CharacterId } from "../characters/registry";
import { isTrailId, TRAILS, trailItem, type TrailId } from "../characters/trails";

/** A best run: its score and its distance (each kept on its own). */
export interface Best {
  score: number;
  distance: number;
}

/** Which record a run counts toward: the classic rope, or Conserve momentum. */
export type Swing = "classic" | "conserve";

/** A day's daily-run bests, one per swing. */
interface DayBests {
  classic: Best;
  conserve: Best;
}

/**
 * Days of daily bests kept (the newest). More than "today" so that a clock
 * that steps back a day — a flight east across the date line, a changed time
 * zone — finds that day's best again instead of wiping the later one.
 */
const DAILY_KEEP = 7;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

interface SaveData {
  /** The classic swing's best (the only best before 1.3, so every older save's best is this one). */
  bestScore: number;
  bestDistance: number;
  /** Conserve momentum's best: a second mode with its own record. */
  conserveBestScore: number;
  conserveBestDistance: number;
  /** Daily-run bests by day (YYYY-MM-DD, see core/daily.ts), per swing; each day starts from nothing. */
  daily: Record<string, DayBests>;
  runs: number;
  totalPerfect: number;
  orbs: number; // banked currency
  /** Shop items bought with orbs ("trail:coral", ...). */
  owned: string[];
  character: CharacterId;
  /** The trail worn (any character can wear any owned trail). */
  trail: TrailId;
  /** The pause-menu swing option: false = the classic rope, true = a momentum-conserving pendulum. */
  conserveMomentum: boolean;
  /** The first-flight tutorial has been finished or skipped. */
  tutorialDone: boolean;
  /** Sound off (the mute button, or M). */
  muted: boolean;
}

/** What a finished run set. */
export interface RunRecord {
  /** A new best for its swing. */
  best: boolean;
  /** A daily run's new best for the day (and its swing). */
  dailyBest: boolean;
}

const KEY = "gale.save.v1";

const MAX_ORBS = 999_999_999;
/** Whatever is stored or passed in, the bank is a whole number in [0, MAX_ORBS]. */
function cleanOrbs(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0;
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_ORBS, Math.floor(n)) : 0;
}

/** A stored count or record: a finite number that is not negative, else 0. */
function cleanCount(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

function cleanBest(v: unknown): Best {
  const o = (v && typeof v === "object" ? v : {}) as Partial<Best>;
  return { score: cleanCount(o.score), distance: cleanCount(o.distance) };
}

function cleanDaily(v: unknown): Record<string, DayBests> {
  const out: Record<string, DayBests> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  const src = v as Record<string, Partial<DayBests> | null | undefined>;
  const days = Object.keys(src)
    .filter((k) => DAY_KEY.test(k))
    .sort()
    .slice(-DAILY_KEEP);
  for (const k of days) {
    const d = src[k];
    if (d && typeof d === "object") out[k] = { classic: cleanBest(d.classic), conserve: cleanBest(d.conserve) };
  }
  return out;
}

const SHOP_ITEMS = new Set(TRAILS.filter((t) => t.price > 0).map((t) => trailItem(t.id)));

/** A new save (a fresh object each time: its lists and maps are written to). */
function freshSave(): SaveData {
  return {
    bestScore: 0,
    bestDistance: 0,
    conserveBestScore: 0,
    conserveBestDistance: 0,
    daily: {},
    runs: 0,
    totalPerfect: 0,
    orbs: 0,
    owned: [],
    character: "plane",
    trail: "own",
    conserveMomentum: false,
    tutorialDone: false,
    muted: false,
  };
}

export class Storage {
  data: SaveData = freshSave();

  constructor() {
    this.load();
  }

  private load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SaveData>;
        const owned = Array.isArray(parsed.owned)
          ? [...new Set(parsed.owned.filter((s): s is string => typeof s === "string" && SHOP_ITEMS.has(s)))]
          : [];
        const trail = isTrailId(parsed.trail) ? parsed.trail : "own";
        this.data = {
          ...freshSave(),
          ...parsed,
          bestScore: cleanCount(parsed.bestScore),
          bestDistance: cleanCount(parsed.bestDistance),
          conserveBestScore: cleanCount(parsed.conserveBestScore),
          conserveBestDistance: cleanCount(parsed.conserveBestDistance),
          daily: cleanDaily(parsed.daily),
          runs: cleanCount(parsed.runs),
          totalPerfect: cleanCount(parsed.totalPerfect),
          owned,
          character: isCharacterId(parsed.character) ? parsed.character : "plane",
          // Only an owned trail can be worn.
          trail: trail === "own" || owned.includes(trailItem(trail)) ? trail : "own",
          conserveMomentum: parsed.conserveMomentum === true,
          tutorialDone: parsed.tutorialDone === true,
          muted: parsed.muted === true,
        };
        // Saves from before orbs existed (or a hand-edited value) bank nothing.
        this.data.orbs = cleanOrbs(parsed.orbs);
      }
    } catch {
      this.data = freshSave();
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage may be unavailable (private mode); ignore */
    }
  }

  /** The all-time best for a swing. */
  best(swing: Swing): Best {
    return swing === "conserve"
      ? { score: this.data.conserveBestScore, distance: this.data.conserveBestDistance }
      : { score: this.data.bestScore, distance: this.data.bestDistance };
  }

  /**
   * The best score in view for a swing — the day's when `daily` is a day's
   * key, else the all-time one. (Plain numbers: the HUD asks every frame.)
   */
  bestScoreFor(swing: Swing, daily: string | null): number {
    if (daily) return this.data.daily[daily]?.[swing].score ?? 0;
    return swing === "conserve" ? this.data.conserveBestScore : this.data.bestScore;
  }

  /** As bestScoreFor, for distance. */
  bestDistanceFor(swing: Swing, daily: string | null): number {
    if (daily) return this.data.daily[daily]?.[swing].distance ?? 0;
    return swing === "conserve" ? this.data.conserveBestDistance : this.data.bestDistance;
  }

  /** The best daily run for a day and swing (nothing yet: zeros). */
  dailyBest(date: string, swing: Swing): Best {
    const d = this.data.daily[date];
    return d ? { ...d[swing] } : { score: 0, distance: 0 };
  }

  /**
   * Record a finished run. `swing` is the record it counts toward; `daily`
   * the day's key when it was a daily run.
   */
  recordRun(
    score: number,
    distance: number,
    perfect: number,
    orbs = 0,
    swing: Swing = "classic",
    daily: string | null = null
  ): RunRecord {
    this.data.runs += 1;
    this.data.totalPerfect += perfect;
    this.data.orbs = cleanOrbs(this.data.orbs + cleanOrbs(orbs));
    const prev = this.best(swing);
    const best = score > prev.score;
    const next = { score: Math.max(prev.score, score), distance: Math.max(prev.distance, distance) };
    if (swing === "conserve") {
      this.data.conserveBestScore = next.score;
      this.data.conserveBestDistance = next.distance;
    } else {
      this.data.bestScore = next.score;
      this.data.bestDistance = next.distance;
    }
    let dailyBest = false;
    if (daily) {
      const days = this.data.daily;
      let day = days[daily];
      if (!day) {
        day = days[daily] = { classic: { score: 0, distance: 0 }, conserve: { score: 0, distance: 0 } };
        // Keep the newest few days (and always the one just flown).
        const old = Object.keys(days)
          .filter((k) => k !== daily)
          .sort();
        for (let i = 0; i <= old.length - DAILY_KEEP; i++) delete days[old[i]];
      }
      const rec = day[swing];
      dailyBest = score > rec.score;
      rec.score = Math.max(rec.score, score);
      rec.distance = Math.max(rec.distance, distance);
    }
    this.save();
    return { best, dailyBest };
  }

  owns(item: string): boolean {
    return this.data.owned.includes(item);
  }

  /** Spend orbs on a shop item; false (and nothing spent) if it cannot be afforded. */
  buy(item: string, price: number): boolean {
    if (this.owns(item)) return true;
    if (!SHOP_ITEMS.has(item) || this.data.orbs < price) return false;
    this.data.orbs = cleanOrbs(this.data.orbs - price);
    this.data.owned.push(item);
    this.save();
    return true;
  }

  setTrail(id: TrailId) {
    if (id !== "own" && !this.owns(trailItem(id))) return;
    this.data.trail = id;
    this.save();
  }

  setCharacter(id: CharacterId) {
    this.data.character = id;
    this.save();
  }

  setMuted(muted: boolean) {
    this.data.muted = muted;
    this.save();
  }

  setTutorialDone() {
    if (this.data.tutorialDone) return;
    this.data.tutorialDone = true;
    this.save();
  }

  setConserveMomentum(on: boolean) {
    this.data.conserveMomentum = on;
    this.save();
  }
}
