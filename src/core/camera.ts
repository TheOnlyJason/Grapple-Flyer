import { CONFIG } from "./config";
import { damp } from "./math";

// Camera stores the world coordinate currently at the screen's top-left corner.
// worldToScreen: sx = wx - x, sy = wy - y.
export class Camera {
  x = 0;
  y = 0;
  w = 1280;
  h = 720;

  private shakeMag = 0;
  shakeX = 0;
  shakeY = 0;

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
  }

  snapTo(targetX: number, targetY: number) {
    this.x = targetX - this.w * CONFIG.camera.anchorX;
    this.y = targetY - this.h * CONFIG.camera.anchorY;
  }

  follow(targetX: number, targetY: number, speed: number, dt: number) {
    const lookAhead = speed * CONFIG.camera.lookAheadSpeed;
    const desiredX = targetX - this.w * CONFIG.camera.anchorX + lookAhead;
    const desiredY = targetY - this.h * CONFIG.camera.anchorY;

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

  // Translate the context into world space (call inside save/restore).
  apply(ctx: CanvasRenderingContext2D) {
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
    return this.x + this.w;
  }
  get top() {
    return this.y;
  }
  get bottom() {
    return this.y + this.h;
  }
}
