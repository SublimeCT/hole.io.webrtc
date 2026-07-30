# TURN 中继服务

> 本文用于介绍如何配置服务器端的 TURN 中继服务, 用于在 webrtc 连接打洞失败后提供中继方案

移动运营商通常会封禁 `3478` 端口, 可以直接改为 `5349` 端口, 同时配置上 TLS 证书, **详见 [turnserver-cert.sh](../infra/coturn/turnserver-cert.sh), 以下只是对脚本的说明**, 因为需要 TLS 证书, 所以脚本通常被配置为在每次生成证书秘钥后执行, 详见 [crontab-配置](#crontab-配置)

以 `certbot` 生成的证书为例, 需要将通配符证书的公钥和私钥文件复制到 `/etc/` 下:

- `/etc/turnserver_cert.pem`
- `/etc/turnserver_privkey.pem`

这个路径可以是任意路径, 只要确保 `turnserver` 用户有权限访问即可:

```bash
# 2. 修正文件所有者 (Coturn 运行账户为 turnserver)
sudo chown turnserver:turnserver "$CERT_DEST" "$KEY_DEST"

# 3. 修正文件权限 (私钥必须是 600)
sudo chmod 644 "$CERT_DEST"
sudo chmod 600 "$KEY_DEST"
```

```bash
# 开放 TCP 5349 端口
sudo ufw allow 5349/tcp
sudo ufw reload
```

这里需要先到服务器提供商配置好开放的端口:

- `5349`: `TCP` TURNS
- `3478`: `TCP/UDP` STUN
- `49160 ~ 49260`: `UDP` TURN

脚本需要配置可执行权限:

```bash
sudo chmod +x /usr/local/bin/reload_coturn.sh
```

## crontab 配置

首先将脚本放到 `/usr/local/bin/reload_coturn.sh`(也可以改为其他路径)

```bash
crontab -e
```

在生成证书的那一行配置中的 `--deploy-hook` 加上 `sudo /usr/local/bin/reload_coturn.sh`, 也就是说, 如果现在是 `--deploy-hook "sudo nginx -s reload"`, 则应该改为 `--deploy-hook "sudo nginx -s reload && sudo /usr/local/bin/reload_coturn.sh"`

## cotrun 配置

参考 [turnserver.conf](../infra/coturn/turnserver.conf)

注意末尾的配置需要替换为服务器真实配置

## hole.io env 配置

```bash
PORT=30711
HOST=127.0.0.1
LOG_LEVEL=info
CORS_ORIGIN=https://holeio.xiaban.run
DATABASE_URL=postgresql://holeio:your-password@127.0.0.1:5432/holeio
TURN_SECRET=<your-secret>
STUN_URIS=stun:holeio.xiaban.run:3478
TURN_URIS=turns:holeio.xiaban.run:5349?transport=tcp
```
