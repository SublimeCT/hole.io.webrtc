import {
  BOT_COUNT,
  GAME_DURATION_SECONDS,
  INITIAL_HOLE_RADIUS,
  MAP_HALF_SIZE,
  PEDESTRIAN_SPEED,
  ROAD_CENTERS,
  SCENE_OBJECT_COUNT,
  SIDEWALK_WIDTH,
  VEHICLE_SPEED,
} from "./constants";
import { getPrefabDefinition } from "./prefabs";
import type {
  HoleState,
  Quaternion,
  RouteMotion,
  SimulationState,
  Vector2,
  WorldObjectState,
} from "./types";

const VEHICLE_PREFABS = [
  "sedan",
  "hatchback",
  "suv",
  "taxi",
  "police",
  "van",
  "delivery",
  "truck",
  "ambulance",
  "firetruck",
  "garbage-truck",
] as const;
const BUILDING_PREFABS = [
  "building-a",
  "building-b",
  "building-c",
  "building-d",
  "building-e",
  "building-f",
  "building-g",
  "building-h",
  "building-i",
  "building-j",
  "building-k",
  "building-l",
  "building-m",
  "building-n",
  "building-o",
  "building-p",
  "building-q",
  "building-r",
  "building-s",
  "building-t",
  "building-u",
] as const;
const COMMERCIAL_LANDMARK_PREFABS = [
  "commercial-building-a",
  "commercial-building-b",
  "commercial-building-c",
  "commercial-building-d",
  "commercial-building-e",
  "commercial-building-f",
  "commercial-building-g",
  "commercial-building-h",
  "commercial-skyscraper-a",
  "commercial-skyscraper-b",
  "commercial-skyscraper-c",
  "commercial-skyscraper-d",
] as const;
const COMMERCIAL_SHOP_PREFABS = [
  "commercial-low-a",
  "commercial-low-b",
  "commercial-low-c",
  "commercial-low-d",
  "commercial-low-e",
  "commercial-low-f",
  "commercial-low-g",
  "commercial-low-h",
] as const;
const ROUTE_LIMIT = MAP_HALF_SIZE - 8;
const SIDEWALK_CENTER_OFFSET = 3.5 + SIDEWALK_WIDTH / 2;
const ROAD_AND_SIDEWALK_HALF_WIDTH = 3.5 + SIDEWALK_WIDTH;
const SMALL_PROP_MULTIPLIER = 5;
const OCCUPANCY_CELL_SIZE = 12;

interface LandInterval {
  minimum: number;
  maximum: number;
  center: number;
  size: number;
}

interface OccupiedFootprint {
  id: string;
  position: Vector2;
  radius: number;
}

function rotationFromYaw(yaw: number): Quaternion {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

function fitDiameterFor(size: Vector2, height: number, shape: WorldObjectState["shape"]): number {
  if (shape === "sphere" || shape === "cylinder") {
    return Math.max(size.x, size.y);
  }
  const dimensions = [size.x, size.y, height].sort((left, right) => left - right);
  return Math.hypot(dimensions[0] ?? 0, dimensions[1] ?? 0);
}

function scoreFor(prefabId: string, size: Vector2, stackLayers: number): number {
  const contactArea = size.x * size.y;
  const buildingMultiplier =
    prefabId.startsWith("building-") || prefabId.startsWith("commercial-") ? 8 : 1;
  const cap = buildingMultiplier === 8 ? 50 : 30;
  return Math.min(cap, Math.max(1, Math.round(contactArea * 4) * buildingMultiplier * stackLayers));
}

function createObject(
  index: number,
  prefabId: string,
  position: Vector2,
  yaw = 0,
  motion: RouteMotion | null = null,
  stackLayers = 1,
): WorldObjectState {
  const prefab = getPrefabDefinition(prefabId);
  const height = prefab.height * stackLayers;
  return {
    id: `object-${index + 1}`,
    prefabId,
    shape: prefab.shape,
    position,
    centerY: height / 2,
    size: prefab.size,
    height,
    stackLayers,
    fitDiameter: fitDiameterFor(prefab.size, height, prefab.shape),
    value: scoreFor(prefabId, prefab.size, stackLayers),
    status: "static",
    velocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    rotation: rotationFromYaw(yaw),
    activeTime: 0,
    claimedBy: null,
    motion,
    routeMotion: motion,
  };
}

function route(
  kind: RouteMotion["kind"],
  laneId: string,
  axis: RouteMotion["axis"],
  direction: -1 | 1,
  speed: number,
  lateralCoordinate: number,
  headingYaw: number,
  minimum = -ROUTE_LIMIT,
  maximum = ROUTE_LIMIT,
): RouteMotion {
  return {
    kind,
    laneId,
    axis,
    direction,
    speed,
    lateralCoordinate,
    headingYaw,
    minimum,
    maximum,
  };
}

function footprintRadius(prefabId: string): number {
  const prefab = getPrefabDefinition(prefabId);
  return Math.hypot(prefab.size.x, prefab.size.y) / 2;
}

function occupancyCellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function occupancyCellRange(
  position: Vector2,
  radius: number,
): readonly [number, number, number, number] {
  return [
    Math.floor((position.x - radius) / OCCUPANCY_CELL_SIZE),
    Math.floor((position.x + radius) / OCCUPANCY_CELL_SIZE),
    Math.floor((position.y - radius) / OCCUPANCY_CELL_SIZE),
    Math.floor((position.y + radius) / OCCUPANCY_CELL_SIZE),
  ];
}

function createLandIntervals(): readonly LandInterval[] {
  const edges = [-MAP_HALF_SIZE];
  for (const center of ROAD_CENTERS) {
    edges.push(center - ROAD_AND_SIDEWALK_HALF_WIDTH, center + ROAD_AND_SIDEWALK_HALF_WIDTH);
  }
  edges.push(MAP_HALF_SIZE);

  const intervals: LandInterval[] = [];
  for (let index = 0; index < edges.length - 1; index += 2) {
    const minimum = edges[index];
    const maximum = edges[index + 1];
    if (minimum === undefined || maximum === undefined) {
      continue;
    }
    intervals.push({ minimum, maximum, center: (minimum + maximum) / 2, size: maximum - minimum });
  }
  return intervals;
}

function addLargeBlock(
  add: (prefabId: string, position: Vector2, yaw?: number) => void,
  canPlace: (prefabId: string, position: Vector2) => boolean,
  centerX: number,
  centerY: number,
  blockIndex: number,
  includeCentralBuilding: boolean,
): void {
  const layout = blockIndex % 6;
  const landmarks = [
    [-11.5, -11.5],
    [-11.5, 11.5],
    [11.5, -11.5],
    [11.5, 11.5],
  ] as const;
  const shops = [
    [0, -7],
    [7, 0],
    [0, 7],
    [-7, 0],
  ] as const;
  landmarks.forEach(([offsetX, offsetY], localIndex) => {
    add(
      COMMERCIAL_LANDMARK_PREFABS[
        (blockIndex * 4 + localIndex) % COMMERCIAL_LANDMARK_PREFABS.length
      ] ?? "commercial-building-a",
      { x: centerX + offsetX, y: centerY + offsetY },
    );
  });

  shops.forEach(([offsetX, offsetY], shopIndex) => {
    const prefabId =
      COMMERCIAL_SHOP_PREFABS[(blockIndex * 4 + shopIndex) % COMMERCIAL_SHOP_PREFABS.length] ??
      "commercial-low-a";
    const position = { x: centerX + offsetX, y: centerY + offsetY };
    if (canPlace(prefabId, position)) {
      add(prefabId, position);
    }
  });

  if (includeCentralBuilding) {
    const prefabId =
      COMMERCIAL_SHOP_PREFABS[(blockIndex * 5 + 3) % COMMERCIAL_SHOP_PREFABS.length] ??
      "commercial-low-a";
    const center = { x: centerX, y: centerY };
    if (canPlace(prefabId, center)) {
      add(prefabId, center);
    }
    return;
  }

  const landscapeByLayout = [
    [
      [0, -14],
      [14, 0],
      [0, 14],
      [-14, 0],
    ],
    [
      [0, -14],
      [0, 14],
      [-14, 0],
      [14, 0],
    ],
    [
      [-14, -14],
      [14, 14],
      [-14, 14],
      [14, -14],
    ],
    [
      [0, -14],
      [-14, 0],
      [14, 0],
      [0, 14],
    ],
    [
      [-14, -14],
      [-14, 14],
      [14, -14],
      [14, 14],
    ],
    [
      [0, -14],
      [-14, 0],
      [0, 14],
      [14, 0],
    ],
  ] as const;
  const landscape = landscapeByLayout[layout];
  if (!landscape) {
    throw new Error(`Missing city block layout: ${layout}`);
  }
  landscape.forEach(([offsetX, offsetY]) => {
    const position = { x: centerX + offsetX, y: centerY + offsetY };
    if (canPlace("tree-small", position)) {
      add("tree-small", position);
    }
  });
  const featurePrefabs = [
    "tree-large",
    "fence",
    "fence-low",
    "cone",
    "cone-flat",
    "debris-tire",
    "debris-bumper",
  ] as const;
  const featurePositions = [
    [-14, -3],
    [-14, 3],
    [14, -3],
    [14, 3],
    [-3, -14],
    [3, -14],
    [0, 14],
  ] as const;
  const featurePrefab = featurePrefabs[layout];
  const featurePosition = featurePositions[layout];
  if (featurePrefab && featurePosition) {
    const position = { x: centerX + featurePosition[0], y: centerY + featurePosition[1] };
    if (canPlace(featurePrefab, position)) {
      add(featurePrefab, position, featurePrefab.startsWith("fence") ? Math.PI / 2 : 0);
    }
  }

  const candidates: Vector2[] = [];
  const phase = (blockIndex % 7) * 0.11;
  for (let offsetY = -15; offsetY <= 15; offsetY += 1.72) {
    for (let offsetX = -15; offsetX <= 15; offsetX += 1.72) {
      candidates.push({ x: centerX + offsetX + phase, y: centerY + offsetY - phase });
    }
  }
  const smallPrefabs = [
    "planter",
    "crate",
    blockIndex % 2 === 0 ? "debris-plate" : "debris-plate-small",
    "cone",
    "cone-flat",
    "debris-tire",
    "debris-bumper",
  ] as const;
  for (const prefabId of smallPrefabs) {
    let placed = 0;
    for (const position of candidates) {
      if (placed === 4 * SMALL_PROP_MULTIPLIER) {
        break;
      }
      if (canPlace(prefabId, position)) {
        add(prefabId, position, prefabId === "crate" ? blockIndex * 0.23 : 0);
        placed += 1;
      }
    }
  }
}

function addNarrowBlock(
  add: (prefabId: string, position: Vector2, yaw?: number) => void,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  blockIndex: number,
): void {
  const tall = height >= width;
  const longOffset = Math.max(0, Math.max(width, height) / 2 - 7.2);
  const first = tall
    ? { x: centerX, y: centerY - longOffset }
    : { x: centerX - longOffset, y: centerY };
  const second = tall
    ? { x: centerX, y: centerY + longOffset }
    : { x: centerX + longOffset, y: centerY };
  add(BUILDING_PREFABS[blockIndex % BUILDING_PREFABS.length] ?? "building-a", first);
  if (longOffset >= 7) {
    add(BUILDING_PREFABS[(blockIndex + 1) % BUILDING_PREFABS.length] ?? "building-b", second);
  }
  if (Math.min(width, height) >= 16 && longOffset >= 7) {
    const treeOffset = Math.min(width, height) / 2 - 2;
    add(
      "tree-small",
      tall ? { x: centerX - treeOffset, y: centerY } : { x: centerX, y: centerY - treeOffset },
    );
    add(
      "tree-small",
      tall ? { x: centerX + treeOffset, y: centerY } : { x: centerX, y: centerY + treeOffset },
    );
  }
}

function nextRandom(state: number): readonly [number, number] {
  let next = state >>> 0;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  return [(next >>> 0) / 4_294_967_296, next >>> 0];
}

function buildCityObjects(seed: number): readonly WorldObjectState[] {
  const objects: WorldObjectState[] = [];
  const occupiedCells = new Map<string, OccupiedFootprint[]>();
  const canPlace = (prefabId: string, position: Vector2, throwOnOverlap = false): boolean => {
    const radius = footprintRadius(prefabId);
    const [minimumX, maximumX, minimumY, maximumY] = occupancyCellRange(position, radius);
    const checked = new Set<string>();
    for (let cellY = minimumY; cellY <= maximumY; cellY += 1) {
      for (let cellX = minimumX; cellX <= maximumX; cellX += 1) {
        const candidates = occupiedCells.get(occupancyCellKey(cellX, cellY));
        if (!candidates) {
          continue;
        }
        for (const candidate of candidates) {
          if (checked.has(candidate.id)) {
            continue;
          }
          checked.add(candidate.id);
          if (
            Math.hypot(candidate.position.x - position.x, candidate.position.y - position.y) <
            candidate.radius + radius + 0.04
          ) {
            if (throwOnOverlap) {
              throw new Error(
                `City placement overlap: ${prefabId} at ${position.x},${position.y} with ${candidate.id} at ${candidate.position.x},${candidate.position.y}`,
              );
            }
            return false;
          }
        }
      }
    }
    return true;
  };
  const add = (
    prefabId: string,
    position: Vector2,
    yaw = 0,
    motion: RouteMotion | null = null,
  ): void => {
    const radius = footprintRadius(prefabId);
    if (!motion && !prefabId.startsWith("character-")) {
      if (!canPlace(prefabId, position, true)) {
        throw new Error(`City placement overlap: ${prefabId} at ${position.x},${position.y}`);
      }
      const footprint = { id: `${prefabId}-${objects.length}`, position, radius };
      const [minimumX, maximumX, minimumY, maximumY] = occupancyCellRange(position, radius);
      for (let cellY = minimumY; cellY <= maximumY; cellY += 1) {
        for (let cellX = minimumX; cellX <= maximumX; cellX += 1) {
          const key = occupancyCellKey(cellX, cellY);
          const cell = occupiedCells.get(key) ?? [];
          cell.push(footprint);
          occupiedCells.set(key, cell);
        }
      }
    }
    objects.push(createObject(objects.length, prefabId, position, yaw, motion));
  };

  const landIntervals = createLandIntervals();
  let blockIndex = 0;
  let centralBuildingBlocks = 0;
  for (const blockX of landIntervals) {
    for (const blockY of landIntervals) {
      if (blockX.size >= 30 && blockY.size >= 30) {
        const includeCentralBuilding = centralBuildingBlocks < 20;
        centralBuildingBlocks += 1;
        addLargeBlock(
          add,
          canPlace,
          blockX.center,
          blockY.center,
          blockIndex,
          includeCentralBuilding,
        );
      } else {
        addNarrowBlock(add, blockX.center, blockY.center, blockX.size, blockY.size, blockIndex);
      }
      blockIndex += 1;
    }
  }

  const vehicleSlots = [-230, -142, -54, 34, 122, 210] as const;
  let vehicleIndex = 0;
  ROAD_CENTERS.forEach((roadCenter, roadIndex) => {
    for (const slot of vehicleSlots) {
      for (const laneOffset of [-1.75, 1.75] as const) {
        const direction: -1 | 1 = laneOffset < 0 ? 1 : -1;
        add(
          VEHICLE_PREFABS[vehicleIndex % VEHICLE_PREFABS.length] ?? "sedan",
          { x: roadCenter + laneOffset, y: slot },
          direction > 0 ? 0 : Math.PI,
          route(
            "vehicle",
            `v-${roadIndex}-${laneOffset}`,
            "y",
            direction,
            VEHICLE_SPEED,
            roadCenter + laneOffset,
            direction > 0 ? 0 : Math.PI,
          ),
        );
        vehicleIndex += 1;
      }
    }
  });
  ROAD_CENTERS.forEach((roadCenter, roadIndex) => {
    for (const slot of vehicleSlots) {
      for (const laneOffset of [-1.75, 1.75] as const) {
        const direction: -1 | 1 = laneOffset < 0 ? -1 : 1;
        add(
          VEHICLE_PREFABS[vehicleIndex % VEHICLE_PREFABS.length] ?? "sedan",
          { x: slot, y: roadCenter + laneOffset },
          direction > 0 ? Math.PI / 2 : -Math.PI / 2,
          route(
            "vehicle",
            `h-${roadIndex}-${laneOffset}`,
            "x",
            direction,
            VEHICLE_SPEED,
            roadCenter + laneOffset,
            direction > 0 ? Math.PI / 2 : -Math.PI / 2,
          ),
        );
        vehicleIndex += 1;
      }
    }
  });

  let characterIndex = 0;
  const nextCharacter = (): string => {
    const suffix = String.fromCharCode(97 + (characterIndex % 18));
    characterIndex += 1;
    return `character-${suffix}`;
  };
  const addSidewalkCharacters = (
    axis: RouteMotion["axis"],
    roadCenter: number,
    roadIndex: number,
    interval: LandInterval,
    intervalIndex: number,
  ): void => {
    const hasMovingCharacter = (roadIndex + intervalIndex) % 2 === 0;
    const movingSide: -1 | 1 = (roadIndex + intervalIndex) % 2 === 0 ? -1 : 1;
    for (const side of [-1, 1] as const) {
      const direction: -1 | 1 = (roadIndex + intervalIndex + side) % 2 === 0 ? 1 : -1;
      const fixed = roadCenter + side * SIDEWALK_CENTER_OFFSET;
      const yaw =
        axis === "y" ? (direction > 0 ? 0 : Math.PI) : direction > 0 ? Math.PI / 2 : -Math.PI / 2;
      const point = (along: number): Vector2 =>
        axis === "y" ? { x: fixed, y: along } : { x: along, y: fixed };
      if (hasMovingCharacter && side === movingSide) {
        const minimum = interval.minimum + 1.5;
        const maximum = interval.maximum - 1.5;
        for (let walker = 0; walker < 3; walker += 1) {
          const progress = (walker + 0.5) / 3;
          const start = minimum + (maximum - minimum) * progress;
          add(
            nextCharacter(),
            point(start),
            yaw,
            route(
              "pedestrian",
              `${axis}-walk-${roadIndex}-${intervalIndex}-${side}-${walker}`,
              axis,
              direction,
              PEDESTRIAN_SPEED,
              fixed,
              yaw,
              minimum,
              maximum,
            ),
          );
        }
      } else {
        for (const progress of [0.12, 0.27, 0.42, 0.58, 0.73, 0.88]) {
          add(nextCharacter(), point(interval.minimum + interval.size * progress), yaw);
        }
      }
    }
  };

  ROAD_CENTERS.forEach((roadCenter, roadIndex) => {
    landIntervals.forEach((interval, intervalIndex) => {
      addSidewalkCharacters("y", roadCenter, roadIndex, interval, intervalIndex);
      addSidewalkCharacters("x", roadCenter, roadIndex, interval, intervalIndex);
    });
  });

  const buildingIndices = objects
    .map((object, index) => ({ object, index }))
    .filter(
      ({ object }) =>
        object.prefabId.startsWith("building-") || object.prefabId.startsWith("commercial-"),
    );
  let stackRng = seed >>> 0;
  const stackCount = (BOT_COUNT + 1) * 3;
  for (let selection = 0; selection < stackCount; selection += 1) {
    const [random, nextState] = nextRandom(stackRng);
    stackRng = nextState;
    const candidateIndex = selection + Math.floor(random * (buildingIndices.length - selection));
    const selected = buildingIndices[candidateIndex];
    if (!selected) {
      continue;
    }
    const displaced = buildingIndices[selection];
    buildingIndices[selection] = selected;
    if (displaced) {
      buildingIndices[candidateIndex] = displaced;
    }
    const object = objects[selected.index];
    if (!object) {
      continue;
    }
    const yaw = Math.atan2(
      2 * (object.rotation.w * object.rotation.y + object.rotation.x * object.rotation.z),
      1 - 2 * (object.rotation.y * object.rotation.y + object.rotation.z * object.rotation.z),
    );
    objects[selected.index] = createObject(
      selected.index,
      object.prefabId,
      object.position,
      yaw,
      object.motion,
    );
    for (let layer = 1; layer < 10; layer += 1) {
      const tier = createObject(
        objects.length,
        object.prefabId,
        object.position,
        yaw,
        object.motion,
      );
      objects.push({
        ...tier,
        centerY: object.height * (layer + 0.5),
      });
    }
  }

  if (objects.length !== SCENE_OBJECT_COUNT) {
    throw new Error(`Expected ${SCENE_OBJECT_COUNT} city objects, received ${objects.length}`);
  }
  return objects;
}

function createHoles(seed: number): readonly [readonly HoleState[], number] {
  const holes: HoleState[] = [];
  let rngState = seed >>> 0;
  const spawnLimit = MAP_HALF_SIZE - 30;
  for (let index = 0; index <= BOT_COUNT; index += 1) {
    let position: Vector2 | null = null;
    for (let attempt = 0; attempt < 96; attempt += 1) {
      const [randomX, stateAfterX] = nextRandom(rngState);
      const [randomY, stateAfterY] = nextRandom(stateAfterX);
      rngState = stateAfterY;
      const candidate = {
        x: (randomX * 2 - 1) * spawnLimit,
        y: (randomY * 2 - 1) * spawnLimit,
      };
      if (
        holes.every(
          (hole) =>
            Math.hypot(hole.position.x - candidate.x, hole.position.y - candidate.y) >=
            hole.radius + INITIAL_HOLE_RADIUS + 12,
        )
      ) {
        position = candidate;
        break;
      }
    }
    if (!position) {
      throw new Error("Unable to find a non-overlapping initial hole spawn");
    }
    holes.push({
      id: index === 0 ? "player" : `bot-${index}`,
      kind: index === 0 ? "human" : "bot",
      position,
      radius: INITIAL_HOLE_RADIUS,
      score: 0,
      eliminationRemaining: 0,
      eliminations: 0,
      revivesRemaining: 1,
      invulnerabilityRemaining: 0,
      isOut: false,
      bot:
        index === 0
          ? null
          : {
              mode: "wander",
              targetObjectId: null,
              targetScore: 0,
              commitRemaining: 0,
              sectorIndex: index,
              wanderAngle: index * Math.PI,
              rethinkIn: 0,
            },
    });
  }
  return [holes, rngState];
}

export function createInitialSimulation(seed = 0x5eed1234): SimulationState {
  const [holes, rngState] = createHoles(seed);
  return {
    elapsed: 0,
    remaining: GAME_DURATION_SECONDS,
    status: "playing",
    holes,
    objects: buildCityObjects(seed),
    rngState,
  };
}
