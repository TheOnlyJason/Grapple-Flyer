// Unified input: pointer (tap / hold / release) + keyboard.
// Logic works in CSS pixels relative to the canvas top-left.

export class Input {
  readonly pointer = { x: 0, y: 0 };

  // Continuous "hold" (pointer down OR hold-key). Drives the tether.
  holding = false;
  // Edges, refreshed once per frame by beginFrame().
  pressed = false;
  released = false;
  pointerJustDown = false;

  // Keys pressed this frame (key codes). Refreshed by beginFrame().
  tapped: Set<string> = new Set();

  private pointerDown = false;
  private holdKey = false;
  private prevHold = false;
  private pendingPointerDown = false;
  private pendingTaps = new Set<string>();

  // Cached canvas rect: the element is fixed and full-viewport, so its origin
  // only moves on viewport changes — no need for a layout read per pointermove.
  private rectLeft = 0;
  private rectTop = 0;

  constructor(private el: HTMLElement) {
    this.attach();
  }

  // Re-read the canvas position. Cheap; call after anything that moves it.
  refreshRect() {
    const rect = this.el.getBoundingClientRect();
    this.rectLeft = rect.left;
    this.rectTop = rect.top;
  }

  private attach() {
    const el = this.el;

    this.refreshRect();
    window.addEventListener("resize", () => this.refreshRect());
    window.addEventListener("orientationchange", () => this.refreshRect());

    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.pointerDown = true;
      this.pendingPointerDown = true;
      this.setPointer(e);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    });

    const up = (e: PointerEvent) => {
      this.pointerDown = false;
      this.setPointer(e);
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointermove", (e) => this.setPointer(e));

    window.addEventListener("blur", () => {
      this.pointerDown = false;
      this.holdKey = false;
    });

    window.addEventListener(
      "keydown",
      (e) => {
        if (e.repeat) return;
        this.pendingTaps.add(e.code);
        if (
          e.code === "Space" ||
          e.code === "ArrowUp" ||
          e.code === "KeyW"
        ) {
          this.holdKey = true;
          e.preventDefault();
        }
      },
      { passive: false }
    );

    window.addEventListener("keyup", (e) => {
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
        this.holdKey = false;
      }
    });

    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private setPointer(e: PointerEvent) {
    this.pointer.x = e.clientX - this.rectLeft;
    this.pointer.y = e.clientY - this.rectTop;
  }

  beginFrame() {
    this.holding = this.pointerDown || this.holdKey;
    this.pressed = this.holding && !this.prevHold;
    this.released = !this.holding && this.prevHold;
    this.prevHold = this.holding;

    this.pointerJustDown = this.pendingPointerDown;
    this.pendingPointerDown = false;

    // Ping-pong the two persistent sets instead of allocating a fresh one:
    // tapped stays stable for the frame, pendingTaps starts empty.
    const taps = this.tapped;
    this.tapped = this.pendingTaps;
    this.pendingTaps = taps;
    this.pendingTaps.clear();
  }

  // True on any fresh interaction this frame (used to unlock audio / start runs).
  get anyInteraction(): boolean {
    return this.pressed || this.pointerJustDown || this.tapped.size > 0;
  }

  get dashTapped(): boolean {
    return (
      this.tapped.has("ShiftLeft") ||
      this.tapped.has("ShiftRight") ||
      this.tapped.has("KeyD")
    );
  }
}
