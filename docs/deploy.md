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

## 配置 GitHub Actions

在 GitHub `production` Environment 中添加：

- `DEPLOY_HOST`
- `DEPLOY_PORT`
- `DEPLOY_USER`：`deploy-holeio`
- `DEPLOY_SSH_KEY`：私钥内容
- `DEPLOY_KNOWN_HOSTS`：服务器 SSH host key

推送 `v*` tag 或手动运行 `.github/workflows/release-artifact.yml` 完成部署。
