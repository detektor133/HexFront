# Деплой сервера

Сервер: Node 24 за Caddy (TLS, wss) на дешёвом VPS. Клиент остаётся на Cloudflare Pages и подключается по `wss://`.

Выкладка идёт **по ключу SSH**, а не по паролю: пароль нужен только один раз, чтобы положить ключ на сервер, и агенту он не нужен. Секреты лежат в переменных окружения вашего пользователя Windows, в репозиторий и в вывод скриптов не попадают.

## Один раз: ключ и секреты (PowerShell на вашем ПК)

1. Ключ без пароля, только для деплоя:

   ```powershell
   ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\hexfront_deploy" -N '""' -C hexfront-deploy
   ```

2. Положить публичную часть на сервер (спросит пароль root **у вас**, один раз). Подставьте IP:

   ```powershell
   Get-Content "$env:USERPROFILE\.ssh\hexfront_deploy.pub" | ssh root@<IP> "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
   ```

3. Сохранить секреты в окружении пользователя (IP спросит и не покажет в истории команд):

   ```powershell
   [Environment]::SetEnvironmentVariable('HEXFRONT_VPS_HOST', (Read-Host 'IP сервера'), 'User')
   [Environment]::SetEnvironmentVariable('HEXFRONT_SSH_KEY', "$env:USERPROFILE\.ssh\hexfront_deploy", 'User')
   ```

   Если логин не `root`: `[Environment]::SetEnvironmentVariable('HEXFRONT_VPS_USER', 'имя', 'User')`.

4. Перезапустите Claude Code (и терминал): переменные окружения читаются при старте процесса.

5. Желательно после проверки входа по ключу отключить вход по паролю на сервере (`PasswordAuthentication no` в `/etc/ssh/sshd_config`, затем `systemctl restart ssh`): тогда украденный пароль ничего не даст.

## Команды (Git Bash, из корня репозитория)

```bash
bash deploy/deploy.sh setup      # один раз: Node, Caddy, сервис, файрвол
bash deploy/deploy.sh            # выкатить текущий коммит; не поднялся — автоматический откат
bash deploy/deploy.sh rollback   # вручную вернуть прошлый релиз
```

Домен для TLS по умолчанию `<ip-через-дефисы>.sslip.io` (публичный DNS, резолвится в ваш IP, сертификат выпускает Caddy). Свой домен: `HEXFRONT_DOMAIN`. Откуда разрешено играть: `HEXFRONT_ORIGINS` (по умолчанию `hexfront.pages.dev` и его поддомены).

## Что делает сервис

- Слушает только `127.0.0.1:8080`, наружу смотрит Caddy на 443; файрвол открывает 22, 80, 443.
- Работает от пользователя без прав, с `ProtectSystem=strict`, лимитом памяти 300 МБ и автоперезапуском.
- Настройки — `/etc/hexfront.env`: `ALLOWED_ORIGINS`, `MAX_ROOMS`, `TRUST_PROXY`. Логи — `journalctl -u hexfront`.
- Проверка: `https://<домен>/healthz`.
