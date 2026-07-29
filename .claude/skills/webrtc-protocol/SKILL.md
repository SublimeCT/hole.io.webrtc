---
name: webrtc-protocol
description: Hole.io 项目的 WebRTC 星型联机、host 权威模拟、房间信令状态机、增量快照和可靠 checkpoint 约定。修改 packages/shared/protocol、packages/client/src/net 或 packages/server/src/signaling 时使用。
---

# WebRTC Protocol

## 不可突破的边界

- 联机固定为 host 中心的星型拓扑；guest 之间不建立连接。
- guest 只发送归一化输入、客户端输入序号、时间戳和技能意图。位置、体积、分数、吞噬、死亡和物体状态只能由 host 的共享模拟循环产生。
- 联机 roster 只允许真人。禁止创建 Bot、断线 Bot 或 Bot 接管。
- WSS 只负责房间生命周期、心跳、TURN 临时凭据和 SDP/ICE 转发。游戏输入、快照、事件、checkpoint 不经过后端。
- 信令和游戏协议都先改 `packages/shared/protocol`，client/server 直接导入；禁止复制接口。

## Channel 选择

| 数据                                        | Channel    | 规则                                                                 |
| ------------------------------------------- | ---------- | -------------------------------------------------------------------- |
| 输入、插值快照                              | unreliable | `{ ordered: false, maxRetransmits: 0 }`；新数据覆盖旧数据，不重传    |
| 开始/结束、世界事件、重同步请求、checkpoint | reliable   | 默认 ordered/reliable；checkpoint 分块并带传输 id、chunk index/count |

不要把 checkpoint 附在下一条 unreliable 快照中。大包会增加拥塞、仍可能丢失，并阻塞后续高频数据。

只在本机呈现、无法从快照最终状态推导的瞬时效果必须发 reliable 事件。例如 `poop-hit` 不能靠陷阱从 `poopHazards` 中消失来推断，否则 guest 不知道具体命中了谁，也无法触发本机 UI。

## 序号与恢复

- `snapshotSeq` 标识每个普通快照，允许断层；接收端丢弃旧序号并继续插值。
- `worldRevision` 只在可观察世界发生离散变化时递增，例如物体被吞噬、道具生成或移除、玩家死亡或复活。
- 增量携带 `baseWorldRevision` 和 `worldRevision`。只有本地 revision 不等于增量的 base revision，才通过 reliable channel 发 `resync-request`。
- checkpoint 必须能在双方拥有相同地图基线时独立重建当前世界：全部玩家、全部道具和临时实体、全部活跃物体，以及所有偏离地图初始状态的静态物体。仍处于初始状态的静态物体不传。
- 应用 checkpoint 后丢弃 revision 不更新或快照序号更旧的在途增量。

## 房间与建连

状态机固定为 `lobby → connecting → playing → lobby`：

1. `lobby` 中所有 entered 玩家都 ready 后，host 请求 `begin-connection`。
2. `connecting` 中只允许 host↔guest 的 SDP/ICE。每个 guest 建立一组 reliable/unreliable DataChannel。
3. host 确认所有 DataChannel 可用后请求 `start-match`；后端进入固定时长的 `playing`。
4. `playing` 时 WSS 保持连接但客户端消息只接受 application heartbeat 和主动 `leave-room`。
5. 计时结束后所有成员 `entered=false`、`ready=false`，必须再次 `enter-room` 才参加下一局。

host 在任一状态心跳超时都解散房间；guest 超时只移除。v1 不迁移 host。

## 连接类型检测

- 双通道 open、peer 标记 `connected` 后，用 `RTCPeerConnection.getStats()` 找 `nominated`/`state==="succeeded"` 的 `candidate-pair`，读其 `localCandidateId` 对应 `local-candidate` 的 `candidateType`：`relay` → TURN 中继，其余（host/srflx/prflx）→ P2P 直连。
- ICE 可能后续切换路径（直连掉线转中继），`connectionstatechange` 回到 `connected` 时应复检。类型写 `peerConnectionTypes` 并 `console.log`，房间页玩家 card 据此展示。
- 这是诊断手段（尤其移动网络是否走到 relay），不要用来驱动玩法。

## 准备前置门控

guest 必须先与房主建立 WebRTC 连接（`peerConnections[hostId]==="connected"`）才能「准备」；host 必须「所有 guest 已连接 + 全员 ready」才能开始。这让连不上的问题在 lobby 就暴露（清晰文案），而非开始后在 30s connecting 超时回退。

## 踢人（lobby-only）

- C2S `kick-peer { peerId }`，S2C 专用 `kicked { roomCode }`。**不要**复用 `room-error`——它是瞬时可恢复错误（RATE_LIMITED 等），复用会让所有瞬时错误都触发回主页。
- `RoomService.kickPeer` 仅 `lobby` 允许（对局中由 dispatcher 的 `MATCH_IN_PROGRESS` 门控自然拒绝）。服务端先给被踢者发 `kicked`，再广播 `room-state`（避免被踢者先看到自己从 peers 消失、被误判为「玩家退出」toast）。
- 被踢客户端按 room-closed 同样处置：dispose 本地会话、`termination="kicked"`、回主页提示。`sendToPeer` 走 `connections` Map，成员已删仍可送达。

## 车辆本地确定性推进（§0.1 唯一例外）

- §0.1「guest 永不本地模拟」**唯一例外**是确定性路由车辆运动：guest 用与 host 相同的纯函数 `advanceRoutedObjects`（即 `moveRoutedObjects`，仅移动 + `enforceVehicleSpacing`）本地推进，使全员车辆运动一致。位置/分数/吞噬/死亡/道具仍全由 host 权威。
- 确定性前提（任一被破坏都会让 host/guest 车辆错位）：①两端用同一固定步长常量 `FIXED_STEP_SECONDS=1/60`；②`enforceVehicleSpacing` 依赖 `Array.sort` 稳定（不可改非稳定）；③`runtime.movingRouteObjectIds` 迭代顺序由相同 `initialState.objects` 顺序决定；④联机无 bot → `releasedObjectIds` 两端皆空。
- guest 的车辆 runtime 与渲染用的 `simulationRuntime` 分开（后者保持 null，使脏物体走 `guestDirtyObjectIds`）。
- 已知可接受偏差：match-start 信号时延造成全网车辆一个**常量**相位偏移（亚米级），仅纯视觉、不影响玩法（车辆吞噬仍 host 权威、靠 consumed override 收敛）。不要用 host 时间插值去「修」它。
- guest `applyCheckpoint` 以**当前** state 为物体基线（而非 `initialState`），保留本地推进的车辆位置——否则任何 resync 都会把车辆弹回出生点并永久停住（车辆不在 delta/checkpoint 里）。这也修复了一个既有潜在 bug。

## 退出与结束导航

- 中途退出：退出者 `disposeSession` 回主页；其他人底部 toast「xxx 已退出游戏」。房主退出 = 房间解散，全员回主页。
- 正常结束：双方进结算页，8s 倒计时后自动回房间 lobby。`onMatchEnd` 用 `matchEndedRef` 幂等；并监听 `matchId` null 化作安全网——服务器 `match-ended` 可能比 host 的 `finished` 快照先到、peer 连接已关，guest 的 `Game.onMatchEnd` 未必触发，此时用 `Game.buildCurrentMatchResult()` 兜底。
- store 的 `termination`（仅 room-closed/kicked 置位）区分「该回主页」与「瞬时 error 仅 toast」。终止处理必须 `disposeSession`，否则 session 半死、回 `/online` 后 socket 已关无法重连。

## 修改检查单

1. 先更新 `packages/shared/protocol` 的 runtime schema 和类型。
2. 检查 WSS message 是否仍设置 `additionalProperties: false`，并限制字符串和 payload 大小。
3. 检查 SDP/ICE 是否只能在 connecting 且只能 host↔guest 转发。
4. 检查 playing dispatcher 是否只接受 heartbeat 和主动 `leave-room`。
5. 检查高频包中没有玩家名称、静态地图基线或可由接收端推导的字段。
6. 检查 `SPEC.md` 和 `docs/phase-3-notes.md` 是否同步。
7. 运行 typecheck、test、lint 和 format check。
