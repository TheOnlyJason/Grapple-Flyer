// Tiny render-cache helpers shared by the draw code.
//
// The renderer used to rebuild every gradient / sprite from scratch each frame
// (~150-200 CanvasGradient allocations + thousands of rgba strings per frame),
// which is the #1 cost on mobile WebKit. Instead: bake repeated imagery into
// small offscreen canvases and rebuild them only when `theme.version` changes
// (the palette is quantized, so that's a few times per second at most).
//
// NOTE: use makeScratch() rather than document.createElement directly — the
// headless test harnesses (scripts/smoke.mjs, shot.mjs, perf.mjs) mock
// document.createElement to return real canvas objects for "canvas".

export interface Scratch {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/** Create an offscreen canvas + 2d context of the given pixel size. */
export function makeScratch(w: number, h: number): Scratch {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable for scratch canvas");
  return { canvas, ctx };
}

/**
 * Cache a value keyed on theme.version (plus an optional extra key for
 * geometry buckets). Usage:
 *
 *   private sky = new VersionCache<CanvasGradient>();
 *   const g = this.sky.get(version, key, () => buildGradient());
 */
export class VersionCache<T> {
  private version = -1;
  private key: unknown = undefined;
  private value: T | undefined;

  get(version: number, key: unknown, build: () => T): T {
    if (this.version !== version || this.key !== key || this.value === undefined) {
      this.version = version;
      this.key = key;
      this.value = build();
    }
    return this.value;
  }

  /** Drop the cached value (e.g. on resize). */
  invalidate() {
    this.version = -1;
    this.value = undefined;
  }
}
