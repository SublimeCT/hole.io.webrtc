import {
  FOOTPRINT_MARK_SECONDS,
  greenAxisAt,
  TRAFFIC_LIGHT_PREFAB_ID,
  type WorldObjectState,
} from "@hole-io/shared/simulation";
import * as THREE from "three";

const RED_ON = 0xff3b30;
const RED_OFF = 0x4a1515;
const GREEN_ON = 0x35e86f;
const GREEN_OFF = 0x123d22;
const AUTHORED_CENTER_Y = 1.9;

interface TrafficLightPart {
  mesh: THREE.InstancedMesh;
  localMatrix: THREE.Matrix4;
}

export class TrafficLightRenderer {
  readonly #scene: THREE.Scene;
  readonly #parts: TrafficLightPart[] = [];
  readonly #geometries = new Set<THREE.BufferGeometry>();
  readonly #materials: THREE.Material[] = [];
  readonly #indicesByObjectId = new Map<string, number>();
  readonly #worldMatrix = new THREE.Matrix4();
  readonly #instanceMatrix = new THREE.Matrix4();
  readonly #position = new THREE.Vector3();
  readonly #quaternion = new THREE.Quaternion();
  readonly #scale = new THREE.Vector3();
  readonly #nsRed: THREE.MeshBasicMaterial;
  readonly #nsGreen: THREE.MeshBasicMaterial;
  readonly #ewRed: THREE.MeshBasicMaterial;
  readonly #ewGreen: THREE.MeshBasicMaterial;
  #greenAxis: "x" | "y" | null = null;

  constructor(scene: THREE.Scene, objects: readonly WorldObjectState[]) {
    this.#scene = scene;
    const trafficLights = objects.filter((object) => object.prefabId === TRAFFIC_LIGHT_PREFAB_ID);
    trafficLights.forEach((object, index) => this.#indicesByObjectId.set(object.id, index));

    const poleMaterial = this.#material(new THREE.MeshLambertMaterial({ color: 0x283238 }));
    const housingMaterial = this.#material(new THREE.MeshLambertMaterial({ color: 0x111719 }));
    this.#nsRed = this.#material(new THREE.MeshBasicMaterial());
    this.#nsGreen = this.#material(new THREE.MeshBasicMaterial());
    this.#ewRed = this.#material(new THREE.MeshBasicMaterial());
    this.#ewGreen = this.#material(new THREE.MeshBasicMaterial());

    this.#addPart(
      new THREE.CylinderGeometry(0.09, 0.12, 3.2, 6),
      poleMaterial,
      trafficLights.length,
      0,
      1.6 - AUTHORED_CENTER_Y,
      0,
    );
    this.#addPart(
      new THREE.BoxGeometry(0.42, 0.95, 0.34),
      housingMaterial,
      trafficLights.length,
      -0.3,
      3.2 - AUTHORED_CENTER_Y,
      0,
    );
    this.#addPart(
      new THREE.BoxGeometry(0.34, 0.95, 0.42),
      housingMaterial,
      trafficLights.length,
      0,
      3.2 - AUTHORED_CENTER_Y,
      -0.3,
    );
    const bulbGeometry = new THREE.SphereGeometry(0.13, 8, 6);
    this.#addPart(
      bulbGeometry,
      this.#nsRed,
      trafficLights.length,
      -0.3,
      3.42 - AUTHORED_CENTER_Y,
      -0.19,
    );
    this.#addPart(
      bulbGeometry,
      this.#nsGreen,
      trafficLights.length,
      -0.3,
      3.04 - AUTHORED_CENTER_Y,
      -0.19,
    );
    this.#addPart(
      bulbGeometry,
      this.#ewRed,
      trafficLights.length,
      -0.19,
      3.42 - AUTHORED_CENTER_Y,
      -0.3,
    );
    this.#addPart(
      bulbGeometry,
      this.#ewGreen,
      trafficLights.length,
      -0.19,
      3.04 - AUTHORED_CENTER_Y,
      -0.3,
    );
    this.sync(trafficLights, 0);
  }

  sync(changedObjects: readonly WorldObjectState[], elapsed: number): void {
    const axis = greenAxisAt(elapsed);
    if (axis !== this.#greenAxis) {
      this.#greenAxis = axis;
      this.#nsRed.color.setHex(axis === "y" ? RED_OFF : RED_ON);
      this.#nsGreen.color.setHex(axis === "y" ? GREEN_ON : GREEN_OFF);
      this.#ewRed.color.setHex(axis === "x" ? RED_OFF : RED_ON);
      this.#ewGreen.color.setHex(axis === "x" ? GREEN_ON : GREEN_OFF);
    }

    const touchedMeshes = new Set<THREE.InstancedMesh>();
    for (const object of changedObjects) {
      const index = this.#indicesByObjectId.get(object.id);
      if (index === undefined) continue;
      const footprintFade = object.footprintFadeRemaining ?? 0;
      const visible = object.status !== "consumed" || footprintFade > 0;
      const fadeScale =
        object.status === "consumed" ? Math.max(0.05, footprintFade / FOOTPRINT_MARK_SECONDS) : 1;
      this.#position.set(
        object.position.x,
        object.status === "consumed" && footprintFade > 0
          ? object.centerY - (1 - footprintFade / FOOTPRINT_MARK_SECONDS) * object.height * 1.4
          : object.centerY,
        object.position.y,
      );
      this.#quaternion.set(
        object.rotation.x,
        object.rotation.y,
        object.rotation.z,
        object.rotation.w,
      );
      const scale = visible ? object.sizeMultiplier * fadeScale : 0;
      this.#scale.setScalar(scale);
      this.#worldMatrix.compose(this.#position, this.#quaternion, this.#scale);
      for (const part of this.#parts) {
        this.#instanceMatrix.multiplyMatrices(this.#worldMatrix, part.localMatrix);
        part.mesh.setMatrixAt(index, this.#instanceMatrix);
        touchedMeshes.add(part.mesh);
      }
    }
    for (const mesh of touchedMeshes) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  dispose(): void {
    for (const part of this.#parts) this.#scene.remove(part.mesh);
    for (const geometry of this.#geometries) geometry.dispose();
    for (const material of this.#materials) material.dispose();
  }

  #material<T extends THREE.Material>(material: T): T {
    this.#materials.push(material);
    return material;
  }

  #addPart(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    count: number,
    x: number,
    y: number,
    z: number,
  ): void {
    this.#geometries.add(geometry);
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const localMatrix = new THREE.Matrix4().makeTranslation(x, y, z);
    this.#parts.push({ mesh, localMatrix });
    this.#scene.add(mesh);
  }
}
