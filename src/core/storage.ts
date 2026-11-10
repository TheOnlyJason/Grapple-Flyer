// Minimal local persistence (the seed of a future progression/save manager).

import { isCharacterId, type CharacterId } from "../characters/registry";

interface SaveData {
  bestScore: number;
  bestDistance: number;
  runs: number;
  totalPerfect: number;
  orbs: number; // banked currency
  character: CharacterId;
  /** The pause-menu swing option: false = the classic rope, true = a momentum-conserving pendulum. */
  conserveMomentum: boolean;
}

const KEY = "gale.save.v1";

const MAX_ORBS = 999_999_999;
/** Whatever is stored or passed in, the bank is a whole number in [0, MAX_ORBS]. */
function cleanOrbs(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0;
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_ORBS, Math.floor(n)) : 0;
}

const DEFAULT: SaveData = {
  bestScore: 0,
  bestDistance: 0,
  runs: 0,
  totalPerfect: 0,
  orbs: 0,
  character: "plane",
  conserveMomentum: false,
};

export class Storage {
  data: SaveData = { ...DEFAULT };

  constructor() {
    this.load();
  }

  private load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SaveData>;
        this.data = {
          ...DEFAULT,
          ...parsed,
          character: isCharacterId(parsed.character) ? parsed.character : "plane",
          conserveMomentum: parsed.conserveMomentum === true,
        };
        // Saves from before orbs existed (or a hand-edited value) bank nothing.
        this.data.orbs = cleanOrbs(parsed.orbs);
      }
    } catch {
      this.data = { ...DEFAULT };
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage may be unavailable (private mode); ignore */
    }
  }

  // Record a finished run; returns whether a new best score was set.
  recordRun(score: number, distance: number, perfect: number, orbs = 0): boolean {
    this.data.runs += 1;
    this.data.totalPerfect += perfect;
    this.data.orbs = cleanOrbs(this.data.orbs + cleanOrbs(orbs));
    const isBest = score > this.data.bestScore;
    if (isBest) this.data.bestScore = score;
    if (distance > this.data.bestDistance) this.data.bestDistance = distance;
    this.save();
    return isBest;
  }

  setCharacter(id: CharacterId) {
    this.data.character = id;
    this.save();
  }

  setConserveMomentum(on: boolean) {
    this.data.conserveMomentum = on;
    this.save();
  }
}
