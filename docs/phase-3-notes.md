# Phase 3 Notes

## 已完成：后端与共享协议

- 删除旧房间/信令实现，建立 `lobby → connecting → playing → lobby` 多局房间状态机。
- 全局最多 20 个房间、每房最多 5 名真人；联机 roster 禁止 Bot。
- lobby 和 connecting 分别为 180 秒、30 秒；playing 固定 180 秒。
- WebSocket 在对局中保持，客户端每 4 秒发 application heartbeat；超过 8 秒时 guest 移除、host 解散房间。
- 所有玩家 ready 后 host 才能进入 connecting；SDP/ICE 强制只在 host↔guest 之间转发。
- playing 阶段只接受 heartbeat 和主动 `leave-room`，拒绝其他客户端 WSS 消息，游戏数据不经过后端。
- 6 位去歧义房间码；不存在房间连续 5 次封 5 分钟、累计 10 次永久封禁。
- TypeBox strict runtime schema 校验全部 WSS 入站消息，并限制 payload、消息速率、待处理队列、发送缓冲、origin 和连接数。
- PostgreSQL + `@fastify/postgres` + Drizzle：持久化房间、对局 roster 和 IP 封禁，不记录高频游戏状态。
- `.env.local` / `.env` 与进程环境配置；coturn auth-secret 短期凭据和原生 Ubuntu 部署配置。
- DataChannel 共享协议定义 host 权威输入、unreliable 增量快照、reliable 世界事件、revision 重同步和分块 checkpoint。
- 联机房间页面已接入 WSS：真实房间码、URL 入房、ready、资料更新、4 秒心跳、局后重新入房和错误提示。
- 客户端严格校验服务端消息；Zustand 负责网络状态到 React UI 的框架无关桥接。
- host 与每个 guest 建立独立 `RTCPeerConnection`，包含 reliable 和 unordered/unreliable 双 DataChannel；全部通道 open 后才请求 start-match。
- Ubuntu 生产部署使用 systemd，不使用 Docker；项目发布目录和操作流程见 `docs/deployment-ubuntu.md`。

## 已完成：客户端联机游戏循环

- `createMultiplayerSimulation(seed, spawnSeed, peerIds[])` 生成最多 5 名 human hole，id 等于 peerId。
- `OnlineGameDriver` 统一驱动 host 和 guest 侧逻辑：host 约 60Hz 步进权威模拟并约 10Hz unreliable 广播 `StateDeltaSnapshot`；guest 约 30Hz unreliable 发送输入包，通过 `SnapshotInterpolator` 过滤乱序快照后 `applyDelta` 到本地渲染态。
- `Game.createOnline(config)` 支持 `mode: "host" | "guest"`，host 侧处理 `setRemoteInput` 和 `buildCheckpoint`，guest 侧处理 `applyDelta` 和 `applyCheckpoint`，两者共用同一套 Three.js 渲染管线。
- `snapshotCodec.ts` 实现 host↔guest 完整序列化：`stateToDeltaSnapshot`、`buildFullCheckpoint`、`splitCheckpointIntoChunks`、`applyDeltaToState`、`applyCheckpointToState`。
- `MultiplayerProvider` Context 持久化 `MultiplayerSession`，跨 `/online`↔`/game` 路由导航不断线。
- 颜色冲突检测改为模态弹窗（仅弹给受影响的非 host 玩家）；host 侧 ready check 后端已排除 host 自身。
- 联机会话暂存路由懒加载期间到达的 reliable DataChannel 消息，guest 不会再因丢失 `match-start` 卡在 `00 / 00`。
- 联机对局返回主页前要求确认；确认后发送 `leave-room` 并销毁会话，重新点击联机将建立新房间会话。
- 房间邀请链接在 Clipboard API 不可用或被拒绝时使用 DOM 复制兜底。
- `poop-hit` 通过 reliable DataChannel 定向标识被命中的 peer，guest 可触发本机粪便雨表现。
- 游戏 HUD 左下显示实际渲染 FPS；联机排行榜头像使用各玩家圆环色和名称首字符。
- 房间服务拒绝 NFKC 后不区分大小写的重复玩家名称，Online 表单同步即时校验。

## 已知限制

- v1 没有 host 迁移，host 超时直接结束房间。
- 永久封禁需要数据库管理员解除；已签发的 TURN 临时凭据在 TTL 内无法由 Fastify 单独撤销。
- coturn 能验证 STUN/TURN 协议和认证，不能读取 DTLS 加密后的游戏 DataChannel 消息。
- 当前后端只持久化对局和 roster 骨架；最终排名/积分统计接口随客户端联机结算一并实现。
