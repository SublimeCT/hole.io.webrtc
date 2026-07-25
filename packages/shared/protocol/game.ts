// DataChannel 实时同步协议（host ↔ guests，P2P 星型，不经信令服务）。
// 照 packages/shared/simulation/types.ts 的 HoleState / WorldObjectState 定义，去掉客户端不需要的内部字段。
// host 权威循环（Phase 3）才使用；信令服务端不引用本文件。

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

/**
 * 输入包（guest → host，约 30Hz，unreliable channel）。
 * 只携带归一化方向 + 序号 + 客户端时间戳 + 本帧触发的技能，
 * 绝不携带位置/分数（AGENTS.md §0.1「客户端永不信任自己的状态」、§4 硬性规则）。
 */
export interface InputPacket {
  seq: number;
  direction: Vector2;
  clientTime: number;
  abilities?: readonly AbilityId[];
}

/**
 * 玩家洞快照（照 HoleState，去 bot 内部状态；id 用 peerId）。
 * 阵亡/无敌/出局字段驱动 K.O.、皇冠、无敌闪烁等视觉。
 * 技能字段保持 optional，兼容渐进上线。
 */
export interface PlayerSnapshot {
  peerId: string;
  position: Vector2;
  radius: number;
  score: number;
  eliminations: number;
  revivesRemaining: number;
  /** >0 表示 K.O. 倒计时中（阵亡待复活）。 */
  eliminationRemaining: number;
  /** >0 表示复活后无敌中。 */
  invulnerabilityRemaining: number;
  isOut: boolean;
  speedBoostRemaining?: number;
  radiusBoostRemaining?: number;
  bombFuseRemaining?: number;
  speedBoostCooldown?: number;
  radiusBoostCooldown?: number;
  bombCooldown?: number;
  activePowerUps: readonly ActivePowerUp[];
}

/** 活跃物体（status="active"，正在下落/倾倒）的位姿快照，照 WorldObjectState 取渲染+插值所需字段。 */
export interface ActiveObjectSnapshot {
  id: string;
  position: Vector2;
  /** 高度（下落中变化）。 */
  centerY: number;
  rotation: Quaternion;
  velocity: Vector3;
  angularVelocity: Vector3;
  activeTime: number;
}

/**
 * 状态快照（host → 所有 guest，约 10Hz，unreliable channel）。
 * 车辆/行人不进快照：它们是确定性 route 运动（基于 elapsed），guest 用 host 的 elapsed +
 * 地图初始 routeMotion + simulation 的 route/交通灯逻辑本地推算（AGENTS.md §4「客户端本地已知的不传」）。
 * 地图静止物体同样不进快照（客户端加载时已知初始状态）。
 */
export interface StateSnapshot {
  seq: number;
  serverTime: number;
  elapsed: number;
  remaining: number;
  status: "playing" | "finished";
  players: readonly PlayerSnapshot[];
  activeObjects: readonly ActiveObjectSnapshot[];
  /** 本帧新被吞噬的物体 id（客户端移除对应实例）。 */
  consumedObjectIds: readonly string[];
  powerUps: readonly MapPowerUp[];
  footprints: readonly FootprintStrike[];
  poopHazards: readonly PoopHazard[];
}

export interface PlayerAssignment {
  peerId: string;
  playerName: string;
  /** 对应 SimulationState.holes 的下标。 */
  holeIndex: number;
}

/**
 * 关键事件（reliable channel，host 经 DataChannel 广播，server 不参与）。
 * match-start 与信令层的 start-match（WSS 房间状态通知）是两件事：前者是游戏开始事件，后者是房间进入 playing。
 */
export type GameEvent =
  | {
      type: "match-start";
      seed: number;
      matchDurationSeconds: number;
      players: readonly PlayerAssignment[];
    }
  | { type: "match-end"; ranking: readonly PlayerAssignment[] };
