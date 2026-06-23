// Deterministic, seedable PRNG (mulberry32). Deterministic seeds keep the door
// open for "daily seed" runs and reproducible debugging later.

export class Rng {
  private state: number;

  constructor(seed: number | string = Date.now()) {
    this.state = typeof seed === "string" ? hashString(seed) : seed >>> 0;
  }

  // Float in [0, 1).
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Float in [min, max).
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  // Integer in [min, max] inclusive.
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  // True with probability p.
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

export function hashString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
