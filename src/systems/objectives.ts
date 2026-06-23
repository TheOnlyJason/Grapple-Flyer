import { Rng } from "../core/rng";

export type ObjectiveKind =
  | "perfect"
  | "skim"
  | "moving"
  | "collect"
  | "distance"
  | "dash";

export interface Objective {
  kind: ObjectiveKind;
  label: string;
  target: number;
  progress: number;
  done: boolean;
  justCompleted: number; // >0 briefly when completed, for HUD flash
}

interface Template {
  kind: ObjectiveKind;
  range: [number, number];
  step: number;
  make: (target: number) => string;
}

const TEMPLATES: Template[] = [
  {
    kind: "perfect",
    range: [2, 4],
    step: 1,
    make: (t) => `Land ${t} perfect releases`,
  },
  {
    kind: "skim",
    range: [120, 240],
    step: 20,
    make: (t) => `Skim clouds for ${t} m`,
  },
  {
    kind: "moving",
    range: [3, 5],
    step: 1,
    make: (t) => `Swing from ${t} moving anchors`,
  },
  {
    kind: "collect",
    range: [8, 16],
    step: 2,
    make: (t) => `Collect ${t} wind wisps`,
  },
  {
    kind: "distance",
    range: [600, 1200],
    step: 100,
    make: (t) => `Reach ${t} m in one run`,
  },
  { kind: "dash", range: [2, 3], step: 1, make: (t) => `Trigger ${t} wind dashes` },
];

// Generates and tracks three distinct run objectives.
export class Objectives {
  list: Objective[] = [];

  reset(rng: Rng) {
    const pool = [...TEMPLATES];
    this.list = [];
    for (let i = 0; i < 3 && pool.length; i++) {
      const idx = rng.int(0, pool.length - 1);
      const tpl = pool.splice(idx, 1)[0];
      const raw = rng.range(tpl.range[0], tpl.range[1]);
      const target = Math.max(tpl.step, Math.round(raw / tpl.step) * tpl.step);
      this.list.push({
        kind: tpl.kind,
        label: tpl.make(target),
        target,
        progress: 0,
        done: false,
        justCompleted: 0,
      });
    }
  }

  // Add progress to every objective of `kind`. Returns true if one just finished.
  report(kind: ObjectiveKind, amount = 1): boolean {
    let completed = false;
    for (const o of this.list) {
      if (o.kind !== kind || o.done) continue;
      o.progress = Math.min(o.target, o.progress + amount);
      if (o.progress >= o.target) {
        o.done = true;
        o.justCompleted = 1.5;
        completed = true;
      }
    }
    return completed;
  }

  // For distance/skim style objectives we set an absolute value instead of adding.
  set(kind: ObjectiveKind, value: number): boolean {
    let completed = false;
    for (const o of this.list) {
      if (o.kind !== kind || o.done) continue;
      o.progress = Math.min(o.target, value);
      if (o.progress >= o.target) {
        o.done = true;
        o.justCompleted = 1.5;
        completed = true;
      }
    }
    return completed;
  }

  update(dt: number) {
    for (const o of this.list) {
      if (o.justCompleted > 0) o.justCompleted = Math.max(0, o.justCompleted - dt);
    }
  }

  get completedCount(): number {
    return this.list.filter((o) => o.done).length;
  }

  get allDone(): boolean {
    return this.list.length > 0 && this.list.every((o) => o.done);
  }
}
