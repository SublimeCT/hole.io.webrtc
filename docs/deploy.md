# 部署

## 创建用户

1. 创建 ssh key

```bash
ssh-keygen -t ed25519 -N '' -f ~/.ssh/github_actions_ed25519 -C "github-actions"
cat ~/.ssh/github_actions_ed25519.pub
```

2. 创建部署用户

```bash
sudo adduser deploy-holeio
sudo mkdir /srv/holeio-server-dist/
sudo chown -R deploy-holeio:deploy-holeio /srv/holeio-server-dist
sudo su - deploy-holeio
mkdir -p ~/.ssh
chmod 700 ~/.ssh
vim ~/.ssh/authorized_keys # 写入公钥内容 ssh-ed25519 AAAA...

```

## 配置服务

1. 允许部署用户重启服务

```bash
sudo visudo -f /etc/sudoers.d/holeio-deploy
```

写入：

```text
deploy-holeio ALL=(root) NOPASSWD: /usr/bin/systemctl restart holeio-server.service
```

该用户拥有 `/srv/holeio-server-dist` 的写权限，并且只拥有重启 `holeio-server.service` 的 sudo 权限。上传目录结构为：

```text
/srv/holeio-server-dist/client/
/srv/holeio-server-dist/server/
```

2. 创建 `/etc/systemd/system/holeio-server.service`

```ini
[Unit]
After=network.target postgresql.service

[Service]
User=deploy-holeio
WorkingDirectory=/srv/holeio-server-dist/server
EnvironmentFile=/etc/holeio/server.env
ExecStartPre=/usr/bin/node dist/migrate.mjs
ExecStart=/usr/bin/node dist/server.mjs
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

3. 启用服务

```bash
sudo systemctl daemon-reload
sudo systemctl enable holeio-server.service
```

## 配置 TURN

1. 生成共享 secret（≥32 字符）

```bash
openssl rand -base64 48
```

2. 安装并启用 coturn

```bash
sudo apt-get install -y coturn
echo 'TURNSERVER_ENABLED=1' | sudo tee /etc/default/coturn
```

3. 写 `/etc/turnserver.conf`：复制 [infra/coturn/turnserver.conf](../infra/coturn/turnserver.conf) 全部内容，再追加 3 行

```text
static-auth-secret=<第 1 步生成的 secret>
realm=hole.io
external-ip=<服务器公网 IP>
```

> `external-ip` 仅当 `ip a` 显示内网 IP（10.x / 172.16-31.x / 192.168.x）时加；公网 IP 直连删此行。

4. 开放防火墙并启动

```bash
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 49160:49260/udp
sudo systemctl enable --now coturn
```

5. 在 `/etc/holeio/server.env` 追加（`TURN_SECRET` 必须等于 coturn 的 `static-auth-secret`）

```text
TURN_SECRET=<第 1 步生成的 secret>
STUN_URIS=stun:<公网IP或域名>:3478
TURN_URIS=turn:<公网IP或域名>:3478?transport=udp
```

> `TURN_TTL_SECONDS`（默认 3600）、`TURN_REALM`（默认 hole.io）可不写。

6. 验证

```bash
sudo systemctl status coturn
```

浏览器打开 <https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/>，填入 `STUN_URIS`/`TURN_URIS` + 信令下发的凭证，确认出现 `relay` 类型 candidate。

## 配置 GitHub Actions

在 GitHub 仓库 → Settings → Environments → `production` → Add environment secret 添加以下三个。工作流 [release-artifact.yml](../.github/workflows/release-artifact.yml) 用它们做 SSH 免密上传 + 远程重启服务。

**`DEPLOY_HOST`** — 部署目标服务器地址

- 值：公网 IP 或域名，如 `203.0.113.10` 或 `hole.example.com`。不带 `ssh://` 前缀、不带端口（端口已固定 22）。
- 用途：rsync 上传 `.deploy/` 到 `/srv/holeio-server-dist/` 的目标主机，以及 ssh 远程执行 `systemctl restart holeio-server.service`。

**`DEPLOY_SSH_KEY`** — SSH 私钥（PEM 全文）

- 值：[创建用户](#创建用户) 第 1 步 `ssh-keygen` 生成的私钥**全文**，含首尾标记：

  ```text
  -----BEGIN OPENSSH PRIVATE KEY-----
  （多行 base64）
  -----END OPENSSH PRIVATE KEY-----
  ```

- 取值：`cat ~/.ssh/github_actions_ed25519`
- 用途：runner 免密登录 `deploy-holeio`；对应公钥已在服务器 `deploy-holeio` 的 `~/.ssh/authorized_keys`。
- ⚠️ 是私钥本体（不是 `.pub`），切勿进仓库。

**`DEPLOY_KNOWN_HOSTS`** — 服务器 SSH host key（公钥）

- 值：标准 known_hosts 行 `<host> ssh-ed25519 <base64>`，如 `203.0.113.10 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5...`。
- 取值（`<host>` 换成 `DEPLOY_HOST` 的值）：

  ```bash
  ssh-keyscan -t ed25519 <host> 2>/dev/null | grep ssh-ed25519
  ```

  macOS 直接进剪贴板：`ssh-keyscan -t ed25519 <host> 2>/dev/null | grep ssh-ed25519 | pbcopy`

- 用途：工作流里 `ssh -o StrictHostKeyChecking=yes` 据此校验服务器身份防中间人；该值被原样写成 runner 的 `~/.ssh/known_hosts`。
- ⚠️ 每台服务器唯一，无默认值，不能猜，必须对实际服务器取。

> SSH 端口固定为 22、部署用户固定为 `deploy-holeio`（工作流内置默认值，无需配置为 secret）。

推送 `v*` tag 或手动运行 `.github/workflows/release-artifact.yml` 完成部署。
