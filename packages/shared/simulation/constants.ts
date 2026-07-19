export const MAP_HALF_SIZE = 242;
export const INITIAL_HOLE_RADIUS = 1.15;
export const GAME_DURATION_SECONDS = 180;
export const BOT_COUNT = 2;
export const SCENE_OBJECT_COUNT = 13_805;
export const SPATIAL_HASH_CELL_SIZE = 8;
export const BASE_MOVE_SPEED = 8.2;
export const MOVE_SPEED_PER_LEVEL = 0.45;
export const BOT_SPEED_MULTIPLIER = 0.56;
export const BOT_DETECTION_RADIUS = 88;
export const VEHICLE_SPEED = 4.5;
export const PEDESTRIAN_SPEED = 1.15;

export const HOLE_FIT_RATIO = 0.98;
export const GRAVITY_METERS_PER_SECOND_SQUARED = 16.2;
export const GROUND_THICKNESS = 0.35;

export const ROAD_CENTERS = [-220, -176, -132, -88, -44, 0, 44, 88, 132, 176, 220] as const;
export const ROAD_WIDTH = 7;
export const SIDEWALK_WIDTH = 1.5;

export const HOLE_LEVELS = [
  { minimumScore: 0, radius: 1.15 },
  { minimumScore: 12, radius: 1.75 },
  { minimumScore: 40, radius: 2.55 },
  { minimumScore: 110, radius: 3.5 },
  { minimumScore: 260, radius: 4.6 },
  { minimumScore: 600, radius: 5.8 },
  { minimumScore: 1_200, radius: 7.2 },
  { minimumScore: 2_400, radius: 8.8 },
  { minimumScore: 4_500, radius: 10.6 },
  { minimumScore: 8_000, radius: 12.6 },
] as const;
