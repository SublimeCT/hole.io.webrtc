import {
  FOOTPRINT_DELAY_SECONDS,
  FOOTPRINT_MARK_SECONDS,
  FOOTPRINT_SOLE,
  FOOTPRINT_TOES,
  type FootprintStrike,
  type HoleState,
  type MapPowerUp,
  type PoopHazard,
  type PowerUpType,
} from "@hole-io/shared/simulation";
import * as THREE from "three";

const EMOJI: Record<PowerUpType, string> = {
  magnet: "🧲",
  shrink: "🔍",
  foot: "🦶",
  burger: "🍔",
  poop: "💩",
  doubleFoot: "👣",
  beer: "🍺",
};

export class PowerUpRenderer {
  readonly #scene: THREE.Scene;
  readonly #layer: HTMLElement;
  readonly #labels = new Map<string, HTMLElement>();
  readonly #footprints = new Map<
    string,
    THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  >();
  readonly #poopLabels = new Map<string, HTMLElement>();
  readonly #activeLabels = new Map<string, HTMLElement>();
  readonly #projected = new THREE.Vector3();
  readonly #footprintTexture: THREE.CanvasTexture;

  constructor(scene: THREE.Scene, layer: HTMLElement) {
    this.#scene = scene;
    this.#layer = layer;
    this.#footprintTexture = this.#createFootprintTexture();
  }

  sync(
    powerUps: readonly MapPowerUp[],
    footprints: readonly FootprintStrike[],
    hazards: readonly PoopHazard[],
    holes: readonly HoleState[],
    camera: THREE.Camera,
    width: number,
    height: number,
  ): void {
    this.#syncLabels(
      powerUps,
      this.#labels,
      camera,
      width,
      height,
      (item) => EMOJI[item.type],
      "is-map-item",
      true,
    );
    this.#syncLabels(hazards, this.#poopLabels, camera, width, height, () => "💩");
    const activeItems = holes.flatMap((hole) =>
      hole.eliminationRemaining > 0 || hole.isOut
        ? []
        : hole.activePowerUps.map((effect) => ({
            id: `${hole.id}:${effect.type}`,
            position: hole.position,
            type: effect.type,
          })),
    );
    this.#syncLabels(
      activeItems,
      this.#activeLabels,
      camera,
      width,
      height,
      (item) => EMOJI[item.type],
      "is-active",
    );
    const footprintIds = new Set(footprints.map((footprint) => footprint.id));
    for (const footprint of footprints) {
      let mesh = this.#footprints.get(footprint.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({
            color: 0x777777,
            map: this.#footprintTexture,
            transparent: true,
            opacity: 0.32,
            alphaTest: 0.04,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.renderOrder = 5;
        this.#footprints.set(footprint.id, mesh);
        this.#scene.add(mesh);
      }
      const descent =
        footprint.impactRemaining > 0
          ? Math.min(1, footprint.impactRemaining / FOOTPRINT_DELAY_SECONDS)
          : 0;
      mesh.position.set(footprint.position.x, descent * 24 + 0.12, footprint.position.y);
      mesh.rotation.z = footprint.rotation;
      mesh.scale.set(footprint.width, footprint.length, 1);
      mesh.material.opacity =
        footprint.fadeRemaining > 0
          ? 0.32 * (footprint.fadeRemaining / FOOTPRINT_MARK_SECONDS)
          : 0.32;
    }
    for (const [id, mesh] of this.#footprints) {
      if (!footprintIds.has(id)) {
        this.#scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        this.#footprints.delete(id);
      }
    }
  }

  dispose(): void {
    [
      ...this.#labels.values(),
      ...this.#poopLabels.values(),
      ...this.#activeLabels.values(),
    ].forEach((label) => label.remove());
    this.#footprints.forEach((mesh) => {
      this.#scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
    this.#labels.clear();
    this.#poopLabels.clear();
    this.#activeLabels.clear();
    this.#footprints.clear();
    this.#footprintTexture.dispose();
  }

  #syncLabels<T extends { id: string; position: { x: number; y: number } }>(
    items: readonly T[],
    labels: Map<string, HTMLElement>,
    camera: THREE.Camera,
    width: number,
    height: number,
    emojiFor: (item: T) => string,
    modifier = "",
    clampToViewport = false,
  ): void {
    const ids = new Set(items.map((item) => item.id));
    for (const item of items) {
      let label = labels.get(item.id);
      if (!label) {
        label = document.createElement("span");
        label.className = `map-power-up ${modifier}`.trim();
        label.textContent = emojiFor(item);
        this.#layer.appendChild(label);
        labels.set(item.id, label);
      }
      this.#projected.set(item.position.x, 0.2, item.position.y).project(camera);
      const behindCamera = this.#projected.z < -1 || this.#projected.z > 1;
      let projectedX = this.#projected.x;
      let projectedY = this.#projected.y;
      if (behindCamera) {
        projectedX *= -1;
        projectedY *= -1;
      }
      let screenX = ((projectedX + 1) / 2) * width;
      let screenY = ((-projectedY + 1) / 2) * height;
      if (clampToViewport) {
        const inset = Math.min(105, Math.max(40, Math.min(width, height) * 0.18));
        screenX = Math.max(inset, Math.min(width - inset, screenX));
        screenY = Math.max(inset, Math.min(height - inset, screenY));
      }
      label.hidden = false;
      label.classList.toggle(
        "is-offscreen",
        behindCamera || Math.abs(this.#projected.x) > 1 || Math.abs(this.#projected.y) > 1,
      );
      label.style.transform = `translate3d(${screenX}px, ${screenY}px, 0) translate(-50%, -50%)`;
    }
    for (const [id, label] of labels) {
      if (!ids.has(id)) {
        label.remove();
        labels.delete(id);
      }
    }
  }

  #createFootprintTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "white";
      context.beginPath();
      FOOTPRINT_SOLE.forEach((point, index) => {
        const x = (point.x + 0.5) * canvas.width;
        const y = (point.y + 0.5) * canvas.height;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.closePath();
      FOOTPRINT_TOES.forEach((toe) => {
        context.moveTo(
          (toe.center.x + 0.5 + toe.radius.x) * canvas.width,
          (toe.center.y + 0.5) * canvas.height,
        );
        context.ellipse(
          (toe.center.x + 0.5) * canvas.width,
          (toe.center.y + 0.5) * canvas.height,
          toe.radius.x * canvas.width,
          toe.radius.y * canvas.height,
          0,
          0,
          Math.PI * 2,
        );
      });
      context.fill();
    }
    return new THREE.CanvasTexture(canvas);
  }
}
