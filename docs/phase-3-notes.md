# Phase 3 Notes

## 已完成：后端与共享协议

- 删除旧房间/信令实现，建立 `lobby → connecting → playing → lobby` 多局房间状态机。
- 全局最多 20 个房间、每房最多 5 名真人；联机 roster 禁止 Bot。
- lobby 和 connecting 分别为 180 秒、30 秒；playing 固定 180 秒。
- WebSocket 在对局中保持，客户端每 4 秒发 application heartbeat；超过 8 秒时 guest 移除、host 解散房间。
- 所有玩家 ready 后 host 才能进入 connecting；SDP/ICE 强制只在 host↔guest 之间转发。
- playing 阶段拒绝 heartbeat 以外的所有客户端 WSS 消息，游戏数据不经过后端。
- 6 位去歧义房间码；不存在房间连续 5 次封 5 分钟、累计 10 次永久封禁。
- TypeBox strict runtime schema 校验全部 WSS 入站消息，并限制 payload、消息速率、待处理队列、发送缓冲、origin 和连接数。
- PostgreSQL + `@fastify/postgres` + Drizzle：持久化房间、对局 roster 和 IP 封禁，不记录高频游戏状态。
- `.env.local` / `.env` 与进程环境配置；coturn auth-secret 短期凭据和原生 Ubuntu 部署配置。
- DataChannel 共享协议定义 host 权威输入、unreliable 增量快照、reliable 世界事件、revision 重同步和分块 checkpoint。
- 联机房间页面已接入 WSS：真实房间码、URL 入房、ready、资料更新、4 秒心跳、局后重新入房和错误提示。
- 客户端严格校验服务端消息；Zustand 负责网络状态到 React UI 的框架无关桥接。
- host 与每个 guest 建立独立 `RTCPeerConnection`，包含 reliable 和 unordered/unreliable 双 DataChannel；全部通道 open 后才请求 start-match。
- Ubuntu 生产部署使用 systemd，不使用 Docker；项目发布目录和操作流程见 `docs/deployment-ubuntu.md`。

## 待完成：客户端联机

- host 使用 `packages/shared/simulation` 驱动最多 5 名人类输入，约 10Hz 广播增量。
- guest 快照插值、worldRevision 检查、checkpoint 分块重组与原子恢复。
- WebRTC ICE/TURN 实机 NAT、移动网络切换、弱网和带宽压力测试。

## 已知限制

- v1 没有 host 迁移，host 超时直接结束房间。
- 永久封禁需要数据库管理员解除；已签发的 TURN 临时凭据在 TTL 内无法由 Fastify 单独撤销。
- coturn 能验证 STUN/TURN 协议和认证，不能读取 DTLS 加密后的游戏 DataChannel 消息。
- 当前后端只持久化对局和 roster 骨架；最终排名/积分统计接口随客户端联机结算一并实现。
