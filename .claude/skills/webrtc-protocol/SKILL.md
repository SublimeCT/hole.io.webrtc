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

## 修改检查单

1. 先更新 `packages/shared/protocol` 的 runtime schema 和类型。
2. 检查 WSS message 是否仍设置 `additionalProperties: false`，并限制字符串和 payload 大小。
3. 检查 SDP/ICE 是否只能在 connecting 且只能 host↔guest 转发。
4. 检查 playing dispatcher 是否只接受 heartbeat 和主动 `leave-room`。
5. 检查高频包中没有玩家名称、静态地图基线或可由接收端推导的字段。
6. 检查 `SPEC.md` 和 `docs/phase-3-notes.md` 是否同步。
7. 运行 typecheck、test、lint 和 format check。
