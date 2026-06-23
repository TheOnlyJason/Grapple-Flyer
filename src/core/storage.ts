// Minimal local persistence (the seed of a future progression/save manager).

import { isCharacterId, type CharacterId } from "../characters/registry";

interface SaveData {
  bestScore: number;
  bestDistance: number;
  runs: number;
  totalPerfect: number;
  character: CharacterId;
}

const KEY = "gale.save.v1";

const DEFAULT: SaveData = {
  bestScore: 0,
  bestDistance: 0,
  runs: 0,
  totalPerfect: 0,
  character: "plane",
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
        };
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
  recordRun(score: number, distance: number, perfect: number): boolean {
    this.data.runs += 1;
    this.data.totalPerfect += perfect;
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
}
