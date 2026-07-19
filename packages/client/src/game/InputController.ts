import type { Vector2 } from "@hole-io/shared/simulation";

const MAX_DRAG_DISTANCE = 54;

export class InputController {
  readonly #canvas: HTMLCanvasElement;
  readonly #dragPad: HTMLElement;
  readonly #dragKnob: HTMLElement;
  readonly #pressedKeys = new Set<string>();
  #pointerId: number | null = null;
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
    canvas.addEventListener("pointerdown", this.#onPointerDown);
    canvas.addEventListener("pointermove", this.#onPointerMove);
    canvas.addEventListener("pointerup", this.#onPointerUp);
    canvas.addEventListener("pointercancel", this.#onPointerUp);
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
    if (this.#pointerId !== null) {
      return;
    }
    this.#pointerId = event.pointerId;
    this.#startX = event.clientX;
    this.#startY = event.clientY;
    this.#canvas.setPointerCapture(event.pointerId);
    this.#dragPad.style.left = `${this.#startX - 44}px`;
    this.#dragPad.style.top = `${this.#startY - 44}px`;
    this.#dragPad.classList.add("is-active");
    this.#updatePointer(event.clientX, event.clientY);
  };

  readonly #onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId === this.#pointerId) {
      this.#updatePointer(event.clientX, event.clientY);
    }
  };

  readonly #onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId === this.#pointerId) {
      this.#endPointer();
    }
  };

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
    this.#pointerDirection = { x: 0, y: 0 };
    this.#dragKnob.style.transform = "translate(0, 0)";
    this.#dragPad.classList.remove("is-active");
  }
}
