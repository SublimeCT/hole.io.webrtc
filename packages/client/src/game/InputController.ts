import type { Vector2 } from "@hole-io/shared/simulation";

const MAX_DRAG_DISTANCE = 54;

export class InputController {
  readonly #canvas: HTMLCanvasElement;
  readonly #dragPad: HTMLElement;
  readonly #dragKnob: HTMLElement;
  readonly #pressedKeys = new Set<string>();
  #pointerId: number | null = null;
  #touchId: number | null = null;
  #startX = 0;
  #startY = 0;
  #pointerDirection: Vector2 = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement, dragPad: HTMLElement, dragKnob: HTMLElement) {
    this.#canvas = canvas;
    this.#dragPad = dragPad;
    this.#dragKnob = dragKnob;
    window.addEventListener("keydown", this.#onKeyDown);
    window.addEventListener("keyup", this.#onKeyUp);
    window.addEventListener("blur", this.#onBlur);
    canvas.addEventListener("pointerdown", this.#onPointerDown, { passive: false });
    canvas.addEventListener("pointermove", this.#onPointerMove, { passive: false });
    canvas.addEventListener("pointerup", this.#onPointerUp, { passive: false });
    canvas.addEventListener("pointercancel", this.#onPointerUp, { passive: false });
    canvas.addEventListener("lostpointercapture", this.#onLostPointerCapture);
    // Keep native touch listeners even when Pointer Events are exposed: mobile
    // emulators and embedded WebViews do not always dispatch the same event family.
    canvas.addEventListener("touchstart", this.#onTouchStart, { passive: false });
    window.addEventListener("touchmove", this.#onTouchMove, { passive: false });
    window.addEventListener("touchend", this.#onTouchEnd, { passive: false });
    window.addEventListener("touchcancel", this.#onTouchEnd, { passive: false });
  }

  getDirection(): Vector2 {
    const keyboardX =
      Number(this.#pressedKeys.has("ArrowRight") || this.#pressedKeys.has("KeyD")) -
      Number(this.#pressedKeys.has("ArrowLeft") || this.#pressedKeys.has("KeyA"));
    const keyboardY =
      Number(this.#pressedKeys.has("ArrowDown") || this.#pressedKeys.has("KeyS")) -
      Number(this.#pressedKeys.has("ArrowUp") || this.#pressedKeys.has("KeyW"));
    const length = Math.hypot(keyboardX, keyboardY);
    if (length > 0) {
      return { x: keyboardX / length, y: keyboardY / length };
    }
    return this.#pointerDirection;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.#onKeyDown);
    window.removeEventListener("keyup", this.#onKeyUp);
    window.removeEventListener("blur", this.#onBlur);
    this.#canvas.removeEventListener("pointerdown", this.#onPointerDown);
    this.#canvas.removeEventListener("pointermove", this.#onPointerMove);
    this.#canvas.removeEventListener("pointerup", this.#onPointerUp);
    this.#canvas.removeEventListener("pointercancel", this.#onPointerUp);
    this.#canvas.removeEventListener("lostpointercapture", this.#onLostPointerCapture);
    this.#canvas.removeEventListener("touchstart", this.#onTouchStart);
    window.removeEventListener("touchmove", this.#onTouchMove);
    window.removeEventListener("touchend", this.#onTouchEnd);
    window.removeEventListener("touchcancel", this.#onTouchEnd);
  }

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.code.startsWith("Arrow")) {
      event.preventDefault();
    }
    this.#pressedKeys.add(event.code);
  };

  readonly #onKeyUp = (event: KeyboardEvent): void => {
    this.#pressedKeys.delete(event.code);
  };

  readonly #onBlur = (): void => {
    this.#pressedKeys.clear();
    this.#endPointer();
  };

  readonly #onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    event.preventDefault();
    if (this.#pointerId !== null) {
      return;
    }
    this.#pointerId = event.pointerId;
    try {
      this.#canvas.setPointerCapture(event.pointerId);
    } catch {
      // Some embedded WebViews expose Pointer Events without pointer capture.
    }
    this.#beginPointer(event.clientX, event.clientY);
  };

  readonly #onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId === this.#pointerId) {
      event.preventDefault();
      this.#updatePointer(event.clientX, event.clientY);
    }
  };

  readonly #onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId === this.#pointerId) {
      event.preventDefault();
      this.#endPointer();
    }
  };

  readonly #onLostPointerCapture = (): void => {
    this.#endPointer();
  };

  readonly #onTouchStart = (event: TouchEvent): void => {
    event.preventDefault();
    if (this.#touchId !== null || this.#pointerId !== null) {
      return;
    }
    const touch = event.changedTouches[0];
    if (!touch) {
      return;
    }
    this.#touchId = touch.identifier;
    this.#beginPointer(touch.clientX, touch.clientY);
  };

  readonly #onTouchMove = (event: TouchEvent): void => {
    event.preventDefault();
    const touch = this.#findTouch(event.changedTouches);
    if (touch) {
      this.#updatePointer(touch.clientX, touch.clientY);
    }
  };

  readonly #onTouchEnd = (event: TouchEvent): void => {
    event.preventDefault();
    if (this.#findTouch(event.changedTouches)) {
      this.#touchId = null;
      this.#endPointer();
    }
  };

  #findTouch(touches: TouchList): Touch | null {
    if (this.#touchId === null) {
      return null;
    }
    for (let index = 0; index < touches.length; index += 1) {
      const touch = touches.item(index);
      if (touch?.identifier === this.#touchId) {
        return touch;
      }
    }
    return null;
  }

  #updatePointer(clientX: number, clientY: number): void {
    const deltaX = clientX - this.#startX;
    const deltaY = clientY - this.#startY;
    const distance = Math.hypot(deltaX, deltaY);
    const scale = distance > MAX_DRAG_DISTANCE ? MAX_DRAG_DISTANCE / distance : 1;
    const clampedX = deltaX * scale;
    const clampedY = deltaY * scale;
    this.#dragKnob.style.transform = `translate(${clampedX}px, ${clampedY}px)`;
    this.#pointerDirection = {
      x: clampedX / MAX_DRAG_DISTANCE,
      y: clampedY / MAX_DRAG_DISTANCE,
    };
  }

  #endPointer(): void {
    this.#pointerId = null;
    this.#touchId = null;
    this.#pointerDirection = { x: 0, y: 0 };
    this.#dragKnob.style.transform = "translate(0, 0)";
    this.#dragPad.classList.remove("is-active");
  }

  #beginPointer(clientX: number, clientY: number): void {
    this.#startX = clientX;
    this.#startY = clientY;
    this.#dragPad.style.left = `${clientX - 44}px`;
    this.#dragPad.style.top = `${clientY - 44}px`;
    this.#dragPad.classList.add("is-active");
    this.#updatePointer(clientX, clientY);
  }
}
