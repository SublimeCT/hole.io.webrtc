import {
  BASE_MOVE_SPEED,
  BOT_DETECTION_RADIUS,
  BOT_SPEED_MULTIPLIER,
  HOLE_FIT_RATIO,
  INITIAL_HOLE_RADIUS,
  MAP_HALF_SIZE,
  MOVE_SPEED_PER_LEVEL,
  ROAD_CENTERS,
  ROAD_WIDTH,
  SPATIAL_HASH_CELL_SIZE,
} from "./constants";
import { stepActivePhysics } from "./physics";
import { getHoleProgress } from "./progression";
import { SpatialHash } from "./spatialHash";
import type {
  BotState,
  HoleState,
  PlayerInput,
  SimulationEvent,
  SimulationState,
  SimulationStepResult,
  Vector2,
  WorldObjectState,
} from "./types";

const MAX_OBJECT_FOOTPRINT_RADIUS = 7;
const HOLE_ELIMINATION_MINIMUM_SCORE = 12;
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
      Math.min(BOT_DETECTION_RADIUS, 14)
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
    };
  }

  let bot = {
    ...current,
    rethinkIn: current.rethinkIn - deltaSeconds,
    commitRemaining: Math.max(0, current.commitRemaining - deltaSeconds),
  };
  let nextRngState = rngState;
  const currentTarget = objects.find(
    (object) =>
      object.id === bot.targetObjectId &&
      (object.status === "static" || (object.status === "active" && object.claimedBy === hole.id)),
  );
  const targetIsValid =
    currentTarget !== undefined &&
    (currentTarget.status === "active" || canFitThroughHole(hole, currentTarget));

  if (currentTarget?.status === "active") {
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
  return { bot, direction, rngState: nextRngState };
}

function moveHole(hole: HoleState, direction: Vector2, deltaSeconds: number): HoleState {
  const normalized = normalize(direction);
  const limit = Math.max(0, MAP_HALF_SIZE - hole.radius);
  const levelSpeed = BASE_MOVE_SPEED + getHoleProgress(hole.score).level * MOVE_SPEED_PER_LEVEL;
  const moveSpeed = hole.kind === "bot" ? levelSpeed * BOT_SPEED_MULTIPLIER : levelSpeed;
  return {
    ...hole,
    position: {
      x: clamp(hole.position.x + normalized.x * moveSpeed * deltaSeconds, -limit, limit),
      y: clamp(hole.position.y + normalized.y * moveSpeed * deltaSeconds, -limit, limit),
    },
  };
}

function isFullyCoveredByHole(
  hole: HoleState,
  objectPosition: Vector2,
  footprintRadius: number,
): boolean {
  return (
    Math.hypot(objectPosition.x - hole.position.x, objectPosition.y - hole.position.y) +
      footprintRadius <=
    hole.radius
  );
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
  const limit = MAP_HALF_SIZE - INITIAL_HOLE_RADIUS - 8;
  for (let attempt = 0; attempt < 96; attempt += 1) {
    const [randomX, stateAfterX] = nextRandom(nextState);
    const [randomY, stateAfterY] = nextRandom(stateAfterX);
    nextState = stateAfterY;
    const position = { x: (randomX * 2 - 1) * limit, y: (randomY * 2 - 1) * limit };
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
      const gainedScore = Math.max(HOLE_ELIMINATION_MINIMUM_SCORE, Math.round(loser.score * 0.6));
      const score = winner.score + gainedScore;
      nextHoles[winnerIndex] = {
        ...winner,
        score,
        radius: getHoleProgress(score).radius,
      };
      const nextEliminations = loser.eliminations + 1;
      nextHoles[loserIndex] =
        loser.revivesRemaining > 0
          ? {
              ...loser,
              radius: getHoleProgress(loser.score).radius,
              eliminationRemaining: HOLE_RESPAWN_SECONDS,
              eliminations: nextEliminations,
              revivesRemaining: loser.revivesRemaining - 1,
              bot:
                loser.kind === "bot"
                  ? {
                      mode: "wander",
                      targetObjectId: null,
                      targetScore: 0,
                      commitRemaining: 0,
                      sectorIndex: 0,
                      wanderAngle: 0,
                      rethinkIn: 0.4,
                    }
                  : null,
            }
          : {
              ...loser,
              eliminationRemaining: 0,
              eliminations: nextEliminations,
              isOut: true,
              bot: null,
            };
    }
  }
  return { holes: nextHoles, rngState: nextRngState };
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
  for (const intersection of ROAD_CENTERS) {
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
  objects.forEach((object, index) => {
    const motion = object.motion;
    if (object.status !== "static" || !motion || motion.kind !== "vehicle") {
      return;
    }
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
    for (let leftIndex = 0; leftIndex < nextObjects.length; leftIndex += 1) {
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
    return { ...hole, score, radius: getHoleProgress(score).radius };
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
  const inputByPlayer = new Map(inputs.map((input) => [input.playerId, input.direction] as const));
  let rngState = state.rngState;
  const movedHoles = state.holes.map((hole) => {
    if (hole.eliminationRemaining > 0 || hole.isOut) {
      return hole;
    }
    if (hole.kind === "human") {
      return moveHole(hole, inputByPlayer.get(hole.id) ?? { x: 0, y: 0 }, safeDelta);
    }
    const decision = decideBotInput(hole, state.objects, safeDelta, rngState);
    rngState = decision.rngState;
    return moveHole({ ...hole, bot: decision.bot }, decision.direction, safeDelta);
  });

  const holeResolution = resolveHoleConsumption(movedHoles, safeDelta, rngState);
  const competitiveHoles = holeResolution.holes;
  rngState = holeResolution.rngState;
  const previousStatusById = new Map(state.objects.map((object) => [object.id, object.status]));
  const routedObjects = enforceVehicleSpacing(
    state.objects.map((object) => moveRoutedObject(object, safeDelta, state.elapsed)),
  );
  const objects = [...stepActivePhysics(routedObjects, competitiveHoles, safeDelta)];
  const newlyConsumed = objects.filter(
    (object) => object.status === "consumed" && previousStatusById.get(object.id) === "active",
  );
  const scoredHoles = applyConsumedScores(competitiveHoles, newlyConsumed);
  const events: SimulationEvent[] = newlyConsumed.map((object) => ({
    type: "consumed",
    objectId: object.id,
    holeId: object.claimedBy ?? "unknown",
    value: object.value,
    position: object.position,
  }));

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
      const canEnterWhileMoving =
        canFitThroughHole(hole, object) &&
        isFullyCoveredByHole(hole, object.position, footprintRadius);
      if ((!mobileObject && distance <= hole.radius + footprintRadius) || canEnterWhileMoving) {
        objects[index] = activateObject(object, hole);
      }
    }
  }

  const elapsed = Math.min(state.elapsed + safeDelta, state.elapsed + state.remaining);
  const remaining = Math.max(0, state.remaining - safeDelta);
  return {
    state: {
      elapsed,
      remaining,
      status:
        remaining === 0 || scoredHoles.some((hole) => hole.kind === "human" && hole.isOut)
          ? "finished"
          : "playing",
      holes: scoredHoles,
      objects,
      rngState,
    },
    events,
  };
}
