import { describe, expect, it } from "vitest";

import {
  BASE_MOVE_SPEED,
  BOT_SPEED_MULTIPLIER,
  GAME_DURATION_SECONDS,
  INITIAL_HOLE_RADIUS,
  MAP_HALF_SIZE,
  PEDESTRIAN_SPEED,
  ROAD_CENTERS,
  ROAD_WIDTH,
  SCENE_OBJECT_COUNT,
  SIDEWALK_WIDTH,
  VEHICLE_SPEED,
} from "./constants";
import { stepSimulation } from "./simulation";
import { SpatialHash } from "./spatialHash";
import { PREFAB_DEFINITIONS } from "./prefabs";
import type { SimulationState, WorldObjectState } from "./types";
import { createInitialSimulation } from "./world";

function stateWithObject(object: WorldObjectState): SimulationState {
  const initial = createInitialSimulation();
  const player = initial.holes[0];
  if (!player) {
    throw new Error("Initial player is required");
  }
  return { ...initial, holes: [{ ...player, position: { x: 0, y: 0 } }], objects: [object] };
}

function boxObject(positionX = 0, size = 0.8, height = 0.8): WorldObjectState {
  return {
    id: "test-object",
    prefabId: "crate",
    shape: "box",
    position: { x: positionX, y: 0 },
    centerY: height / 2,
    size: { x: size, y: size },
    height,
    stackLayers: 1,
    fitDiameter: Math.hypot(size, Math.min(size, height)),
    value: 100,
    status: "static",
    velocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    activeTime: 0,
    claimedBy: null,
    motion: null,
    routeMotion: null,
  };
}

function advance(state: SimulationState, frameCount: number): SimulationState {
  let next = state;
  for (let frame = 0; frame < frameCount; frame += 1) {
    next = stepSimulation(next, [], 1 / 60).state;
  }
  return next;
}

function planarHalfExtents(object: WorldObjectState): readonly [number, number] {
  const routeAxis = object.motion?.axis;
  if (routeAxis === "x") {
    return [object.size.y / 2, object.size.x / 2];
  }
  if (routeAxis === "y") {
    return [object.size.x / 2, object.size.y / 2];
  }
  const yaw = yawFromRotation(object);
  const rotatesAcrossAxes = Math.abs(Math.cos(yaw)) < 0.01;
  return rotatesAcrossAxes
    ? [object.size.y / 2, object.size.x / 2]
    : [object.size.x / 2, object.size.y / 2];
}

function objectsOverlap(left: WorldObjectState, right: WorldObjectState): boolean {
  const [leftHalfX, leftHalfY] = planarHalfExtents(left);
  const [rightHalfX, rightHalfY] = planarHalfExtents(right);
  return (
    Math.abs(left.position.x - right.position.x) < leftHalfX + rightHalfX &&
    Math.abs(left.position.y - right.position.y) < leftHalfY + rightHalfY &&
    Math.abs(left.centerY - right.centerY) < (left.height + right.height) / 2
  );
}

function expectNoFootprintOverlap(objects: readonly WorldObjectState[]): void {
  const cellSize = 16;
  const cells = new Map<string, WorldObjectState[]>();
  for (const object of objects) {
    if (object.status !== "static") {
      continue;
    }
    const [halfX, halfY] = planarHalfExtents(object);
    const minimumX = Math.floor((object.position.x - halfX) / cellSize);
    const maximumX = Math.floor((object.position.x + halfX) / cellSize);
    const minimumY = Math.floor((object.position.y - halfY) / cellSize);
    const maximumY = Math.floor((object.position.y + halfY) / cellSize);
    const checked = new Set<string>();
    for (let cellY = minimumY; cellY <= maximumY; cellY += 1) {
      for (let cellX = minimumX; cellX <= maximumX; cellX += 1) {
        const key = `${cellX}:${cellY}`;
        const cell = cells.get(key) ?? [];
        for (const candidate of cell) {
          if (!checked.has(candidate.id) && objectsOverlap(object, candidate)) {
            throw new Error(
              `Footprint overlap: ${object.id}/${object.prefabId} (${object.position.x},${object.position.y}) and ${candidate.id}/${candidate.prefabId} (${candidate.position.x},${candidate.position.y})`,
            );
          }
          checked.add(candidate.id);
        }
        cell.push(object);
        cells.set(key, cell);
      }
    }
  }
}

function expectedCharacterYaw(axis: "x" | "y", direction: -1 | 1): number {
  if (axis === "y") {
    return direction > 0 ? 0 : Math.PI;
  }
  return direction > 0 ? Math.PI / 2 : -Math.PI / 2;
}

function yawFromRotation(object: WorldObjectState): number {
  const { x, y, z, w } = object.rotation;
  return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + z * z));
}

describe("SpatialHash", () => {
  it("returns ids from cells overlapping a circular query extent", () => {
    const hash = new SpatialHash(4);
    hash.insert("near", { x: 1, y: 1 });
    hash.insert("far", { x: 20, y: 20 });

    expect(hash.query({ x: 0, y: 0 }, 2)).toContain("near");
    expect(hash.query({ x: 0, y: 0 }, 2)).not.toContain("far");
  });
});

describe("physical swallowing", () => {
  it("only activates on contact and does not award score before passing through the ground", () => {
    const result = stepSimulation(stateWithObject(boxObject()), [], 1 / 60);

    expect(result.state.objects[0]?.status).toBe("active");
    expect(result.state.holes[0]?.score).toBe(0);
    expect(result.events).toHaveLength(0);
  });

  it("awards score only after gravity moves the whole body through the open ground", () => {
    const activated = stepSimulation(stateWithObject(boxObject()), [], 1 / 60).state;
    const firstPhysicsStep = stepSimulation(activated, [], 1 / 60).state;
    expect(firstPhysicsStep.objects[0]?.centerY).toBeLessThan(0.4);
    expect(firstPhysicsStep.holes[0]?.score).toBe(0);

    const consumed = advance(firstPhysicsStep, 180);
    expect(consumed.objects[0]?.status).toBe("consumed");
    expect(consumed.holes[0]?.score).toBe(100);
    expect(consumed.holes[0]?.radius).toBeGreaterThan(INITIAL_HOLE_RADIUS);
  });

  it("returns a partially fallen object to the ground when the hole moves away", () => {
    const activated = stepSimulation(stateWithObject(boxObject()), [], 1 / 60).state;
    const partiallyFallen = advance(activated, 12);
    expect(partiallyFallen.objects[0]?.centerY).toBeLessThan(0.4);
    expect(partiallyFallen.holes[0]?.score).toBe(0);

    const player = partiallyFallen.holes[0];
    if (!player) {
      throw new Error("Player is required");
    }
    const movedAway: SimulationState = {
      ...partiallyFallen,
      holes: [{ ...player, position: { x: 4, y: 0 } }],
    };
    const settled = advance(movedAway, 240);

    expect(settled.objects[0]?.status).toBe("static");
    expect(settled.objects[0]?.centerY).toBeGreaterThanOrEqual(0.39);
    expect(settled.holes[0]?.score).toBe(0);
  });

  it("keeps an oversized object caught on the physical rim without scoring", () => {
    const caught = advance(stateWithObject(boxObject(0, 2, 2)), 300);

    expect(caught.objects[0]?.status).toBe("active");
    expect(caught.objects[0]?.centerY).toBeGreaterThan(0.9);
    expect(caught.holes[0]?.score).toBe(0);
  });

  it("prevents unresolved rim contact from launching an object across the map", () => {
    const object: WorldObjectState = {
      ...boxObject(0, 2, 2),
      status: "active",
      velocity: { x: 100, y: 20, z: 0 },
      claimedBy: "player",
    };
    const result = stepSimulation(stateWithObject(object), [], 1 / 60);

    expect(Math.abs(result.state.objects[0]?.position.x ?? 1)).toBeLessThanOrEqual(0.061);
    expect(result.state.objects[0]?.status).toBe("active");
    expect(result.state.holes[0]?.score).toBe(0);
  });

  it("never activates or consumes an object outside the hole footprint", () => {
    const untouched = advance(stateWithObject(boxObject(3)), 180);

    expect(untouched.objects[0]?.status).toBe("static");
    expect(untouched.holes[0]?.score).toBe(0);
  });

  it("does not collide with the visual shaft below the physical ground opening", () => {
    const object: WorldObjectState = {
      ...boxObject(2),
      centerY: -1,
      status: "active",
      velocity: { x: 4, y: 0, z: 0 },
      claimedBy: "player",
    };
    const initial = stateWithObject(object);
    const player = initial.holes[0];
    if (!player) {
      throw new Error("Player is required");
    }
    const result = stepSimulation({ ...initial, holes: [{ ...player, radius: 3 }] }, [], 0.1);

    expect(result.state.objects[0]?.position.x).toBeGreaterThan(2.3);
    expect(result.state.objects[0]?.status).toBe("consumed");
  });
});

describe("world defaults", () => {
  it("clamps player movement inside the expanded map", () => {
    const initial = createInitialSimulation();
    const player = initial.holes[0];
    if (!player) {
      throw new Error("Initial player is required");
    }
    const state = {
      ...initial,
      holes: [{ ...player, position: { x: MAP_HALF_SIZE - 0.2, y: 0 } }],
      objects: [],
    };
    const result = stepSimulation(state, [{ playerId: "player", direction: { x: 1, y: 0 } }], 0.1);

    expect(result.state.holes[0]?.position.x).toBeLessThanOrEqual(
      MAP_HALF_SIZE - INITIAL_HOLE_RADIUS,
    );
  });

  it("keeps bots slower than the human player while preserving the same map bounds", () => {
    const initial = createInitialSimulation();
    const human = initial.holes[0];
    const bot = initial.holes[1];
    if (!human || !bot || !bot.bot) {
      throw new Error("Human and bot holes are required");
    }
    const state: SimulationState = {
      ...initial,
      holes: [
        { ...human, position: { x: 0, y: 0 } },
        {
          ...bot,
          position: { x: 0, y: 10 },
          bot: { ...bot.bot, mode: "wander", wanderAngle: 0, rethinkIn: 10 },
        },
      ],
      objects: [],
    };
    const result = stepSimulation(state, [{ playerId: "player", direction: { x: 1, y: 0 } }], 0.1);

    expect(result.state.holes[0]?.position.x).toBeCloseTo(BASE_MOVE_SPEED * 0.1);
    expect(result.state.holes[1]?.position.x).toBeCloseTo(
      BASE_MOVE_SPEED * BOT_SPEED_MULTIPLIER * 0.1,
    );
  });

  it("keeps a committed Bot target instead of oscillating between equivalent objects", () => {
    const initial = createInitialSimulation();
    const bot = initial.holes.find((hole) => hole.id === "bot-1");
    if (!bot || !bot.bot) {
      throw new Error("Bot is required");
    }
    const first: WorldObjectState = { ...boxObject(8), id: "target-first", value: 4 };
    const second: WorldObjectState = {
      ...boxObject(8),
      id: "target-second",
      position: { x: 8, y: 0.25 },
      value: 4,
    };
    let state: SimulationState = {
      ...initial,
      holes: [
        {
          ...bot,
          position: { x: 0, y: 0 },
          bot: { ...bot.bot, mode: "wander", targetObjectId: null, rethinkIn: 0 },
        },
      ],
      objects: [first, second],
    };
    state = stepSimulation(state, [], 1 / 60).state;
    const targetId = state.holes[0]?.bot?.targetObjectId;
    expect(targetId).not.toBeNull();
    for (let frame = 0; frame < 10; frame += 1) {
      state = stepSimulation(state, [], 1 / 60).state;
      expect(state.holes[0]?.bot?.targetObjectId).toBe(targetId);
    }
  });

  it("increases hole movement speed after each growth level while staying faster than traffic", () => {
    const initial = createInitialSimulation();
    const player = initial.holes[0];
    if (!player) {
      throw new Error("Player is required");
    }
    const grownPlayer = { ...player, score: 40, radius: 2.55 };
    const result = stepSimulation(
      { ...initial, holes: [grownPlayer], objects: [] },
      [{ playerId: "player", direction: { x: 1, y: 0 } }],
      0.1,
    );

    expect(result.state.holes[0]?.position.x).toBeGreaterThan(
      grownPlayer.position.x + BASE_MOVE_SPEED * 0.1,
    );
    expect(BASE_MOVE_SPEED).toBeGreaterThan(VEHICLE_SPEED);
  });

  it("moves traffic and selected pedestrians only along their authoritative routes", () => {
    const initial = createInitialSimulation();
    const vehicle = initial.objects.find((object) => object.motion?.speed === VEHICLE_SPEED);
    const pedestrian = initial.objects.find(
      (object) =>
        object.motion?.speed === PEDESTRIAN_SPEED &&
        Math.abs(object.position[object.motion.axis]) < 150,
    );
    if (!vehicle || !vehicle.motion || !pedestrian || !pedestrian.motion) {
      throw new Error("Moving vehicle and pedestrian are required");
    }
    const result = stepSimulation(
      { ...initial, holes: [], objects: [vehicle, pedestrian] },
      [],
      0.1,
    );
    const movedVehicle = result.state.objects[0];
    const movedPedestrian = result.state.objects[1];
    if (!movedVehicle || !movedPedestrian) {
      throw new Error("Moved route objects are required");
    }

    expect(movedVehicle.position[vehicle.motion.axis]).toBeCloseTo(
      vehicle.position[vehicle.motion.axis] + vehicle.motion.direction * VEHICLE_SPEED * 0.1,
    );
    expect(movedPedestrian.position[pedestrian.motion.axis]).toBeCloseTo(
      pedestrian.position[pedestrian.motion.axis] +
        pedestrian.motion.direction * PEDESTRIAN_SPEED * 0.1,
    );
  });

  it("keeps queued vehicles separated by their physical lengths", () => {
    const initial = createInitialSimulation();
    const source = initial.objects.find((object) => object.motion?.speed === VEHICLE_SPEED);
    if (!source) {
      throw new Error("Vehicle is required");
    }
    const motion = {
      kind: "vehicle" as const,
      laneId: "test-lane",
      axis: "x" as const,
      direction: 1 as const,
      speed: VEHICLE_SPEED,
      lateralCoordinate: 0,
      headingYaw: Math.PI / 2,
      minimum: -168,
      maximum: 168,
    };
    const leader: WorldObjectState = {
      ...source,
      id: "leader",
      position: { x: 0, y: 0 },
      motion,
      routeMotion: motion,
    };
    const follower: WorldObjectState = {
      ...source,
      id: "follower",
      position: { x: -0.1, y: 0 },
      motion,
      routeMotion: motion,
    };
    const result = stepSimulation(
      { ...initial, elapsed: 0, holes: [], objects: [leader, follower] },
      [],
      0.1,
    );
    const nextLeader = result.state.objects[0];
    const nextFollower = result.state.objects[1];
    if (!nextLeader || !nextFollower) {
      throw new Error("Queued vehicles are required");
    }
    const minimumGap = nextLeader.size.y / 2 + nextFollower.size.y / 2 + 1.2;

    expect(nextLeader.position.x - nextFollower.position.x).toBeGreaterThanOrEqual(minimumGap);
  });

  it("builds a dense non-overlapping city with correct street-side routes", () => {
    const initial = createInitialSimulation();

    expect(initial.objects).toHaveLength(SCENE_OBJECT_COUNT);
    expect(initial.remaining).toBe(GAME_DURATION_SECONDS);
    expect(initial.remaining).toBe(180);
    expect(initial.objects.every((object) => object.prefabId.length > 0)).toBe(true);
    expect(initial.objects.every((object) => object.value > 0)).toBe(true);
    expect(
      initial.objects
        .filter(
          (object) =>
            object.prefabId.startsWith("building-") || object.prefabId.startsWith("commercial-"),
        )
        .every((object) => object.value <= 50),
    ).toBe(true);
    expect(
      initial.objects
        .filter(
          (object) =>
            !object.prefabId.startsWith("building-") && !object.prefabId.startsWith("commercial-"),
        )
        .every((object) => object.value <= 30),
    ).toBe(true);
    expect(initial.objects.every((object) => object.centerY >= object.height / 2)).toBe(true);
    const missingPrefabs = PREFAB_DEFINITIONS.filter(
      (definition) => !initial.objects.some((object) => object.prefabId === definition.id),
    ).map((definition) => definition.id);
    expect(missingPrefabs).toEqual([]);
    expectNoFootprintOverlap(initial.objects);
    expect(
      initial.objects.filter(
        (object) =>
          object.prefabId.startsWith("building-") || object.prefabId.startsWith("commercial-"),
      ),
    ).toHaveLength(985);
    expect(
      initial.objects.filter((object) => object.prefabId.startsWith("character-")),
    ).toHaveLength(2_772);
    expect(initial.objects.filter((object) => object.motion?.speed === VEHICLE_SPEED)).toHaveLength(
      264,
    );
    expect(
      initial.objects.filter((object) => object.motion?.speed === PEDESTRIAN_SPEED),
    ).toHaveLength(396);
    expect(initial.objects.filter((object) => object.motion?.kind === "vehicle")).toHaveLength(264);
    expect(initial.objects.filter((object) => object.motion?.kind === "pedestrian")).toHaveLength(
      396,
    );
    expect(initial.objects.filter((object) => object.prefabId === "planter")).toHaveLength(1_600);
    expect(initial.objects.filter((object) => object.prefabId === "crate")).toHaveLength(1_600);
    expect(
      initial.objects.filter((object) => object.prefabId.startsWith("debris-plate")),
    ).toHaveLength(1_600);
    const towerGroups = new Map<string, WorldObjectState[]>();
    initial.objects
      .filter(
        (object) =>
          object.prefabId.startsWith("building-") || object.prefabId.startsWith("commercial-"),
      )
      .forEach((building) => {
        const key = `${building.position.x}:${building.position.y}:${building.prefabId}`;
        const group = towerGroups.get(key) ?? [];
        group.push(building);
        towerGroups.set(key, group);
      });
    const towers = [...towerGroups.values()].filter((group) => group.length === 10);
    expect(towers).toHaveLength(9);
    expect(
      new Set(towers.flatMap((tower) => tower.map((building) => building.prefabId))).size,
    ).toBeGreaterThan(1);
    towers.forEach((tower) => {
      const ordered = [...tower].sort((left, right) => left.centerY - right.centerY);
      ordered.forEach((building, layer) => {
        expect(building.value).toBe(50);
        expect(building.centerY).toBeCloseTo(building.height * (layer + 0.5));
      });
    });

    const sidewalkCenterOffset = ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2;
    for (const pedestrian of initial.objects.filter((object) =>
      object.prefabId.startsWith("character-"),
    )) {
      const motion = pedestrian.motion;
      if (!motion) {
        const onVerticalSidewalk = ROAD_CENTERS.some(
          (center) =>
            Math.abs(Math.abs(pedestrian.position.x - center) - sidewalkCenterOffset) < 0.001,
        );
        const onHorizontalSidewalk = ROAD_CENTERS.some(
          (center) =>
            Math.abs(Math.abs(pedestrian.position.y - center) - sidewalkCenterOffset) < 0.001,
        );
        expect(onVerticalSidewalk || onHorizontalSidewalk).toBe(true);
        continue;
      }
      const fixedCoordinate = motion.axis === "y" ? pedestrian.position.x : pedestrian.position.y;
      expect(
        ROAD_CENTERS.some(
          (center) => Math.abs(Math.abs(fixedCoordinate - center) - sidewalkCenterOffset) < 0.001,
        ),
      ).toBe(true);
      expect(yawFromRotation(pedestrian)).toBeCloseTo(
        expectedCharacterYaw(motion.axis, motion.direction),
      );
      expect(pedestrian.position[motion.axis]).toBeGreaterThanOrEqual(motion.minimum);
      expect(pedestrian.position[motion.axis]).toBeLessThanOrEqual(motion.maximum);
    }
  });

  it("keeps bots within authoritative map bounds and lets them score in the real city simulation", () => {
    let state = createInitialSimulation();
    for (let frame = 0; frame < 480; frame += 1) {
      state = stepSimulation(state, [], 1 / 60).state;
      state.holes
        .filter((hole) => hole.kind === "bot")
        .forEach((bot) => {
          const limit = MAP_HALF_SIZE - bot.radius;
          expect(Number.isFinite(bot.position.x)).toBe(true);
          expect(Number.isFinite(bot.position.y)).toBe(true);
          expect(Math.abs(bot.position.x)).toBeLessThanOrEqual(limit);
          expect(Math.abs(bot.position.y)).toBeLessThanOrEqual(limit);
        });
    }
    expect(state.holes.filter((hole) => hole.kind === "bot").every((bot) => bot.score > 0)).toBe(
      true,
    );
  }, 45_000);

  it("spawns every competitor deterministically without overlap", () => {
    const first = createInitialSimulation(0x44aa55cc);
    const second = createInitialSimulation(0x44aa55cc);
    expect(first.holes.map((hole) => hole.position)).toEqual(
      second.holes.map((hole) => hole.position),
    );
    for (let leftIndex = 0; leftIndex < first.holes.length; leftIndex += 1) {
      const left = first.holes[leftIndex];
      if (!left) {
        continue;
      }
      for (let rightIndex = leftIndex + 1; rightIndex < first.holes.length; rightIndex += 1) {
        const right = first.holes[rightIndex];
        if (!right) {
          continue;
        }
        expect(
          Math.hypot(left.position.x - right.position.x, left.position.y - right.position.y),
        ).toBeGreaterThan(left.radius + right.radius);
      }
    }
  });

  it("spawns every hole clear of every initial map object", () => {
    const first = createInitialSimulation(0x5eed1234, 0x10203040);
    const second = createInitialSimulation(0x5eed1234, 0x50607080);
    expect(first.holes.map((hole) => hole.position)).not.toEqual(
      second.holes.map((hole) => hole.position),
    );
    first.holes.forEach((hole) => {
      first.objects.forEach((object) => {
        const objectRadius = Math.hypot(object.size.x, object.size.y) / 2;
        expect(
          Math.hypot(hole.position.x - object.position.x, hole.position.y - object.position.y),
        ).toBeGreaterThanOrEqual(hole.radius + objectRadius);
      });
    });
  });

  it("keeps bot positions inside the map throughout a full match", () => {
    let state: SimulationState = { ...createInitialSimulation(), objects: [] };
    for (let frame = 0; frame < GAME_DURATION_SECONDS * 60; frame += 1) {
      state = stepSimulation(state, [], 1 / 60).state;
      state.holes
        .filter((hole) => hole.kind === "bot")
        .forEach((bot) => {
          const limit = MAP_HALF_SIZE - bot.radius;
          expect(Math.abs(bot.position.x)).toBeLessThanOrEqual(limit);
          expect(Math.abs(bot.position.y)).toBeLessThanOrEqual(limit);
        });
    }
  }, 20_000);

  it("returns a non-consumed routed object to its original lane and heading", () => {
    const initial = createInitialSimulation();
    const vehicle = initial.objects.find(
      (object) =>
        object.motion?.kind === "vehicle" &&
        object.motion.axis === "y" &&
        object.motion.direction === 1,
    );
    if (!vehicle || !vehicle.motion) {
      throw new Error("Vertical vehicle route is required");
    }
    let state: SimulationState = {
      ...initial,
      holes: [],
      objects: [{ ...vehicle, status: "active", motion: null, claimedBy: "player" }],
    };
    for (let frame = 0; frame < 180; frame += 1) {
      state = stepSimulation(state, [], 1 / 60).state;
    }
    const resumed = state.objects[0];
    if (!resumed || !resumed.motion) {
      throw new Error("Vehicle route was not restored");
    }
    expect(resumed.status).toBe("static");
    expect(resumed.position.x).toBeCloseTo(resumed.motion.lateralCoordinate);
    expect(yawFromRotation(resumed)).toBeCloseTo(resumed.motion.headingYaw);
    const afterRouteStep = stepSimulation(state, [], 0.1).state.objects[0];
    expect(afterRouteStep?.position.y).toBeGreaterThan(resumed.position.y);
  });

  it("keeps vehicle lanes collision-free for a full signal cycle and does not halt for a distant hole", () => {
    const initial = createInitialSimulation();
    const vehicle = initial.objects.find((object) => object.motion?.kind === "vehicle");
    const player = initial.holes[0];
    if (!vehicle || !vehicle.motion || !player) {
      throw new Error("Initial vehicle and player are required");
    }
    const distantHoleResult = stepSimulation(
      {
        ...initial,
        holes: [{ ...player, position: { x: 120, y: 120 } }],
        objects: [vehicle],
      },
      [],
      0.1,
    );
    const movedVehicle = distantHoleResult.state.objects[0];
    if (!movedVehicle) {
      throw new Error("Moved vehicle is required");
    }
    expect(movedVehicle.position[vehicle.motion.axis]).toBeCloseTo(
      vehicle.position[vehicle.motion.axis] + vehicle.motion.direction * VEHICLE_SPEED * 0.1,
    );

    let state: SimulationState = { ...initial, holes: [] };
    for (let frame = 0; frame < 4_000; frame += 1) {
      state = stepSimulation(state, [], 1 / 60).state;
      if (frame % 60 === 0) {
        expectNoFootprintOverlap(state.objects);
      }
    }
  }, 45_000);

  it("lets a route vehicle continue through a hole that cannot fully contain it", () => {
    const initial = createInitialSimulation();
    const vehicle = initial.objects.find((object) => object.motion?.kind === "vehicle");
    const player = initial.holes[0];
    if (!vehicle || !vehicle.motion || !player) {
      throw new Error("Initial vehicle and player are required");
    }
    const result = stepSimulation(
      {
        ...initial,
        holes: [{ ...player, position: { ...vehicle.position } }],
        objects: [vehicle],
      },
      [],
      0.1,
    );
    const movedVehicle = result.state.objects[0];
    if (!movedVehicle) {
      throw new Error("Moved vehicle is required");
    }
    expect(movedVehicle.status).toBe("static");
    expect(movedVehicle.position[vehicle.motion.axis]).toBeCloseTo(
      vehicle.position[vehicle.motion.axis] + vehicle.motion.direction * VEHICLE_SPEED * 0.1,
    );
  });

  it("activates a fully covered route vehicle for the physical fall", () => {
    const initial = createInitialSimulation();
    const vehicle = initial.objects.find((object) => object.motion?.kind === "vehicle");
    const player = initial.holes[0];
    if (!vehicle || !player) {
      throw new Error("Initial vehicle and player are required");
    }
    const result = stepSimulation(
      {
        ...initial,
        holes: [{ ...player, radius: 4, position: { ...vehicle.position } }],
        objects: [vehicle],
      },
      [],
      0.1,
    );
    expect(result.state.objects[0]?.status).toBe("active");
  });

  it("activates every vehicle prefab when a hole fully covers it", () => {
    const initial = createInitialSimulation();
    const player = initial.holes[0];
    if (!player) {
      throw new Error("Player is required");
    }
    const vehicles = [
      ...new Map(
        initial.objects
          .filter((object) => object.motion?.kind === "vehicle")
          .map((object) => [object.prefabId, object]),
      ).values(),
    ];
    expect(vehicles).toHaveLength(11);

    vehicles.forEach((vehicle) => {
      const result = stepSimulation(
        {
          ...initial,
          holes: [{ ...player, radius: 4, position: { ...vehicle.position } }],
          objects: [vehicle],
        },
        [],
        1 / 60,
      );
      expect(result.state.objects[0]?.status).toBe("active");
    });
  });

  it("allows a fully enclosed larger hole to consume and respawn a smaller hole", () => {
    const initial = createInitialSimulation();
    const player = initial.holes[0];
    const bot = initial.holes[1];
    if (!player || !bot) {
      throw new Error("Player and bot are required");
    }
    const result = stepSimulation(
      {
        ...initial,
        holes: [
          { ...player, position: { x: 0, y: 0 }, radius: 4, score: 40 },
          { ...bot, position: { x: 1, y: 0 }, radius: 1.15, score: 20 },
        ],
        objects: [],
      },
      [],
      1 / 60,
    );
    const winner = result.state.holes.find((hole) => hole.id === "player");
    const respawnedBot = result.state.holes.find((hole) => hole.id === "bot-1");
    expect(winner?.score).toBeGreaterThan(40);
    expect(respawnedBot?.score).toBe(20);
    expect(respawnedBot?.radius).toBeCloseTo(1.978571);
    expect(respawnedBot?.eliminationRemaining).toBeGreaterThan(0);
    expect(respawnedBot?.eliminations).toBe(1);
    expect(respawnedBot?.revivesRemaining).toBe(0);
  });

  it("requires the entire smaller hole to be covered before a capture", () => {
    const initial = createInitialSimulation();
    const player = initial.holes[0];
    const bot = initial.holes[1];
    if (!player || !bot) {
      throw new Error("Player and bot are required");
    }
    const result = stepSimulation(
      {
        ...initial,
        holes: [
          { ...player, position: { x: 0, y: 0 }, radius: 4, score: 40 },
          { ...bot, position: { x: 3, y: 0 }, radius: INITIAL_HOLE_RADIUS },
        ],
        objects: [],
      },
      [],
      1 / 60,
    );
    const unresolvedBot = result.state.holes.find((hole) => hole.id === "bot-1");
    expect(unresolvedBot?.eliminations).toBe(0);
    expect(unresolvedBot?.eliminationRemaining).toBe(0);
  });

  it("respawns once with five seconds of immunity and ends the match on a second human defeat", () => {
    const initial = createInitialSimulation();
    const player = initial.holes[0];
    const bot = initial.holes[1];
    if (!player || !bot) {
      throw new Error("Player and bot are required");
    }
    const firstDefeat = stepSimulation(
      {
        ...initial,
        holes: [
          { ...player, position: { x: 0, y: 0 }, radius: INITIAL_HOLE_RADIUS },
          { ...bot, position: { x: 0, y: 0 }, radius: 4, score: 40 },
        ],
        objects: [],
      },
      [],
      1 / 60,
    ).state;
    const eliminatedPlayer = firstDefeat.holes.find((hole) => hole.id === "player");
    expect(eliminatedPlayer?.eliminationRemaining).toBeGreaterThan(0);

    const respawned = advance(firstDefeat, 120);
    const revivedPlayer = respawned.holes.find((hole) => hole.id === "player");
    const revivedBot = respawned.holes.find((hole) => hole.id === "bot-1");
    if (!revivedPlayer || !revivedBot) {
      throw new Error("Respawned players are required");
    }
    expect(revivedPlayer.eliminationRemaining).toBe(0);
    expect(revivedPlayer.invulnerabilityRemaining).toBeGreaterThan(4.7);
    expect(
      Math.hypot(
        revivedPlayer.position.x - revivedBot.position.x,
        revivedPlayer.position.y - revivedBot.position.y,
      ),
    ).toBeGreaterThan(revivedPlayer.radius + revivedBot.radius);

    const immuneResult = stepSimulation(
      {
        ...respawned,
        holes: [
          { ...revivedPlayer, position: { x: 0, y: 0 } },
          { ...revivedBot, position: { x: 0, y: 0 }, radius: 4, score: 40 },
        ],
        objects: [],
      },
      [],
      1 / 60,
    ).state;
    expect(immuneResult.holes.find((hole) => hole.id === "player")?.isOut).toBe(false);

    const finalResult = stepSimulation(
      {
        ...respawned,
        holes: [
          {
            ...revivedPlayer,
            position: { x: 0, y: 0 },
            invulnerabilityRemaining: 0,
            revivesRemaining: 0,
          },
          { ...revivedBot, position: { x: 0, y: 0 }, radius: 4, score: 40 },
        ],
        objects: [],
      },
      [],
      1 / 60,
    ).state;
    expect(finalResult.status).toBe("finished");
    expect(finalResult.holes.find((hole) => hole.id === "player")?.isOut).toBe(true);
  });
});
