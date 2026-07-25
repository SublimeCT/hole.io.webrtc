import {
  BOT_COUNT,
  CITY_BLOCK_COLUMNS,
  CITY_BLOCK_ROWS,
  CITY_BLOCK_SIZE,
  CITY_CHARACTER_COUNT,
  CITY_MOVING_CHARACTER_COUNT,
  CITY_SMALL_OBJECT_COUNTS,
  CITY_VEHICLE_COUNT,
  GAME_DURATION_SECONDS,
  INITIAL_HOLE_RADIUS,
  MAP_HALF_HEIGHT,
  MAP_HALF_WIDTH,
  PEDESTRIAN_SPEED,
  ROAD_X_CENTERS,
  ROAD_Y_CENTERS,
  ROAD_WIDTH,
  SCENE_OBJECT_COUNT,
  SIDEWALK_WIDTH,
  VEHICLE_SPEED,
} from "./constants";
import { getPrefabDefinition, HIGHEST_BUILDING_PREFAB_ID } from "./prefabs";
import type {
  HoleState,
  MapPowerUp,
  PowerUpType,
  Quaternion,
  RouteMotion,
  SimulationState,
  Vector2,
  WorldObjectState,
} from "./types";

const POWER_UP_TYPES: readonly PowerUpType[] = [
  "magnet",
  "shrink",
  "foot",
  "burger",
  "poop",
  "doubleFoot",
  "beer",
];

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
  "vehicle-delivery-flat",
] as const;
export const RUNTIME_BUILDING_PREFAB_IDS = [
  "building-a",
  "building-b",
  "building-c",
  "building-d",
  "building-e",
  "building-f",
  "building-g",
  "building-h",
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
  "commercial-skyscraper-e",
  "commercial-low-b",
  "commercial-low-d",
  "commercial-low-f",
] as const;
const SIDEWALK_CENTER_OFFSET = 3.5 + SIDEWALK_WIDTH / 2;
const ROAD_AND_SIDEWALK_HALF_WIDTH = 3.5 + SIDEWALK_WIDTH;
const OCCUPANCY_CELL_SIZE = 12;
const SPAWN_ATTEMPTS = 4_096;
const SPAWN_SAFETY_MARGIN = 0.08;
const PEDESTRIAN_ROUTE_CLEARANCE = 0.5;
const BUILDING_GAP = 0.2;
const BUILDING_EDGE_INSET = 0.2;
const SMALL_PROP_TARGETS = [
  { count: CITY_SMALL_OBJECT_COUNTS[25], value: 25 },
  { count: CITY_SMALL_OBJECT_COUNTS[12], value: 12 },
  { count: CITY_SMALL_OBJECT_COUNTS[4], value: 4 },
] as const;
const TALL_BUILDING_MINIMUM_HEIGHT = 12;
const TALL_BUILDING_PREFAB_IDS = RUNTIME_BUILDING_PREFAB_IDS.filter(
  (prefabId) => getPrefabDefinition(prefabId).height >= TALL_BUILDING_MINIMUM_HEIGHT,
);
const SHORT_BUILDING_PREFAB_IDS = RUNTIME_BUILDING_PREFAB_IDS.filter((prefabId) =>
  prefabId.startsWith("building-"),
);
const COMPACT_BUILDING_PREFAB_IDS = RUNTIME_BUILDING_PREFAB_IDS.filter((prefabId) =>
  prefabId.startsWith("commercial-low-"),
);

interface LandInterval {
  minimum: number;
  maximum: number;
  center: number;
  size: number;
}

interface OccupiedFootprint {
  id: string;
  position: Vector2;
  halfX: number;
  halfY: number;
  isBuilding: boolean;
}

interface BlockedFootprint {
  id: string;
  position: Vector2;
  radius: number;
}

export type CityBlockEdge = "north" | "east" | "south" | "west";

type CityBlockPropOrder =
  | "rows"
  | "columns"
  | "center-out"
  | "edge-in"
  | "checkerboard"
  | "diagonal";

export interface CityBlockLayout {
  id: string;
  label: string;
  buildingEdges: readonly [CityBlockEdge, CityBlockEdge];
  interiorBuildingOffsets: readonly (readonly [number, number])[];
  smallProps: readonly string[];
  propOrder: CityBlockPropOrder;
}

export const CITY_BLOCK_LAYOUTS = [
  {
    id: "residential-garden",
    label: "Residential garden",
    buildingEdges: ["north", "south"],
    interiorBuildingOffsets: [
      [-10, 0],
      [0, 0],
      [10, 0],
    ],
    smallProps: ["planter", "crate", "debris-plate", "cone", "cone-flat", "parasol-a", "parasol-b"],
    propOrder: "rows",
  },
  {
    id: "commercial-canyon",
    label: "Commercial canyon",
    buildingEdges: ["east", "west"],
    interiorBuildingOffsets: [
      [0, -10],
      [0, 0],
      [0, 10],
    ],
    smallProps: ["planter", "crate", "debris-plate-small", "cone", "debris-tire", "awning"],
    propOrder: "columns",
  },
  {
    id: "mixed-courtyard",
    label: "Mixed courtyard",
    buildingEdges: ["north", "south"],
    interiorBuildingOffsets: [
      [-8, -2],
      [8, 2],
    ],
    smallProps: ["planter", "crate", "debris-bumper", "cone-flat", "parasol-a", "parasol-b"],
    propOrder: "center-out",
  },
  {
    id: "tower-promenade",
    label: "Tower promenade",
    buildingEdges: ["east", "west"],
    interiorBuildingOffsets: [
      [-3, -10],
      [3, 0],
      [-3, 10],
    ],
    smallProps: ["planter", "crate", "debris-plate", "debris-tire", "overhang", "overhang-wide"],
    propOrder: "edge-in",
  },
  {
    id: "market-arcade",
    label: "Market arcade",
    buildingEdges: ["north", "south"],
    interiorBuildingOffsets: [
      [-10, -2],
      [0, 3],
      [10, -2],
    ],
    smallProps: ["planter", "crate", "debris-plate-small", "cone", "awning-wide", "parasol-a"],
    propOrder: "checkerboard",
  },
] as const satisfies readonly CityBlockLayout[];

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

function scoreFor(
  prefabId: string,
  size: Vector2,
  stackLayers: number,
  sizeMultiplier = 1,
): number {
  const isBuilding = prefabId.startsWith("building-") || prefabId.startsWith("commercial-");
  if (isBuilding) {
    if (prefabId === HIGHEST_BUILDING_PREFAB_ID) return 50;
    const footprintArea = size.x * size.y;
    if (footprintArea >= 70) return 40;
    if (footprintArea >= 35) return 30;
    return 20;
  }
  if (
    prefabId.startsWith("vehicle-") ||
    VEHICLE_PREFABS.includes(prefabId as (typeof VEHICLE_PREFABS)[number])
  ) {
    return 40;
  }
  if (sizeMultiplier >= 5) return 25 * stackLayers;
  if (sizeMultiplier >= 2) return 12 * stackLayers;
  const contactArea = size.x * size.y;
  if (contactArea >= 12) return 25 * stackLayers;
  if (contactArea >= 4) return 12 * stackLayers;
  return 4 * stackLayers;
}

function createObject(
  index: number,
  prefabId: string,
  position: Vector2,
  yaw = 0,
  motion: RouteMotion | null = null,
  stackLayers = 1,
  sizeMultiplier = 1,
  valueOverride?: number,
): WorldObjectState {
  const prefab = getPrefabDefinition(prefabId);
  const size = {
    x: prefab.size.x * sizeMultiplier,
    y: prefab.size.y * sizeMultiplier,
  };
  const height = prefab.height * stackLayers * sizeMultiplier;
  return {
    id: `object-${index + 1}`,
    prefabId,
    shape: prefab.shape,
    position,
    centerY: height / 2,
    size,
    height,
    stackLayers,
    sizeMultiplier,
    fitDiameter: fitDiameterFor(size, height, prefab.shape),
    value: valueOverride ?? scoreFor(prefabId, size, stackLayers, sizeMultiplier),
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
  minimum?: number,
  maximum?: number,
): RouteMotion {
  const routeLimit = (axis === "x" ? MAP_HALF_WIDTH : MAP_HALF_HEIGHT) - 8;
  return {
    kind,
    laneId,
    axis,
    direction,
    speed,
    lateralCoordinate,
    headingYaw,
    minimum: minimum ?? -routeLimit,
    maximum: maximum ?? routeLimit,
  };
}

function footprintRadius(prefabId: string, sizeMultiplier = 1): number {
  const prefab = getPrefabDefinition(prefabId);
  return (Math.hypot(prefab.size.x, prefab.size.y) * sizeMultiplier) / 2;
}

function footprintHalfExtents(
  prefabId: string,
  sizeMultiplier = 1,
  yaw = 0,
): readonly [number, number] {
  const prefab = getPrefabDefinition(prefabId);
  const swapsAxes = Math.abs(Math.cos(yaw)) < 0.01;
  const width = (swapsAxes ? prefab.size.y : prefab.size.x) * sizeMultiplier;
  const depth = (swapsAxes ? prefab.size.x : prefab.size.y) * sizeMultiplier;
  return [width / 2, depth / 2];
}

function occupancyCellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function occupancyCellRange(
  position: Vector2,
  halfX: number,
  halfY: number,
): readonly [number, number, number, number] {
  return [
    Math.floor((position.x - halfX) / OCCUPANCY_CELL_SIZE),
    Math.floor((position.x + halfX) / OCCUPANCY_CELL_SIZE),
    Math.floor((position.y - halfY) / OCCUPANCY_CELL_SIZE),
    Math.floor((position.y + halfY) / OCCUPANCY_CELL_SIZE),
  ];
}

function createLandIntervals(
  roadCenters: readonly number[],
  expectedCount: number,
  axis: "x" | "y",
): readonly LandInterval[] {
  const intervals: LandInterval[] = [];
  for (let index = 0; index < roadCenters.length - 1; index += 1) {
    const leftRoad = roadCenters[index];
    const rightRoad = roadCenters[index + 1];
    const minimum = leftRoad === undefined ? undefined : leftRoad + ROAD_AND_SIDEWALK_HALF_WIDTH;
    const maximum = rightRoad === undefined ? undefined : rightRoad - ROAD_AND_SIDEWALK_HALF_WIDTH;
    if (minimum === undefined || maximum === undefined) {
      continue;
    }
    intervals.push({ minimum, maximum, center: (minimum + maximum) / 2, size: maximum - minimum });
  }
  if (
    intervals.length !== expectedCount ||
    intervals.some((interval) => Math.abs(interval.size - CITY_BLOCK_SIZE) > 0.001)
  ) {
    throw new Error(
      `Road centers must define exactly ${expectedCount} 41m city blocks on the ${axis} axis`,
    );
  }
  return intervals;
}

function halton(index: number, base: number): number {
  let fraction = 1;
  let result = 0;
  let remaining = index;
  while (remaining > 0) {
    fraction /= base;
    result += fraction * (remaining % base);
    remaining = Math.floor(remaining / base);
  }
  return result;
}

function smallPropCandidates(
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  blockIndex: number,
  propOrder: CityBlockPropOrder,
): Vector2[] {
  const candidates: Vector2[] = [];
  const halfWidth = Math.max(1.5, width / 2 - 0.8);
  const halfHeight = Math.max(1.5, height / 2 - 0.8);
  const columnCount = Math.floor((halfWidth * 2) / 2.1) + 1;
  const rowCount = Math.floor((halfHeight * 2) / 2.1) + 1;
  const targetCount = columnCount * rowCount;
  const orderSalt: Record<CityBlockPropOrder, number> = {
    rows: 1,
    columns: 5,
    "center-out": 11,
    "edge-in": 17,
    checkerboard: 23,
    diagonal: 29,
  };
  const used = new Set<string>();
  let sampleIndex = 1 + blockIndex * 37 + orderSalt[propOrder] * 101;
  while (candidates.length < targetCount) {
    const column = Math.min(columnCount - 1, Math.floor(halton(sampleIndex, 2) * columnCount));
    const row = Math.min(rowCount - 1, Math.floor(halton(sampleIndex, 3) * rowCount));
    sampleIndex += 1;
    const key = `${column}:${row}`;
    if (used.has(key)) continue;
    used.add(key);
    const offsetX = -halfWidth + (column / Math.max(1, columnCount - 1)) * halfWidth * 2;
    const offsetY = -halfHeight + (row / Math.max(1, rowCount - 1)) * halfHeight * 2;
    candidates.push({ x: centerX + offsetX, y: centerY + offsetY });
  }
  return candidates;
}

function createBlockBuildingPalette(blockIndex: number): readonly string[] {
  const palette: string[] = [];
  const addUnique = (prefabId: string | undefined): void => {
    if (prefabId && !palette.includes(prefabId)) palette.push(prefabId);
  };
  for (let offset = 0; offset < 2; offset += 1) {
    addUnique(
      SHORT_BUILDING_PREFAB_IDS[(blockIndex * 2 + offset) % SHORT_BUILDING_PREFAB_IDS.length],
    );
  }
  addUnique(COMPACT_BUILDING_PREFAB_IDS[blockIndex % COMPACT_BUILDING_PREFAB_IDS.length]);
  for (let offset = 0; offset < 3; offset += 1) {
    addUnique(
      TALL_BUILDING_PREFAB_IDS[(blockIndex * 3 + offset) % TALL_BUILDING_PREFAB_IDS.length],
    );
  }
  return palette;
}

function fillBuildingEdge(
  requiredPrefabs: readonly string[],
  palette: readonly string[],
  span: number,
): readonly string[] {
  const requiredWidth = requiredPrefabs.reduce(
    (total, prefabId) => total + getPrefabDefinition(prefabId).size.x,
    0,
  );
  const requiredGaps = Math.max(0, requiredPrefabs.length - 1) * BUILDING_GAP;
  const availableUnits = Math.max(0, Math.floor((span - requiredWidth - requiredGaps) * 100));
  const bestByCost: ({ coverage: number; prefabs: string[] } | undefined)[] = Array.from(
    { length: availableUnits + 1 },
    () => undefined,
  );
  bestByCost[0] = { coverage: 0, prefabs: [] };
  for (let cost = 0; cost <= availableUnits; cost += 1) {
    const current = bestByCost[cost];
    if (!current || current.prefabs.length >= 9) continue;
    for (const prefabId of palette) {
      const width = getPrefabDefinition(prefabId).size.x;
      const itemCost = Math.round((BUILDING_GAP + width) * 100);
      const nextCost = cost + itemCost;
      if (nextCost > availableUnits) continue;
      const nextCoverage = current.coverage + width;
      if ((bestByCost[nextCost]?.coverage ?? -1) >= nextCoverage) continue;
      bestByCost[nextCost] = {
        coverage: nextCoverage,
        prefabs: [...current.prefabs, prefabId],
      };
    }
  }
  const filler = bestByCost.reduce<{ coverage: number; prefabs: string[] } | undefined>(
    (best, candidate) =>
      candidate && (!best || candidate.coverage > best.coverage) ? candidate : best,
    undefined,
  );
  return [...requiredPrefabs, ...(filler?.prefabs ?? [])];
}

function addBuildingEdge(
  add: (
    prefabId: string,
    position: Vector2,
    yaw?: number,
    motion?: RouteMotion | null,
    sizeMultiplier?: number,
  ) => void,
  canPlace: (
    prefabId: string,
    position: Vector2,
    throwOnOverlap?: boolean,
    sizeMultiplier?: number,
    allowPedestrianRoutes?: boolean,
    yaw?: number,
  ) => boolean,
  edge: CityBlockEdge,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  palette: readonly string[],
  requiredPrefabs: readonly string[],
): void {
  const horizontal = edge === "north" || edge === "south";
  const span = horizontal ? width : height;
  const start = (horizontal ? centerX : centerY) - span / 2;
  const end = start + span;
  const yaw = horizontal
    ? edge === "north"
      ? Math.PI
      : 0
    : edge === "east"
      ? Math.PI / 2
      : -Math.PI / 2;
  let along = start;
  if (palette.length === 0) throw new Error("A city block building palette cannot be empty");
  const edgePrefabs = fillBuildingEdge(requiredPrefabs, palette, span);
  edgePrefabs.forEach((prefabId, placementCount) => {
    const gap = placementCount === 0 ? 0 : BUILDING_GAP;
    const definition = getPrefabDefinition(prefabId);
    along += gap;
    const positionAlong = along + definition.size.x / 2;
    const position = horizontal
      ? {
          x: positionAlong,
          y:
            edge === "north"
              ? centerY + height / 2 - definition.size.y / 2 - BUILDING_EDGE_INSET
              : centerY - height / 2 + definition.size.y / 2 + BUILDING_EDGE_INSET,
        }
      : {
          x:
            edge === "east"
              ? centerX + width / 2 - definition.size.y / 2 - BUILDING_EDGE_INSET
              : centerX - width / 2 + definition.size.y / 2 + BUILDING_EDGE_INSET,
          y: positionAlong,
        };
    if (!canPlace(prefabId, position, false, 1, false, yaw)) {
      throw new Error(`Unable to fill ${edge} building edge at ${centerX},${centerY}`);
    }
    add(prefabId, position, yaw);
    along += definition.size.x;
  });
  if (along > end + 0.001) {
    throw new Error(`Building edge exceeds its block at ${centerX},${centerY}:${edge}`);
  }
  const occupiedSpan = edgePrefabs.reduce(
    (total, prefabId) => total + getPrefabDefinition(prefabId).size.x,
    0,
  );
  if (occupiedSpan + 1e-6 < span * 0.9) {
    throw new Error(
      `Building edge coverage ${occupiedSpan}/${span} below 90% at ${centerX},${centerY}:${edge}`,
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

function buildCityObjects(): readonly WorldObjectState[] {
  const objects: WorldObjectState[] = [];
  const occupiedCells = new Map<string, OccupiedFootprint[]>();
  const canPlace = (
    prefabId: string,
    position: Vector2,
    throwOnOverlap = false,
    sizeMultiplier = 1,
    allowPedestrianRoutes = false,
    yaw = 0,
  ): boolean => {
    const [halfWidth, halfDepth] = footprintHalfExtents(prefabId, sizeMultiplier, yaw);
    const isBuilding = prefabId.startsWith("building-") || prefabId.startsWith("commercial-");
    const intersectsRoad =
      ROAD_X_CENTERS.some((center) => Math.abs(position.x - center) < ROAD_WIDTH / 2 + halfWidth) ||
      ROAD_Y_CENTERS.some((center) => Math.abs(position.y - center) < ROAD_WIDTH / 2 + halfDepth);
    if (intersectsRoad) {
      return false;
    }
    if (!allowPedestrianRoutes) {
      const intersectsPedestrianRoute =
        ROAD_X_CENTERS.some((center) =>
          [-1, 1].some(
            (side) =>
              Math.abs(position.x - (center + side * SIDEWALK_CENTER_OFFSET)) <
              halfWidth + PEDESTRIAN_ROUTE_CLEARANCE,
          ),
        ) ||
        ROAD_Y_CENTERS.some((center) =>
          [-1, 1].some(
            (side) =>
              Math.abs(position.y - (center + side * SIDEWALK_CENTER_OFFSET)) <
              halfDepth + PEDESTRIAN_ROUTE_CLEARANCE,
          ),
        );
      if (intersectsPedestrianRoute) {
        return false;
      }
    }
    const [minimumX, maximumX, minimumY, maximumY] = occupancyCellRange(
      position,
      halfWidth,
      halfDepth,
    );
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
          const clearance = isBuilding && candidate.isBuilding ? BUILDING_GAP - 0.01 : 0.04;
          if (
            Math.abs(candidate.position.x - position.x) < candidate.halfX + halfWidth + clearance &&
            Math.abs(candidate.position.y - position.y) < candidate.halfY + halfDepth + clearance
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
    sizeMultiplier = 1,
    valueOverride?: number,
  ): void => {
    const isCharacter = prefabId.startsWith("character-");
    if (!motion && !isCharacter) {
      if (!canPlace(prefabId, position, true, sizeMultiplier, false, yaw)) {
        throw new Error(`City placement overlap: ${prefabId} at ${position.x},${position.y}`);
      }
      const [halfX, halfY] = footprintHalfExtents(prefabId, sizeMultiplier, yaw);
      const footprint = {
        id: `${prefabId}-${objects.length}`,
        position,
        halfX,
        halfY,
        isBuilding: prefabId.startsWith("building-") || prefabId.startsWith("commercial-"),
      };
      const [minimumX, maximumX, minimumY, maximumY] = occupancyCellRange(position, halfX, halfY);
      for (let cellY = minimumY; cellY <= maximumY; cellY += 1) {
        for (let cellX = minimumX; cellX <= maximumX; cellX += 1) {
          const key = occupancyCellKey(cellX, cellY);
          const cell = occupiedCells.get(key) ?? [];
          cell.push(footprint);
          occupiedCells.set(key, cell);
        }
      }
    } else if (
      isCharacter &&
      !motion &&
      !canPlace(prefabId, position, false, sizeMultiplier, true, yaw)
    ) {
      return;
    } else if (isCharacter && !motion) {
      const [halfX, halfY] = footprintHalfExtents(prefabId, sizeMultiplier, yaw);
      const footprint = {
        id: `${prefabId}-${objects.length}`,
        position,
        halfX,
        halfY,
        isBuilding: false,
      };
      const [minimumX, maximumX, minimumY, maximumY] = occupancyCellRange(position, halfX, halfY);
      for (let cellY = minimumY; cellY <= maximumY; cellY += 1) {
        for (let cellX = minimumX; cellX <= maximumX; cellX += 1) {
          const key = occupancyCellKey(cellX, cellY);
          const cell = occupiedCells.get(key) ?? [];
          cell.push(footprint);
          occupiedCells.set(key, cell);
        }
      }
    }
    objects.push(
      createObject(
        objects.length,
        prefabId,
        position,
        yaw,
        motion,
        1,
        sizeMultiplier,
        valueOverride,
      ),
    );
  };

  const xIntervals = createLandIntervals(ROAD_X_CENTERS, CITY_BLOCK_COLUMNS, "x");
  const yIntervals = createLandIntervals(ROAD_Y_CENTERS, CITY_BLOCK_ROWS, "y");
  let blockIndex = 0;
  for (const blockX of xIntervals) {
    for (const blockY of yIntervals) {
      const layout = CITY_BLOCK_LAYOUTS[blockIndex % CITY_BLOCK_LAYOUTS.length];
      if (!layout) {
        throw new Error(`Missing city block layout: ${blockIndex}`);
      }
      const palette = createBlockBuildingPalette(blockIndex);
      layout.buildingEdges.forEach((edge, edgeIndex) => {
        const requiredPrefabs =
          edgeIndex === 0
            ? [palette[0], palette[2], palette[4]].filter((value): value is string =>
                Boolean(value),
              )
            : [palette[1], palette[3], palette[5]].filter((value): value is string =>
                Boolean(value),
              );
        addBuildingEdge(
          add,
          canPlace,
          edge,
          blockX.center,
          blockY.center,
          blockX.size,
          blockY.size,
          palette,
          requiredPrefabs,
        );
      });
      const tallestPalette = [...palette].sort(
        (left, right) => getPrefabDefinition(right).height - getPrefabDefinition(left).height,
      );
      layout.interiorBuildingOffsets.forEach((offset, offsetIndex) => {
        const prefabId = tallestPalette[offsetIndex % tallestPalette.length];
        if (!prefabId) throw new Error(`Missing interior building for block ${blockIndex}`);
        const position = { x: blockX.center + offset[0], y: blockY.center + offset[1] };
        if (!canPlace(prefabId, position)) {
          throw new Error(`Unable to place interior building in block ${blockIndex}`);
        }
        add(prefabId, position);
      });
      blockIndex += 1;
    }
  }

  const blockCandidates = xIntervals.flatMap((blockX, xIndex) =>
    yIntervals.map((blockY, yIndex) => {
      const index = xIndex * yIntervals.length + yIndex;
      const layout = CITY_BLOCK_LAYOUTS[index % CITY_BLOCK_LAYOUTS.length];
      if (!layout) throw new Error(`Missing city block layout: ${index}`);
      return {
        index,
        layout,
        positions: smallPropCandidates(
          blockX.center,
          blockY.center,
          blockX.size,
          blockY.size,
          index,
          layout.propOrder,
        ),
      };
    }),
  );
  const smallCandidateCursors = new Map<number, number>();
  let smallPropCursor = 0;
  for (const target of SMALL_PROP_TARGETS) {
    const baseCount = Math.floor(target.count / blockCandidates.length);
    const remainder = target.count % blockCandidates.length;
    for (const block of blockCandidates) {
      const blockTarget = baseCount + (block.index < remainder ? 1 : 0);
      let placed = 0;
      let candidateCursor = smallCandidateCursors.get(block.index) ?? 0;
      while (placed < blockTarget && candidateCursor < block.positions.length) {
        const position = block.positions[candidateCursor];
        candidateCursor += 1;
        if (!position) continue;
        const matchingPrefabs = block.layout.smallProps;
        for (let attempt = 0; attempt < matchingPrefabs.length; attempt += 1) {
          const prefabId = matchingPrefabs[(smallPropCursor + attempt) % matchingPrefabs.length];
          if (!prefabId || !canPlace(prefabId, position)) continue;
          const yaw = prefabId === "crate" ? block.index * 0.23 : 0;
          add(prefabId, position, yaw, null, 1, target.value);
          smallPropCursor += attempt + 1;
          placed += 1;
          break;
        }
      }
      smallCandidateCursors.set(block.index, candidateCursor);
      if (placed !== blockTarget) {
        throw new Error(
          `Unable to place ${blockTarget} small props worth ${target.value} points in block ${block.index}`,
        );
      }
    }
  }

  let vehicleIndex = 0;
  let laneIndex = 0;
  for (const axis of ["y", "x"] as const) {
    const roadCenters = axis === "y" ? ROAD_X_CENTERS : ROAD_Y_CENTERS;
    const vehicleSlots = (axis === "y" ? yIntervals : xIntervals).map(
      (interval) => interval.center,
    );
    roadCenters.forEach((roadCenter, roadIndex) => {
      for (const laneOffset of [-1.75, 1.75] as const) {
        const direction: -1 | 1 =
          axis === "y" ? (laneOffset < 0 ? 1 : -1) : laneOffset < 0 ? -1 : 1;
        const omittedSlot = laneIndex % vehicleSlots.length;
        const selectedSlots = vehicleSlots.filter((_, slotIndex) => slotIndex !== omittedSlot);
        for (const slot of selectedSlots) {
          const lateralCoordinate = roadCenter + laneOffset;
          const yaw =
            axis === "y"
              ? direction > 0
                ? 0
                : Math.PI
              : direction > 0
                ? Math.PI / 2
                : -Math.PI / 2;
          const position =
            axis === "y" ? { x: lateralCoordinate, y: slot } : { x: slot, y: lateralCoordinate };
          add(
            VEHICLE_PREFABS[vehicleIndex % VEHICLE_PREFABS.length] ?? "sedan",
            position,
            yaw,
            route(
              "vehicle",
              `${axis}-${roadIndex}-${laneOffset}`,
              axis,
              direction,
              VEHICLE_SPEED,
              lateralCoordinate,
              yaw,
            ),
          );
          vehicleIndex += 1;
        }
        laneIndex += 1;
      }
    });
  }
  if (vehicleIndex !== CITY_VEHICLE_COUNT) {
    throw new Error(`Expected ${CITY_VEHICLE_COUNT} vehicles, received ${vehicleIndex}`);
  }

  let characterIndex = 0;
  let movingPedestrianIndex = 0;
  let sidewalkSegmentIndex = 0;
  const nextCharacter = (): string => {
    const suffix = String.fromCharCode(97 + (characterIndex % 8));
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
    const count = 5;
    const movingIndex = movingPedestrianIndex < CITY_MOVING_CHARACTER_COUNT ? 0 : -1;
    const movingSide: -1 | 1 = sidewalkSegmentIndex % 2 === 0 ? -1 : 1;
    const minimum = interval.minimum + 1.2;
    const maximum = interval.maximum - 1.2;
    for (let personIndex = 0; personIndex < count; personIndex += 1) {
      const side: -1 | 1 =
        movingIndex >= 0
          ? personIndex === movingIndex
            ? movingSide
            : movingSide === -1
              ? 1
              : -1
          : (personIndex + roadIndex + intervalIndex) % 2 === 0
            ? -1
            : 1;
      const direction: -1 | 1 = (roadIndex + intervalIndex + side) % 2 === 0 ? 1 : -1;
      const fixed = roadCenter + side * SIDEWALK_CENTER_OFFSET;
      const yaw =
        axis === "y" ? (direction > 0 ? 0 : Math.PI) : direction > 0 ? Math.PI / 2 : -Math.PI / 2;
      const progress = (personIndex + 0.5) / count;
      const along = minimum + (maximum - minimum) * progress;
      const position = axis === "y" ? { x: fixed, y: along } : { x: along, y: fixed };
      const motion =
        personIndex === movingIndex
          ? route(
              "pedestrian",
              `${axis}-walk-${roadIndex}-${intervalIndex}-${side}`,
              axis,
              direction,
              PEDESTRIAN_SPEED,
              fixed,
              yaw,
              minimum,
              maximum,
            )
          : null;
      add(nextCharacter(), position, yaw, motion);
      if (motion) movingPedestrianIndex += 1;
    }
    sidewalkSegmentIndex += 1;
  };

  ROAD_X_CENTERS.forEach((roadCenter, roadIndex) => {
    yIntervals.forEach((interval, intervalIndex) => {
      addSidewalkCharacters("y", roadCenter, roadIndex, interval, intervalIndex);
    });
  });
  ROAD_Y_CENTERS.forEach((roadCenter, roadIndex) => {
    xIntervals.forEach((interval, intervalIndex) => {
      addSidewalkCharacters("x", roadCenter, roadIndex, interval, intervalIndex);
    });
  });
  if (
    characterIndex !== CITY_CHARACTER_COUNT ||
    movingPedestrianIndex !== CITY_MOVING_CHARACTER_COUNT
  ) {
    throw new Error(
      `Expected ${CITY_CHARACTER_COUNT} characters/${CITY_MOVING_CHARACTER_COUNT} moving, received ${characterIndex}/${movingPedestrianIndex}`,
    );
  }

  if (objects.length !== SCENE_OBJECT_COUNT) {
    throw new Error(`Expected ${SCENE_OBJECT_COUNT} city objects, received ${objects.length}`);
  }
  return objects;
}

function createHoles(
  seed: number,
  objects: readonly WorldObjectState[],
): readonly [readonly HoleState[], number] {
  const holes: HoleState[] = [];
  let rngState = seed >>> 0;
  const spawnLimitX = MAP_HALF_WIDTH - INITIAL_HOLE_RADIUS - 1;
  const spawnLimitY = MAP_HALF_HEIGHT - INITIAL_HOLE_RADIUS - 1;
  const blockedCells = new Map<string, BlockedFootprint[]>();
  for (const object of objects) {
    const radius = footprintRadius(object.prefabId, object.sizeMultiplier);
    const footprint: BlockedFootprint = {
      id: object.id,
      position: object.position,
      radius,
    };
    const queryRadius = radius + INITIAL_HOLE_RADIUS + SPAWN_SAFETY_MARGIN;
    const [minimumX, maximumX, minimumY, maximumY] = occupancyCellRange(
      object.position,
      queryRadius,
      queryRadius,
    );
    for (let cellY = minimumY; cellY <= maximumY; cellY += 1) {
      for (let cellX = minimumX; cellX <= maximumX; cellX += 1) {
        const key = occupancyCellKey(cellX, cellY);
        const cell = blockedCells.get(key) ?? [];
        cell.push(footprint);
        blockedCells.set(key, cell);
      }
    }
  }
  const isObjectFree = (position: Vector2): boolean => {
    const queryRadius = INITIAL_HOLE_RADIUS + SPAWN_SAFETY_MARGIN;
    const [minimumX, maximumX, minimumY, maximumY] = occupancyCellRange(
      position,
      queryRadius,
      queryRadius,
    );
    const checked = new Set<string>();
    for (let cellY = minimumY; cellY <= maximumY; cellY += 1) {
      for (let cellX = minimumX; cellX <= maximumX; cellX += 1) {
        const candidates = blockedCells.get(occupancyCellKey(cellX, cellY));
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
            candidate.radius + INITIAL_HOLE_RADIUS + SPAWN_SAFETY_MARGIN
          ) {
            return false;
          }
        }
      }
    }
    return true;
  };
  for (let index = 0; index <= BOT_COUNT; index += 1) {
    let position: Vector2 | null = null;
    for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt += 1) {
      const [randomX, stateAfterX] = nextRandom(rngState);
      const [randomY, stateAfterY] = nextRandom(stateAfterX);
      rngState = stateAfterY;
      const candidate = {
        x: (randomX * 2 - 1) * spawnLimitX,
        y: (randomY * 2 - 1) * spawnLimitY,
      };
      if (
        isObjectFree(candidate) &&
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
      speedBoostRemaining: 0,
      speedBoostCooldown: 0,
      radiusBoostRemaining: 0,
      radiusBoostCooldown: 0,
      bombFuseRemaining: 0,
      bombCooldown: 0,
      activePowerUps: [],
      nextPoopDropIn: 0,
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

export function createInitialSimulation(seed = 0x5eed1234, spawnSeed = seed): SimulationState {
  const objects = buildCityObjects();
  const [holes, holeRngState] = createHoles(spawnSeed, objects);
  let rngState = holeRngState;
  const powerUps: MapPowerUp[] = [];
  for (let index = 0; index < holes.length; index += 1) {
    const [randomX, afterX] = nextRandom(rngState);
    const [randomY, afterY] = nextRandom(afterX);
    const [randomType, afterType] = nextRandom(afterY);
    rngState = afterType;
    powerUps.push({
      id: `power-up-0-${index}`,
      type: POWER_UP_TYPES[Math.floor(randomType * POWER_UP_TYPES.length)] ?? "magnet",
      position: {
        x: (randomX * 2 - 1) * (MAP_HALF_WIDTH - 4),
        y: (randomY * 2 - 1) * (MAP_HALF_HEIGHT - 4),
      },
    });
  }
  return {
    elapsed: 0,
    remaining: GAME_DURATION_SECONDS,
    status: "playing",
    holes,
    objects,
    powerUps,
    footprints: [],
    poopHazards: [],
    positionHistory: holes.map((hole) => ({
      holeId: hole.id,
      elapsed: 0,
      position: { ...hole.position },
    })),
    nextPowerUpSpawnAt: 60,
    rngState,
  };
}
