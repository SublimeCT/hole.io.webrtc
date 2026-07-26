# Host-authoritative multiplayer

日期：2026-07-26

## 决策

联机模式由 host 运行与单机相同的 `packages/shared/simulation` 权威循环。最多 5 名真人只向 host 发送输入和技能意图；host 计算位置、分数、半径、吞噬、死亡、道具和物体状态，并通过星型 WebRTC DataChannel 广播。

## 性能依据

在当前 60Hz simulation 上测得：

| 场景                           |   每个 60Hz step |
| ------------------------------ | ---------------: |
| 当前单机：1 human + 2 bots     |      约 `3.70ms` |
| 联机模拟：3 humans，无 bots    |      约 `2.19ms` |
| 联机模拟：4 humans，无 bots    |      约 `2.77ms` |
| 4 humans + 0–50 active objects | 约 `2.88–3.24ms` |

当前碰撞/吞噬候选使用空间筛选，新增真人输入没有使 host 模拟负担成倍增长；移除联机 Bot 后反而低于当前单机基线。5 人上限还需在 Phase 3 客户端完成后补移动端实机压力测试。

## 一致性规则

- 玩家死亡竞态只接受 host 最先处理的权威结果。
- 同一 tick 多人满足吞噬同一普通物体时，物体只移除一次，但所有满足者都可计分。
- 高频普通快照允许丢失；离散世界 revision 不连续时，guest 请求 reliable 分块 checkpoint。
- checkpoint 基于相同地图基线，包含全部玩家/道具/临时实体和所有偏离初始状态的物体。

## 接受的限制

- host 可修改自己的浏览器代码作弊，v1 不增加中立权威服务。
- host 掉线不迁移，房间直接解散。
- TURN 中继可能承担 host 与多个 guest 的上/下行流量，需要按 coturn 日志控制容量。
