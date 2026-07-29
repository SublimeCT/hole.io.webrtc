// RTCDataChannel 实时同步协议。固定为 host ↔ guest 星型，不经过信令服务。
import type {
  AbilityId,
  ActivePowerUp,
  FootprintStrike,
  MapPowerUp,
  PoopHazard,
  Quaternion,
  Vector2,
  Vector3,
} from "../simulation/types.js";

export interface InputPacket {
  type: "input";
  matchId: string;
  seq: number;
  direction: Vector2;
  clientTime: number;
  abilities?: readonly AbilityId[];
}

export interface PlayerSnapshot {
  peerId: string;
  position: Vector2;
  radius: number;
  score: number;
  eliminations: number;
  revivesRemaining: number;
  eliminationRemaining: number;
  invulnerabilityRemaining: number;
  isOut: boolean;
  lastProcessedInputSeq: number;
  speedBoostRemaining?: number;
  radiusBoostRemaining?: number;
  bombFuseRemaining?: number;
  speedBoostCooldown?: number;
  radiusBoostCooldown?: number;
  bombCooldown?: number;
  activePowerUps: readonly ActivePowerUp[];
}

export interface ActiveObjectSnapshot {
  id: string;
  position: Vector2;
  centerY: number;
  rotation: Quaternion;
  velocity: Vector3;
  angularVelocity: Vector3;
  activeTime: number;
}

/** 地图基线的物体发生变化后用于重建的覆盖值；初始状态的物体不进入 checkpoint。 */
export type ObjectStateOverride =
  | { id: string; state: "consumed" }
  | { id: string; state: "active"; object: ActiveObjectSnapshot }
  | {
      id: string;
      state: "settled";
      position: Vector2;
      centerY: number;
      rotation: Quaternion;
    };

/**
 * host → guest，约 10Hz，走 unordered/unreliable channel。
 * 快照自身允许丢失；只有 baseWorldRevision 与接收端 revision 不匹配时才需要可靠重同步。
 */
export interface StateDeltaSnapshot {
  type: "state-delta";
  matchId: string;
  snapshotSeq: number;
  hostTick: number;
  baseWorldRevision: number;
  worldRevision: number;
  hostTime: number;
  elapsed: number;
  remaining: number;
  status: "playing" | "finished";
  players: readonly PlayerSnapshot[];
  changedObjects: readonly ObjectStateOverride[];
  powerUps: readonly MapPowerUp[];
  footprints: readonly FootprintStrike[];
  poopHazards: readonly PoopHazard[];
}

export interface PlayerAssignment {
  peerId: string;
  playerName: string;
  holeIndex: number;
}

/** reliable channel 上按顺序应用的离散世界事件。 */
export type WorldEvent =
  | {
      type: "object-consumed";
      matchId: string;
      worldRevision: number;
      objectId: string;
      creditedPeerIds: readonly string[];
    }
  | {
      type: "player-eliminated";
      matchId: string;
      worldRevision: number;
      peerId: string;
      creditedPeerId: string | null;
    }
  | {
      type: "player-revived";
      matchId: string;
      worldRevision: number;
      peerId: string;
    }
  | {
      type: "power-up-changed";
      matchId: string;
      worldRevision: number;
      powerUps: readonly MapPowerUp[];
    }
  | {
      type: "poop-hit";
      matchId: string;
      worldRevision: number;
      peerId: string;
    };

/**
 * 相同 mapId/mapRevision/seed 基线下可独立重建整个可观察世界的可靠 checkpoint。
 * objectOverrides 只列出偏离地图初始状态的物体。
 */
export interface FullStateCheckpoint {
  matchId: string;
  checkpointId: string;
  snapshotSeq: number;
  hostTick: number;
  worldRevision: number;
  mapId: string;
  mapRevision: string;
  seed: number;
  hostTime: number;
  elapsed: number;
  remaining: number;
  players: readonly PlayerSnapshot[];
  objectOverrides: readonly ObjectStateOverride[];
  powerUps: readonly MapPowerUp[];
  footprints: readonly FootprintStrike[];
  poopHazards: readonly PoopHazard[];
}

export interface ResyncRequest {
  type: "resync-request";
  matchId: string;
  expectedWorldRevision: number;
  receivedBaseWorldRevision: number;
  lastSnapshotSeq: number;
}

/** checkpoint JSON 序列化后分块发送，接收端仅在全部 chunk 到齐后原子应用。 */
export interface CheckpointChunk {
  type: "checkpoint-chunk";
  matchId: string;
  checkpointId: string;
  chunkIndex: number;
  chunkCount: number;
  encoding: "json";
  payload: string;
}

export type GameEvent =
  | {
      type: "match-start";
      matchId: string;
      seed: number;
      mapId: string;
      mapRevision: string;
      matchDurationSeconds: number;
      players: readonly PlayerAssignment[];
    }
  | {
      type: "match-end";
      matchId: string;
      ranking: readonly PlayerAssignment[];
    }
  | WorldEvent
  | ResyncRequest
  | CheckpointChunk;

/** 旧名称保留为类型别名，现有插值调用点迁移时不会复制协议定义。 */
export type StateSnapshot = StateDeltaSnapshot;
