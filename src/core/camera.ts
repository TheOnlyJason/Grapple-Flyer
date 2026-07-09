import { CONFIG } from "./config";
import { clamp, damp } from "./math";

// Camera stores the world coordinate currently at the screen's top-left corner.
// worldToScreen: sx = (wx - x) * zoom, sy = (wy - y) * zoom.
export class Camera {
  x = 0;
  y = 0;
  /** Screen size in CSS px. */
  w = 1280;
  h = 720;
  /**
   * World-to-screen scale (<= 1 zooms OUT). Short viewports (phones in
   * landscape) zoom out so the tether's reach stays on screen instead of
   * latching onto anchors the player never saw.
   */
  zoom = 1;

  // Safe-area insets (CSS px) so the HUD clears notches / rounded corners /
  // the home indicator on phones. Zero on desktop.
  insets = { top: 0, right: 0, bottom: 0, left: 0 };

  private shakeMag = 0;
  shakeX = 0;
  shakeY = 0;

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    // Aim for ~900 world px of visible height (desktop shows a touch more
    // world, phones a lot more), floored so the art stays readable.
    this.zoom = clamp(h / 900, 0.6, 1);
  }

  /** Visible world width / height (grows as the camera zooms out). */
  get viewW() {
    return this.w / this.zoom;
  }
  get viewH() {
    return this.h / this.zoom;
  }

  snapTo(targetX: number, targetY: number) {
    this.x = targetX - this.viewW * CONFIG.camera.anchorX;
    this.y = targetY - this.viewH * CONFIG.camera.anchorY;
  }

  follow(targetX: number, targetY: number, speed: number, dt: number) {
    const lookAhead = speed * CONFIG.camera.lookAheadSpeed;
    const desiredX = targetX - this.viewW * CONFIG.camera.anchorX + lookAhead;
    const desiredY = targetY - this.viewH * CONFIG.camera.anchorY;

    this.x = damp(this.x, desiredX, CONFIG.camera.followX, dt);
    this.y = damp(this.y, desiredY, CONFIG.camera.followY, dt);

    // Decay shake.
    this.shakeMag = damp(this.shakeMag, 0, CONFIG.camera.shakeDecay, dt);
    const a = Math.random() * Math.PI * 2;
    this.shakeX = Math.cos(a) * this.shakeMag;
    this.shakeY = Math.sin(a) * this.shakeMag;
  }

  addShake(amount: number) {
    this.shakeMag = Math.min(this.shakeMag + amount, 40);
  }

  // Scale + translate the context into world space (call inside save/restore).
  apply(ctx: CanvasRenderingContext2D) {
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(
      Math.round(-this.x + this.shakeX),
      Math.round(-this.y + this.shakeY)
    );
  }

  // Visible world bounds (ignoring shake), handy for culling/spawning.
  get left() {
    return this.x;
  }
  get right() {
    return this.x + this.viewW;
  }
  get top() {
    return this.y;
  }
  get bottom() {
    return this.y + this.viewH;
  }
}
