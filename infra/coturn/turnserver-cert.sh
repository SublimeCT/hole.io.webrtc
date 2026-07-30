#!/bin/bash

# ================= 配置区域 =================
DOMAIN="holeio.a.run" # 替换为你的域名
CERT_SRC="/home/admin/.certbot/config/live/$DOMAIN/fullchain.pem" # 替换为你的证书路径
KEY_SRC="/home/admin/.certbot/config/live/$DOMAIN/privkey.pem" # 替换为你的证书路径

CERT_DEST="/etc/turnserver_cert.pem"
KEY_DEST="/etc/turnserver_privkey.pem"
# ===========================================

# 1. 复制证书文件
sudo cp -L "$CERT_SRC" "$CERT_DEST"
sudo cp -L "$KEY_SRC" "$KEY_DEST"

# 2. 【核心步骤】转换为 EC 格式
# Certbot 生成的 EC 证书通常是 PKCS#8 格式 (BEGIN PRIVATE KEY)
# Coturn 无法识别，必须转换为 SEC1 格式 (BEGIN EC PRIVATE KEY)
sudo openssl ec -in "$KEY_DEST" -out "$KEY_DEST.tmp" 2>/dev/null && sudo mv "$KEY_DEST.tmp" "$KEY_DEST"

# 3. 修正权限
sudo chown turnserver:turnserver "$CERT_DEST" "$KEY_DEST"
sudo chmod 644 "$CERT_DEST"
sudo chmod 600 "$KEY_DEST"

# 4. 重启服务
sudo systemctl restart coturn

echo "Coturn 证书更新并转换格式完成。"
