---
name: drizzle-postgres
description: Hole.io 后端 PostgreSQL、pg 连接池和 Drizzle schema/migration 约定。修改 packages/server/src/db、数据库插件、持久化统计或封禁数据时使用。
---

# Drizzle PostgreSQL

## 项目边界

- PostgreSQL 用户名和数据库名固定为 `holeio`；密码和完整 `DATABASE_URL` 只从 `process.env`、`.env.local`、`.env` 读取。
- Fastify 注册 `@fastify/postgres` 管理连接池生命周期，Drizzle 复用 `app.pg.pool`。禁止另外创建未关闭的 Pool。
- schema 唯一真源为 `packages/server/src/db/schema.ts`；变更后运行 `pnpm --filter @hole-io/server db:generate`，migration 和 schema 同次提交。
- SQL 值始终参数化或由 Drizzle expression 构造。不要拼接客户端输入、表名或列名。

## 允许持久化的数据

- 房间码和房间生命周期。
- 对局起止、参与者和低频最终统计。
- 必须跨重启保留的 IP 临时/永久封禁。
- Phase 4 的事件化存档数据。

禁止写入 30/60Hz 输入、快照、玩家位置或完整世界 checkpoint。实时房间以进程内 `RoomService` 为准，PostgreSQL 不是游戏循环。

## Schema 与安全

- 房间码、状态、计数、用户资料等同时做应用层 runtime schema 和数据库 `CHECK`/unique 约束。
- 时间统一存 `timestamp with time zone`，应用边界使用 epoch milliseconds。
- 多表写入（例如 match + roster）使用事务。
- 不存在房间尝试的累计更新必须按 IP 串行或原子完成，不能用无保护的 read-modify-write。
- 数据库错误不向客户端暴露 query、连接串、表结构或堆栈；日志 redaction 覆盖密码、secret、credential 和 authorization。

## 修改检查单

1. 更新 Drizzle schema。
2. 生成并检查 SQL migration 与 snapshot。
3. 更新生产 Persistence 和测试用 MemoryPersistence 接口。
4. 确认 `.env.example` 只有占位值，没有真实密钥。
5. 更新 `SPEC.md`；架构权衡写入 `docs/decisions/`。
6. 运行 typecheck、test、lint、format check。
