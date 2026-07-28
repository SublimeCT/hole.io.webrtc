import {
  FOOTPRINT_MARK_SECONDS,
  PREFAB_DEFINITIONS,
  type HoleState,
  type PrefabDefinition,
  type WorldObjectState,
} from "@hole-io/shared/simulation";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { VEHICLE_SINK_DURATION_SECONDS, getVehicleSinkTransform } from "./vehicleSink";

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

const SMALL_OBJECT_RENDER_DISTANCE = 150;
const SMALL_OBJECT_SCORE_THRESHOLD = 10;
const MODEL_LOAD_CONCURRENCY = 4;
const VISIBILITY_REFRESH_SECONDS = 0.1;
const INSTANCE_CELL_SIZE = 32;

function instanceBatchKey(object: WorldObjectState): string {
  if (object.motion !== null) {
    return "dynamic";
  }
  return `${Math.floor(object.position.x / INSTANCE_CELL_SIZE)}:${Math.floor(
    object.position.y / INSTANCE_CELL_SIZE,
  )}`;
}

export class CityObjectRenderer {
  readonly #scene: THREE.Scene;
  readonly #loader = new GLTFLoader();
  readonly #prefabs = new Map<string, LoadedPrefab>();
  readonly #instanceBatches = new Set<InstanceBatch>();
  readonly #instances = new Map<string, ObjectInstance>();
  readonly #activeModels = new Map<string, THREE.Group>();
  readonly #transparentModels = new Map<string, THREE.Group>();
  readonly #transparentObjectIds = new Set<string>();
  readonly #hiddenSmallObjectIds = new Set<string>();
  readonly #animatedModels = new Map<string, AnimatedModel>();
  readonly #vehicleSinkElapsed = new Map<string, number>();
  readonly #objectsById = new Map<string, WorldObjectState>();
  readonly #continuousObjectIds = new Set<string>();
  readonly #lastStatus = new Map<string, WorldObjectState["status"]>();
  readonly #lastSizeMultiplier = new Map<string, number>();
  readonly #position = new THREE.Vector3();
  readonly #quaternion = new THREE.Quaternion();
  readonly #scale = new THREE.Vector3(1, 1, 1);
  readonly #worldMatrix = new THREE.Matrix4();
  readonly #partMatrix = new THREE.Matrix4();
  readonly #textures = new Set<THREE.Texture>();
  /** 按可视属性复用 MeshBasicMaterial，避免每个 prefab part 各建一份等价材质。 */
  readonly #materialCache = new Map<string, THREE.MeshBasicMaterial>();
  #visibilityRefreshElapsed = VISIBILITY_REFRESH_SECONDS;

  constructor(scene: THREE.Scene) {
    this.#scene = scene;
  }

  async initialize(
    objects: readonly WorldObjectState[],
    onProgress: (loaded: number, total: number) => void,
  ): Promise<void> {
    this.#objectsById.clear();
    objects.forEach((object) => this.#objectsById.set(object.id, object));
    const objectsByPrefab = new Map<string, WorldObjectState[]>();
    for (const object of objects) {
      const prefabObjects = objectsByPrefab.get(object.prefabId) ?? [];
      prefabObjects.push(object);
      objectsByPrefab.set(object.prefabId, prefabObjects);
    }
    const definitions = [...objectsByPrefab.keys()].map((id) => {
      const definition = PREFAB_DEFINITIONS.find((candidate) => candidate.id === id);
      if (!definition) {
        throw new Error(`Missing prefab definition: ${id}`);
      }
      return definition;
    });
    let loaded = 0;
    let nextDefinitionIndex = 0;
    const loadNext = async (): Promise<void> => {
      while (nextDefinitionIndex < definitions.length) {
        const definitionIndex = nextDefinitionIndex;
        nextDefinitionIndex += 1;
        const definition = definitions[definitionIndex];
        if (!definition) continue;
        this.#prefabs.set(definition.id, await this.#loadPrefab(definition));
        loaded += 1;
        onProgress(loaded, definitions.length);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(MODEL_LOAD_CONCURRENCY, definitions.length) }, async () =>
        loadNext(),
      ),
    );

    for (const definition of definitions) {
      const prefab = this.#prefabs.get(definition.id);
      if (!prefab) {
        continue;
      }
      const prefabObjects = objectsByPrefab.get(definition.id) ?? [];
      const objectsByBatch = new Map<string, WorldObjectState[]>();
      for (const object of prefabObjects) {
        const key = instanceBatchKey(object);
        const batchObjects = objectsByBatch.get(key) ?? [];
        batchObjects.push(object);
        objectsByBatch.set(key, batchObjects);
      }
      for (const [batchKey, batchObjects] of objectsByBatch) {
        const instanceCount = batchObjects.reduce((total, object) => total + object.stackLayers, 0);
        const hasDynamicInstances =
          prefab.animations.length === 0 && batchObjects.some((object) => object.motion !== null);
        const meshes = prefab.parts.map((part) => {
          const mesh = new THREE.InstancedMesh(part.geometry, part.material, instanceCount);
          mesh.instanceMatrix.setUsage(
            hasDynamicInstances ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage,
          );
          mesh.name = `instances:${definition.id}:${batchKey}`;
          this.#scene.add(mesh);
          return mesh;
        });
        let nextIndex = 0;
        const indicesByObjectId = new Map<string, readonly number[]>();
        batchObjects.forEach((object) => {
          const indices = Array.from(
            { length: object.stackLayers },
            (_, layer) => nextIndex + layer,
          );
          nextIndex += object.stackLayers;
          indicesByObjectId.set(object.id, indices);
        });
        const batch: InstanceBatch = {
          prefab,
          meshes,
          objectIds: batchObjects.map((object) => object.id),
          indicesByObjectId,
        };
        this.#instanceBatches.add(batch);
        batchObjects.forEach((object) => {
          const indices = indicesByObjectId.get(object.id);
          if (!indices) {
            return;
          }
          this.#instances.set(object.id, { batch, indices });
          if (object.motion && prefab.animations.length > 0) {
            this.#setHiddenInstanceTransforms(batch, indices, object);
            const animated = this.#getAnimatedModel(object.id, prefab);
            this.#setGroupTransform(animated.group, object);
          } else {
            this.#setInstanceTransforms(batch, indices, object);
          }
          this.#lastStatus.set(object.id, object.status);
          this.#lastSizeMultiplier.set(object.id, object.sizeMultiplier);
        });
        meshes.forEach((mesh) => {
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingSphere();
        });
      }
    }
  }

  sync(
    changedObjects: readonly WorldObjectState[],
    deltaSeconds = 0,
    visibilityContext: CityVisibilityContext | null = null,
  ): void {
    const touchedMeshes = new Set<THREE.InstancedMesh>();
    const objectIds = new Set<string>();
    changedObjects.forEach((object) => {
      this.#objectsById.set(object.id, object);
      objectIds.add(object.id);
    });
    this.#continuousObjectIds.forEach((objectId) => objectIds.add(objectId));
    this.#visibilityRefreshElapsed += deltaSeconds;
    const refreshVisibility =
      visibilityContext !== null && this.#visibilityRefreshElapsed >= VISIBILITY_REFRESH_SECONDS;
    if (refreshVisibility) {
      this.#visibilityRefreshElapsed = 0;
      this.#objectsById.forEach((object) => objectIds.add(object.id));
    }
    for (const objectId of objectIds) {
      const object = this.#objectsById.get(objectId);
      if (object === undefined) {
        continue;
      }
      const instance = this.#instances.get(object.id);
      if (!instance) {
        continue;
      }
      const previousStatus = this.#lastStatus.get(object.id);
      const sizeChanged = this.#lastSizeMultiplier.get(object.id) !== object.sizeMultiplier;
      const vehicleSinkElapsed = this.#advanceVehicleSink(object, previousStatus, deltaSeconds);
      const needsContinuousUpdate =
        object.status === "active" ||
        (object.footprintFadeRemaining ?? 0) > 0 ||
        (vehicleSinkElapsed !== null && vehicleSinkElapsed < VEHICLE_SINK_DURATION_SECONDS);
      if (needsContinuousUpdate) {
        this.#continuousObjectIds.add(object.id);
      } else {
        this.#continuousObjectIds.delete(object.id);
      }
      const animated = this.#animatedModels.get(object.id);
      if (animated) {
        const footprintFade = object.footprintFadeRemaining ?? 0;
        animated.group.visible =
          object.status !== "consumed" ||
          footprintFade > 0 ||
          (vehicleSinkElapsed !== null && vehicleSinkElapsed < VEHICLE_SINK_DURATION_SECONDS);
        if (animated.group.visible) {
          this.#setGroupTransform(animated.group, object);
          if (vehicleSinkElapsed !== null) {
            this.#applyVehicleSink(animated.group, object, vehicleSinkElapsed);
          } else if (object.status === "consumed") {
            this.#applyFootprintFade(animated.group, object, footprintFade);
          } else {
            this.#restoreModelMaterials(animated.group);
          }
          animated.action.paused = object.status !== "static" || !object.motion;
          if (!animated.action.paused) {
            animated.mixer.update(deltaSeconds);
          }
        }
        this.#lastStatus.set(object.id, object.status);
        this.#lastSizeMultiplier.set(object.id, object.sizeMultiplier);
        continue;
      }
      const wasHiddenSmallObject = this.#hiddenSmallObjectIds.has(object.id);
      const wasTransparent = this.#transparentObjectIds.has(object.id);
      const needsVisibilityUpdate = refreshVisibility || previousStatus !== "static";
      const shouldHideSmallObject = !needsVisibilityUpdate
        ? wasHiddenSmallObject
        : object.status === "static" &&
          object.motion === null &&
          visibilityContext !== null &&
          object.value < SMALL_OBJECT_SCORE_THRESHOLD &&
          Math.hypot(
            object.position.x - visibilityContext.player.position.x,
            object.position.y - visibilityContext.player.position.y,
          ) > SMALL_OBJECT_RENDER_DISTANCE;
      if (shouldHideSmallObject) {
        if (!wasHiddenSmallObject) {
          this.#setHiddenInstanceTransforms(instance.batch, instance.indices, object);
          instance.batch.meshes.forEach((mesh) => touchedMeshes.add(mesh));
          this.#hiddenSmallObjectIds.add(object.id);
        }
        const transparentModel = this.#transparentModels.get(object.id);
        if (transparentModel) transparentModel.visible = false;
        const activeModel = this.#activeModels.get(object.id);
        if (activeModel) activeModel.visible = false;
        this.#lastStatus.set(object.id, object.status);
        this.#lastSizeMultiplier.set(object.id, object.sizeMultiplier);
        continue;
      }
      if (wasHiddenSmallObject) {
        this.#hiddenSmallObjectIds.delete(object.id);
      }
      const shouldFade = !needsVisibilityUpdate
        ? wasTransparent
        : object.status === "static" &&
          visibilityContext !== null &&
          this.#shouldFadeBuilding(object, visibilityContext);
      if (shouldFade) {
        if (!wasTransparent) {
          this.#setHiddenInstanceTransforms(instance.batch, instance.indices, object);
          instance.batch.meshes.forEach((mesh) => touchedMeshes.add(mesh));
          this.#transparentObjectIds.add(object.id);
        }
        const transparentModel = this.#getTransparentModel(
          object.id,
          instance.batch.prefab,
          object,
        );
        transparentModel.visible = true;
        if (!wasTransparent || previousStatus !== "static" || sizeChanged) {
          this.#setGroupTransform(transparentModel, object);
        }
        const activeModel = this.#activeModels.get(object.id);
        if (activeModel) {
          activeModel.visible = false;
        }
        this.#lastStatus.set(object.id, object.status);
        this.#lastSizeMultiplier.set(object.id, object.sizeMultiplier);
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
        if (
          previousStatus !== "static" ||
          sizeChanged ||
          object.motion ||
          wasTransparent ||
          wasHiddenSmallObject
        ) {
          this.#setInstanceTransforms(instance.batch, instance.indices, object);
          instance.batch.meshes.forEach((mesh) => touchedMeshes.add(mesh));
        }
        const activeModel = this.#activeModels.get(object.id);
        if (activeModel) {
          activeModel.visible = false;
        }
      } else {
        if (previousStatus === "static") {
          this.#setHiddenInstanceTransforms(instance.batch, instance.indices, object);
          instance.batch.meshes.forEach((mesh) => touchedMeshes.add(mesh));
        }
        const activeModel = this.#getActiveModel(object.id, instance.batch.prefab, object);
        activeModel.visible =
          object.status !== "consumed" ||
          (object.footprintFadeRemaining ?? 0) > 0 ||
          (vehicleSinkElapsed !== null && vehicleSinkElapsed < VEHICLE_SINK_DURATION_SECONDS);
        if (activeModel.visible) {
          const fade = object.footprintFadeRemaining ?? 0;
          if (vehicleSinkElapsed !== null) {
            this.#applyVehicleSink(activeModel, object, vehicleSinkElapsed);
          } else {
            activeModel.position.set(
              object.position.x,
              object.status === "consumed"
                ? object.centerY - (1 - fade / FOOTPRINT_MARK_SECONDS) * object.height * 1.4
                : object.centerY,
              object.position.y,
            );
            activeModel.scale.setScalar(
              object.sizeMultiplier *
                (object.status === "consumed" ? Math.max(0.05, fade / FOOTPRINT_MARK_SECONDS) : 1),
            );
            activeModel.traverse((child) => {
              if (!(child instanceof THREE.Mesh)) return;
              const materials = Array.isArray(child.material) ? child.material : [child.material];
              materials.forEach((material) => {
                material.transparent = object.status === "consumed";
                material.opacity =
                  object.status === "consumed" ? Math.max(0, fade / FOOTPRINT_MARK_SECONDS) : 1;
                material.depthWrite = object.status !== "consumed";
              });
            });
          }
          activeModel.quaternion.set(
            object.rotation.x,
            object.rotation.y,
            object.rotation.z,
            object.rotation.w,
          );
        }
      }
      this.#lastStatus.set(object.id, object.status);
      this.#lastSizeMultiplier.set(object.id, object.sizeMultiplier);
    }
    touchedMeshes.forEach((mesh) => {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
  }

  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.#instanceBatches.forEach((batch) => {
      batch.meshes.forEach((mesh) => this.#scene.remove(mesh));
    });
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
    this.#animatedModels.forEach(({ mixer, group }) => {
      mixer.stopAllAction();
      group.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const animatedMaterials = Array.isArray(child.material) ? child.material : [child.material];
        animatedMaterials.forEach((material) => material.dispose());
      });
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
    this.#activeModels.forEach((group) => {
      group.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => material.dispose());
      });
      this.#scene.remove(group);
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.#textures.forEach((texture) => texture.dispose());
    this.#instanceBatches.clear();
    this.#instances.clear();
    this.#prefabs.clear();
    this.#textures.clear();
    this.#activeModels.clear();
    this.#transparentModels.clear();
    this.#animatedModels.clear();
    this.#vehicleSinkElapsed.clear();
    this.#objectsById.clear();
    this.#continuousObjectIds.clear();
    this.#transparentObjectIds.clear();
    this.#hiddenSmallObjectIds.clear();
    this.#lastStatus.clear();
    this.#lastSizeMultiplier.clear();
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
      this.#textures.add(map);
    }
    const vertexColors = geometry.hasAttribute("color");
    // key 覆盖全部影响外观的属性：命中即等价、可安全共享（激活/透明态仍先 clone 再改，互不污染）。
    const baseColor = map
      ? "ffffff"
      : (mappedSource?.color ?? new THREE.Color(0xffffff)).getHexString();
    const key = `${map?.uuid ?? "nomap"}|${baseColor}|${source.transparent ? 1 : 0}|${source.opacity}|${source.alphaTest}|${source.side}|${vertexColors ? 1 : 0}`;
    const cached = this.#materialCache.get(key);
    if (cached) {
      return cached;
    }
    const material = new THREE.MeshBasicMaterial({
      color: map ? 0xffffff : (mappedSource?.color ?? new THREE.Color(0xffffff)),
      map,
      transparent: source.transparent,
      opacity: source.opacity,
      alphaTest: source.alphaTest,
      side: source.side,
      vertexColors,
      toneMapped: false,
    });
    this.#materialCache.set(key, material);
    return material;
  }

  #setInstanceTransforms(
    batch: InstanceBatch,
    indices: readonly number[],
    object: WorldObjectState,
  ): void {
    indices.forEach((index, layer) => this.#setInstanceTransform(batch, index, object, layer));
  }

  #setHiddenInstanceTransforms(
    batch: InstanceBatch,
    indices: readonly number[],
    object: WorldObjectState,
  ): void {
    this.#worldMatrix.makeScale(0, 0, 0);
    this.#worldMatrix.setPosition(object.position.x, object.centerY, object.position.y);
    batch.meshes.forEach((mesh) => {
      indices.forEach((index) => mesh.setMatrixAt(index, this.#worldMatrix));
    });
  }

  #setInstanceTransform(
    batch: InstanceBatch,
    index: number,
    object: WorldObjectState,
    layer: number,
  ): void {
    const baseHeight =
      object.height / object.stackLayers / Math.max(object.sizeMultiplier, Number.EPSILON);
    this.#position.set(
      object.position.x,
      object.stackLayers === 1 ? object.centerY : baseHeight * (layer + 0.5),
      object.position.y,
    );
    this.#quaternion.set(
      object.rotation.x,
      object.rotation.y,
      object.rotation.z,
      object.rotation.w,
    );
    this.#scale.setScalar(object.sizeMultiplier);
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
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      const clones = materials.map((material) => material.clone());
      child.material = clones.length === 1 ? (clones[0] ?? child.material) : clones;
    });
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
      const model = prefab.template.clone(true);
      model.scale.setScalar(object.sizeMultiplier);
      return model;
    }
    const model = new THREE.Group();
    const baseHeight = object.height / object.stackLayers;
    for (let layer = 0; layer < object.stackLayers; layer += 1) {
      const floor = prefab.template.clone(true);
      floor.position.y = baseHeight * (layer - (object.stackLayers - 1) / 2);
      model.add(floor);
    }
    model.scale.setScalar(object.sizeMultiplier);
    return model;
  }

  #getAnimatedModel(id: string, prefab: LoadedPrefab): AnimatedModel {
    const existing = this.#animatedModels.get(id);
    if (existing) {
      return existing;
    }
    const group = prefab.template.clone(true);
    group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      const clones = materials.map((material) => material.clone());
      child.material = clones.length === 1 ? (clones[0] ?? child.material) : clones;
    });
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
    group.scale.setScalar(object.sizeMultiplier);
  }

  #advanceVehicleSink(
    object: WorldObjectState,
    previousStatus: WorldObjectState["status"] | undefined,
    deltaSeconds: number,
  ): number | null {
    if (object.status !== "consumed" || object.routeMotion?.kind !== "vehicle") {
      return null;
    }
    const elapsed =
      previousStatus === "consumed"
        ? Math.min(
            VEHICLE_SINK_DURATION_SECONDS,
            (this.#vehicleSinkElapsed.get(object.id) ?? 0) + deltaSeconds,
          )
        : 0;
    this.#vehicleSinkElapsed.set(object.id, elapsed);
    return elapsed;
  }

  #applyVehicleSink(group: THREE.Group, object: WorldObjectState, elapsed: number): void {
    const transform = getVehicleSinkTransform(elapsed, object.height);
    group.position.set(
      object.position.x,
      object.centerY - transform.verticalOffset,
      object.position.y,
    );
    group.scale.setScalar(object.sizeMultiplier * transform.scaleMultiplier);
    this.#restoreModelMaterials(group);
  }

  #applyFootprintFade(group: THREE.Group, object: WorldObjectState, remaining: number): void {
    const ratio = Math.max(0, Math.min(1, remaining / FOOTPRINT_MARK_SECONDS));
    group.position.y = object.centerY - (1 - ratio) * object.height * 1.4;
    group.scale.setScalar(object.sizeMultiplier * Math.max(0.05, ratio));
    group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        material.transparent = true;
        material.opacity = ratio;
        material.depthWrite = false;
      });
    });
  }

  #restoreModelMaterials(group: THREE.Group): void {
    group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        material.opacity = 1;
        material.depthWrite = true;
      });
    });
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
