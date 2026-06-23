// Player paper-airplane sprite — processed from user-provided PNG.

export const PLAYER_SPRITE = {
  src: "/assets/paper-airplane.png",
  width: 539,
  height: 172,
  // Player anchor = body center (pixels from the sprite's left edge).
  anchorX: 270,
  // Visual scale relative to hitbox radius.
  scale: 1.62,
};

let img: HTMLImageElement | null = null;
let ready = false;

function boot() {
  if (typeof Image === "undefined") return;
  img = new Image();
  img.onload = () => {
    ready = true;
  };
  img.src = PLAYER_SPRITE.src;
}

boot();

export function isPlayerSpriteReady(): boolean {
  return ready;
}

export function getPlayerSprite(): HTMLImageElement | null {
  return ready && img ? img : null;
}
