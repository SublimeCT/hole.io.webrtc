// 占位类型：WebRTC 联机运行时的输入包与状态快照（AGENTS.md §4「输入包」「状态快照」）。
// Phase 3 的 host 权威广播循环才使用；信令服务端不引用本文件。
// 现在定义是为了确立 client ↔ host 间的单一真源，避免后续协议漂移。

import type { Vector2 } from "../simulation/types.js";

/**
 * 输入包（客户端 → host，约 30Hz）。
 * 只携带归一化方向 + 序号 + 客户端时间戳，绝不携带位置/分数
 * （AGENTS.md §0.1「客户端永不信任自己的状态」、§4 硬性规则）。
 */
export interface InputPacket {
  seq: number;
  direction: Vector2;
  clientTime: number;
}

export interface PlayerSnapshot {
  peerId: string;
  position: Vector2;
  radius: number;
  score: number;
}

/**
 * 状态快照（host → 所有客户端，约 10Hz）。
 * 地图静止物体不进入快照（客户端本地已知其初始状态）；仅活跃物体与被吞噬物体 id 上报。
 * 活跃物体位姿字段待 Phase 3 实现时补充。
 */
export interface StateSnapshot {
  seq: number;
  serverTime: number;
  players: readonly PlayerSnapshot[];
  consumedObjectIds: readonly string[];
}
