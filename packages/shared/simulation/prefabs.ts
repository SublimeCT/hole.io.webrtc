import type { Vector2, WorldObjectShape } from "./types";

export interface PrefabDefinition {
  id: string;
  label: string;
  assetPath: string;
  shape: WorldObjectShape;
  size: Vector2;
  height: number;
}

const SUBURBAN_ROOT = "/kits/kenney-city-kit-suburban/models";
const COMMERCIAL_ROOT = "/kits/kenney-city-kit-commercial/models";
const CAR_ROOT = "/kits/kenney-car-kit/models";
const CHARACTER_ROOT = "/kits/kenney-blocky-characters/models";

// GLB bounds scan: 5.469999 units, higher than every other building mesh in the kit.
export const HIGHEST_BUILDING_PREFAB_ID = "commercial-skyscraper-d";

const BUILDING_IDS = [
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
] as const;

const BUILDING_DEFINITIONS: readonly PrefabDefinition[] = BUILDING_IDS.map((suffix, index) => ({
  id: `building-${suffix}`,
  label: `Suburban house type ${suffix.toUpperCase()}`,
  assetPath: `${SUBURBAN_ROOT}/building-type-${suffix}.glb`,
  shape: "box",
  size: { x: 8.2 + (index % 3) * 0.7, y: 7.2 + (index % 2) * 0.8 },
  height: 5.8 + (index % 4) * 0.65,
}));

const COMMERCIAL_BUILDING_IDS = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const COMMERCIAL_SKYSCRAPER_IDS = ["a", "b", "c", "d"] as const;
const COMMERCIAL_LOW_DETAIL_IDS = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

const COMMERCIAL_BUILDING_DEFINITIONS: readonly PrefabDefinition[] = [
  ...COMMERCIAL_BUILDING_IDS.map((suffix, index) => ({
    id: `commercial-building-${suffix}`,
    label: `Commercial building ${suffix.toUpperCase()}`,
    assetPath: `${COMMERCIAL_ROOT}/building-${suffix}.glb`,
    shape: "box" as const,
    size: { x: 8.55 + (index % 3) * 0.35, y: 8.35 + (index % 2) * 0.45 },
    height: 12 + (index % 4) * 2,
  })),
  ...COMMERCIAL_SKYSCRAPER_IDS.map((suffix, index) => ({
    id: `commercial-skyscraper-${suffix}`,
    label: `Commercial skyscraper ${suffix.toUpperCase()}`,
    assetPath: `${COMMERCIAL_ROOT}/building-skyscraper-${suffix}.glb`,
    shape: "box" as const,
    size: { x: 8.8 + (index % 2) * 0.3, y: 8.8 + ((index + 1) % 2) * 0.3 },
    height: 24 + index * 4,
  })),
  ...COMMERCIAL_LOW_DETAIL_IDS.map((suffix, index) => ({
    id: `commercial-low-${suffix}`,
    label: `Low commercial building ${suffix.toUpperCase()}`,
    assetPath: `${COMMERCIAL_ROOT}/low-detail-building-${suffix}.glb`,
    shape: "box" as const,
    size: { x: 4.8 + (index % 2) * 0.2, y: 4.8 + ((index + 1) % 2) * 0.2 },
    height: 7 + (index % 3),
  })),
];

const CHARACTER_LABELS = [
  "Outdoor pedestrian",
  "Red-shirt pedestrian",
  "Senior pedestrian",
  "Crash-test character",
  "Purple-shirt pedestrian",
  "Green-shirt pedestrian",
  "Red service robot",
  "Purple service robot",
  "Scientist",
  "Police officer",
  "Casual pedestrian",
  "Suited zombie",
  "Utility worker",
  "Mime",
  "Casual zombie",
  "Uniformed pedestrian",
  "Business pedestrian",
  "Ninja character",
] as const;

const CHARACTER_DEFINITIONS: readonly PrefabDefinition[] = CHARACTER_LABELS.map((label, index) => {
  const suffix = String.fromCharCode(97 + index);
  return {
    id: `character-${suffix}`,
    label,
    assetPath: `${CHARACTER_ROOT}/character-${suffix}.glb`,
    shape: "box",
    size: { x: 0.72, y: 0.52 },
    height: 1.8,
  };
});

function extraPrefab(
  id: string,
  label: string,
  assetPath: string,
  size: Vector2,
  height: number,
  shape: WorldObjectShape = "box",
): PrefabDefinition {
  return { id, label, assetPath, shape, size, height };
}

const EXTRA_COMMERCIAL_DEFINITIONS: readonly PrefabDefinition[] = [
  ...["i", "j", "k", "l", "m", "n"].map((suffix, index) =>
    extraPrefab(
      `commercial-building-${suffix}`,
      `Commercial building ${suffix.toUpperCase()}`,
      `${COMMERCIAL_ROOT}/building-${suffix}.glb`,
      { x: 8.4 + (index % 3) * 0.45, y: 8.5 + (index % 2) * 0.5 },
      11 + (index % 4) * 2,
    ),
  ),
  extraPrefab(
    "commercial-skyscraper-e",
    "Commercial skyscraper E",
    `${COMMERCIAL_ROOT}/building-skyscraper-e.glb`,
    { x: 8.9, y: 8.8 },
    30,
  ),
  ...["i", "j", "k", "l", "m", "n"].map((suffix, index) =>
    extraPrefab(
      `commercial-low-${suffix}`,
      `Low commercial building ${suffix.toUpperCase()}`,
      `${COMMERCIAL_ROOT}/low-detail-building-${suffix}.glb`,
      { x: 4.8 + (index % 2) * 0.25, y: 4.8 + ((index + 1) % 2) * 0.25 },
      6.8 + (index % 3),
    ),
  ),
  extraPrefab(
    "commercial-low-wide-a",
    "Wide low commercial building A",
    `${COMMERCIAL_ROOT}/low-detail-building-wide-a.glb`,
    { x: 4.8, y: 4.4 },
    6.2,
  ),
  extraPrefab(
    "commercial-low-wide-b",
    "Wide low commercial building B",
    `${COMMERCIAL_ROOT}/low-detail-building-wide-b.glb`,
    { x: 4.9, y: 4.5 },
    6.6,
  ),
  extraPrefab(
    "awning",
    "Shop awning",
    `${COMMERCIAL_ROOT}/detail-awning.glb`,
    { x: 2.4, y: 0.9 },
    0.8,
  ),
  extraPrefab(
    "awning-wide",
    "Wide shop awning",
    `${COMMERCIAL_ROOT}/detail-awning-wide.glb`,
    { x: 4.5, y: 0.9 },
    0.8,
  ),
  extraPrefab(
    "overhang",
    "Shop overhang",
    `${COMMERCIAL_ROOT}/detail-overhang.glb`,
    { x: 2.1, y: 0.8 },
    0.8,
  ),
  extraPrefab(
    "overhang-wide",
    "Wide shop overhang",
    `${COMMERCIAL_ROOT}/detail-overhang-wide.glb`,
    { x: 3.9, y: 0.8 },
    0.8,
  ),
  extraPrefab(
    "parasol-a",
    "Street parasol A",
    `${COMMERCIAL_ROOT}/detail-parasol-a.glb`,
    { x: 1.4, y: 1.4 },
    2.7,
  ),
  extraPrefab(
    "parasol-b",
    "Street parasol B",
    `${COMMERCIAL_ROOT}/detail-parasol-b.glb`,
    { x: 1.4, y: 1.4 },
    2.7,
  ),
];

const EXTRA_VEHICLE_DEFINITIONS: readonly PrefabDefinition[] = [
  extraPrefab(
    "vehicle-delivery-flat",
    "Flatbed delivery vehicle",
    `${CAR_ROOT}/delivery-flat.glb`,
    { x: 2.2, y: 5.2 },
    2.3,
  ),
  extraPrefab(
    "vehicle-kart-oobi",
    "Kart Oobi",
    `${CAR_ROOT}/kart-oobi.glb`,
    { x: 1.4, y: 2.2 },
    1.6,
  ),
  extraPrefab(
    "vehicle-kart-oodi",
    "Kart Oodi",
    `${CAR_ROOT}/kart-oodi.glb`,
    { x: 1.4, y: 2.2 },
    1.6,
  ),
  extraPrefab(
    "vehicle-kart-ooli",
    "Kart Ooli",
    `${CAR_ROOT}/kart-ooli.glb`,
    { x: 1.4, y: 2.2 },
    1.6,
  ),
  extraPrefab(
    "vehicle-kart-oopi",
    "Kart Oopi",
    `${CAR_ROOT}/kart-oopi.glb`,
    { x: 1.4, y: 2.2 },
    1.6,
  ),
  extraPrefab(
    "vehicle-kart-oozi",
    "Kart Oozi",
    `${CAR_ROOT}/kart-oozi.glb`,
    { x: 1.4, y: 2.2 },
    1.6,
  ),
  extraPrefab("vehicle-race", "Race car", `${CAR_ROOT}/race.glb`, { x: 1.8, y: 4.1 }, 1.4),
  extraPrefab(
    "vehicle-race-future",
    "Future race car",
    `${CAR_ROOT}/race-future.glb`,
    { x: 1.8, y: 4.1 },
    1.4,
  ),
  extraPrefab(
    "vehicle-sedan-sports",
    "Sports sedan",
    `${CAR_ROOT}/sedan-sports.glb`,
    { x: 2, y: 4.2 },
    1.55,
  ),
  extraPrefab(
    "vehicle-suv-luxury",
    "Luxury SUV",
    `${CAR_ROOT}/suv-luxury.glb`,
    { x: 2.15, y: 4.5 },
    1.7,
  ),
  extraPrefab("vehicle-tractor", "Tractor", `${CAR_ROOT}/tractor.glb`, { x: 2.3, y: 3.9 }, 2.5),
  extraPrefab(
    "vehicle-tractor-police",
    "Police tractor",
    `${CAR_ROOT}/tractor-police.glb`,
    { x: 2.4, y: 4 },
    2.6,
  ),
  extraPrefab(
    "vehicle-tractor-shovel",
    "Shovel tractor",
    `${CAR_ROOT}/tractor-shovel.glb`,
    { x: 2.6, y: 4 },
    2.8,
  ),
  extraPrefab(
    "vehicle-truck-flat",
    "Flatbed truck",
    `${CAR_ROOT}/truck-flat.glb`,
    { x: 2.3, y: 5.3 },
    2.5,
  ),
];

const EXTRA_CAR_PART_DEFINITIONS: readonly PrefabDefinition[] = [
  extraPrefab("debris-bolt", "Car bolt", `${CAR_ROOT}/debris-bolt.glb`, { x: 0.22, y: 0.22 }, 0.24),
  extraPrefab(
    "debris-door-window",
    "Car door window",
    `${CAR_ROOT}/debris-door-window.glb`,
    { x: 0.35, y: 1.1 },
    0.85,
  ),
  extraPrefab("debris-door", "Car door", `${CAR_ROOT}/debris-door.glb`, { x: 0.35, y: 1.1 }, 0.9),
  extraPrefab(
    "debris-drivetrain-axle",
    "Car axle",
    `${CAR_ROOT}/debris-drivetrain-axle.glb`,
    { x: 1.5, y: 0.4 },
    0.4,
  ),
  extraPrefab(
    "debris-drivetrain",
    "Car drivetrain",
    `${CAR_ROOT}/debris-drivetrain.glb`,
    { x: 1.5, y: 2.2 },
    0.5,
  ),
  extraPrefab("debris-nut", "Car nut", `${CAR_ROOT}/debris-nut.glb`, { x: 0.2, y: 0.2 }, 0.14),
  extraPrefab(
    "debris-plate-b",
    "Metal debris plate B",
    `${CAR_ROOT}/debris-plate-b.glb`,
    { x: 0.9, y: 0.9 },
    0.16,
  ),
  extraPrefab(
    "debris-plate-small-b",
    "Small metal debris plate B",
    `${CAR_ROOT}/debris-plate-small-b.glb`,
    { x: 0.45, y: 0.45 },
    0.16,
  ),
  extraPrefab(
    "debris-spoiler-a",
    "Car spoiler A",
    `${CAR_ROOT}/debris-spoiler-a.glb`,
    { x: 1.4, y: 0.35 },
    0.38,
  ),
  extraPrefab(
    "debris-spoiler-b",
    "Car spoiler B",
    `${CAR_ROOT}/debris-spoiler-b.glb`,
    { x: 1.25, y: 0.35 },
    0.44,
  ),
  ...[
    "wheel-dark",
    "wheel-default",
    "wheel-racing",
    "wheel-tractor-back",
    "wheel-tractor-dark-back",
    "wheel-tractor-dark-front",
    "wheel-tractor-front",
    "wheel-truck",
  ].map((name) =>
    extraPrefab(
      name,
      name.replaceAll("-", " "),
      `${CAR_ROOT}/${name}.glb`,
      { x: 0.72, y: 0.72 },
      0.42,
      "cylinder",
    ),
  ),
];

const EXTRA_SUBURBAN_DEFINITIONS: readonly PrefabDefinition[] = [
  extraPrefab(
    "driveway-long",
    "Long driveway",
    `${SUBURBAN_ROOT}/driveway-long.glb`,
    { x: 3.5, y: 6.8 },
    0.04,
  ),
  extraPrefab(
    "driveway-short",
    "Short driveway",
    `${SUBURBAN_ROOT}/driveway-short.glb`,
    { x: 3.5, y: 3.4 },
    0.04,
  ),
  ...[
    "fence-1x2",
    "fence-1x3",
    "fence-1x4",
    "fence-2x2",
    "fence-2x3",
    "fence-3x2",
    "fence-3x3",
  ].map((name, index) =>
    extraPrefab(
      name,
      name.replaceAll("-", " "),
      `${SUBURBAN_ROOT}/${name}.glb`,
      { x: 1.8 + (index % 3) * 0.7, y: 0.55 + Math.floor(index / 3) * 0.65 },
      1.5,
    ),
  ),
  extraPrefab("path-long", "Long path", `${SUBURBAN_ROOT}/path-long.glb`, { x: 2.4, y: 6.8 }, 0.04),
  extraPrefab(
    "path-short",
    "Short path",
    `${SUBURBAN_ROOT}/path-short.glb`,
    { x: 2.4, y: 3.4 },
    0.04,
  ),
  extraPrefab(
    "path-stones-long",
    "Long stone path",
    `${SUBURBAN_ROOT}/path-stones-long.glb`,
    { x: 2.4, y: 6.8 },
    0.04,
  ),
  extraPrefab(
    "path-stones-messy",
    "Messy stone path",
    `${SUBURBAN_ROOT}/path-stones-messy.glb`,
    { x: 2.8, y: 5.8 },
    0.04,
  ),
  extraPrefab(
    "path-stones-short",
    "Short stone path",
    `${SUBURBAN_ROOT}/path-stones-short.glb`,
    { x: 2.4, y: 3.4 },
    0.04,
  ),
];

export const PREFAB_DEFINITIONS: readonly PrefabDefinition[] = [
  ...BUILDING_DEFINITIONS,
  ...COMMERCIAL_BUILDING_DEFINITIONS,
  ...CHARACTER_DEFINITIONS,
  ...EXTRA_COMMERCIAL_DEFINITIONS,
  ...EXTRA_VEHICLE_DEFINITIONS,
  ...EXTRA_CAR_PART_DEFINITIONS,
  ...EXTRA_SUBURBAN_DEFINITIONS,
  {
    id: "tree-small",
    label: "Small deciduous tree",
    assetPath: `${SUBURBAN_ROOT}/tree-small.glb`,
    shape: "cylinder",
    size: { x: 1.2, y: 1.2 },
    height: 3,
  },
  {
    id: "tree-large",
    label: "Large deciduous tree",
    assetPath: `${SUBURBAN_ROOT}/tree-large.glb`,
    shape: "cylinder",
    size: { x: 2.2, y: 2.2 },
    height: 5.5,
  },
  {
    id: "planter",
    label: "Street planter",
    assetPath: `${SUBURBAN_ROOT}/planter.glb`,
    shape: "box",
    size: { x: 1.2, y: 0.9 },
    height: 0.55,
  },
  {
    id: "fence",
    label: "Residential fence",
    assetPath: `${SUBURBAN_ROOT}/fence.glb`,
    shape: "box",
    size: { x: 3, y: 0.35 },
    height: 1.4,
  },
  {
    id: "fence-low",
    label: "Low residential fence",
    assetPath: `${SUBURBAN_ROOT}/fence-low.glb`,
    shape: "box",
    size: { x: 3, y: 0.35 },
    height: 0.8,
  },
  {
    id: "sedan",
    label: "Sedan",
    assetPath: `${CAR_ROOT}/sedan.glb`,
    shape: "box",
    size: { x: 2, y: 4.2 },
    height: 1.6,
  },
  {
    id: "hatchback",
    label: "Sports hatchback",
    assetPath: `${CAR_ROOT}/hatchback-sports.glb`,
    shape: "box",
    size: { x: 1.9, y: 3.8 },
    height: 1.55,
  },
  {
    id: "suv",
    label: "SUV",
    assetPath: `${CAR_ROOT}/suv.glb`,
    shape: "box",
    size: { x: 2.1, y: 4.4 },
    height: 1.9,
  },
  {
    id: "taxi",
    label: "Taxi",
    assetPath: `${CAR_ROOT}/taxi.glb`,
    shape: "box",
    size: { x: 2, y: 4.2 },
    height: 1.65,
  },
  {
    id: "police",
    label: "Police car",
    assetPath: `${CAR_ROOT}/police.glb`,
    shape: "box",
    size: { x: 2, y: 4.3 },
    height: 1.7,
  },
  {
    id: "van",
    label: "Cargo van",
    assetPath: `${CAR_ROOT}/van.glb`,
    shape: "box",
    size: { x: 2.2, y: 4.8 },
    height: 2.2,
  },
  {
    id: "delivery",
    label: "Delivery truck",
    assetPath: `${CAR_ROOT}/delivery.glb`,
    shape: "box",
    size: { x: 2.3, y: 5.5 },
    height: 2.7,
  },
  {
    id: "truck",
    label: "Pickup truck",
    assetPath: `${CAR_ROOT}/truck.glb`,
    shape: "box",
    size: { x: 2.35, y: 5.4 },
    height: 2.5,
  },
  {
    id: "ambulance",
    label: "Ambulance",
    assetPath: `${CAR_ROOT}/ambulance.glb`,
    shape: "box",
    size: { x: 2.3, y: 5.3 },
    height: 2.7,
  },
  {
    id: "firetruck",
    label: "Fire truck",
    assetPath: `${CAR_ROOT}/firetruck.glb`,
    shape: "box",
    size: { x: 2.45, y: 6.2 },
    height: 3,
  },
  {
    id: "garbage-truck",
    label: "Garbage truck",
    assetPath: `${CAR_ROOT}/garbage-truck.glb`,
    shape: "box",
    size: { x: 2.5, y: 6.5 },
    height: 3,
  },
  {
    id: "cone",
    label: "Traffic cone",
    assetPath: `${CAR_ROOT}/cone.glb`,
    shape: "cylinder",
    size: { x: 0.55, y: 0.55 },
    height: 0.8,
  },
  {
    id: "cone-flat",
    label: "Knocked-over traffic cone",
    assetPath: `${CAR_ROOT}/cone-flat.glb`,
    shape: "box",
    size: { x: 0.7, y: 0.7 },
    height: 0.22,
  },
  {
    id: "crate",
    label: "Cardboard cargo box",
    assetPath: `${CAR_ROOT}/box.glb`,
    shape: "box",
    size: { x: 0.8, y: 0.8 },
    height: 0.8,
  },
  {
    id: "debris-tire",
    label: "Loose car tire",
    assetPath: `${CAR_ROOT}/debris-tire.glb`,
    shape: "cylinder",
    size: { x: 0.7, y: 0.7 },
    height: 0.25,
  },
  {
    id: "debris-bumper",
    label: "Detached car bumper",
    assetPath: `${CAR_ROOT}/debris-bumper.glb`,
    shape: "box",
    size: { x: 1.4, y: 0.35 },
    height: 0.35,
  },
  {
    id: "debris-plate",
    label: "Large metal debris plate",
    assetPath: `${CAR_ROOT}/debris-plate-a.glb`,
    shape: "box",
    size: { x: 0.8, y: 0.5 },
    height: 0.08,
  },
  {
    id: "debris-plate-small",
    label: "Small metal debris plate",
    assetPath: `${CAR_ROOT}/debris-plate-small-a.glb`,
    shape: "box",
    size: { x: 0.45, y: 0.35 },
    height: 0.06,
  },
] as const;

const PREFABS_BY_ID = new Map(PREFAB_DEFINITIONS.map((definition) => [definition.id, definition]));

export function getPrefabDefinition(id: string): PrefabDefinition {
  const definition = PREFABS_BY_ID.get(id);
  if (!definition) {
    throw new Error(`Unknown prefab: ${id}`);
  }
  return definition;
}
