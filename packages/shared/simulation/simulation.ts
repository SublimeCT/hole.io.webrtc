import {
  BASE_MOVE_SPEED,
  BOMB_COOLDOWN_SECONDS,
  BOMB_FUSE_SECONDS,
  BOMB_RADIUS_MULTIPLIER,
  BEER_DURATION_SECONDS,
  DOUBLE_FOOT_INTERVAL_SECONDS,
  FOOTPRINT_DELAY_SECONDS,
  FOOTPRINT_MARK_SECONDS,
  BOT_DETECTION_RADIUS,
  BOT_SPEED_MULTIPLIER,
  HOLE_FIT_RATIO,
  INITIAL_HOLE_RADIUS,
  MAP_HALF_HEIGHT,
  MAP_HALF_WIDTH,
  MOVE_SPEED_PER_LEVEL,
  MAGNET_DURATION_SECONDS,
  POOP_DURATION_SECONDS,
  POWER_UP_SPAWN_INTERVAL_SECONDS,
  ROAD_X_CENTERS,
  ROAD_Y_CENTERS,
  ROAD_WIDTH,
  RADIUS_BOOST_COOLDOWN_SECONDS,
  RADIUS_BOOST_DURATION_SECONDS,
  SPATIAL_HASH_CELL_SIZE,
  SPEED_BOOST_COOLDOWN_SECONDS,
  SPEED_BOOST_DURATION_SECONDS,
} from "./constants";
import { stepActivePhysics } from "./physics";
import { isInsideNormalizedFootprint } from "./footprint";
import { getHoleProgress } from "./progression";
import { SpatialHash } from "./spatialHash";
import type {
  AbilityId,
  FootprintStrike,
  BotState,
  HoleState,
  PlayerInput,
  SimulationEvent,
  SimulationState,
  SimulationStepResult,
  PowerUpType,
  Vector2,
  WorldObjectState,
} from "./types";

const MAX_OBJECT_FOOTPRINT_RADIUS = 7;
const PLAYER_CAPTURE_SCORE = 300;
const BOMB_SCORE_RATIO = 0.1;
const BOMB_SCORE_CAP = 1_000;
const BOT_ACTIVE_TARGET_TIMEOUT_SECONDS = 4;
const HOLE_RESPAWN_SECONDS = 1.8;
const RESPAWN_INVULNERABILITY_SECONDS = 5;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalize(vector: Vector2): Vector2 {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= 0.0001) {
    return { x: 0, y: 0 };
  }
  return { x: vector.x / length, y: vector.y / length };
}

function radiusForHole(hole: HoleState, score = hole.score): number {
  return getHoleProgress(score).radius;
}

function normalizedHole(hole: HoleState): HoleState {
  return {
    ...hole,
    speedBoostRemaining: hole.speedBoostRemaining ?? 0,
    speedBoostCooldown: hole.speedBoostCooldown ?? 0,
    radiusBoostRemaining: hole.radiusBoostRemaining ?? 0,
    radiusBoostCooldown: hole.radiusBoostCooldown ?? 0,
    bombFuseRemaining: hole.bombFuseRemaining ?? 0,
    bombCooldown: hole.bombCooldown ?? 0,
    activePowerUps: hole.activePowerUps ?? [],
    nextPoopDropIn: hole.nextPoopDropIn ?? 0,
  };
}

function canFitThroughHole(hole: HoleState, object: WorldObjectState): boolean {
  return object.fitDiameter <= hole.radius * 2 * HOLE_FIT_RATIO;
}

function nextRandom(state: number): readonly [number, number] {
  let next = state >>> 0;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  return [(next >>> 0) / 4_294_967_296, next >>> 0];
}

function findNearestEdibleObject(
  hole: HoleState,
  objects: readonly WorldObjectState[],
): readonly [WorldObjectState | null, number] {
  let best: WorldObjectState | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const object of objects) {
    if (object.status !== "static" || object.motion !== null || !canFitThroughHole(hole, object)) {
      continue;
    }
    if (
      Math.hypot(object.position.x - hole.position.x, object.position.y - hole.position.y) >
      Math.min(BOT_DETECTION_RADIUS, 24)
    ) {
      continue;
    }
    const distance = Math.hypot(
      object.position.x - hole.position.x,
      object.position.y - hole.position.y,
    );
    if (distance < bestDistance || (distance === bestDistance && object.id < (best?.id ?? ""))) {
      best = object;
      bestDistance = distance;
    }
  }
  return [best, best ? 1 / Math.max(1, bestDistance) : 0];
}

interface BotDecision {
  bot: BotState;
  direction: Vector2;
  rngState: number;
  releasedObjectId: string | null;
}

function decideBotInput(
  hole: HoleState,
  objects: readonly WorldObjectState[],
  deltaSeconds: number,
  rngState: number,
): BotDecision {
  const current = hole.bot;
  if (!current) {
    return {
      bot: {
        mode: "wander",
        targetObjectId: null,
        targetScore: 0,
        commitRemaining: 0,
        sectorIndex: 0,
        wanderAngle: 0,
        rethinkIn: 1,
      },
      direction: { x: 0, y: 0 },
      rngState,
      releasedObjectId: null,
    };
  }

  let bot = {
    ...current,
    rethinkIn: current.rethinkIn - deltaSeconds,
    commitRemaining: Math.max(0, current.commitRemaining - deltaSeconds),
  };
  let nextRngState = rngState;
  let releasedObjectId: string | null = null;
  const currentTarget = objects.find(
    (object) =>
      object.id === bot.targetObjectId &&
      (object.status === "static" || (object.status === "active" && object.claimedBy === hole.id)),
  );
  const targetIsValid =
    currentTarget !== undefined &&
    (currentTarget.status === "active" || canFitThroughHole(hole, currentTarget));

  if (
    currentTarget?.status === "active" &&
    currentTarget.activeTime >= BOT_ACTIVE_TARGET_TIMEOUT_SECONDS
  ) {
    const [random, updatedRngState] = nextRandom(nextRngState);
    nextRngState = updatedRngState;
    releasedObjectId = currentTarget.id;
    bot = {
      ...bot,
      mode: "wander",
      targetObjectId: null,
      targetScore: 0,
      commitRemaining: 1.2,
      wanderAngle: bot.wanderAngle + Math.PI * (0.65 + random * 0.35),
      rethinkIn: 0.8,
    };
  } else if (currentTarget?.status === "active") {
    bot = { ...bot, mode: "chase", commitRemaining: 4, rethinkIn: 0.5 };
  } else if (
    (bot.mode === "chase" && !targetIsValid) ||
    (bot.rethinkIn <= 0 && bot.commitRemaining <= 0)
  ) {
    const [candidate, candidateScore] = findNearestEdibleObject(hole, objects);
    const currentScore =
      currentTarget && currentTarget.status === "static"
        ? 1 /
          Math.max(
            1,
            Math.hypot(
              currentTarget.position.x - hole.position.x,
              currentTarget.position.y - hole.position.y,
            ),
          )
        : 0;
    const shouldReplace =
      !targetIsValid ||
      (candidate !== null &&
        candidate.id !== bot.targetObjectId &&
        candidateScore > currentScore * 1.35);
    if (candidate && shouldReplace) {
      bot = {
        mode: "chase",
        targetObjectId: candidate.id,
        targetScore: candidateScore,
        commitRemaining: 2.4,
        sectorIndex: bot.sectorIndex,
        wanderAngle: bot.wanderAngle,
        rethinkIn: 0.65,
      };
    } else if (!targetIsValid) {
      const [random, updatedRngState] = nextRandom(nextRngState);
      nextRngState = updatedRngState;
      const sectorIndex = (bot.sectorIndex + 1 + Math.floor(random * 3)) % 8;
      const sectorAngle = (sectorIndex / 8) * Math.PI * 2;
      bot = {
        mode: "wander",
        targetObjectId: null,
        targetScore: 0,
        commitRemaining: 1.5,
        sectorIndex,
        wanderAngle: sectorAngle,
        rethinkIn: 1.1 + random * 0.5,
      };
    } else {
      bot = { ...bot, rethinkIn: 0.65, commitRemaining: 1.2 };
    }
  }

  const target = objects.find(
    (object) =>
      object.id === bot.targetObjectId &&
      (object.status === "static" || (object.status === "active" && object.claimedBy === hole.id)),
  );
  const distanceToTarget = target
    ? Math.hypot(target.position.x - hole.position.x, target.position.y - hole.position.y)
    : Number.POSITIVE_INFINITY;
  const direction = target
    ? distanceToTarget <= 0.08
      ? { x: 0, y: 0 }
      : normalize({
          x: target.position.x - hole.position.x,
          y: target.position.y - hole.position.y,
        })
    : { x: Math.cos(bot.wanderAngle), y: Math.sin(bot.wanderAngle) };
  return { bot, direction, rngState: nextRngState, releasedObjectId };
}

function moveHole(hole: HoleState, direction: Vector2, deltaSeconds: number): HoleState {
  const normalized = normalize(direction);
  const limitX = Math.max(0, MAP_HALF_WIDTH - hole.radius);
  const limitY = Math.max(0, MAP_HALF_HEIGHT - hole.radius);
  const levelSpeed = BASE_MOVE_SPEED + getHoleProgress(hole.score).level * MOVE_SPEED_PER_LEVEL;
  const boostMultiplier = hole.speedBoostRemaining > 0 ? 2 : 1;
  const beerMultiplier = hole.activePowerUps.some((effect) => effect.type === "beer") ? 0.5 : 1;
  const moveSpeed =
    (hole.kind === "bot" ? levelSpeed * BOT_SPEED_MULTIPLIER : levelSpeed) *
    boostMultiplier *
    beerMultiplier;
  return {
    ...hole,
    position: {
      x: clamp(hole.position.x + normalized.x * moveSpeed * deltaSeconds, -limitX, limitX),
      y: clamp(hole.position.y + normalized.y * moveSpeed * deltaSeconds, -limitY, limitY),
    },
  };
}

function updateAbilityState(
  hole: HoleState,
  requested: readonly AbilityId[],
  deltaSeconds: number,
): HoleState {
  let next: HoleState = {
    ...hole,
    speedBoostRemaining: Math.max(0, (hole.speedBoostRemaining ?? 0) - deltaSeconds),
    speedBoostCooldown: Math.max(0, (hole.speedBoostCooldown ?? 0) - deltaSeconds),
    radiusBoostRemaining: Math.max(0, (hole.radiusBoostRemaining ?? 0) - deltaSeconds),
    radiusBoostCooldown: Math.max(0, (hole.radiusBoostCooldown ?? 0) - deltaSeconds),
    bombFuseRemaining: Math.max(0, (hole.bombFuseRemaining ?? 0) - deltaSeconds),
    bombCooldown: Math.max(0, (hole.bombCooldown ?? 0) - deltaSeconds),
  };
  for (const ability of requested) {
    if (ability === "speed" && next.speedBoostCooldown <= 0 && next.speedBoostRemaining <= 0) {
      next = {
        ...next,
        speedBoostRemaining: SPEED_BOOST_DURATION_SECONDS,
        speedBoostCooldown: SPEED_BOOST_COOLDOWN_SECONDS,
      };
    } else if (
      ability === "radius" &&
      next.radiusBoostCooldown <= 0 &&
      next.radiusBoostRemaining <= 0
    ) {
      const promotedScore = getHoleProgress(next.score).nextScore;
      if (promotedScore === null) {
        continue;
      }
      next = {
        ...next,
        score: promotedScore,
        radius: getHoleProgress(promotedScore).radius,
        radiusBoostRemaining: RADIUS_BOOST_DURATION_SECONDS,
        radiusBoostCooldown: RADIUS_BOOST_COOLDOWN_SECONDS,
      };
    } else if (ability === "bomb" && next.bombCooldown <= 0 && next.bombFuseRemaining <= 0) {
      next = { ...next, bombFuseRemaining: BOMB_FUSE_SECONDS, bombCooldown: BOMB_COOLDOWN_SECONDS };
    }
  }
  return next;
}

function resolveBombs(
  previousHoles: readonly HoleState[],
  holes: readonly HoleState[],
): { holes: readonly HoleState[]; events: readonly SimulationEvent[] } {
  const next = holes.map((hole) => ({ ...hole }));
  const events: SimulationEvent[] = [];
  for (let index = 0; index < next.length; index += 1) {
    const bomber = next[index];
    const previousBomber = previousHoles[index];
    if (
      !bomber ||
      !previousBomber ||
      previousBomber.bombFuseRemaining <= 0 ||
      bomber.bombFuseRemaining > 0 ||
      bomber.eliminationRemaining > 0 ||
      bomber.isOut
    ) {
      continue;
    }
    const blastRadius = bomber.radius * BOMB_RADIUS_MULTIPLIER;
    for (let targetIndex = 0; targetIndex < next.length; targetIndex += 1) {
      if (targetIndex === index) continue;
      const target = next[targetIndex];
      if (
        !target ||
        target.eliminationRemaining > 0 ||
        target.isOut ||
        target.invulnerabilityRemaining > 0
      ) {
        continue;
      }
      if (
        Math.hypot(target.position.x - bomber.position.x, target.position.y - bomber.position.y) >
        blastRadius
      ) {
        continue;
      }
      const currentBomber = next[index] ?? bomber;
      const gainedScore = Math.min(BOMB_SCORE_CAP, Math.round(target.score * BOMB_SCORE_RATIO));
      const bomberScore = currentBomber.score + gainedScore;
      next[index] = {
        ...currentBomber,
        score: bomberScore,
        radius: radiusForHole(currentBomber, bomberScore),
      };
      next[targetIndex] = {
        ...target,
        eliminationRemaining: HOLE_RESPAWN_SECONDS,
        eliminations: target.eliminations + 1,
        isOut: false,
      };
      events.push({
        type: "player-defeated",
        objectId: target.id,
        holeId: bomber.id,
        value: gainedScore,
        position: { ...target.position },
      });
    }
  }
  return { holes: next, events };
}

function canCaptureHole(winner: HoleState, loser: HoleState): boolean {
  return (
    winner.radius > loser.radius + 0.001 &&
    Math.hypot(winner.position.x - loser.position.x, winner.position.y - loser.position.y) +
      loser.radius <=
      winner.radius + 0.001
  );
}

function findRespawnPosition(
  holes: readonly HoleState[],
  excludedId: string,
  rngState: number,
): readonly [Vector2, number] {
  let nextState = rngState;
  const limitX = MAP_HALF_WIDTH - INITIAL_HOLE_RADIUS - 8;
  const limitY = MAP_HALF_HEIGHT - INITIAL_HOLE_RADIUS - 8;
  for (let attempt = 0; attempt < 96; attempt += 1) {
    const [randomX, stateAfterX] = nextRandom(nextState);
    const [randomY, stateAfterY] = nextRandom(stateAfterX);
    nextState = stateAfterY;
    const position = { x: (randomX * 2 - 1) * limitX, y: (randomY * 2 - 1) * limitY };
    const isSafe = holes.every(
      (hole) =>
        hole.id === excludedId ||
        hole.eliminationRemaining > 0 ||
        hole.isOut ||
        Math.hypot(hole.position.x - position.x, hole.position.y - position.y) >=
          hole.radius + INITIAL_HOLE_RADIUS + 12,
    );
    if (isSafe) {
      return [position, nextState];
    }
  }
  return [{ x: 0, y: 0 }, nextState];
}

interface HoleResolution {
  holes: readonly HoleState[];
  rngState: number;
}

function resolveHoleConsumption(
  holes: readonly HoleState[],
  deltaSeconds: number,
  rngState: number,
): HoleResolution {
  const nextHoles = holes.map((hole) => ({ ...hole, position: { ...hole.position } }));
  let nextRngState = rngState;
  for (let index = 0; index < nextHoles.length; index += 1) {
    const hole = nextHoles[index];
    if (!hole || hole.isOut) {
      continue;
    }
    if (hole.eliminationRemaining > 0) {
      const eliminationRemaining = Math.max(0, hole.eliminationRemaining - deltaSeconds);
      if (eliminationRemaining > 0) {
        nextHoles[index] = { ...hole, eliminationRemaining };
        continue;
      }
      const [position, updatedRngState] = findRespawnPosition(nextHoles, hole.id, nextRngState);
      nextRngState = updatedRngState;
      nextHoles[index] = {
        ...hole,
        position,
        radius: getHoleProgress(hole.score).radius,
        eliminationRemaining: 0,
        invulnerabilityRemaining: RESPAWN_INVULNERABILITY_SECONDS,
        speedBoostRemaining: 0,
        speedBoostCooldown: 0,
        radiusBoostRemaining: 0,
        radiusBoostCooldown: 0,
        bombFuseRemaining: 0,
        bombCooldown: 0,
        bot:
          hole.kind === "bot"
            ? {
                mode: "wander",
                targetObjectId: null,
                targetScore: 0,
                commitRemaining: 0,
                sectorIndex: 0,
                wanderAngle: 0,
                rethinkIn: 0.35,
              }
            : null,
      };
      continue;
    }
    if (hole.invulnerabilityRemaining > 0) {
      nextHoles[index] = {
        ...hole,
        invulnerabilityRemaining: Math.max(0, hole.invulnerabilityRemaining - deltaSeconds),
      };
    }
  }
  for (let firstIndex = 0; firstIndex < nextHoles.length; firstIndex += 1) {
    const first = nextHoles[firstIndex];
    if (!first || first.eliminationRemaining > 0 || first.isOut) {
      continue;
    }
    for (let secondIndex = firstIndex + 1; secondIndex < nextHoles.length; secondIndex += 1) {
      const second = nextHoles[secondIndex];
      if (
        !second ||
        second.eliminationRemaining > 0 ||
        second.isOut ||
        Math.abs(first.radius - second.radius) < 0.001
      ) {
        continue;
      }
      const winnerIndex = first.radius > second.radius ? firstIndex : secondIndex;
      const loserIndex = winnerIndex === firstIndex ? secondIndex : firstIndex;
      const winner = nextHoles[winnerIndex];
      const loser = nextHoles[loserIndex];
      if (
        !winner ||
        !loser ||
        loser.invulnerabilityRemaining > 0 ||
        !canCaptureHole(winner, loser)
      ) {
        continue;
      }
      const gainedScore = PLAYER_CAPTURE_SCORE;
      const score = winner.score + gainedScore;
      nextHoles[winnerIndex] = {
        ...winner,
        score,
        radius: radiusForHole(winner, score),
      };
      const nextEliminations = loser.eliminations + 1;
      nextHoles[loserIndex] = {
        ...loser,
        radius: getHoleProgress(loser.score).radius,
        eliminationRemaining: HOLE_RESPAWN_SECONDS,
        eliminations: nextEliminations,
        isOut: false,
        speedBoostRemaining: 0,
        speedBoostCooldown: 0,
        radiusBoostRemaining: 0,
        radiusBoostCooldown: 0,
        bombFuseRemaining: 0,
        bombCooldown: 0,
      };
    }
  }
  return { holes: nextHoles, rngState: nextRngState };
}

const POWER_UP_TYPES: readonly PowerUpType[] = [
  "magnet",
  "shrink",
  "foot",
  "burger",
  "poop",
  "doubleFoot",
  "beer",
];

function addTimedPowerUp(hole: HoleState, type: PowerUpType, remaining: number): HoleState {
  return {
    ...hole,
    activePowerUps: [
      ...hole.activePowerUps.filter((effect) => effect.type !== type),
      { type, remaining },
    ],
  };
}

function createFootprints(
  hole: HoleState,
  type: "foot" | "doubleFoot",
  elapsed: number,
): readonly FootprintStrike[] {
  const count = type === "doubleFoot" ? 2 : 1;
  return Array.from({ length: count }, (_, index) => ({
    id: `footprint-${hole.id}-${Math.round(elapsed * 1_000)}-${index}`,
    ownerId: hole.id,
    position: { ...hole.position },
    width: hole.radius * 3,
    length: hole.radius * 6,
    rotation: 0,
    impactRemaining: FOOTPRINT_DELAY_SECONDS + index * DOUBLE_FOOT_INTERVAL_SECONDS,
    fadeRemaining: 0,
  }));
}

function isInsideFootprint(object: WorldObjectState, footprint: FootprintStrike): boolean {
  const cosine = Math.cos(-footprint.rotation);
  const sine = Math.sin(-footprint.rotation);
  const deltaX = object.position.x - footprint.position.x;
  const deltaY = object.position.y - footprint.position.y;
  const localX = deltaX * cosine - deltaY * sine;
  const localY = deltaX * sine + deltaY * cosine;
  return isInsideNormalizedFootprint({
    x: localX / footprint.width,
    y: localY / footprint.length,
  });
}

function positionAt(
  history: SimulationState["positionHistory"],
  hole: HoleState,
  elapsed: number,
): Vector2 {
  const sample = [...history]
    .reverse()
    .find((entry) => entry.holeId === hole.id && entry.elapsed <= elapsed);
  return sample ? { ...sample.position } : { ...hole.position };
}

function updatePowerUpEffects(
  holes: readonly HoleState[],
  history: SimulationState["positionHistory"],
  elapsed: number,
  deltaSeconds: number,
): { holes: readonly HoleState[]; hazards: SimulationState["poopHazards"] } {
  const hazards: Array<SimulationState["poopHazards"][number]> = [];
  const nextHoles = holes.map((hole) => {
    const hadPoop = hole.activePowerUps.some((effect) => effect.type === "poop");
    const activePowerUps = hole.activePowerUps
      .map((effect) => ({ ...effect, remaining: Math.max(0, effect.remaining - deltaSeconds) }))
      .filter((effect) => effect.remaining > 0);
    let nextPoopDropIn = Math.max(0, hole.nextPoopDropIn - deltaSeconds);
    if (hadPoop && nextPoopDropIn <= 0 && hole.eliminationRemaining <= 0 && !hole.isOut) {
      hazards.push({
        id: `poop-${hole.id}-${Math.round(elapsed * 1_000)}`,
        ownerId: hole.id,
        position: positionAt(history, hole, elapsed - 2),
      });
      nextPoopDropIn = 2;
    }
    return { ...hole, activePowerUps, nextPoopDropIn };
  });
  return { holes: nextHoles, hazards };
}

function collectPowerUps(
  holes: readonly HoleState[],
  powerUps: SimulationState["powerUps"],
  objects: readonly WorldObjectState[],
  elapsed: number,
): {
  holes: readonly HoleState[];
  powerUps: SimulationState["powerUps"];
  objects: readonly WorldObjectState[];
  footprints: readonly FootprintStrike[];
  events: readonly SimulationEvent[];
} {
  const nextHoles = holes.map((hole) => ({ ...hole }));
  let nextObjects = objects;
  const collected = new Set<string>();
  const footprints: FootprintStrike[] = [];
  const events: SimulationEvent[] = [];
  for (const powerUp of powerUps) {
    const holeIndex = nextHoles.findIndex(
      (hole) =>
        hole.eliminationRemaining <= 0 &&
        !hole.isOut &&
        Math.hypot(powerUp.position.x - hole.position.x, powerUp.position.y - hole.position.y) <=
          hole.radius,
    );
    if (holeIndex < 0) continue;
    const hole = nextHoles[holeIndex];
    if (!hole) continue;
    collected.add(powerUp.id);
    if (powerUp.type === "burger") {
      const score = hole.score + 400;
      nextHoles[holeIndex] = { ...hole, score, radius: radiusForHole(hole, score) };
    } else if (powerUp.type === "shrink") {
      const range = hole.radius * 5;
      nextObjects = nextObjects.map((object) =>
        object.status === "static" &&
        Math.hypot(object.position.x - hole.position.x, object.position.y - hole.position.y) <=
          range + Math.hypot(object.size.x, object.size.y) / 2
          ? {
              ...object,
              size: { x: object.size.x * 0.5, y: object.size.y * 0.5 },
              height: object.height * 0.5,
              sizeMultiplier: object.sizeMultiplier * 0.5,
              fitDiameter: object.fitDiameter * 0.5,
              centerY: object.centerY * 0.5,
            }
          : object,
      );
      nextHoles[holeIndex] = addTimedPowerUp(hole, powerUp.type, 0.8);
    } else if (powerUp.type === "foot" || powerUp.type === "doubleFoot") {
      footprints.push(...createFootprints(hole, powerUp.type, elapsed));
      nextHoles[holeIndex] = addTimedPowerUp(hole, powerUp.type, powerUp.type === "foot" ? 4 : 9);
    } else {
      const duration =
        powerUp.type === "magnet"
          ? MAGNET_DURATION_SECONDS
          : powerUp.type === "poop"
            ? POOP_DURATION_SECONDS
            : BEER_DURATION_SECONDS;
      nextHoles[holeIndex] = {
        ...addTimedPowerUp(hole, powerUp.type, duration),
        nextPoopDropIn: powerUp.type === "poop" ? 2 : hole.nextPoopDropIn,
      };
    }
    events.push({ type: "power-up-collected", holeId: hole.id, powerUpType: powerUp.type });
  }
  return {
    holes: nextHoles,
    powerUps: powerUps.filter((powerUp) => !collected.has(powerUp.id)),
    objects: nextObjects,
    footprints,
    events,
  };
}

function wrapRoutePosition(value: number, minimum: number, maximum: number): number {
  const span = maximum - minimum;
  if (span <= 0) {
    return minimum;
  }
  if (value > maximum) {
    return minimum + ((value - minimum) % span);
  }
  if (value < minimum) {
    return maximum - ((maximum - value) % span);
  }
  return value;
}

function applyTrafficSignal(
  object: WorldObjectState,
  current: number,
  next: number,
  elapsedSeconds: number,
): number {
  const motion = object.motion;
  if (!motion || motion.kind !== "vehicle") {
    return next;
  }
  const phase = elapsedSeconds % 16;
  const hasGreen = motion.axis === "y" ? phase < 6 : phase >= 8 && phase < 14;
  if (hasGreen) {
    return next;
  }
  const stopDistance = ROAD_WIDTH / 2 + object.size.y / 2 + 0.8;
  const intersections = motion.axis === "x" ? ROAD_X_CENTERS : ROAD_Y_CENTERS;
  for (const intersection of intersections) {
    const currentDistance = (intersection - current) * motion.direction;
    const nextDistance = (intersection - next) * motion.direction;
    if (Math.abs(currentDistance - stopDistance) < 0.05) {
      return current;
    }
    if (currentDistance > stopDistance && nextDistance <= stopDistance) {
      return intersection - motion.direction * stopDistance;
    }
  }
  return next;
}

function moveRoutedObject(
  object: WorldObjectState,
  deltaSeconds: number,
  elapsedSeconds: number,
): WorldObjectState {
  if (object.status !== "static" || !object.motion) {
    return object;
  }
  const motion = object.motion;
  const position = { ...object.position };
  if (motion.axis === "x") {
    position.y = motion.lateralCoordinate;
  } else {
    position.x = motion.lateralCoordinate;
  }
  const current = position[motion.axis];
  const routed = wrapRoutePosition(
    current + motion.direction * motion.speed * deltaSeconds,
    motion.minimum,
    motion.maximum,
  );
  position[motion.axis] = applyTrafficSignal(object, current, routed, elapsedSeconds);
  return { ...object, position };
}

function vehicleFootprintsOverlap(left: WorldObjectState, right: WorldObjectState): boolean {
  const leftMotion = left.motion;
  const rightMotion = right.motion;
  if (!leftMotion || !rightMotion) {
    return false;
  }
  const leftHalfX = leftMotion.axis === "x" ? left.size.y / 2 : left.size.x / 2;
  const leftHalfY = leftMotion.axis === "y" ? left.size.y / 2 : left.size.x / 2;
  const rightHalfX = rightMotion.axis === "x" ? right.size.y / 2 : right.size.x / 2;
  const rightHalfY = rightMotion.axis === "y" ? right.size.y / 2 : right.size.x / 2;
  return (
    Math.abs(left.position.x - right.position.x) < leftHalfX + rightHalfX &&
    Math.abs(left.position.y - right.position.y) < leftHalfY + rightHalfY
  );
}

function enforceVehicleSpacing(objects: readonly WorldObjectState[]): readonly WorldObjectState[] {
  const groups = new Map<string, { index: number; object: WorldObjectState }[]>();
  const vehicleIndices: number[] = [];
  objects.forEach((object, index) => {
    const motion = object.motion;
    if (object.status !== "static" || !motion || motion.kind !== "vehicle") {
      return;
    }
    vehicleIndices.push(index);
    const key = motion.laneId;
    const group = groups.get(key) ?? [];
    group.push({ index, object });
    groups.set(key, group);
  });

  const nextObjects = [...objects];
  for (const group of groups.values()) {
    group.sort((left, right) => {
      const leftMotion = left.object.motion;
      const rightMotion = right.object.motion;
      if (!leftMotion || !rightMotion) {
        return 0;
      }
      return (
        (right.object.position[rightMotion.axis] - left.object.position[leftMotion.axis]) *
        leftMotion.direction
      );
    });
    for (let index = 1; index < group.length; index += 1) {
      const leaderEntry = group[index - 1];
      const followerEntry = group[index];
      if (!leaderEntry || !followerEntry || !followerEntry.object.motion) {
        continue;
      }
      const leader = nextObjects[leaderEntry.index] ?? leaderEntry.object;
      const follower = nextObjects[followerEntry.index] ?? followerEntry.object;
      const motion = followerEntry.object.motion;
      const leaderPosition = leader.position[motion.axis];
      const followerPosition = follower.position[motion.axis];
      const minimumGap = leader.size.y / 2 + follower.size.y / 2 + 1.2;
      if ((leaderPosition - followerPosition) * motion.direction < minimumGap) {
        const position = { ...follower.position };
        position[motion.axis] = leaderPosition - motion.direction * minimumGap;
        nextObjects[followerEntry.index] = { ...follower, position };
      }
    }
  }
  for (let pass = 0; pass < 3; pass += 1) {
    const intersectionCells = new Map<string, number[]>();
    for (const leftIndex of vehicleIndices) {
      const left = nextObjects[leftIndex];
      if (!left?.motion || left.motion.kind !== "vehicle" || left.status !== "static") {
        continue;
      }
      const cellX = Math.floor(left.position.x / 10);
      const cellY = Math.floor(left.position.y / 10);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const nearbyIndices =
            intersectionCells.get(`${cellX + offsetX}:${cellY + offsetY}`) ?? [];
          for (const rightIndex of nearbyIndices) {
            const right = nextObjects[rightIndex];
            if (!right || !vehicleFootprintsOverlap(left, right)) {
              continue;
            }
            const yieldingIndex = left.id > right.id ? leftIndex : rightIndex;
            const yielding = nextObjects[yieldingIndex];
            if (!yielding?.motion) {
              continue;
            }
            const position = { ...yielding.position };
            const yieldingHalfLength =
              yielding.motion.axis === "x" ? yielding.size.y / 2 : yielding.size.x / 2;
            position[yielding.motion.axis] -=
              yielding.motion.direction * (yieldingHalfLength + 1.4);
            nextObjects[yieldingIndex] = { ...yielding, position };
          }
        }
      }
      const key = `${cellX}:${cellY}`;
      const indices = intersectionCells.get(key) ?? [];
      indices.push(leftIndex);
      intersectionCells.set(key, indices);
    }
  }
  return nextObjects;
}

function activateObject(object: WorldObjectState, hole: HoleState): WorldObjectState {
  return {
    ...object,
    status: "active",
    claimedBy: hole.id,
    activeTime: 0,
    motion: null,
  };
}

function applyConsumedScores(
  holes: readonly HoleState[],
  consumedObjects: readonly WorldObjectState[],
): readonly HoleState[] {
  return holes.map((hole) => {
    const gainedScore = consumedObjects
      .filter((object) => object.claimedBy === hole.id)
      .reduce((total, object) => total + object.value, 0);
    if (gainedScore === 0) {
      return hole;
    }
    const score = hole.score + gainedScore;
    return { ...hole, score, radius: radiusForHole(hole, score) };
  });
}

export function stepSimulation(
  state: SimulationState,
  inputs: readonly PlayerInput[],
  deltaSeconds: number,
): SimulationStepResult {
  if (state.status === "finished" || deltaSeconds <= 0) {
    return { state, events: [] };
  }

  const safeDelta = Math.min(deltaSeconds, 0.1);
  const inputByPlayer = new Map(inputs.map((input) => [input.playerId, input] as const));
  let rngState = state.rngState;
  const timedEffects = updatePowerUpEffects(
    state.holes.map(normalizedHole),
    state.positionHistory ?? [],
    state.elapsed,
    safeDelta,
  );
  const previousAbilityHoles = timedEffects.holes;
  const abilityHoles = previousAbilityHoles.map((hole) =>
    updateAbilityState(
      hole,
      hole.eliminationRemaining > 0 || hole.isOut
        ? []
        : (inputByPlayer.get(hole.id)?.abilities ?? []),
      safeDelta,
    ),
  );
  const releasedObjectIds = new Set<string>();
  const movedHoles = abilityHoles.map((hole) => {
    if (hole.eliminationRemaining > 0 || hole.isOut) {
      return hole;
    }
    if (hole.kind === "human") {
      return moveHole(hole, inputByPlayer.get(hole.id)?.direction ?? { x: 0, y: 0 }, safeDelta);
    }
    const decision = decideBotInput(hole, state.objects, safeDelta, rngState);
    rngState = decision.rngState;
    if (decision.releasedObjectId) releasedObjectIds.add(decision.releasedObjectId);
    return moveHole({ ...hole, bot: decision.bot }, decision.direction, safeDelta);
  });

  const bombResolution = resolveBombs(previousAbilityHoles, movedHoles);
  const holeResolution = resolveHoleConsumption(bombResolution.holes, safeDelta, rngState);
  const competitiveHoles = holeResolution.holes;
  rngState = holeResolution.rngState;
  const previousStatusById = new Map(state.objects.map((object) => [object.id, object.status]));
  const routedObjects = enforceVehicleSpacing(
    state.objects.map((object) =>
      moveRoutedObject(
        releasedObjectIds.has(object.id) ? { ...object, claimedBy: null } : object,
        safeDelta,
        state.elapsed,
      ),
    ),
  );
  let objects: WorldObjectState[] = [
    ...stepActivePhysics(routedObjects, competitiveHoles, safeDelta),
  ].map((object) => ({
    ...object,
    footprintFadeRemaining: Math.max(0, (object.footprintFadeRemaining ?? 0) - safeDelta),
  }));
  const newlyConsumed = objects.filter(
    (object) => object.status === "consumed" && previousStatusById.get(object.id) === "active",
  );
  let scoredHoles = applyConsumedScores(competitiveHoles, newlyConsumed);
  const events: SimulationEvent[] = [
    ...bombResolution.events,
    ...newlyConsumed.map(
      (object) =>
        ({
          type: "consumed",
          objectId: object.id,
          holeId: object.claimedBy ?? "unknown",
          value: object.value,
          position: object.position,
        }) as const,
    ),
  ];

  let footprints = (state.footprints ?? []).map((footprint) => {
    if (footprint.impactRemaining <= 0) return { ...footprint };
    const owner = scoredHoles.find(
      (hole) => hole.id === footprint.ownerId && hole.eliminationRemaining <= 0 && !hole.isOut,
    );
    return owner
      ? {
          ...footprint,
          position: { ...owner.position },
          width: owner.radius * 3,
          length: owner.radius * 6,
        }
      : { ...footprint };
  });
  const impactingFootprints = footprints.filter(
    (footprint) =>
      footprint.impactRemaining > 0 && footprint.impactRemaining - safeDelta <= 0.000_001,
  );
  footprints = footprints
    .map((footprint) => ({
      ...footprint,
      impactRemaining: Math.max(0, footprint.impactRemaining - safeDelta),
      fadeRemaining:
        footprint.impactRemaining > 0 && footprint.impactRemaining - safeDelta <= 0.000_001
          ? FOOTPRINT_MARK_SECONDS
          : Math.max(0, footprint.fadeRemaining - safeDelta),
    }))
    .filter((footprint) => footprint.impactRemaining > 0 || footprint.fadeRemaining > 0);
  for (const footprint of impactingFootprints) {
    const owner = scoredHoles.find((hole) => hole.id === footprint.ownerId);
    if (!owner) continue;
    const footprintConsumed: WorldObjectState[] = [];
    objects = objects.map((object) => {
      if (object.status === "consumed" || !isInsideFootprint(object, footprint)) return object;
      const consumed = {
        ...object,
        status: "consumed" as const,
        claimedBy: owner.id,
        motion: null,
        footprintFadeRemaining: FOOTPRINT_MARK_SECONDS,
      };
      footprintConsumed.push(consumed);
      return consumed;
    });
    scoredHoles = applyConsumedScores(scoredHoles, footprintConsumed);
    events.push(
      ...footprintConsumed.map((object) => ({
        type: "consumed" as const,
        objectId: object.id,
        holeId: owner.id,
        value: object.value,
        position: object.position,
      })),
    );
  }

  let powerUps = state.powerUps ?? [];
  let nextPowerUpSpawnAt = state.nextPowerUpSpawnAt ?? POWER_UP_SPAWN_INTERVAL_SECONDS;
  if (state.elapsed + safeDelta >= nextPowerUpSpawnAt) {
    const spawned = [];
    for (let index = 0; index < state.holes.length; index += 1) {
      const [randomX, afterX] = nextRandom(rngState);
      const [randomY, afterY] = nextRandom(afterX);
      const [randomType, afterType] = nextRandom(afterY);
      rngState = afterType;
      spawned.push({
        id: `power-up-${Math.round(nextPowerUpSpawnAt)}-${index}`,
        type: POWER_UP_TYPES[Math.floor(randomType * POWER_UP_TYPES.length)] ?? "magnet",
        position: {
          x: (randomX * 2 - 1) * (MAP_HALF_WIDTH - 4),
          y: (randomY * 2 - 1) * (MAP_HALF_HEIGHT - 4),
        },
      });
    }
    powerUps = [...powerUps, ...spawned];
    nextPowerUpSpawnAt += POWER_UP_SPAWN_INTERVAL_SECONDS;
  }
  const collection = collectPowerUps(scoredHoles, powerUps, objects, state.elapsed);
  scoredHoles = collection.holes;
  powerUps = collection.powerUps;
  objects = [...collection.objects];
  footprints = [...footprints, ...collection.footprints];
  events.push(...collection.events);

  const poopHazards = [...(state.poopHazards ?? []), ...timedEffects.hazards].filter((hazard) => {
    for (const hole of scoredHoles) {
      if (
        hole.eliminationRemaining <= 0 &&
        !hole.isOut &&
        Math.hypot(hazard.position.x - hole.position.x, hazard.position.y - hole.position.y) <=
          hole.radius
      ) {
        events.push({ type: "poop-hit", holeId: hole.id });
        return false;
      }
    }
    return true;
  });

  const objectIndexById = new Map(objects.map((object, index) => [object.id, index] as const));
  const spatialHash = new SpatialHash(SPATIAL_HASH_CELL_SIZE);
  for (const object of objects) {
    if (object.status === "static") {
      spatialHash.insert(object.id, object.position);
    }
  }

  for (const hole of scoredHoles) {
    if (hole.eliminationRemaining > 0 || hole.isOut) {
      continue;
    }
    const nearbyIds = spatialHash.query(hole.position, hole.radius + MAX_OBJECT_FOOTPRINT_RADIUS);
    for (const objectId of nearbyIds) {
      const index = objectIndexById.get(objectId);
      if (index === undefined) {
        continue;
      }
      const object = objects[index];
      if (!object || object.status !== "static") {
        continue;
      }
      const footprintRadius = Math.hypot(object.size.x, object.size.y) / 2;
      const distance = Math.hypot(
        object.position.x - hole.position.x,
        object.position.y - hole.position.y,
      );
      const mobileObject = object.motion !== null;

      // For moving objects (vehicles), only activate if they can fit through the hole
      // For static objects, activate on contact
      const shouldActivate = mobileObject
        ? canFitThroughHole(hole, object) && distance <= hole.radius + footprintRadius * 0.5
        : distance <= hole.radius + footprintRadius;

      if (shouldActivate) {
        objects[index] = activateObject(object, hole);
      }
    }
  }

  const elapsed = Math.min(state.elapsed + safeDelta, state.elapsed + state.remaining);
  const positionHistory = [
    ...(state.positionHistory ?? []).filter((sample) => elapsed - sample.elapsed <= 2.2),
    ...scoredHoles.map((hole) => ({
      holeId: hole.id,
      elapsed,
      position: { ...hole.position },
    })),
  ];
  const remaining = Math.max(0, state.remaining - safeDelta);
  return {
    state: {
      elapsed,
      remaining,
      status: remaining === 0 ? "finished" : "playing",
      holes: scoredHoles,
      objects,
      powerUps,
      footprints,
      poopHazards,
      positionHistory,
      nextPowerUpSpawnAt,
      rngState,
    },
    events,
  };
}
