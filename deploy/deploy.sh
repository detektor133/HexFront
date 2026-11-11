#!/usr/bin/env bash
# Выкладка сервера на VPS по ключу SSH. Запускать из корня репозитория в Git Bash:
#   bash deploy/deploy.sh setup   — разовая подготовка сервера (setup.sh)
#   bash deploy/deploy.sh         — выкатить текущий коммит и перезапустить сервис
#   bash deploy/deploy.sh drain [минут] — не брать новых игроков и ждать конца идущих матчей
#   bash deploy/deploy.sh rollback — вернуть предыдущий релиз
# Секреты берутся из переменных окружения пользователя и в вывод не попадают:
#   HEXFRONT_VPS_HOST  — IP сервера          HEXFRONT_VPS_USER — пользователь (по умолчанию root)
#   HEXFRONT_SSH_KEY   — путь к приватному ключу
# Не секреты: HEXFRONT_DOMAIN (по умолчанию <ip>.sslip.io), HEXFRONT_ORIGINS (откуда играют).
set -euo pipefail

HOST="${HEXFRONT_VPS_HOST:?не задан HEXFRONT_VPS_HOST (см. deploy/README.md)}"
USER_NAME="${HEXFRONT_VPS_USER:-root}"
KEY="${HEXFRONT_SSH_KEY:?не задан HEXFRONT_SSH_KEY (см. deploy/README.md)}"
DOMAIN="${HEXFRONT_DOMAIN:-${HOST//./-}.sslip.io}"
ORIGINS="${HEXFRONT_ORIGINS:-https://hexfront-5d5.pages.dev,https://*.hexfront-5d5.pages.dev}"
APP=/opt/hexfront

SSH=(ssh -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 "$USER_NAME@$HOST")
remote() { "${SSH[@]}" "$@"; }

case "${1:-deploy}" in
  setup)
    "${SSH[@]}" "bash -s -- '$DOMAIN' '$ORIGINS'" <deploy/setup.sh
    ;;
  drain)
    # Дренаж: сервер перестаёт брать новых игроков и ждёт, пока идущие матчи закончатся (до N минут).
    WAIT_MIN="${2:-20}"
    remote "systemctl kill -s SIGUSR2 hexfront"
    for i in $(seq 1 $((WAIT_MIN * 6))); do
      rooms=$(remote "curl -fsS http://127.0.0.1:8080/healthz" | grep -o '"rooms":[0-9]*' | head -1 | cut -d: -f2)
      [ "${rooms:-0}" = "0" ] && { echo "комнат нет, можно выкладывать"; exit 0; }
      sleep 10
    done
    echo "за ${WAIT_MIN} мин комнаты не закончились (осталось ${rooms}); выкладывайте, если готовы их прервать"
    exit 1
    ;;
  rollback)
    remote "set -e; cd $APP; prev=\$(ls -1dt releases/* | sed -n 2p); [ -n \"\$prev\" ]; ln -sfn \"$APP/\$prev\" current; systemctl restart hexfront; echo \"откат на \$prev\""
    ;;
  deploy)
    [ -z "$(git status --porcelain)" ] || { echo "в дереве есть незакоммиченное: выкладываем только коммит"; exit 1; }
    REL="$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
    echo "релиз $REL"
    # Только то, что нужно серверу: код sim, protocol, mapgen и сам сервер.
    git archive HEAD package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json \
      packages/sim packages/protocol packages/mapgen apps/server \
      | "${SSH[@]}" "mkdir -p $APP/releases/$REL && tar -x -C $APP/releases/$REL"
    remote "set -e; cd $APP/releases/$REL; corepack pnpm install --prod --frozen-lockfile --ignore-scripts --filter @hexfront/server... ; chown -R hexfront:hexfront $APP/releases/$REL"
    remote "set -e; cd $APP; prev=\$(readlink current || true); ln -sfn $APP/releases/$REL current; systemctl restart hexfront"
    # Проверка живости; не поднялся — откат на прежний релиз.
    for i in $(seq 1 20); do
      if remote "curl -fsS http://127.0.0.1:8080/healthz" >/dev/null 2>&1; then
        echo "сервер жив: https://$DOMAIN/healthz"
        remote "cd $APP/releases && ls -1dt * | tail -n +6 | xargs -r rm -rf"
        exit 0
      fi
      sleep 1
    done
    echo "сервер не ответил за 20 с, откатываю"
    remote "set -e; cd $APP; prev=\$(ls -1dt releases/* | sed -n 2p); ln -sfn $APP/\$prev current; systemctl restart hexfront"
    exit 1
    ;;
  *)
    echo "команды: setup | deploy | drain [минут] | rollback"
    exit 2
    ;;
esac
