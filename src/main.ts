import { CONFIG } from "./core/config";
import { Game } from "./core/game";
import { clamp } from "./core/math";
import "./render/playerAsset";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const boot = document.getElementById("boot");

const game = new Game(canvas);

// Debug handle: poke at the live game from the console (e.g. GALE.player).
(window as unknown as Record<string, unknown>).GALE = game;

function resize() {
  const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  game.resize(w, h, dpr);
}
window.addEventListener("resize", resize);
window.addEventListener("orientationchange", resize);
resize();

let last = performance.now();
let bootHidden = false;

function loop(now: number) {
  const dt = clamp((now - last) / 1000, 0, CONFIG.maxFrameDt);
  last = now;
  game.frame(dt);

  if (!bootHidden) {
    bootHidden = true;
    boot?.classList.add("hidden");
    setTimeout(() => boot?.remove(), 500);
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
