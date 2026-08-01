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
export type PowerUpType = "magnet" | "shrink" | "foot" | "burger" | "poop" | "doubleFoot" | "beer";

export interface ActivePowerUp {
  type: PowerUpType;
  remaining: number;
}

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
  activePowerUps: readonly ActivePowerUp[];
  nextPoopDropIn: number;
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
  initialCoordinate: number;
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
  /** Uniform scale applied to the prefab's authored dimensions. */
  sizeMultiplier: number;
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
  /** >0 while a footprint-swallowed object remains visible as it fades below ground. */
  footprintFadeRemaining?: number;
}

export type SimulationStatus = "playing" | "finished";

export interface SimulationState {
  elapsed: number;
  remaining: number;
  status: SimulationStatus;
  holes: readonly HoleState[];
  objects: readonly WorldObjectState[];
  powerUps: readonly MapPowerUp[];
  footprints: readonly FootprintStrike[];
  poopHazards: readonly PoopHazard[];
  positionHistory: readonly PositionHistorySample[];
  nextPowerUpSpawnAt: number;
  rngState: number;
}

export interface MapPowerUp {
  id: string;
  type: PowerUpType;
  position: Vector2;
}

export interface FootprintStrike {
  id: string;
  ownerId: string;
  position: Vector2;
  width: number;
  length: number;
  rotation: number;
  impactRemaining: number;
  fadeRemaining: number;
}

export interface PoopHazard {
  id: string;
  ownerId: string;
  position: Vector2;
}

export interface PositionHistorySample {
  holeId: string;
  elapsed: number;
  position: Vector2;
}

export interface PlayerInput {
  playerId: string;
  direction: Vector2;
  abilities?: readonly AbilityId[];
}

export type SimulationEvent =
  | {
      type: "consumed" | "player-defeated";
      objectId: string;
      holeId: string;
      value: number;
      position: Vector2;
    }
  | { type: "power-up-collected"; holeId: string; powerUpType: PowerUpType }
  | { type: "poop-hit"; holeId: string };

export interface SimulationStepResult {
  state: SimulationState;
  events: readonly SimulationEvent[];
}
