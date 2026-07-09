import { CONFIG } from "./core/config";
import { Game } from "./core/game";
import { clamp } from "./core/math";
import "./render/playerAsset";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const boot = document.getElementById("boot");

const game = new Game(canvas);

// Debug handle: poke at the live game from the console (e.g. GALE.player).
(window as unknown as Record<string, unknown>).GALE = game;

// Safe-area insets are published as CSS custom properties (--sat/--sar/…) that
// resolve to env(safe-area-inset-*). Read them back so the HUD can dodge
// notches, rounded corners and the home indicator.
const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
function readInsets() {
  const root = document.documentElement;
  if (typeof getComputedStyle !== "function" || !root) return NO_INSETS;
  const s = getComputedStyle(root);
  const px = (name: string) => {
    const n = parseFloat(s.getPropertyValue(name));
    return Number.isFinite(n) ? n : 0;
  };
  return {
    top: px("--sat"),
    right: px("--sar"),
    bottom: px("--sab"),
    left: px("--sal"),
  };
}

// Adaptive resolution: clamp(devicePixelRatio, 1, 2) is the right ceiling for
// 3x phones, but fill-rate-bound devices (big iPads, older A-series, thermal
// throttling) can't hold 60fps at 2x. renderScale steps the backing store down
// when frames stay slow and back up after a long stable stretch. Everything
// else (camera, HUD, input) works in CSS pixels, so only rasterization cost —
// and a little sharpness — changes.
const RENDER_SCALES = [1, 0.85, 0.7];
let scaleIndex = 0;

function resize() {
  const dpr =
    clamp(window.devicePixelRatio || 1, 1, 2) * RENDER_SCALES[scaleIndex];
  // Prefer the visual viewport: on mobile it tracks the *visible* area as the
  // browser chrome (URL bar) slides in and out, so the canvas never leaves a
  // gap or overflows behind the toolbar.
  const vv = window.visualViewport;
  const w = Math.round(vv?.width ?? window.innerWidth);
  const h = Math.round(vv?.height ?? window.innerHeight);
  const bw = Math.floor(w * dpr);
  const bh = Math.floor(h * dpr);
  // Reallocating the backing store clears the canvas and costs a frame — skip
  // it when the size is unchanged (visualViewport scroll fires these
  // constantly on mobile). game.resize still runs: dpr or the safe-area
  // insets can change without the backing store changing (e.g. rotating
  // between landscape-left and landscape-right mirrors the notch).
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
  }
  game.resize(w, h, dpr, readInsets());
}

// Coalesce the many resize/scroll events mobile fires into one per frame.
let resizePending = false;
function scheduleResize() {
  if (resizePending) return;
  resizePending = true;
  requestAnimationFrame(() => {
    resizePending = false;
    resize();
  });
}

window.addEventListener("resize", scheduleResize);
window.addEventListener("orientationchange", () => {
  scheduleResize();
  // Some browsers report stale viewport dims right after the flip.
  setTimeout(resize, 250);
});
window.visualViewport?.addEventListener("resize", scheduleResize);
window.visualViewport?.addEventListener("scroll", scheduleResize);
resize();

let last = performance.now();
let bootHidden = false;

// Resolution governor: a rolling average of *raw* frame time (before the
// gameplay clamp) decides when to step renderScale. Spikes are capped so a
// tab switch or GC pause doesn't read as sustained jank.
const SLOW_MS = 19; // ~52fps — sustained means we can't hold 60 at this scale
const FAST_MS = 14; // ~71fps — comfortable headroom to scale back up
let avgMs = 1000 / 60;
let slowMs = 0; // time spent with the average above SLOW_MS
let fastMs = 0; // time spent with the average below FAST_MS

function loop(now: number) {
  const rawMs = Math.min(now - last, 100);
  const dt = clamp((now - last) / 1000, 0, CONFIG.maxFrameDt);
  last = now;

  avgMs += (rawMs - avgMs) * 0.05;
  if (avgMs > SLOW_MS) {
    slowMs += rawMs;
    fastMs = 0;
    if (slowMs >= 2000 && scaleIndex < RENDER_SCALES.length - 1) {
      scaleIndex++;
      slowMs = 0;
      resize();
    }
  } else if (avgMs < FAST_MS && scaleIndex > 0) {
    fastMs += rawMs;
    slowMs = 0;
    if (fastMs >= 30000) {
      scaleIndex--;
      fastMs = 0;
      resize();
    }
  } else {
    slowMs = 0;
    fastMs = 0;
  }

  game.frame(dt);

  if (!bootHidden) {
    bootHidden = true;
    boot?.classList.add("hidden");
    setTimeout(() => boot?.remove(), 500);
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
