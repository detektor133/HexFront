#!/usr/bin/env bash
# Разовая подготовка VPS (Ubuntu/Debian), запускается на сервере от root: ставит Node 24, pnpm, Caddy,
# заводит пользователя hexfront, systemd-сервис и файрвол. Повторный запуск безопасен.
# Использование (с вашего ПК это делает deploy.sh setup): bash setup.sh <домен> <origins через запятую>
set -euo pipefail

DOMAIN="${1:?домен для TLS, например 1-2-3-4.sslip.io}"
ORIGINS="${2:?разрешённые Origin клиента, через запятую}"
APP=/opt/hexfront

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg ufw debian-keyring debian-archive-keyring apt-transport-https

# Node 24 LTS
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
corepack enable
corepack prepare pnpm@10.21.0 --activate

# Caddy (TLS и wss)
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' >/etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi
cat >/etc/caddy/Caddyfile <<EOF
${DOMAIN} {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8080
}
EOF

id hexfront >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin hexfront
mkdir -p "$APP/releases"
chown -R hexfront:hexfront "$APP"

# Настройки сервера (не секреты): Origin клиента, прокси, предел комнат под 1 vCPU / 512 МБ.
cat >/etc/hexfront.env <<EOF
PORT=8080
HOST=127.0.0.1
TRUST_PROXY=1
ALLOWED_ORIGINS=${ORIGINS}
MAX_ROOMS=8
EOF

cat >/etc/systemd/system/hexfront.service <<'EOF'
[Unit]
Description=Hexfront game server
After=network.target

[Service]
User=hexfront
WorkingDirectory=/opt/hexfront/current
EnvironmentFile=/etc/hexfront.env
# Лимиты памяти V8 под 512 МБ: комната ≈ 3 МБ, запас большой (docs/architecture/performance.md).
ExecStart=/usr/bin/node --max-semi-space-size=2 --max-old-space-size=160 apps/server/src/main.ts
Restart=always
RestartSec=2
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
MemoryMax=300M

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable hexfront
systemctl restart caddy

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
echo "готово: домен ${DOMAIN}"
