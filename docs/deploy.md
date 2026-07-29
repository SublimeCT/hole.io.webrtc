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

> 之后每次编辑该 unit 文件，都要先 `sudo systemctl daemon-reload` 再 `restart`，否则改了不生效（systemctl 会报 "unit file ... changed on disk"）。改 `/etc/holeio/server.env` 不需要 daemon-reload，直接 `restart holeio-server.service`；改 `/etc/turnserver.conf` 则 `restart coturn`。

## 配置 nginx

nginx 负责：HTTPS 静态前端 + 反代 `/access-status` 和 `/ws`（信令 WebSocket）到本机 Fastify（默认 3001）。TURN 不走 nginx（coturn 直连 3478）。客户端生产环境连 `wss://<当前域名>/ws`，连前先 `GET /access-status`（[signaling.ts](../packages/client/src/net/signaling.ts)）；前后端同域，无 CORS 问题。

1. 写 `/etc/nginx/sites-available/holeio`（`<your-domain>` 换成你的域名）

```nginx
upstream holeio_backend {
    server 127.0.0.1:3001;
    keepalive 16;
}

server {
    listen 80;
    listen [::]:80;
    server_name <your-domain>;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name <your-domain>;

    ssl_certificate     /etc/letsencrypt/live/<your-domain>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<your-domain>/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    root /srv/holeio-server-dist/client;
    index index.html;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    location = /access-status {
        proxy_pass http://holeio_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location = /ws {
        proxy_pass http://holeio_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

2. 启用、取证书、重载

已有通配符证书（其他站点在用）：把配置里的 `ssl_certificate`/`ssl_certificate_key` 指到那份证书路径，跳过 certbot。

```bash
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -s /etc/nginx/sites-available/holeio /etc/nginx/sites-enabled/holeio
sudo nginx -t
sudo systemctl reload nginx
```

没有证书、用 Let's Encrypt 现取：

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -s /etc/nginx/sites-available/holeio /etc/nginx/sites-enabled/holeio
sudo certbot certonly --nginx -d <your-domain>
sudo nginx -t
sudo systemctl reload nginx
sudo certbot renew --dry-run
```

> 前提：域名 A 记录已指向本机公网 IP。已有该域名的 nginx server 块时，只需往里加 `upstream` 和三个 `location`（`/access-status`、`/ws`、`/`），不必新建文件。通配符证书（DNS-01 签发）不需要 `/.well-known/acme-challenge/` 那段，可删；若别的站点已有全局 80→443 跳转，本站点的 `listen 80` 块也可删。`proxy_read_timeout 3600s` 必须有（默认 60s 会掐断空闲 WebSocket）；`X-Forwarded-For` 必须透传，否则 Fastify（`TRUST_PROXY` 默认信任 127.0.0.1）拿不到真实客户端 IP，单 IP 连接数限制会全员挤成 nginx 的 IP。

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

> 主机层（ufw）只是其中一层。阿里云等云厂商还有一层**安全组**（网络层，流量进实例前先过它）：控制台 ECS → 实例 → 安全组 → 入方向，同样放行 `3478/tcp`、`3478/udp`、`49160/49260/udp`，源 `0.0.0.0/0`。安全组不放行，ufw 配了也没用——流量根本到不了机器。

5. 写环境文件 `/etc/holeio/server.env`（**必须在 `/srv` 之外**：`/srv/holeio-server-dist/` 整棵树由 rsync 每次部署 `--delete` 覆盖，配置放里面会被冲掉。systemd 的 `EnvironmentFile=` 从这里把变量注入进程环境，rsync 永远碰不到它）

```bash
sudo install -d -m 0755 /etc/holeio
sudo tee /etc/holeio/server.env > /dev/null <<'EOF'
DATABASE_URL=postgres://holeio:<密码>@localhost:5432/holeio
CORS_ORIGIN=https://<your-domain>
HOST=127.0.0.1
TURN_SECRET=<第 1 步生成的 secret>
STUN_URIS=stun:<公网IP或域名>:3478
TURN_URIS=turn:<公网IP或域名>:3478?transport=udp
EOF
sudo chmod 600 /etc/holeio/server.env
```

`TURN_SECRET` 必须等于 coturn 的 `static-auth-secret`。`CORS_ORIGIN` 必须设成生产域名（默认 `http://localhost:5173`，不设会导致 `/ws` 的 Origin 校验返回 403、WebSocket 连不上；`/access-status` 因不走该校验仍正常）。`HOST=127.0.0.1` 让 Fastify 只监听本机，公网由 nginx 反代（默认 `0.0.0.0` 会监听所有网卡）。`TURN_TTL_SECONDS`（默认 3600）、`TURN_REALM`（默认 hole.io）可不写。dev 用工作目录的 `.env`/`.env.local`，prod 用这个 `EnvironmentFile`，两套互不干扰。

> URI 里填域名（而非 IP）时，只需在 DNS 加一条 A 记录指向服务器公网 IP，服务器无需额外配置——域名由玩家浏览器解析，信令服务原样透传 URI，coturn 只认端口。

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
