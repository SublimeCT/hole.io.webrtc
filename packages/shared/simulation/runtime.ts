import { SPATIAL_HASH_CELL_SIZE } from "./constants";
import { SpatialHash } from "./spatialHash";
import type { SimulationState, Vector2, WorldObjectState } from "./types";

function isStaticSpatialObject(object: WorldObjectState): boolean {
  return object.status === "static" && object.motion === null;
}

function isMovingRouteObject(object: WorldObjectState): boolean {
  return object.status === "static" && object.motion !== null;
}

export interface SimulationRuntime {
  readonly objectIndexById: ReadonlyMap<string, number>;
  readonly activeObjectIds: ReadonlySet<string>;
  readonly movingRouteObjectIds: ReadonlySet<string>;
  readonly movingVehicleObjectIds: ReadonlySet<string>;
  readonly fadingObjectIds: ReadonlySet<string>;
  prepare(state: SimulationState): void;
  getObject(id: string): WorldObjectState | undefined;
  queryStaticObjects(position: Vector2, radius: number): readonly string[];
  commitObjects(objects: readonly WorldObjectState[], candidateIds: Iterable<string>): void;
  takeDirtyObjects(): readonly WorldObjectState[];
  reset(state: SimulationState): void;
}

class IndexedSimulationRuntime implements SimulationRuntime {
  readonly #objectIndexById = new Map<string, number>();
  readonly #objectById = new Map<string, WorldObjectState>();
  readonly #activeObjectIds = new Set<string>();
  readonly #movingRouteObjectIds = new Set<string>();
  readonly #movingVehicleObjectIds = new Set<string>();
  readonly #fadingObjectIds = new Set<string>();
  readonly #dirtyObjectIds = new Set<string>();
  #staticSpatialHash = new SpatialHash(SPATIAL_HASH_CELL_SIZE);
  #objects: readonly WorldObjectState[];

  constructor(state: SimulationState) {
    this.#objects = state.objects;
    this.#rebuild(state.objects);
  }

  get objectIndexById(): ReadonlyMap<string, number> {
    return this.#objectIndexById;
  }

  get activeObjectIds(): ReadonlySet<string> {
    return this.#activeObjectIds;
  }

  get movingRouteObjectIds(): ReadonlySet<string> {
    return this.#movingRouteObjectIds;
  }

  get movingVehicleObjectIds(): ReadonlySet<string> {
    return this.#movingVehicleObjectIds;
  }

  get fadingObjectIds(): ReadonlySet<string> {
    return this.#fadingObjectIds;
  }

  prepare(state: SimulationState): void {
    if (state.objects !== this.#objects) {
      this.reset(state);
    }
  }

  getObject(id: string): WorldObjectState | undefined {
    return this.#objectById.get(id);
  }

  queryStaticObjects(position: Vector2, radius: number): readonly string[] {
    return this.#staticSpatialHash.query(position, radius);
  }

  commitObjects(objects: readonly WorldObjectState[], candidateIds: Iterable<string>): void {
    for (const id of candidateIds) {
      const index = this.#objectIndexById.get(id);
      if (index === undefined) {
        continue;
      }
      const previous = this.#objectById.get(id);
      const next = objects[index];
      if (next === undefined || next === previous) {
        continue;
      }
      if (previous !== undefined && isStaticSpatialObject(previous)) {
        this.#staticSpatialHash.remove(id);
      }
      this.#objectById.set(id, next);
      this.#setMembership(next);
      if (isStaticSpatialObject(next)) {
        this.#staticSpatialHash.insert(id, next.position);
      }
      this.#dirtyObjectIds.add(id);
    }
    this.#objects = objects;
  }

  takeDirtyObjects(): readonly WorldObjectState[] {
    const dirty: WorldObjectState[] = [];
    for (const id of this.#dirtyObjectIds) {
      const object = this.#objectById.get(id);
      if (object !== undefined) {
        dirty.push(object);
      }
    }
    this.#dirtyObjectIds.clear();
    return dirty;
  }

  reset(state: SimulationState): void {
    this.#objects = state.objects;
    this.#dirtyObjectIds.clear();
    this.#rebuild(state.objects);
  }

  #rebuild(objects: readonly WorldObjectState[]): void {
    this.#objectIndexById.clear();
    this.#objectById.clear();
    this.#activeObjectIds.clear();
    this.#movingRouteObjectIds.clear();
    this.#movingVehicleObjectIds.clear();
    this.#fadingObjectIds.clear();
    this.#staticSpatialHash = new SpatialHash(SPATIAL_HASH_CELL_SIZE);
    objects.forEach((object, index) => {
      this.#objectIndexById.set(object.id, index);
      this.#objectById.set(object.id, object);
      this.#setMembership(object);
      if (isStaticSpatialObject(object)) {
        this.#staticSpatialHash.insert(object.id, object.position);
      }
    });
  }

  #setMembership(object: WorldObjectState): void {
    this.#activeObjectIds.delete(object.id);
    this.#movingRouteObjectIds.delete(object.id);
    this.#movingVehicleObjectIds.delete(object.id);
    this.#fadingObjectIds.delete(object.id);
    if (object.status === "active") {
      this.#activeObjectIds.add(object.id);
    }
    if (isMovingRouteObject(object)) {
      this.#movingRouteObjectIds.add(object.id);
      if (object.motion?.kind === "vehicle") {
        this.#movingVehicleObjectIds.add(object.id);
      }
    }
    if ((object.footprintFadeRemaining ?? 0) > 0) {
      this.#fadingObjectIds.add(object.id);
    }
  }
}

export function createSimulationRuntime(state: SimulationState): SimulationRuntime {
  return new IndexedSimulationRuntime(state);
}
