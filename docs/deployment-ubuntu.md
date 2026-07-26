# Ubuntu 部署与运维

本文只说明本项目的发布、启停、更新和回滚。域名、证书、Nginx 主配置、PostgreSQL、TURN 和防火墙由服务器现有配置负责，本文不重复初始化或调优。

禁止为本项目创建或启用 swap。

## 1. 固定目录

```text
/srv/hole.io.webrtc/
  releases/<release>/       # 每个前端版本的静态文件
  dist -> releases/<release>

/srv/hole.io.webrtc-server/
  releases/<release>/       # 完整 pnpm workspace
  current -> releases/<release>
  .env.local                # 持久化后端配置，不进入 release
```

- Nginx 的前端根目录固定为 `/srv/hole.io.webrtc/dist/`。
- Fastify 的工作目录固定为 `/srv/hole.io.webrtc-server/current/`。
- release 目录不可原地修改；每次更新创建新 release，再切换软链接。
- `.env.local` 只允许服务运行用户读取，不复制进 release，也不提交到 Git。

## 2. Nginx 对接约定

在现有独立域名的 Nginx server block 中保持以下行为：

- 静态文件根目录指向 `/srv/hole.io.webrtc/dist/`。
- SPA 未命中静态文件时回退到 `index.html`。
- `/ws` 转发到 Fastify 的 `/ws`，保留 WebSocket `Upgrade` 和 `Connection` 请求头。
- `/health` 转发到 Fastify 的 `/health`。
- WSS 读超时必须大于应用的 4 秒心跳间隔和 8 秒掉线判定。
- 后续存档 REST API 使用同一个后端 upstream。

生产前端默认使用当前页面域名下的 `/ws`，不需要在仓库或文档中保存域名。

## 3. 后端环境文件

将实际配置保存在：

```text
/srv/hole.io.webrtc-server/.env.local
```

需要提供的变量名：

```text
PORT
HOST
LOG_LEVEL
CORS_ORIGIN
TRUST_PROXY
DATABASE_URL
TURN_SECRET
TURN_TTL_SECONDS
TURN_REALM
STUN_URIS
TURN_URIS
```

约束：

- `HOST` 只监听 Nginx 能访问的本机地址。
- `CORS_ORIGIN` 只允许实际前端 Origin，不使用 `*`。
- `TRUST_PROXY` 只信任现有 Nginx。
- `DATABASE_URL`、`TURN_SECRET` 和 TURN 凭据配置不得出现在命令行、日志、release 或 Git 中。
- 每个 release 的 `packages/server/.env.local` 使用软链接指向持久化 `.env.local`，以便应用和 Drizzle 按 dotenv 标准读取。

## 4. 准备 release

将完整 pnpm workspace 上传或检出到：

```text
/srv/hole.io.webrtc-server/releases/<release>/
```

在该 release 根目录执行：

```bash
ln -s /srv/hole.io.webrtc-server/.env.local packages/server/.env.local
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

首次部署在构建检查通过后执行 migration；更新时不要在准备阶段执行，按第 8 节先备份并停止旧服务：

```bash
pnpm --filter @hole-io/server db:migrate
```

将构建后的前端静态文件复制到对应前端 release：

```bash
mkdir -p /srv/hole.io.webrtc/releases/<release>
rsync -a --delete packages/client/dist/ /srv/hole.io.webrtc/releases/<release>/
```

所有命令都应由现有服务运行用户执行，避免在 `/srv` 下产生其他用户所有的文件。

## 5. systemd 服务

Fastify 使用一个 systemd 服务和一个 Node 进程。不要使用 PM2 或 Node cluster，因为房间状态保存在单进程内存中。

服务单元的项目相关部分如下；运行用户和 pnpm 绝对路径使用服务器现有值：

```ini
[Unit]
Description=Hole.io WebRTC server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=<运行用户>
Group=<运行组>
WorkingDirectory=/srv/hole.io.webrtc-server/current
EnvironmentFile=/srv/hole.io.webrtc-server/.env.local
ExecStart=<pnpm绝对路径> --filter @hole-io/server start
Restart=on-failure
RestartSec=3
TimeoutStopSec=20
KillSignal=SIGTERM
LimitNOFILE=65536
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

正常停止必须使用 systemd。Fastify 收到 `SIGTERM` 后会结束房间、停止定时任务并关闭数据库连接池；不要使用 `kill -9`。

## 6. 首次启用

确认 release 已通过第 4 节检查后，切换前后端链接：

```bash
ln -sfn /srv/hole.io.webrtc-server/releases/<release> /srv/hole.io.webrtc-server/current
ln -sfn /srv/hole.io.webrtc/releases/<release> /srv/hole.io.webrtc/dist
systemctl enable --now holeio-server
```

验证：

```bash
systemctl is-active holeio-server
systemctl status holeio-server --no-pager
journalctl -u holeio-server -n 100 --no-pager
```

最后通过现有 Nginx 的 `/health` 检查数据库和 Fastify 状态，并从浏览器确认静态资源及 `/ws` Upgrade 正常。

## 7. 启动、停止与日志

```bash
systemctl start holeio-server
systemctl stop holeio-server
systemctl restart holeio-server
systemctl status holeio-server --no-pager
journalctl -u holeio-server -f
journalctl -u holeio-server --since "30 min ago" --no-pager
```

停止或重启会结束所有内存房间。当前没有 host migration，更新前必须安排维护窗口。

## 8. 更新

1. 将新版本放入新的 backend release 目录。
2. 按第 4 节完成依赖安装、检查、测试和构建，不在此时执行 migration。
3. 使用现有数据库备份机制创建更新前备份，并记录备份标识。
4. 记录当前前后端软链接指向的旧 release。
5. 优雅停止 `holeio-server`。
6. 执行新 release 的 migration。
7. 将 `current` 和 `dist` 分别切换到同一个新 release 标识。
8. 启动 `holeio-server`。
9. 检查 systemd 状态、journal、Nginx `/health` 和浏览器 WSS 建连。

切换命令：

```bash
systemctl stop holeio-server
ln -sfn /srv/hole.io.webrtc-server/releases/<release> /srv/hole.io.webrtc-server/current
ln -sfn /srv/hole.io.webrtc/releases/<release> /srv/hole.io.webrtc/dist
systemctl start holeio-server
```

确认新版本稳定后再清理旧 release，至少保留当前版本和上一个可运行版本。

## 9. 回滚

如果 migration 保持向后兼容，代码和前端可以直接回滚：

```bash
systemctl stop holeio-server
ln -sfn /srv/hole.io.webrtc-server/releases/<old-release> /srv/hole.io.webrtc-server/current
ln -sfn /srv/hole.io.webrtc/releases/<old-release> /srv/hole.io.webrtc/dist
systemctl start holeio-server
```

回滚后检查 systemd、journal、`/health` 和 WSS。

只有代码回滚无法兼容新 migration 时，才停止服务并通过现有数据库恢复流程恢复更新前备份。数据库恢复会丢失备份之后的数据，不能作为常规回滚步骤。

## 10. 项目运维检查

日常只检查与本项目直接相关的状态：

- `holeio-server` 是否持续为 active，重启次数是否异常增长。
- `/health` 是否返回成功，数据库状态是否为 `ok`。
- journal 是否持续出现 WSS 协议错误、连接拒绝、房间 sweep 错误或数据库错误。
- Node 常驻内存是否持续增长；不通过 swap 掩盖内存泄漏。
- coturn 是否出现 allocation 配额拒绝或异常中继流量。
- 更新后前端 release 与 backend release 标识是否一致。

出现内存持续增长时，先保留日志和堆快照，再停止新房间进入或回滚版本；不要创建或启用 swap。
