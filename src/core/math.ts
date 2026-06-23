// Small, allocation-light math helpers used across the game.

export interface Vec2 {
  x: number;
  y: number;
}

export const vec = (x = 0, y = 0): Vec2 => ({ x, y });

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// Frame-rate independent smoothing. `rate` ~ how fast we approach the target
// per second. Higher = snappier. dt in seconds.
export const damp = (a: number, b: number, rate: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-rate * dt));

export const len = (x: number, y: number): number => Math.hypot(x, y);

export const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(ax - bx, ay - by);

export const dist2 = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};

export const TAU = Math.PI * 2;

// Shortest signed angular difference (b - a) wrapped to [-PI, PI].
export const angleDelta = (a: number, b: number): number => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

export const sign = (v: number): number => (v < 0 ? -1 : v > 0 ? 1 : 0);

export const deg = (radians: number): number => (radians * 180) / Math.PI;
export const rad = (degrees: number): number => (degrees * Math.PI) / 180;
