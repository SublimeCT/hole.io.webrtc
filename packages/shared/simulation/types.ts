export interface Vector2 {
  x: number;
  y: number;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export type HoleKind = "human" | "bot";
export type BotMode = "wander" | "chase";
export type AbilityId = "speed" | "radius" | "bomb";

export interface BotState {
  mode: BotMode;
  targetObjectId: string | null;
  targetScore: number;
  commitRemaining: number;
  sectorIndex: number;
  wanderAngle: number;
  rethinkIn: number;
}

export interface HoleState {
  id: string;
  kind: HoleKind;
  position: Vector2;
  radius: number;
  score: number;
  eliminationRemaining: number;
  eliminations: number;
  revivesRemaining: number;
  invulnerabilityRemaining: number;
  speedBoostRemaining: number;
  speedBoostCooldown: number;
  radiusBoostRemaining: number;
  radiusBoostCooldown: number;
  bombFuseRemaining: number;
  bombCooldown: number;
  isOut: boolean;
  bot: BotState | null;
}

export type WorldObjectShape = "box" | "sphere" | "cylinder";
export type WorldObjectStatus = "static" | "active" | "consumed";
export type RouteAxis = "x" | "y";
export type RouteKind = "vehicle" | "pedestrian";

export interface RouteMotion {
  kind: RouteKind;
  laneId: string;
  axis: RouteAxis;
  direction: -1 | 1;
  speed: number;
  lateralCoordinate: number;
  headingYaw: number;
  minimum: number;
  maximum: number;
}

export interface WorldObjectState {
  id: string;
  prefabId: string;
  shape: WorldObjectShape;
  position: Vector2;
  centerY: number;
  size: Vector2;
  height: number;
  stackLayers: number;
  fitDiameter: number;
  value: number;
  status: WorldObjectStatus;
  velocity: Vector3;
  angularVelocity: Vector3;
  rotation: Quaternion;
  activeTime: number;
  claimedBy: string | null;
  motion: RouteMotion | null;
  routeMotion: RouteMotion | null;
}

export type SimulationStatus = "playing" | "finished";

export interface SimulationState {
  elapsed: number;
  remaining: number;
  status: SimulationStatus;
  holes: readonly HoleState[];
  objects: readonly WorldObjectState[];
  rngState: number;
}

export interface PlayerInput {
  playerId: string;
  direction: Vector2;
  abilities?: readonly AbilityId[];
}

export type SimulationEvent = {
  type: "consumed";
  objectId: string;
  holeId: string;
  value: number;
  position: Vector2;
};

export interface SimulationStepResult {
  state: SimulationState;
  events: readonly SimulationEvent[];
}
