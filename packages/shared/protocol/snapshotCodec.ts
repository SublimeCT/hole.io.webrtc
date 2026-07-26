// host 权威模拟 ↔ guest 快照插值 的序列化与合并。
// host 用 *ToSnapshot* 把 SimulationState 编码成 DataChannel 协议消息；
// guest 用 apply*ToState 把收到的消息合并回渲染用的 SimulationState。
// 双方共用此模块，禁止在 client 两端各写一份（AGENTS.md 第 0.2 / 第 3 节）。
import type {
  ActiveObjectSnapshot,
  CheckpointChunk,
  FullStateCheckpoint,
  ObjectStateOverride,
  PlayerSnapshot,
  StateDeltaSnapshot,
  WorldEvent,
} from "./game.js";
import type {
  FootprintStrike,
  HoleState,
  MapPowerUp,
  PoopHazard,
  SimulationEvent,
  SimulationState,
  WorldObjectState,
} from "../simulation/types.js";

/** 固定城市地图的标识，host/guest 必须一致；用于 checkpoint 基线校验。 */
export const MULTIPLAYER_MAP_ID = "city-v1";
export const MULTIPLAYER_MAP_REVISION = "1";
/** Checkpoint 分块的单片最大字符数（JSON 文本）。DataChannel 单包上限 128KB，留足余量。 */
const CHECKPOINT_CHUNK_SIZE = 24_000;

export interface DeltaSnapshotInput {
  readonly state: SimulationState;
  readonly matchId: string;
  readonly snapshotSeq: number;
  readonly hostTick: number;
  readonly hostTime: number;
  readonly baseWorldRevision: number;
  readonly worldRevision: number;
  /** 每个 peer 最近一次被权威循环处理的输入序号；未携带输入的玩家填 0。 */
  readonly lastProcessedInputByPeer: ReadonlyMap<string, number>;
  /** host 维护的「已广播 consumed」集合；函数会原地 add，避免每帧重复广播同一消耗。 */
  readonly emittedConsumed: Set<string>;
}

function toActiveObjectSnapshot(object: WorldObjectState): ActiveObjectSnapshot {
  return {
    id: object.id,
    position: object.position,
    centerY: object.centerY,
    rotation: object.rotation,
    velocity: object.velocity,
    angularVelocity: object.angularVelocity,
    activeTime: object.activeTime,
  };
}

export function holeToPlayerSnapshot(
  hole: HoleState,
  lastProcessedInputSeq: number,
): PlayerSnapshot {
  return {
    peerId: hole.id,
    position: hole.position,
    radius: hole.radius,
    score: hole.score,
    eliminations: hole.eliminations,
    revivesRemaining: hole.revivesRemaining,
    eliminationRemaining: hole.eliminationRemaining,
    invulnerabilityRemaining: hole.invulnerabilityRemaining,
    isOut: hole.isOut,
    lastProcessedInputSeq,
    speedBoostRemaining: hole.speedBoostRemaining,
    radiusBoostRemaining: hole.radiusBoostRemaining,
    bombFuseRemaining: hole.bombFuseRemaining,
    speedBoostCooldown: hole.speedBoostCooldown,
    radiusBoostCooldown: hole.radiusBoostCooldown,
    bombCooldown: hole.bombCooldown,
    activePowerUps: hole.activePowerUps,
  };
}

/**
 * 产出 ~10Hz unreliable 增量快照。players 全量；changedObjects 只含当前 active 物体 + 本帧新增 consumed；
 * powerUps/footprints/poopHazards 全量（数量少）。静态未变物体不进入快照（guest 本地已知初始状态）。
 */
export function stateToDeltaSnapshot(input: DeltaSnapshotInput): StateDeltaSnapshot {
  const changedObjects: ObjectStateOverride[] = [];
  for (const object of input.state.objects) {
    if (object.status === "active") {
      changedObjects.push({
        id: object.id,
        state: "active",
        object: toActiveObjectSnapshot(object),
      });
    } else if (object.status === "consumed" && !input.emittedConsumed.has(object.id)) {
      changedObjects.push({ id: object.id, state: "consumed" });
      input.emittedConsumed.add(object.id);
    }
  }
  const players = input.state.holes.map((hole) =>
    holeToPlayerSnapshot(hole, input.lastProcessedInputByPeer.get(hole.id) ?? 0),
  );
  return {
    type: "state-delta",
    matchId: input.matchId,
    snapshotSeq: input.snapshotSeq,
    hostTick: input.hostTick,
    baseWorldRevision: input.baseWorldRevision,
    worldRevision: input.worldRevision,
    hostTime: input.hostTime,
    elapsed: input.state.elapsed,
    remaining: input.state.remaining,
    status: input.state.status,
    players,
    changedObjects,
    powerUps: input.state.powerUps,
    footprints: input.state.footprints,
    poopHazards: input.state.poopHazards,
  };
}

export interface CheckpointInput {
  readonly state: SimulationState;
  readonly matchId: string;
  readonly checkpointId: string;
  readonly snapshotSeq: number;
  readonly hostTick: number;
  readonly worldRevision: number;
  readonly hostTime: number;
}

/**
 * 可靠 checkpoint：在相同 mapId/seed 基线上独立重建可观察世界。
 * objectOverrides 只列偏离初始状态的物体（active / consumed），仍为初始 static 的物体不传。
 */
export function buildFullCheckpoint(input: CheckpointInput): FullStateCheckpoint {
  const objectOverrides: ObjectStateOverride[] = [];
  for (const object of input.state.objects) {
    if (object.status === "active") {
      objectOverrides.push({
        id: object.id,
        state: "active",
        object: toActiveObjectSnapshot(object),
      });
    } else if (object.status === "consumed") {
      objectOverrides.push({ id: object.id, state: "consumed" });
    }
  }
  return {
    matchId: input.matchId,
    checkpointId: input.checkpointId,
    snapshotSeq: input.snapshotSeq,
    hostTick: input.hostTick,
    worldRevision: input.worldRevision,
    mapId: MULTIPLAYER_MAP_ID,
    mapRevision: MULTIPLAYER_MAP_REVISION,
    seed: 0,
    hostTime: input.hostTime,
    elapsed: input.state.elapsed,
    remaining: input.state.remaining,
    players: input.state.holes.map((hole) => holeToPlayerSnapshot(hole, 0)),
    objectOverrides,
    powerUps: input.state.powerUps,
    footprints: input.state.footprints,
    poopHazards: input.state.poopHazards,
  };
}

/**
 * 把权威循环产生的离散事件映射成 reliable WorldEvent。
 * - consumed → object-consumed（creditedPeerIds = 吞噬者）
 * - player-defeated → player-eliminated（objectId 为被击败 peerId，holeId 为击败者）
 * - power-up-collected → power-up-changed（携带当前全量 powerUps）
 * - poop-hit 不广播（guest 从 poopHazards 全量同步看到）
 */
export function simulationEventToWorldEvent(
  event: SimulationEvent,
  ctx: { matchId: string; worldRevision: number; powerUps: readonly MapPowerUp[] },
): WorldEvent | null {
  if (event.type === "consumed") {
    return {
      type: "object-consumed",
      matchId: ctx.matchId,
      worldRevision: ctx.worldRevision,
      objectId: event.objectId,
      creditedPeerIds: event.holeId === "unknown" ? [] : [event.holeId],
    };
  }
  if (event.type === "player-defeated") {
    return {
      type: "player-eliminated",
      matchId: ctx.matchId,
      worldRevision: ctx.worldRevision,
      peerId: event.objectId,
      creditedPeerId: event.holeId === "unknown" ? null : event.holeId,
    };
  }
  if (event.type === "power-up-collected") {
    return {
      type: "power-up-changed",
      matchId: ctx.matchId,
      worldRevision: ctx.worldRevision,
      powerUps: ctx.powerUps,
    };
  }
  return null;
}

function playerSnapshotToHole(snap: PlayerSnapshot): HoleState {
  return {
    id: snap.peerId,
    kind: "human",
    position: snap.position,
    radius: snap.radius,
    score: snap.score,
    eliminationRemaining: snap.eliminationRemaining,
    eliminations: snap.eliminations,
    revivesRemaining: snap.revivesRemaining,
    invulnerabilityRemaining: snap.invulnerabilityRemaining,
    speedBoostRemaining: snap.speedBoostRemaining ?? 0,
    speedBoostCooldown: snap.speedBoostCooldown ?? 0,
    radiusBoostRemaining: snap.radiusBoostRemaining ?? 0,
    radiusBoostCooldown: snap.radiusBoostCooldown ?? 0,
    bombFuseRemaining: snap.bombFuseRemaining ?? 0,
    bombCooldown: snap.bombCooldown ?? 0,
    activePowerUps: snap.activePowerUps,
    // 以下字段为 host 权威内部状态，guest 渲染不依赖：
    nextPoopDropIn: 0,
    isOut: snap.isOut,
    bot: null,
  };
}

function applyObjectOverrides(
  objects: readonly WorldObjectState[],
  overrides: readonly ObjectStateOverride[],
): readonly WorldObjectState[] {
  if (overrides.length === 0) return objects;
  const overrideById = new Map<string, ObjectStateOverride>();
  for (const override of overrides) overrideById.set(override.id, override);
  let changed = false;
  const next = objects.map((object) => {
    const override = overrideById.get(object.id);
    if (override === undefined) return object;
    changed = true;
    if (override.state === "consumed") {
      return { ...object, status: "consumed" as const, motion: null };
    }
    if (override.state === "active") {
      return {
        ...object,
        status: "active" as const,
        position: override.object.position,
        centerY: override.object.centerY,
        rotation: override.object.rotation,
        velocity: override.object.velocity,
        angularVelocity: override.object.angularVelocity,
        activeTime: override.object.activeTime,
        motion: null,
      };
    }
    // settled：物体落回静止但位置/朝向偏离初始
    return {
      ...object,
      status: "static" as const,
      position: override.position,
      centerY: override.centerY,
      rotation: override.rotation,
    };
  });
  return changed ? next : objects;
}

/** guest：把一条 unreliable 增量合并进当前渲染 state（不可变，返回新 state）。 */
export function applyDeltaToState(
  state: SimulationState,
  delta: StateDeltaSnapshot,
): SimulationState {
  const snapshotByPeer = new Map<string, PlayerSnapshot>();
  for (const player of delta.players) snapshotByPeer.set(player.peerId, player);
  const holes = state.holes.map((hole) => {
    const snap = snapshotByPeer.get(hole.id);
    return snap ? playerSnapshotToHole(snap) : hole;
  });
  const objects = applyObjectOverrides(state.objects, delta.changedObjects);
  return {
    ...state,
    holes,
    objects,
    powerUps: delta.powerUps,
    footprints: delta.footprints as readonly FootprintStrike[],
    poopHazards: delta.poopHazards as readonly PoopHazard[],
    elapsed: delta.elapsed,
    remaining: delta.remaining,
    status: delta.status,
  };
}

/**
 * guest：应用可靠 checkpoint。base 必须是 createMultiplayerSimulation 产出的初始 state
 * （objects 为全量初始 static），checkpoint 在其上覆盖偏离的物体与全部玩家/道具。
 */
export function applyCheckpointToState(
  base: SimulationState,
  checkpoint: FullStateCheckpoint,
): SimulationState {
  const objects = applyObjectOverrides(base.objects, checkpoint.objectOverrides);
  const holes = checkpoint.players.map(playerSnapshotToHole);
  return {
    ...base,
    holes,
    objects,
    powerUps: checkpoint.powerUps,
    footprints: checkpoint.footprints as readonly FootprintStrike[],
    poopHazards: checkpoint.poopHazards as readonly PoopHazard[],
    elapsed: checkpoint.elapsed,
    remaining: checkpoint.remaining,
    status: "playing",
  };
}

// ---- Checkpoint 分块编解码（reliable channel 上顺序重组，全部到齐后原子应用）----

export function serializeCheckpoint(checkpoint: FullStateCheckpoint): string {
  return JSON.stringify(checkpoint);
}

export function splitCheckpointIntoChunks(input: {
  matchId: string;
  checkpointId: string;
  payload: string;
  chunkSize?: number;
}): readonly CheckpointChunk[] {
  const size = input.chunkSize ?? CHECKPOINT_CHUNK_SIZE;
  const chunks: CheckpointChunk[] = [];
  for (let index = 0; index < input.payload.length; index += size) {
    chunks.push({
      type: "checkpoint-chunk",
      matchId: input.matchId,
      checkpointId: input.checkpointId,
      chunkIndex: Math.floor(index / size),
      chunkCount: 0, // 占位，下方回填
      encoding: "json",
      payload: input.payload.slice(index, index + size),
    });
  }
  const chunkCount = chunks.length;
  return chunks.map((chunk) => ({ ...chunk, chunkCount }));
}

export interface CheckpointAssembly {
  checkpoint: FullStateCheckpoint | null;
  complete: boolean;
}

/** 累积收到的 chunk，当某个 checkpointId 的全部分片到齐时返回重组结果。 */
export function assembleCheckpointChunks(
  pending: ReadonlyMap<string, readonly CheckpointChunk[]>,
  chunksById: ReadonlyMap<string, readonly CheckpointChunk[]>,
): Map<string, readonly CheckpointChunk[]> {
  const merged = new Map<string, readonly CheckpointChunk[]>();
  for (const [id, chunks] of pending) merged.set(id, chunks);
  for (const [id, chunks] of chunksById) {
    const existing = merged.get(id) ?? [];
    const byIndex = new Map<number, CheckpointChunk>();
    for (const chunk of [...existing, ...chunks]) byIndex.set(chunk.chunkIndex, chunk);
    merged.set(
      id,
      [...byIndex.values()].sort((a, b) => a.chunkIndex - b.chunkIndex),
    );
  }
  return merged;
}

export function tryCompleteCheckpoint(
  chunks: readonly CheckpointChunk[],
): FullStateCheckpoint | null {
  if (chunks.length === 0) return null;
  const count = chunks[0]?.chunkCount ?? 0;
  if (chunks.length !== count) return null;
  const payload = chunks.map((chunk) => chunk.payload).join("");
  try {
    return JSON.parse(payload) as FullStateCheckpoint;
  } catch {
    return null;
  }
}
