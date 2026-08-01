// Three 41m blocks across and four down, with 7m roads, 1.5m sidewalks, and 8m edge margins.
export const MAP_WIDTH = 169;
export const MAP_HEIGHT = 220;
export const MAP_HALF_WIDTH = MAP_WIDTH / 2;
export const MAP_HALF_HEIGHT = MAP_HEIGHT / 2;
export const INITIAL_HOLE_RADIUS = 1.15;
export const GAME_DURATION_SECONDS = 180;
export const BOT_COUNT = 2;
export const SCENE_OBJECT_COUNT = 715;
export const CITY_BUILDING_COUNT = 157;
export const CITY_VEHICLE_COUNT = 44;
export const CITY_CHARACTER_COUNT = 155;
export const CITY_TRAFFIC_LIGHT_COUNT = 20;
export const TRAFFIC_LIGHT_PREFAB_ID = "traffic-light";
export const CITY_MOVING_CHARACTER_COUNT = 0;
export const CITY_SMALL_OBJECT_COUNTS = {
  4: 150,
  12: 142,
  25: 47,
} as const;
export const SPATIAL_HASH_CELL_SIZE = 8;
export const BASE_MOVE_SPEED = 8.2;
export const MOVE_SPEED_PER_LEVEL = 0.45;
export const BOT_SPEED_MULTIPLIER = 0.56;
export const BOT_DETECTION_RADIUS = 88;
export const VEHICLE_SPEED = 4.5;
export const TRAFFIC_NS_GREEN_SECONDS = 51 / VEHICLE_SPEED;
export const TRAFFIC_EW_GREEN_SECONDS = 51 / VEHICLE_SPEED;
export const TRAFFIC_CYCLE_SECONDS = TRAFFIC_NS_GREEN_SECONDS + TRAFFIC_EW_GREEN_SECONDS;
export const PEDESTRIAN_SPEED = 1.15;

export const SPEED_BOOST_DURATION_SECONDS = 5;
export const SPEED_BOOST_COOLDOWN_SECONDS = 15;
export const RADIUS_BOOST_DURATION_SECONDS = 10;
export const RADIUS_BOOST_COOLDOWN_SECONDS = 25;
export const BOMB_FUSE_SECONDS = 3;
export const BOMB_COOLDOWN_SECONDS = 45;
export const BOMB_RADIUS_MULTIPLIER = 2;
export const POWER_UP_SPAWN_INTERVAL_SECONDS = 60;
export const MAGNET_DURATION_SECONDS = 10;
export const POOP_DURATION_SECONDS = 10;
export const BEER_DURATION_SECONDS = 8;
export const FOOTPRINT_DELAY_SECONDS = 3;
export const FOOTPRINT_MARK_SECONDS = 4;
export const DOUBLE_FOOT_INTERVAL_SECONDS = 5;

export const HOLE_FIT_RATIO = 0.98;
export const GRAVITY_METERS_PER_SECOND_SQUARED = 16.2;
export const GROUND_THICKNESS = 0.35;

export const CITY_BLOCK_COLUMNS = 3;
export const CITY_BLOCK_ROWS = 4;
export const ROAD_X_CENTERS = [-76.5, -25.5, 25.5, 76.5] as const;
export const ROAD_Y_CENTERS = [-102, -51, 0, 51, 102] as const;
export const ROAD_WIDTH = 7;
export const SIDEWALK_WIDTH = 1.5;
export const CITY_BLOCK_SIZE = 41;

export const HOLE_LEVELS = [
  { minimumScore: 0, radius: 1.15 },
  { minimumScore: 36, radius: 1.7 },
  { minimumScore: 108, radius: 2.35 },
  { minimumScore: 234, radius: 3.1 },
  { minimumScore: 432, radius: 4.0 },
  { minimumScore: 720, radius: 5.0 },
  { minimumScore: 1_170, radius: 6.2 },
  { minimumScore: 1_800, radius: 7.5 },
  { minimumScore: 2_700, radius: 9.0 },
  { minimumScore: 4_050, radius: 10.5 },
] as const;
