import { GRAVITY_METERS_PER_SECOND_SQUARED, GROUND_THICKNESS } from "./constants";
import type { HoleState, WorldObjectState } from "./types";

type RapierModule = typeof import("@dimforge/rapier3d");
type RapierWorld = import("@dimforge/rapier3d").World;
type RapierRigidBody = import("@dimforge/rapier3d").RigidBody;

let rapierModulePromise: Promise<RapierModule> | undefined;

const GROUND_GROUP = 1;
const ACTIVE_GROUP = 2;
const GROUND_COLLISION_GROUPS = (GROUND_GROUP << 16) | ACTIVE_GROUP;
const ACTIVE_COLLISION_GROUPS = (ACTIVE_GROUP << 16) | (GROUND_GROUP | ACTIVE_GROUP);
const HOLE_SEGMENTS = 96;
const OUTER_GROUND_RADIUS = 32;
const GROUND_GROUP_KEY = "ground";

interface ActiveEntry {
  object: WorldObjectState;
  index: number;
}

interface PhysicsGroup {
  hole: HoleState | null;
  entries: ActiveEntry[];
}

interface ActiveBody {
  body: RapierRigidBody;
  shapeKey: string;
}

interface PhysicsWorldGroup {
  world: RapierWorld;
  groundBody: RapierRigidBody;
  holeRadius: number | null;
  activeBodies: Map<string, ActiveBody>;
}

export interface SimulationPhysicsRuntime {
  step(
    objects: readonly WorldObjectState[],
    holes: readonly HoleState[],
    deltaSeconds: number,
  ): readonly WorldObjectState[];
  reset(): void;
  dispose(): void;
}

function rotationFromYaw(yaw: number): WorldObjectState["rotation"] {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

function resumeRoute(object: WorldObjectState): WorldObjectState {
  const motion = object.routeMotion;
  if (!motion) {
    return object;
  }
  const position = { ...object.position };
  if (motion.axis === "x") {
    position.y = motion.lateralCoordinate;
  } else {
    position.x = motion.lateralCoordinate;
  }
  return {
    ...object,
    position,
    centerY: object.height / 2,
    velocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    rotation: rotationFromYaw(motion.headingYaw),
    activeTime: 0,
    claimedBy: null,
    motion,
  };
}

function shapeKey(object: WorldObjectState): string {
  return `${object.shape}:${object.size.x}:${object.size.y}:${object.height}`;
}

function createColliderDescriptor(
  RAPIER: RapierModule,
  object: WorldObjectState,
): import("@dimforge/rapier3d").ColliderDesc {
  if (object.shape === "sphere") {
    return RAPIER.ColliderDesc.ball(object.size.x / 2);
  }
  if (object.shape === "cylinder") {
    return RAPIER.ColliderDesc.cylinder(object.height / 2, object.size.x / 2);
  }
  return RAPIER.ColliderDesc.cuboid(object.size.x / 2, object.height / 2, object.size.y / 2);
}

function configureCollider(
  descriptor: import("@dimforge/rapier3d").ColliderDesc,
  collisionGroups: number,
): import("@dimforge/rapier3d").ColliderDesc {
  return descriptor.setCollisionGroups(collisionGroups).setFriction(0.78).setRestitution(0);
}

function createBody(
  RAPIER: RapierModule,
  world: RapierWorld,
  object: WorldObjectState,
): ActiveBody {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(object.position.x, object.centerY, object.position.y)
      .setRotation(object.rotation)
      .setLinvel(object.velocity.x, object.velocity.y, object.velocity.z)
      .setAngvel(object.angularVelocity)
      .setLinearDamping(0.12)
      .setAngularDamping(0.16)
      .setCanSleep(false),
  );
  const volume = object.size.x * object.size.y * object.height;
  const mass = Math.min(120, 28 + Math.cbrt(volume) * 10);
  const collider = configureCollider(
    createColliderDescriptor(RAPIER, object),
    ACTIVE_COLLISION_GROUPS,
  ).setMass(mass);
  world.createCollider(collider, body);
  return { body, shapeKey: shapeKey(object) };
}

function holeGroupKey(holeId: string): string {
  return `hole:${holeId}`;
}

function overlappingHole(
  positionX: number,
  positionZ: number,
  fitDiameter: number,
  holes: readonly HoleState[],
): HoleState | null {
  let nearest: HoleState | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const hole of holes) {
    if (hole.eliminationRemaining > 0 || hole.isOut) {
      continue;
    }
    const distance = Math.hypot(positionX - hole.position.x, positionZ - hole.position.y);
    if (distance <= hole.radius + fitDiameter / 2 && distance < nearestDistance) {
      nearest = hole;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function groupActiveObjects(
  objects: readonly WorldObjectState[],
  holes: readonly HoleState[],
): ReadonlyMap<string, PhysicsGroup> {
  const groups = new Map<string, PhysicsGroup>();
  objects.forEach((object, index) => {
    if (object.status !== "active") {
      return;
    }
    const hole = overlappingHole(object.position.x, object.position.y, object.fitDiameter, holes);
    const key = hole === null ? GROUND_GROUP_KEY : holeGroupKey(hole.id);
    const group = groups.get(key) ?? { hole, entries: [] };
    group.entries.push({ object, index });
    groups.set(key, group);
  });
  return groups;
}

function holeGravityMultiplier(hole: HoleState | null): number {
  return (
    hole?.activePowerUps.reduce((multiplier, effect) => {
      if (effect.type === "magnet") return Math.max(multiplier, 3);
      return multiplier;
    }, 1) ?? 1
  );
}

function wedgeVertices(innerRadius: number, startAngle: number, endAngle: number): Float32Array {
  const innerStartX = Math.cos(startAngle) * innerRadius;
  const innerStartZ = Math.sin(startAngle) * innerRadius;
  const innerEndX = Math.cos(endAngle) * innerRadius;
  const innerEndZ = Math.sin(endAngle) * innerRadius;
  const outerEndX = Math.cos(endAngle) * OUTER_GROUND_RADIUS;
  const outerEndZ = Math.sin(endAngle) * OUTER_GROUND_RADIUS;
  const outerStartX = Math.cos(startAngle) * OUTER_GROUND_RADIUS;
  const outerStartZ = Math.sin(startAngle) * OUTER_GROUND_RADIUS;
  return new Float32Array([
    innerStartX,
    0,
    innerStartZ,
    innerEndX,
    0,
    innerEndZ,
    outerEndX,
    0,
    outerEndZ,
    outerStartX,
    0,
    outerStartZ,
    innerStartX,
    -GROUND_THICKNESS,
    innerStartZ,
    innerEndX,
    -GROUND_THICKNESS,
    innerEndZ,
    outerEndX,
    -GROUND_THICKNESS,
    outerEndZ,
    outerStartX,
    -GROUND_THICKNESS,
    outerStartZ,
  ]);
}

function createGroundBody(
  RAPIER: RapierModule,
  world: RapierWorld,
  hole: HoleState | null,
): RapierRigidBody {
  const groundBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(hole?.position.x ?? 0, 0, hole?.position.y ?? 0),
  );
  if (hole === null) {
    world.createCollider(
      configureCollider(
        new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })),
        GROUND_COLLISION_GROUPS,
      ),
      groundBody,
    );
    return groundBody;
  }

  for (let segment = 0; segment < HOLE_SEGMENTS; segment += 1) {
    const startAngle = (segment / HOLE_SEGMENTS) * Math.PI * 2;
    const endAngle = ((segment + 1) / HOLE_SEGMENTS) * Math.PI * 2;
    const descriptor = RAPIER.ColliderDesc.convexHull(
      wedgeVertices(hole.radius, startAngle, endAngle),
    );
    if (descriptor === null) {
      throw new Error(`Rapier could not create ground wedge ${segment} for radius ${hole.radius}`);
    }
    world.createCollider(configureCollider(descriptor, GROUND_COLLISION_GROUPS), groundBody);
  }
  return groundBody;
}

function sameVector(
  left: import("@dimforge/rapier3d").Vector,
  right: { readonly x: number; readonly y: number; readonly z: number },
): boolean {
  return left.x === right.x && left.y === right.y && left.z === right.z;
}

function sameRotation(
  left: import("@dimforge/rapier3d").Rotation,
  right: WorldObjectState["rotation"],
): boolean {
  return left.x === right.x && left.y === right.y && left.z === right.z && left.w === right.w;
}

function syncBodyFromState(body: RapierRigidBody, object: WorldObjectState): void {
  const position = { x: object.position.x, y: object.centerY, z: object.position.y };
  if (!sameVector(body.translation(), position)) {
    body.setTranslation(position, true);
  }
  if (!sameRotation(body.rotation(), object.rotation)) {
    body.setRotation(object.rotation, true);
  }
  if (!sameVector(body.linvel(), object.velocity)) {
    body.setLinvel(object.velocity, true);
  }
  if (!sameVector(body.angvel(), object.angularVelocity)) {
    body.setAngvel(object.angularVelocity, true);
  }
}

function verticalHalfExtent(
  object: WorldObjectState,
  rotation: WorldObjectState["rotation"],
): number {
  if (object.shape === "sphere") {
    return object.size.x / 2;
  }
  const { x, y, z, w } = rotation;
  const matrixYFromX = 2 * (x * y + z * w);
  const matrixYFromY = 1 - 2 * (x * x + z * z);
  const matrixYFromZ = 2 * (y * z - x * w);
  if (object.shape === "cylinder") {
    const axisY = Math.max(-1, Math.min(1, matrixYFromY));
    return (
      (object.height / 2) * Math.abs(axisY) +
      (object.size.x / 2) * Math.sqrt(Math.max(0, 1 - axisY * axisY))
    );
  }
  return (
    Math.abs(matrixYFromX) * (object.size.x / 2) +
    Math.abs(matrixYFromY) * (object.height / 2) +
    Math.abs(matrixYFromZ) * (object.size.y / 2)
  );
}

class RapierPhysicsRuntime implements SimulationPhysicsRuntime {
  readonly #RAPIER: RapierModule;
  readonly #groups = new Map<string, PhysicsWorldGroup>();
  #disposed = false;

  constructor(RAPIER: RapierModule) {
    this.#RAPIER = RAPIER;
  }

  step(
    objects: readonly WorldObjectState[],
    holes: readonly HoleState[],
    deltaSeconds: number,
  ): readonly WorldObjectState[] {
    if (this.#disposed) {
      throw new Error("Cannot step a disposed Rapier physics runtime");
    }
    const groups = groupActiveObjects(objects, holes);
    this.#removeStaleWorlds(holes);
    this.#removeStaleBodies(groups);
    if (groups.size === 0) {
      return objects;
    }

    const nextObjects = [...objects];
    for (const [key, physicsGroup] of groups) {
      const worldGroup = this.#prepareWorld(key, physicsGroup.hole);
      worldGroup.world.gravity = {
        x: 0,
        y: -GRAVITY_METERS_PER_SECOND_SQUARED * holeGravityMultiplier(physicsGroup.hole),
        z: 0,
      };
      worldGroup.world.timestep = deltaSeconds;
      for (const { object } of physicsGroup.entries) {
        const expectedShapeKey = shapeKey(object);
        let activeBody = worldGroup.activeBodies.get(object.id);
        if (activeBody !== undefined && activeBody.shapeKey !== expectedShapeKey) {
          worldGroup.world.removeRigidBody(activeBody.body);
          worldGroup.activeBodies.delete(object.id);
          activeBody = undefined;
        }
        if (activeBody === undefined) {
          activeBody = createBody(this.#RAPIER, worldGroup.world, object);
          worldGroup.activeBodies.set(object.id, activeBody);
        } else {
          syncBodyFromState(activeBody.body, object);
        }
      }

      worldGroup.world.step();
      physicsGroup.entries.forEach(({ object, index }) => {
        const activeBody = worldGroup.activeBodies.get(object.id);
        if (activeBody === undefined) {
          return;
        }
        const body = activeBody.body;
        let position = body.translation();
        let velocity = body.linvel();
        const rotation = body.rotation();
        let halfHeight = verticalHalfExtent(object, rotation);
        const touchingGroundLayer = position.y + halfHeight >= -GROUND_THICKNESS;
        if (touchingGroundLayer) {
          const maximumHorizontalStep = Math.max(0.06, deltaSeconds * 3);
          const clampedPosition = {
            x: Math.max(
              object.position.x - maximumHorizontalStep,
              Math.min(object.position.x + maximumHorizontalStep, position.x),
            ),
            y: position.y,
            z: Math.max(
              object.position.y - maximumHorizontalStep,
              Math.min(object.position.y + maximumHorizontalStep, position.z),
            ),
          };
          const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
          const speedScale = horizontalSpeed > 3 ? 3 / horizontalSpeed : 1;
          const clampedVelocity = {
            x: velocity.x * speedScale,
            y: Math.min(velocity.y, 0.25),
            z: velocity.z * speedScale,
          };
          body.setTranslation(clampedPosition, true);
          body.setLinvel(clampedVelocity, true);
          position = body.translation();
          velocity = body.linvel();
          halfHeight = verticalHalfExtent(object, rotation);
        }
        const angularVelocity = body.angvel();
        const nearbyHole = overlappingHole(position.x, position.z, object.fitDiameter, holes);
        const claimedBy = nearbyHole?.id ?? object.claimedBy;
        const fullyBelowGround = position.y + halfHeight < -GROUND_THICKNESS - 0.02;
        const hasSettledOnGround =
          object.activeTime > 0.45 &&
          !nearbyHole &&
          position.y - halfHeight >= -0.03 &&
          Math.hypot(velocity.x, velocity.y, velocity.z) < 0.08 &&
          Math.hypot(angularVelocity.x, angularVelocity.y, angularVelocity.z) < 0.1;
        const stopped = fullyBelowGround || hasSettledOnGround;
        const nextObject: WorldObjectState = {
          ...object,
          position: { x: position.x, y: position.z },
          centerY: position.y,
          velocity: stopped ? { x: 0, y: 0, z: 0 } : { ...velocity },
          angularVelocity: stopped ? { x: 0, y: 0, z: 0 } : { ...angularVelocity },
          rotation: { ...rotation },
          status: fullyBelowGround ? "consumed" : hasSettledOnGround ? "static" : "active",
          activeTime: object.activeTime + deltaSeconds,
          claimedBy: hasSettledOnGround ? null : claimedBy,
          motion: null,
        };
        nextObjects[index] = hasSettledOnGround ? resumeRoute(nextObject) : nextObject;
      });
    }
    return nextObjects;
  }

  reset(): void {
    for (const group of this.#groups.values()) {
      group.world.free();
    }
    this.#groups.clear();
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.reset();
    this.#disposed = true;
  }

  #prepareWorld(key: string, hole: HoleState | null): PhysicsWorldGroup {
    let group = this.#groups.get(key);
    const holeRadius = hole?.radius ?? null;
    if (group !== undefined && group.holeRadius !== holeRadius) {
      group.world.free();
      this.#groups.delete(key);
      group = undefined;
    }
    if (group === undefined) {
      const world = new this.#RAPIER.World({ x: 0, y: -GRAVITY_METERS_PER_SECOND_SQUARED, z: 0 });
      group = {
        world,
        groundBody: createGroundBody(this.#RAPIER, world, hole),
        holeRadius,
        activeBodies: new Map(),
      };
      this.#groups.set(key, group);
    } else if (hole !== null) {
      const translation = group.groundBody.translation();
      if (translation.x !== hole.position.x || translation.z !== hole.position.y) {
        group.groundBody.setTranslation({ x: hole.position.x, y: 0, z: hole.position.y }, true);
      }
    }
    return group;
  }

  #removeStaleWorlds(holes: readonly HoleState[]): void {
    const validKeys = new Set([GROUND_GROUP_KEY, ...holes.map((hole) => holeGroupKey(hole.id))]);
    for (const [key, group] of this.#groups) {
      if (!validKeys.has(key)) {
        group.world.free();
        this.#groups.delete(key);
      }
    }
  }

  #removeStaleBodies(groups: ReadonlyMap<string, PhysicsGroup>): void {
    for (const [key, worldGroup] of this.#groups) {
      const desiredIds = new Set(groups.get(key)?.entries.map(({ object }) => object.id) ?? []);
      for (const [objectId, activeBody] of worldGroup.activeBodies) {
        if (!desiredIds.has(objectId)) {
          worldGroup.world.removeRigidBody(activeBody.body);
          worldGroup.activeBodies.delete(objectId);
        }
      }
    }
  }
}

export async function createSimulationPhysicsRuntime(): Promise<SimulationPhysicsRuntime> {
  // The package's declared ESM entry is rapier.js. The explicit subpath avoids the
  // incomplete root package metadata while vite-plugin-wasm handles its .wasm import.
  rapierModulePromise ??= import("@dimforge/rapier3d/rapier.js");
  const RAPIER = await rapierModulePromise;
  return new RapierPhysicsRuntime(RAPIER);
}

export function stepActivePhysics(
  runtime: SimulationPhysicsRuntime,
  objects: readonly WorldObjectState[],
  holes: readonly HoleState[],
  deltaSeconds: number,
): readonly WorldObjectState[] {
  return runtime.step(objects, holes, deltaSeconds);
}
