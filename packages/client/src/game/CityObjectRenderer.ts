import {
  MAP_HALF_SIZE,
  PREFAB_DEFINITIONS,
  type HoleState,
  type PrefabDefinition,
  type WorldObjectState,
} from "@hole-io/shared/simulation";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

interface LoadedPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  localMatrix: THREE.Matrix4;
}

interface LoadedPrefab {
  template: THREE.Group;
  parts: readonly LoadedPart[];
  animations: THREE.AnimationClip[];
}

interface InstanceBatch {
  prefab: LoadedPrefab;
  meshes: readonly THREE.InstancedMesh[];
  objectIds: readonly string[];
  indicesByObjectId: ReadonlyMap<string, readonly number[]>;
}

interface ObjectInstance {
  batch: InstanceBatch;
  indices: readonly number[];
}

interface AnimatedModel {
  group: THREE.Group;
  mixer: THREE.AnimationMixer;
  action: THREE.AnimationAction;
}

export interface CityVisibilityContext {
  player: HoleState;
  cameraPosition: THREE.Vector3;
}

const HIDDEN_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

export class CityObjectRenderer {
  readonly #scene: THREE.Scene;
  readonly #loader = new GLTFLoader();
  readonly #prefabs = new Map<string, LoadedPrefab>();
  readonly #instances = new Map<string, ObjectInstance>();
  readonly #activeModels = new Map<string, THREE.Group>();
  readonly #transparentModels = new Map<string, THREE.Group>();
  readonly #transparentObjectIds = new Set<string>();
  readonly #animatedModels = new Map<string, AnimatedModel>();
  readonly #lastStatus = new Map<string, WorldObjectState["status"]>();
  readonly #position = new THREE.Vector3();
  readonly #quaternion = new THREE.Quaternion();
  readonly #scale = new THREE.Vector3(1, 1, 1);
  readonly #worldMatrix = new THREE.Matrix4();
  readonly #partMatrix = new THREE.Matrix4();

  constructor(scene: THREE.Scene) {
    this.#scene = scene;
  }

  async initialize(
    objects: readonly WorldObjectState[],
    onProgress: (loaded: number, total: number) => void,
  ): Promise<void> {
    const usedIds = [...new Set(objects.map((object) => object.prefabId))];
    const definitions = usedIds.map((id) => {
      const definition = PREFAB_DEFINITIONS.find((candidate) => candidate.id === id);
      if (!definition) {
        throw new Error(`Missing prefab definition: ${id}`);
      }
      return definition;
    });
    let loaded = 0;
    await Promise.all(
      definitions.map(async (definition) => {
        this.#prefabs.set(definition.id, await this.#loadPrefab(definition));
        loaded += 1;
        onProgress(loaded, definitions.length);
      }),
    );

    for (const definition of definitions) {
      const prefab = this.#prefabs.get(definition.id);
      if (!prefab) {
        continue;
      }
      const prefabObjects = objects.filter((object) => object.prefabId === definition.id);
      const instanceCount = prefabObjects.reduce((total, object) => total + object.stackLayers, 0);
      const meshes = prefab.parts.map((part) => {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, instanceCount);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.name = `instances:${definition.id}`;
        this.#scene.add(mesh);
        return mesh;
      });
      let nextIndex = 0;
      const indicesByObjectId = new Map<string, readonly number[]>();
      prefabObjects.forEach((object) => {
        const indices = Array.from({ length: object.stackLayers }, (_, layer) => nextIndex + layer);
        nextIndex += object.stackLayers;
        indicesByObjectId.set(object.id, indices);
      });
      const batch: InstanceBatch = {
        prefab,
        meshes,
        objectIds: prefabObjects.map((object) => object.id),
        indicesByObjectId,
      };
      prefabObjects.forEach((object) => {
        const indices = indicesByObjectId.get(object.id);
        if (!indices) {
          return;
        }
        this.#instances.set(object.id, { batch, indices });
        if (object.motion && prefab.animations.length > 0) {
          batch.meshes.forEach((mesh) => {
            indices.forEach((index) => mesh.setMatrixAt(index, HIDDEN_MATRIX));
          });
          const animated = this.#getAnimatedModel(object.id, prefab);
          this.#setGroupTransform(animated.group, object);
        } else {
          this.#setInstanceTransforms(batch, indices, object);
        }
        this.#lastStatus.set(object.id, object.status);
      });
      meshes.forEach((mesh) => {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.boundingSphere = new THREE.Sphere(
          new THREE.Vector3(0, MAP_HALF_SIZE * 0.02, 0),
          MAP_HALF_SIZE * 1.5,
        );
      });
    }
  }

  sync(
    objects: readonly WorldObjectState[],
    deltaSeconds = 0,
    visibilityContext: CityVisibilityContext | null = null,
  ): void {
    const touchedMeshes = new Set<THREE.InstancedMesh>();
    for (const object of objects) {
      const instance = this.#instances.get(object.id);
      if (!instance) {
        continue;
      }
      const previousStatus = this.#lastStatus.get(object.id);
      const animated = this.#animatedModels.get(object.id);
      if (animated) {
        animated.group.visible = object.status !== "consumed";
        if (animated.group.visible) {
          this.#setGroupTransform(animated.group, object);
          animated.action.paused = object.status !== "static" || !object.motion;
          if (!animated.action.paused) {
            animated.mixer.update(deltaSeconds);
          }
        }
        this.#lastStatus.set(object.id, object.status);
        continue;
      }
      const shouldFade =
        object.status === "static" &&
        visibilityContext !== null &&
        this.#shouldFadeBuilding(object, visibilityContext);
      const wasTransparent = this.#transparentObjectIds.has(object.id);
      if (shouldFade) {
        if (!wasTransparent) {
          instance.batch.meshes.forEach((mesh) => {
            instance.indices.forEach((index) => mesh.setMatrixAt(index, HIDDEN_MATRIX));
            touchedMeshes.add(mesh);
          });
          this.#transparentObjectIds.add(object.id);
        }
        const transparentModel = this.#getTransparentModel(
          object.id,
          instance.batch.prefab,
          object,
        );
        transparentModel.visible = true;
        this.#setGroupTransform(transparentModel, object);
        const activeModel = this.#activeModels.get(object.id);
        if (activeModel) {
          activeModel.visible = false;
        }
        this.#lastStatus.set(object.id, object.status);
        continue;
      }
      if (wasTransparent) {
        this.#transparentObjectIds.delete(object.id);
        const transparentModel = this.#transparentModels.get(object.id);
        if (transparentModel) {
          transparentModel.visible = false;
        }
      }
      if (object.status === "static") {
        if (previousStatus !== "static" || object.motion || wasTransparent) {
          this.#setInstanceTransforms(instance.batch, instance.indices, object);
          instance.batch.meshes.forEach((mesh) => touchedMeshes.add(mesh));
        }
        const activeModel = this.#activeModels.get(object.id);
        if (activeModel) {
          activeModel.visible = false;
        }
      } else {
        if (previousStatus === "static") {
          instance.batch.meshes.forEach((mesh) => {
            instance.indices.forEach((index) => mesh.setMatrixAt(index, HIDDEN_MATRIX));
            touchedMeshes.add(mesh);
          });
        }
        const activeModel = this.#getActiveModel(object.id, instance.batch.prefab, object);
        activeModel.visible = object.status !== "consumed";
        if (activeModel.visible) {
          activeModel.position.set(object.position.x, object.centerY, object.position.y);
          activeModel.quaternion.set(
            object.rotation.x,
            object.rotation.y,
            object.rotation.z,
            object.rotation.w,
          );
        }
      }
      this.#lastStatus.set(object.id, object.status);
    }
    touchedMeshes.forEach((mesh) => {
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    for (const prefab of this.#prefabs.values()) {
      for (const part of prefab.parts) {
        geometries.add(part.geometry);
        if (Array.isArray(part.material)) {
          part.material.forEach((material) => materials.add(material));
        } else {
          materials.add(part.material);
        }
      }
    }
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.#animatedModels.forEach(({ mixer, group }) => {
      mixer.stopAllAction();
      this.#scene.remove(group);
    });
    this.#transparentModels.forEach((group) => {
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          materials.forEach((material) => material.dispose());
        }
      });
      this.#scene.remove(group);
    });
  }

  async #loadPrefab(definition: PrefabDefinition): Promise<LoadedPrefab> {
    // Resolve public assets against Vite's base path so project Pages sites work.
    const assetUrl = `${import.meta.env.BASE_URL}${definition.assetPath.replace(/^\/+/, "")}`;
    const gltf = await this.#loader.loadAsync(assetUrl);
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    const sourceBounds = new THREE.Box3().setFromObject(model);
    const sourceSize = sourceBounds.getSize(new THREE.Vector3());
    if (sourceSize.x <= 0 || sourceSize.y <= 0 || sourceSize.z <= 0) {
      throw new Error(`Prefab has invalid bounds: ${definition.id}`);
    }
    model.scale.set(
      definition.size.x / sourceSize.x,
      definition.height / sourceSize.y,
      definition.size.y / sourceSize.z,
    );
    model.updateMatrixWorld(true);
    const scaledBounds = new THREE.Box3().setFromObject(model);
    const center = scaledBounds.getCenter(new THREE.Vector3());
    model.position.sub(center);

    const template = new THREE.Group();
    template.name = `active:${definition.id}`;
    template.add(model);
    template.updateMatrixWorld(true);
    const parts: LoadedPart[] = [];
    const sourceMaterials = new Set<THREE.Material>();
    template.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = false;
        child.receiveShadow = false;
        const source = Array.isArray(child.material) ? child.material : [child.material];
        source.forEach((material) => sourceMaterials.add(material));
        child.material = source.map((material) =>
          this.#createColorMaterial(material, child.geometry),
        );
        if (child.material.length === 1) {
          child.material = child.material[0] ?? new THREE.MeshBasicMaterial({ color: 0xffffff });
        }
        parts.push({
          geometry: child.geometry,
          material: child.material,
          localMatrix: child.matrixWorld.clone(),
        });
      }
    });
    sourceMaterials.forEach((material) => material.dispose());
    return { template, parts, animations: gltf.animations };
  }

  #createColorMaterial(
    source: THREE.Material,
    geometry: THREE.BufferGeometry,
  ): THREE.MeshBasicMaterial {
    const mappedSource =
      source instanceof THREE.MeshBasicMaterial ||
      source instanceof THREE.MeshLambertMaterial ||
      source instanceof THREE.MeshPhongMaterial ||
      source instanceof THREE.MeshStandardMaterial ||
      source instanceof THREE.MeshToonMaterial
        ? source
        : null;
    const map = mappedSource?.map ?? null;
    if (map) {
      map.colorSpace = THREE.SRGBColorSpace;
    }
    return new THREE.MeshBasicMaterial({
      color: map ? 0xffffff : (mappedSource?.color ?? new THREE.Color(0xffffff)),
      map,
      transparent: source.transparent,
      opacity: source.opacity,
      alphaTest: source.alphaTest,
      side: source.side,
      vertexColors: geometry.hasAttribute("color"),
      toneMapped: false,
    });
  }

  #setInstanceTransforms(
    batch: InstanceBatch,
    indices: readonly number[],
    object: WorldObjectState,
  ): void {
    indices.forEach((index, layer) => this.#setInstanceTransform(batch, index, object, layer));
  }

  #setInstanceTransform(
    batch: InstanceBatch,
    index: number,
    object: WorldObjectState,
    layer: number,
  ): void {
    const baseHeight = object.height / object.stackLayers;
    this.#position.set(object.position.x, baseHeight * (layer + 0.5), object.position.y);
    this.#quaternion.set(
      object.rotation.x,
      object.rotation.y,
      object.rotation.z,
      object.rotation.w,
    );
    this.#worldMatrix.compose(this.#position, this.#quaternion, this.#scale);
    batch.meshes.forEach((mesh, partIndex) => {
      const part = batch.prefab.parts[partIndex];
      if (part) {
        this.#partMatrix.multiplyMatrices(this.#worldMatrix, part.localMatrix);
        mesh.setMatrixAt(index, this.#partMatrix);
      }
    });
  }

  #getActiveModel(id: string, prefab: LoadedPrefab, object: WorldObjectState): THREE.Group {
    const existing = this.#activeModels.get(id);
    if (existing) {
      return existing;
    }
    const model = this.#createStackedModel(prefab, object);
    this.#activeModels.set(id, model);
    this.#scene.add(model);
    return model;
  }

  #getTransparentModel(id: string, prefab: LoadedPrefab, object: WorldObjectState): THREE.Group {
    const existing = this.#transparentModels.get(id);
    if (existing) {
      return existing;
    }
    const model = this.#createStackedModel(prefab, object);
    model.name = `transparent:${id}`;
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }
      const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
      const transparentMaterials = sourceMaterials.map((source) => {
        const material = source.clone();
        material.transparent = true;
        material.opacity = Math.min(0.3, source.opacity * 0.32);
        material.depthWrite = false;
        return material;
      });
      child.material =
        transparentMaterials.length === 1
          ? (transparentMaterials[0] ?? child.material)
          : transparentMaterials;
    });
    this.#transparentModels.set(id, model);
    this.#scene.add(model);
    return model;
  }

  #createStackedModel(prefab: LoadedPrefab, object: WorldObjectState): THREE.Group {
    if (object.stackLayers === 1) {
      return prefab.template.clone(true);
    }
    const model = new THREE.Group();
    const baseHeight = object.height / object.stackLayers;
    for (let layer = 0; layer < object.stackLayers; layer += 1) {
      const floor = prefab.template.clone(true);
      floor.position.y = baseHeight * (layer - (object.stackLayers - 1) / 2);
      model.add(floor);
    }
    return model;
  }

  #getAnimatedModel(id: string, prefab: LoadedPrefab): AnimatedModel {
    const existing = this.#animatedModels.get(id);
    if (existing) {
      return existing;
    }
    const group = prefab.template.clone(true);
    const mixer = new THREE.AnimationMixer(group);
    const walk = THREE.AnimationClip.findByName(prefab.animations, "walk");
    if (!walk) {
      throw new Error(`Animated prefab is missing walk clip: ${group.name}`);
    }
    const action = mixer.clipAction(walk);
    action.play();
    const animated = { group, mixer, action };
    this.#animatedModels.set(id, animated);
    this.#scene.add(group);
    return animated;
  }

  #setGroupTransform(group: THREE.Group, object: WorldObjectState): void {
    group.position.set(object.position.x, object.centerY, object.position.y);
    group.quaternion.set(
      object.rotation.x,
      object.rotation.y,
      object.rotation.z,
      object.rotation.w,
    );
  }

  #shouldFadeBuilding(object: WorldObjectState, context: CityVisibilityContext): boolean {
    if (!(object.prefabId.startsWith("building-") || object.prefabId.startsWith("commercial-"))) {
      return false;
    }
    const footprintRadius = Math.hypot(object.size.x, object.size.y) / 2;
    const holeDistance = Math.hypot(
      object.position.x - context.player.position.x,
      object.position.y - context.player.position.y,
    );
    const tooLargeForHole = object.fitDiameter > context.player.radius * 2 * 0.98;
    if (tooLargeForHole && holeDistance <= context.player.radius + footprintRadius + 3) {
      return true;
    }

    const cameraDeltaX = context.cameraPosition.x - context.player.position.x;
    const cameraDeltaZ = context.cameraPosition.z - context.player.position.y;
    const cameraDistanceSquared = cameraDeltaX * cameraDeltaX + cameraDeltaZ * cameraDeltaZ;
    if (cameraDistanceSquared <= 0.0001) {
      return false;
    }
    const objectDeltaX = object.position.x - context.player.position.x;
    const objectDeltaZ = object.position.y - context.player.position.y;
    const t = (objectDeltaX * cameraDeltaX + objectDeltaZ * cameraDeltaZ) / cameraDistanceSquared;
    if (t <= 0.04 || t >= 0.96) {
      return false;
    }
    const closestX = context.player.position.x + cameraDeltaX * t;
    const closestZ = context.player.position.y + cameraDeltaZ * t;
    const heightAlongView = context.cameraPosition.y * t;
    return (
      Math.hypot(object.position.x - closestX, object.position.y - closestZ) <=
        footprintRadius + 0.4 && object.height >= heightAlongView - 0.3
    );
  }
}
