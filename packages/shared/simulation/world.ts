import {
  BOT_COUNT,
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
import { getPrefabDefinition, HIGHEST_BUILDING_PREFAB_ID, PREFAB_DEFINITIONS } from "./prefabs";
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
  "vehicle-delivery-flat",
  "vehicle-kart-oobi",
  "vehicle-kart-oodi",
  "vehicle-kart-ooli",
  "vehicle-kart-oopi",
  "vehicle-kart-oozi",
  "vehicle-race",
  "vehicle-race-future",
  "vehicle-sedan-sports",
  "vehicle-suv-luxury",
  "vehicle-tractor",
  "vehicle-tractor-police",
  "vehicle-tractor-shovel",
  "vehicle-truck-flat",
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
  "commercial-building-i",
  "commercial-building-j",
  "commercial-building-k",
  "commercial-building-l",
  "commercial-building-m",
  "commercial-building-n",
  "commercial-skyscraper-a",
  "commercial-skyscraper-b",
  "commercial-skyscraper-c",
  "commercial-skyscraper-d",
  "commercial-skyscraper-e",
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
  "commercial-low-i",
  "commercial-low-j",
  "commercial-low-k",
  "commercial-low-l",
  "commercial-low-m",
  "commercial-low-n",
  "commercial-low-wide-a",
  "commercial-low-wide-b",
] as const;
const ROUTE_LIMIT = MAP_HALF_SIZE - 8;
const SIDEWALK_CENTER_OFFSET = 3.5 + SIDEWALK_WIDTH / 2;
const ROAD_AND_SIDEWALK_HALF_WIDTH = 3.5 + SIDEWALK_WIDTH;
const SMALL_PROP_MULTIPLIER = 5;
const OCCUPANCY_CELL_SIZE = 12;
const SPAWN_ATTEMPTS = 4_096;
const SPAWN_SAFETY_MARGIN = 0.08;

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

type BlockPrefabSlot =
  | "landmark"
  | "shop"
  | "house"
  | "tree-small"
  | "tree-large"
  | "planter"
  | "fence"
  | "fence-low"
  | "crate"
  | "cone"
  | "cone-flat"
  | "debris-tire"
  | "debris-bumper"
  | "debris-plate"
  | "debris-plate-small"
  | "awning"
  | "awning-wide"
  | "overhang"
  | "overhang-wide"
  | "parasol-a"
  | "parasol-b"
  | "sedan"
  | "hatchback"
  | "suv"
  | "path-long"
  | "path-stones-long";

export interface CityBlockPlacement {
  prefab: BlockPrefabSlot;
  offset: readonly [number, number];
  yaw?: number;
}

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
  structures: readonly CityBlockPlacement[];
  details: readonly CityBlockPlacement[];
  smallProps: readonly BlockPrefabSlot[];
  propOrder: CityBlockPropOrder;
}

const RETAIL_PLAZA_STRUCTURES = [
  { prefab: "landmark", offset: [-11.5, -11.5] },
  { prefab: "landmark", offset: [-11.5, 11.5] },
  { prefab: "landmark", offset: [11.5, -11.5] },
  { prefab: "landmark", offset: [11.5, 11.5] },
  { prefab: "shop", offset: [0, -7] },
  { prefab: "shop", offset: [7, 0] },
  { prefab: "shop", offset: [0, 7] },
  { prefab: "shop", offset: [-7, 0] },
] as const satisfies readonly CityBlockPlacement[];

const TOWER_COURT_STRUCTURES = [
  { prefab: "landmark", offset: [-12, -11] },
  { prefab: "landmark", offset: [12, -11] },
  { prefab: "landmark", offset: [0, 12] },
  { prefab: "shop", offset: [-8, 2] },
  { prefab: "shop", offset: [0, 2] },
  { prefab: "shop", offset: [8, 2] },
  { prefab: "shop", offset: [-10, 10] },
  { prefab: "shop", offset: [10, 10] },
] as const satisfies readonly CityBlockPlacement[];

const POCKET_PARK_STRUCTURES = [
  { prefab: "house", offset: [-11.5, -11.5] },
  { prefab: "house", offset: [-11.5, 11.5] },
  { prefab: "house", offset: [11.5, -11.5] },
  { prefab: "house", offset: [11.5, 11.5] },
  { prefab: "shop", offset: [0, -7] },
  { prefab: "shop", offset: [7, 0] },
  { prefab: "shop", offset: [0, 7] },
  { prefab: "shop", offset: [-7, 0] },
] as const satisfies readonly CityBlockPlacement[];

const SERVICE_YARD_STRUCTURES = [
  { prefab: "landmark", offset: [-12, -10] },
  { prefab: "landmark", offset: [-12, 10] },
  { prefab: "shop", offset: [3, -10] },
  { prefab: "shop", offset: [12, -10] },
  { prefab: "shop", offset: [3, 0] },
  { prefab: "shop", offset: [12, 0] },
  { prefab: "shop", offset: [3, 10] },
  { prefab: "shop", offset: [12, 10] },
] as const satisfies readonly CityBlockPlacement[];

const FENCED_HOUSING_STRUCTURES = [
  { prefab: "house", offset: [-12, 0] },
  { prefab: "house", offset: [0, -12] },
  { prefab: "house", offset: [12, 0] },
  { prefab: "house", offset: [0, 12] },
  { prefab: "shop", offset: [-10, -10] },
  { prefab: "shop", offset: [10, -10] },
  { prefab: "shop", offset: [-10, 10] },
  { prefab: "shop", offset: [10, 10] },
] as const satisfies readonly CityBlockPlacement[];

const MIXED_COURTYARD_STRUCTURES = [
  { prefab: "landmark", offset: [-12, -12] },
  { prefab: "house", offset: [-12, 12] },
  { prefab: "house", offset: [12, -12] },
  { prefab: "landmark", offset: [12, 12] },
  { prefab: "shop", offset: [0, -7] },
  { prefab: "shop", offset: [7, 0] },
  { prefab: "shop", offset: [0, 7] },
  { prefab: "shop", offset: [-7, 0] },
] as const satisfies readonly CityBlockPlacement[];

const AUTO_FORECOURT_STRUCTURES = [
  { prefab: "landmark", offset: [-12, -11] },
  { prefab: "landmark", offset: [12, -11] },
  { prefab: "shop", offset: [-12, 11] },
  { prefab: "shop", offset: [0, 11] },
  { prefab: "shop", offset: [12, 11] },
  { prefab: "shop", offset: [-8, 0] },
  { prefab: "shop", offset: [0, 0] },
  { prefab: "shop", offset: [8, 0] },
] as const satisfies readonly CityBlockPlacement[];

const GARDEN_ARCADE_STRUCTURES = [
  { prefab: "house", offset: [-12, 0] },
  { prefab: "house", offset: [0, -12] },
  { prefab: "house", offset: [12, 0] },
  { prefab: "house", offset: [0, 12] },
  { prefab: "shop", offset: [-10, -10] },
  { prefab: "shop", offset: [10, -10] },
  { prefab: "shop", offset: [-10, 10] },
  { prefab: "shop", offset: [10, 10] },
] as const satisfies readonly CityBlockPlacement[];

const LINEAR_MARKET_STRUCTURES = [
  { prefab: "landmark", offset: [-12, 0] },
  { prefab: "landmark", offset: [12, 0] },
  { prefab: "shop", offset: [-8, -10] },
  { prefab: "shop", offset: [0, -10] },
  { prefab: "shop", offset: [8, -10] },
  { prefab: "shop", offset: [-8, 10] },
  { prefab: "shop", offset: [0, 10] },
  { prefab: "shop", offset: [8, 10] },
] as const satisfies readonly CityBlockPlacement[];

const CIVIC_SQUARE_STRUCTURES = [
  { prefab: "landmark", offset: [-11.5, -11.5] },
  { prefab: "landmark", offset: [-11.5, 11.5] },
  { prefab: "landmark", offset: [11.5, -11.5] },
  { prefab: "landmark", offset: [11.5, 11.5] },
  { prefab: "shop", offset: [0, -7] },
  { prefab: "shop", offset: [7, 0] },
  { prefab: "shop", offset: [0, 7] },
  { prefab: "shop", offset: [-7, 0] },
] as const satisfies readonly CityBlockPlacement[];

export const CITY_BLOCK_LAYOUTS = [
  {
    id: "retail-plaza",
    label: "Retail plaza",
    structures: RETAIL_PLAZA_STRUCTURES,
    details: [
      { prefab: "tree-small", offset: [0, -14] },
      { prefab: "tree-small", offset: [14, 0] },
      { prefab: "tree-small", offset: [0, 14] },
      { prefab: "tree-small", offset: [-14, 0] },
      { prefab: "awning-wide", offset: [0, -1] },
    ],
    smallProps: ["planter", "crate", "debris-plate", "cone", "cone-flat", "parasol-a", "parasol-b"],
    propOrder: "rows",
  },
  {
    id: "tower-court",
    label: "Tower court",
    structures: TOWER_COURT_STRUCTURES,
    details: [
      { prefab: "tree-large", offset: [-15, 0] },
      { prefab: "tree-large", offset: [15, 0] },
      { prefab: "planter", offset: [0, -4] },
      { prefab: "awning", offset: [-4, 6] },
      { prefab: "awning", offset: [4, 6] },
    ],
    smallProps: [
      "planter",
      "crate",
      "debris-plate",
      "debris-plate-small",
      "cone",
      "cone-flat",
      "debris-tire",
    ],
    propOrder: "columns",
  },
  {
    id: "pocket-park",
    label: "Pocket park",
    structures: POCKET_PARK_STRUCTURES,
    details: [
      { prefab: "tree-large", offset: [0, 0] },
      { prefab: "tree-small", offset: [-5, 0] },
      { prefab: "tree-small", offset: [5, 0] },
      { prefab: "tree-small", offset: [0, -5] },
      { prefab: "tree-small", offset: [0, 5] },
    ],
    smallProps: [
      "planter",
      "crate",
      "debris-plate",
      "debris-plate-small",
      "cone",
      "parasol-a",
      "parasol-b",
    ],
    propOrder: "center-out",
  },
  {
    id: "service-yard",
    label: "Service yard",
    structures: SERVICE_YARD_STRUCTURES,
    details: [
      { prefab: "fence", offset: [-4, -3], yaw: Math.PI / 2 },
      { prefab: "fence", offset: [-4, 3], yaw: Math.PI / 2 },
      { prefab: "crate", offset: [-1, -5] },
      { prefab: "debris-tire", offset: [-1, 0] },
      { prefab: "debris-bumper", offset: [-1, 5] },
    ],
    smallProps: [
      "planter",
      "crate",
      "debris-plate",
      "debris-plate-small",
      "cone",
      "cone-flat",
      "debris-bumper",
    ],
    propOrder: "edge-in",
  },
  {
    id: "fenced-housing",
    label: "Fenced housing",
    structures: FENCED_HOUSING_STRUCTURES,
    details: [
      { prefab: "fence-low", offset: [-3, -4] },
      { prefab: "fence-low", offset: [3, -4] },
      { prefab: "fence-low", offset: [-3, 4] },
      { prefab: "fence-low", offset: [3, 4] },
      { prefab: "tree-large", offset: [0, 0] },
    ],
    smallProps: [
      "planter",
      "crate",
      "debris-plate",
      "debris-plate-small",
      "cone",
      "cone-flat",
      "debris-tire",
    ],
    propOrder: "checkerboard",
  },
  {
    id: "mixed-courtyard",
    label: "Mixed courtyard",
    structures: MIXED_COURTYARD_STRUCTURES,
    details: [
      { prefab: "tree-small", offset: [-14, 0] },
      { prefab: "tree-small", offset: [14, 0] },
      { prefab: "overhang-wide", offset: [0, -1] },
      { prefab: "parasol-a", offset: [-3, 3] },
      { prefab: "parasol-b", offset: [3, 3] },
    ],
    smallProps: [
      "planter",
      "crate",
      "debris-plate",
      "debris-plate-small",
      "cone",
      "cone-flat",
      "debris-bumper",
    ],
    propOrder: "diagonal",
  },
  {
    id: "auto-forecourt",
    label: "Auto forecourt",
    structures: AUTO_FORECOURT_STRUCTURES,
    details: [
      { prefab: "sedan", offset: [-14, 5] },
      { prefab: "suv", offset: [14, 5] },
      { prefab: "cone", offset: [-4, -5] },
      { prefab: "cone", offset: [4, -5] },
      { prefab: "debris-bumper", offset: [0, -5] },
    ],
    smallProps: [
      "planter",
      "crate",
      "debris-plate",
      "debris-plate-small",
      "cone",
      "cone-flat",
      "debris-tire",
    ],
    propOrder: "columns",
  },
  {
    id: "garden-arcade",
    label: "Garden arcade",
    structures: GARDEN_ARCADE_STRUCTURES,
    details: [
      { prefab: "path-stones-long", offset: [0, 0] },
      { prefab: "tree-small", offset: [-6, 0] },
      { prefab: "tree-small", offset: [6, 0] },
      { prefab: "parasol-a", offset: [-5, 5] },
      { prefab: "parasol-b", offset: [5, 5] },
    ],
    smallProps: [
      "planter",
      "crate",
      "debris-plate",
      "debris-plate-small",
      "cone",
      "parasol-a",
      "parasol-b",
    ],
    propOrder: "center-out",
  },
  {
    id: "linear-market",
    label: "Linear market",
    structures: LINEAR_MARKET_STRUCTURES,
    details: [
      { prefab: "parasol-a", offset: [-4, 0] },
      { prefab: "parasol-b", offset: [4, 0] },
      { prefab: "awning-wide", offset: [0, -3] },
      { prefab: "awning-wide", offset: [0, 3] },
      { prefab: "tree-small", offset: [0, 0] },
    ],
    smallProps: [
      "planter",
      "crate",
      "debris-plate",
      "debris-plate-small",
      "cone",
      "cone-flat",
      "debris-bumper",
    ],
    propOrder: "rows",
  },
  {
    id: "civic-square",
    label: "Civic square",
    structures: CIVIC_SQUARE_STRUCTURES,
    details: [
      { prefab: "tree-large", offset: [0, 0] },
      { prefab: "planter", offset: [-5, -5] },
      { prefab: "planter", offset: [5, -5] },
      { prefab: "planter", offset: [-5, 5] },
      { prefab: "planter", offset: [5, 5] },
    ],
    smallProps: [
      "planter",
      "crate",
      "debris-plate",
      "debris-plate-small",
      "cone",
      "parasol-a",
      "parasol-b",
    ],
    propOrder: "edge-in",
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

function scoreFor(prefabId: string, size: Vector2, stackLayers: number): number {
  const isBuilding = prefabId.startsWith("building-") || prefabId.startsWith("commercial-");
  if (isBuilding) {
    return prefabId === HIGHEST_BUILDING_PREFAB_ID ? 50 : 40;
  }
  if (
    prefabId.startsWith("vehicle-") ||
    VEHICLE_PREFABS.includes(prefabId as (typeof VEHICLE_PREFABS)[number])
  ) {
    return 30;
  }
  const contactArea = size.x * size.y;
  return Math.min(30, Math.max(1, Math.round(contactArea * 4) * stackLayers));
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

function prefabForBlockSlot(slot: BlockPrefabSlot, placementIndex: number): string {
  switch (slot) {
    case "landmark":
      return (
        COMMERCIAL_LANDMARK_PREFABS[placementIndex % COMMERCIAL_LANDMARK_PREFABS.length] ??
        "commercial-building-a"
      );
    case "shop":
      return (
        COMMERCIAL_SHOP_PREFABS[placementIndex % COMMERCIAL_SHOP_PREFABS.length] ??
        "commercial-low-a"
      );
    case "house":
      return BUILDING_PREFABS[placementIndex % BUILDING_PREFABS.length] ?? "building-a";
    default:
      return slot;
  }
}

function addBlockPlacements(
  add: (prefabId: string, position: Vector2, yaw?: number) => void,
  canPlace: (prefabId: string, position: Vector2) => boolean,
  centerX: number,
  centerY: number,
  blockIndex: number,
  placements: readonly CityBlockPlacement[],
): void {
  placements.forEach((placement, placementIndex) => {
    const prefabId = prefabForBlockSlot(placement.prefab, blockIndex * 17 + placementIndex);
    const position = {
      x: centerX + placement.offset[0],
      y: centerY + placement.offset[1],
    };
    if (canPlace(prefabId, position)) {
      add(prefabId, position, placement.yaw ?? 0);
    }
  });
}

function smallPropCandidates(
  centerX: number,
  centerY: number,
  blockIndex: number,
  propOrder: CityBlockPropOrder,
): Vector2[] {
  const phase = (blockIndex % 7) * 0.11;
  const candidates: Vector2[] = [];
  for (let offsetY = -15; offsetY <= 15; offsetY += 1.72) {
    for (let offsetX = -15; offsetX <= 15; offsetX += 1.72) {
      candidates.push({ x: centerX + offsetX + phase, y: centerY + offsetY - phase });
    }
  }
  if (propOrder === "columns") {
    return [...candidates].sort((left, right) =>
      left.x === right.x ? left.y - right.y : left.x - right.x,
    );
  }
  if (propOrder === "center-out") {
    return [...candidates].sort(
      (left, right) =>
        Math.hypot(left.x - centerX, left.y - centerY) -
        Math.hypot(right.x - centerX, right.y - centerY),
    );
  }
  if (propOrder === "edge-in") {
    return [...candidates].sort(
      (left, right) =>
        Math.max(Math.abs(right.x - centerX), Math.abs(right.y - centerY)) -
        Math.max(Math.abs(left.x - centerX), Math.abs(left.y - centerY)),
    );
  }
  if (propOrder === "checkerboard") {
    return [...candidates].sort((left, right) => {
      const leftParity = Math.round((left.x + left.y) / 1.72) & 1;
      const rightParity = Math.round((right.x + right.y) / 1.72) & 1;
      return leftParity - rightParity;
    });
  }
  if (propOrder === "diagonal") {
    return [...candidates].sort((left, right) => {
      const leftDiagonal = left.x - centerX + (left.y - centerY);
      const rightDiagonal = right.x - centerX + (right.y - centerY);
      return leftDiagonal === rightDiagonal ? left.x - right.x : leftDiagonal - rightDiagonal;
    });
  }
  return candidates;
}

function addLargeBlock(
  add: (prefabId: string, position: Vector2, yaw?: number) => void,
  canPlace: (prefabId: string, position: Vector2) => boolean,
  centerX: number,
  centerY: number,
  blockIndex: number,
  includeCentralBuilding: boolean,
): void {
  const layout = CITY_BLOCK_LAYOUTS[blockIndex % CITY_BLOCK_LAYOUTS.length];
  if (!layout) {
    throw new Error(`Missing city block layout: ${blockIndex}`);
  }
  addBlockPlacements(add, canPlace, centerX, centerY, blockIndex, layout.structures);
  addBlockPlacements(add, canPlace, centerX, centerY, blockIndex + 29, layout.details);

  if (includeCentralBuilding) {
    const prefabId =
      COMMERCIAL_SHOP_PREFABS[(blockIndex * 5 + 3) % COMMERCIAL_SHOP_PREFABS.length] ??
      "commercial-low-a";
    const center = { x: centerX, y: centerY };
    if (canPlace(prefabId, center)) {
      add(prefabId, center);
    }
  }

  if (includeCentralBuilding) {
    return;
  }

  const candidates = smallPropCandidates(centerX, centerY, blockIndex, layout.propOrder);
  for (const slot of layout.smallProps) {
    const prefabId = prefabForBlockSlot(slot, blockIndex);
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

function ensureAllPrefabsArePlaced(
  objects: readonly WorldObjectState[],
  add: (prefabId: string, position: Vector2, yaw?: number) => void,
  canPlace: (prefabId: string, position: Vector2) => boolean,
): void {
  const placedIds = new Set(objects.map((object) => object.prefabId));
  const missing = PREFAB_DEFINITIONS.filter((definition) => !placedIds.has(definition.id));
  if (missing.length === 0) {
    return;
  }

  const candidates: Vector2[] = [];
  for (let y = -MAP_HALF_SIZE + 4; y <= MAP_HALF_SIZE - 4; y += 3.5) {
    for (let x = -MAP_HALF_SIZE + 4; x <= MAP_HALF_SIZE - 4; x += 3.5) {
      candidates.push({ x, y });
    }
  }
  let candidateOffset = 0;
  for (const definition of missing) {
    let placed = false;
    const requiredRadius = footprintRadius(definition.id);
    for (let attempt = 0; attempt < candidates.length; attempt += 1) {
      const candidate = candidates[(candidateOffset + attempt) % candidates.length];
      if (!candidate) {
        continue;
      }
      const intersectsRoadRoute = ROAD_CENTERS.some(
        (center) =>
          Math.abs(candidate.x - center) < requiredRadius + ROAD_WIDTH / 2 + 1 ||
          Math.abs(candidate.y - center) < requiredRadius + ROAD_WIDTH / 2 + 1,
      );
      const blocksCandidate = objects.some(
        (object) =>
          (object.motion !== null || object.prefabId.startsWith("character-")) &&
          Math.hypot(object.position.x - candidate.x, object.position.y - candidate.y) <
            footprintRadius(object.prefabId) + requiredRadius + 0.04,
      );
      if (intersectsRoadRoute || blocksCandidate || !canPlace(definition.id, candidate)) {
        continue;
      }
      add(definition.id, candidate, ((candidateOffset + attempt) % 4) * (Math.PI / 2));
      candidateOffset += attempt + 1;
      placed = true;
      break;
    }
    if (!placed) {
      throw new Error(`Unable to place required prefab: ${definition.id}`);
    }
  }
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

  const towerEligibleObjectCount = objects.length;
  ensureAllPrefabsArePlaced(objects, add, canPlace);

  const buildingIndices = objects
    .map((object, index) => ({ object, index }))
    .filter(
      ({ object, index }) =>
        index < towerEligibleObjectCount &&
        (object.prefabId.startsWith("building-") || object.prefabId.startsWith("commercial-")),
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
        centerY: object.height * (layer + 0.5) + layer * 0.0001,
      });
    }
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
  const spawnLimit = MAP_HALF_SIZE - INITIAL_HOLE_RADIUS - 1;
  const blockedCells = new Map<string, OccupiedFootprint[]>();
  for (const object of objects) {
    const radius = Math.hypot(object.size.x, object.size.y) / 2;
    const footprint: OccupiedFootprint = {
      id: object.id,
      position: object.position,
      radius,
    };
    const [minimumX, maximumX, minimumY, maximumY] = occupancyCellRange(
      object.position,
      radius + INITIAL_HOLE_RADIUS + SPAWN_SAFETY_MARGIN,
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
    const [minimumX, maximumX, minimumY, maximumY] = occupancyCellRange(position, queryRadius);
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
        x: (randomX * 2 - 1) * spawnLimit,
        y: (randomY * 2 - 1) * spawnLimit,
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
  const objects = buildCityObjects(seed);
  const [holes, rngState] = createHoles(spawnSeed, objects);
  return {
    elapsed: 0,
    remaining: GAME_DURATION_SECONDS,
    status: "playing",
    holes,
    objects,
    rngState,
  };
}
