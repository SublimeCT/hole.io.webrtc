import {
  Body,
  Box,
  ConvexPolyhedron,
  Cylinder,
  Plane,
  Quaternion as CannonQuaternion,
  SAPBroadphase,
  Sphere,
  Vec3,
  World,
  type Shape,
} from "cannon-es";

import { GRAVITY_METERS_PER_SECOND_SQUARED, GROUND_THICKNESS } from "./constants";
import type { HoleState, Quaternion, WorldObjectState } from "./types";

const GROUND_GROUP = 1;
const ACTIVE_GROUP = 2;
const HOLE_SEGMENTS = 96;
const OUTER_GROUND_RADIUS = 32;

interface ActiveEntry {
  object: WorldObjectState;
  index: number;
}

interface PhysicsGroup {
  hole: HoleState | null;
  entries: ActiveEntry[];
}

interface GroundWedge {
  shape: Shape;
  offset: Vec3;
}

function createShape(object: WorldObjectState): Shape {
  if (object.shape === "sphere") {
    return new Sphere(object.size.x / 2);
  }
  if (object.shape === "cylinder") {
    return new Cylinder(object.size.x / 2, object.size.y / 2, object.height, 12);
  }
  return new Box(new Vec3(object.size.x / 2, object.height / 2, object.size.y / 2));
}

function rotationFromYaw(yaw: number): Quaternion {
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

function createBody(object: WorldObjectState): Body {
  const volume = object.size.x * object.size.y * object.height;
  const mass = Math.min(120, 28 + Math.cbrt(volume) * 10);
  return new Body({
    mass,
    shape: createShape(object),
    position: new Vec3(object.position.x, object.centerY, object.position.y),
    velocity: new Vec3(object.velocity.x, object.velocity.y, object.velocity.z),
    angularVelocity: new Vec3(
      object.angularVelocity.x,
      object.angularVelocity.y,
      object.angularVelocity.z,
    ),
    quaternion: new CannonQuaternion(
      object.rotation.x,
      object.rotation.y,
      object.rotation.z,
      object.rotation.w,
    ),
    collisionFilterGroup: ACTIVE_GROUP,
    // Simultaneously falling bodies collide so swallowed objects cannot interpenetrate.
    collisionFilterMask: GROUND_GROUP | ACTIVE_GROUP,
    linearDamping: 0.12,
    angularDamping: 0.16,
    allowSleep: false,
  });
}

function orientFaceOutward(vertices: readonly Vec3[], face: readonly number[]): number[] {
  const first = vertices[face[0] ?? 0] ?? new Vec3();
  const second = vertices[face[1] ?? 0] ?? new Vec3();
  const third = vertices[face[2] ?? 0] ?? new Vec3();
  const normal = second.vsub(first).cross(third.vsub(second));
  const polyCenter = vertices
    .reduce((center, vertex) => center.vadd(vertex), new Vec3())
    .scale(1 / vertices.length);
  const faceCenter = face
    .reduce((center, index) => center.vadd(vertices[index] ?? new Vec3()), new Vec3())
    .scale(1 / face.length);
  return normal.dot(faceCenter.vsub(polyCenter)) >= 0 ? [...face] : [...face].reverse();
}

function createGroundWedge(innerRadius: number, startAngle: number, endAngle: number): GroundWedge {
  const innerStart = new Vec3(
    Math.cos(startAngle) * innerRadius,
    0,
    Math.sin(startAngle) * innerRadius,
  );
  const innerEnd = new Vec3(Math.cos(endAngle) * innerRadius, 0, Math.sin(endAngle) * innerRadius);
  const outerEnd = new Vec3(
    Math.cos(endAngle) * OUTER_GROUND_RADIUS,
    0,
    Math.sin(endAngle) * OUTER_GROUND_RADIUS,
  );
  const outerStart = new Vec3(
    Math.cos(startAngle) * OUTER_GROUND_RADIUS,
    0,
    Math.sin(startAngle) * OUTER_GROUND_RADIUS,
  );
  const worldVertices = [
    innerStart,
    innerEnd,
    outerEnd,
    outerStart,
    new Vec3(innerStart.x, -GROUND_THICKNESS, innerStart.z),
    new Vec3(innerEnd.x, -GROUND_THICKNESS, innerEnd.z),
    new Vec3(outerEnd.x, -GROUND_THICKNESS, outerEnd.z),
    new Vec3(outerStart.x, -GROUND_THICKNESS, outerStart.z),
  ];
  const offset = worldVertices
    .reduce((center, vertex) => center.vadd(vertex), new Vec3())
    .scale(1 / worldVertices.length);
  const vertices = worldVertices.map((vertex) => vertex.vsub(offset));
  const candidateFaces: readonly (readonly number[])[] = [
    [0, 1, 2, 3],
    [4, 7, 6, 5],
    [0, 4, 5, 1],
    [3, 2, 6, 7],
    [0, 3, 7, 4],
    [1, 5, 6, 2],
  ];
  return {
    shape: new ConvexPolyhedron({
      vertices,
      faces: candidateFaces.map((face) => orientFaceOutward(vertices, face)),
    }),
    offset,
  };
}

function createGroundBody(hole: HoleState | null): Body {
  if (!hole) {
    const ground = new Body({
      mass: 0,
      shape: new Plane(),
      collisionFilterGroup: GROUND_GROUP,
      collisionFilterMask: ACTIVE_GROUP,
    });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    return ground;
  }

  const ground = new Body({
    mass: 0,
    position: new Vec3(hole.position.x, 0, hole.position.y),
    collisionFilterGroup: GROUND_GROUP,
    collisionFilterMask: ACTIVE_GROUP,
  });
  for (let segment = 0; segment < HOLE_SEGMENTS; segment += 1) {
    const startAngle = (segment / HOLE_SEGMENTS) * Math.PI * 2;
    const endAngle = ((segment + 1) / HOLE_SEGMENTS) * Math.PI * 2;
    const wedge = createGroundWedge(hole.radius, startAngle, endAngle);
    ground.addShape(wedge.shape, wedge.offset);
  }
  return ground;
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
): readonly PhysicsGroup[] {
  const groups = new Map<string, PhysicsGroup>();
  objects.forEach((object, index) => {
    if (object.status !== "active") {
      return;
    }
    const hole = overlappingHole(object.position.x, object.position.y, object.fitDiameter, holes);
    const key = hole?.id ?? "ground";
    const group = groups.get(key) ?? { hole, entries: [] };
    group.entries.push({ object, index });
    groups.set(key, group);
  });
  return [...groups.values()];
}

export function stepActivePhysics(
  objects: readonly WorldObjectState[],
  holes: readonly HoleState[],
  deltaSeconds: number,
): readonly WorldObjectState[] {
  const groups = groupActiveObjects(objects, holes);
  if (groups.length === 0) {
    return objects;
  }
  const nextObjects = [...objects];

  for (const group of groups) {
    const world = new World();
    world.broadphase = new SAPBroadphase(world);
    const fallMultiplier =
      group.hole?.activePowerUps.reduce((multiplier, effect) => {
        if (effect.type === "magnet") return Math.max(multiplier, 3);
        if (effect.type === "beer") return Math.max(multiplier, 2);
        return multiplier;
      }, 1) ?? 1;
    world.gravity.set(0, -GRAVITY_METERS_PER_SECOND_SQUARED * fallMultiplier, 0);
    world.defaultContactMaterial.friction = 0.78;
    world.defaultContactMaterial.restitution = 0;
    world.addBody(createGroundBody(group.hole));
    const bodies = group.entries.map(({ object }) => {
      const body = createBody(object);
      world.addBody(body);
      return body;
    });
    world.step(deltaSeconds);

    group.entries.forEach(({ object, index }, bodyIndex) => {
      const body = bodies[bodyIndex];
      if (!body) {
        return;
      }
      body.updateAABB();
      const touchingGroundLayer = body.aabb.upperBound.y >= -GROUND_THICKNESS;
      if (touchingGroundLayer) {
        const maximumHorizontalStep = Math.max(0.06, deltaSeconds * 3);
        body.position.x = Math.max(
          object.position.x - maximumHorizontalStep,
          Math.min(object.position.x + maximumHorizontalStep, body.position.x),
        );
        body.position.z = Math.max(
          object.position.y - maximumHorizontalStep,
          Math.min(object.position.y + maximumHorizontalStep, body.position.z),
        );
        const horizontalSpeed = Math.hypot(body.velocity.x, body.velocity.z);
        if (horizontalSpeed > 3) {
          const speedScale = 3 / horizontalSpeed;
          body.velocity.x *= speedScale;
          body.velocity.z *= speedScale;
        }
        body.velocity.y = Math.min(body.velocity.y, 0.25);
        body.updateAABB();
      }
      const nearbyHole = overlappingHole(
        body.position.x,
        body.position.z,
        object.fitDiameter,
        holes,
      );
      const claimedBy = nearbyHole?.id ?? object.claimedBy;
      const fullyBelowGround = body.aabb.upperBound.y < -GROUND_THICKNESS - 0.02;
      const hasSettledOnGround =
        object.activeTime > 0.45 &&
        !nearbyHole &&
        body.aabb.lowerBound.y >= -0.03 &&
        body.velocity.length() < 0.08 &&
        body.angularVelocity.length() < 0.1;
      const nextObject: WorldObjectState = {
        ...object,
        position: { x: body.position.x, y: body.position.z },
        centerY: body.position.y,
        velocity:
          fullyBelowGround || hasSettledOnGround
            ? { x: 0, y: 0, z: 0 }
            : { x: body.velocity.x, y: body.velocity.y, z: body.velocity.z },
        angularVelocity:
          fullyBelowGround || hasSettledOnGround
            ? { x: 0, y: 0, z: 0 }
            : { x: body.angularVelocity.x, y: body.angularVelocity.y, z: body.angularVelocity.z },
        rotation: {
          x: body.quaternion.x,
          y: body.quaternion.y,
          z: body.quaternion.z,
          w: body.quaternion.w,
        },
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
