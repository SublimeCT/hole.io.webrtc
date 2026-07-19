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

export const PREFAB_DEFINITIONS: readonly PrefabDefinition[] = [
  ...BUILDING_DEFINITIONS,
  ...COMMERCIAL_BUILDING_DEFINITIONS,
  ...CHARACTER_DEFINITIONS,
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
