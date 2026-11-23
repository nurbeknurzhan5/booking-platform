#!/usr/bin/env bash
# Запуск стенда (postStartCommand): адрес сайта Codespace → конфигурация API, затем API, воркер и сайт в фоне.
# Логи: .local/api.log, .local/worker.log, .local/web.log. Перезапуск вручную: bash .devcontainer/start.sh
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
ENV_FILE="$ROOT/apps/api/.env"
mkdir -p .local
[ -f "$ENV_FILE" ] || { echo "Нет apps/api/.env — запустите bash .devcontainer/setup.sh"; exit 1; }

# Публичный адрес сайта: в Codespaces — https://<имя>-3000.app.github.dev (нужен для ссылок в сообщениях и CORS)
if [ -n "${CODESPACE_NAME:-}" ]; then
  SITE="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  SECURE=true
else
  SITE="http://localhost:3000"
  SECURE=false
fi
setenv() { if grep -q "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else echo "$1=$2" >> "$ENV_FILE"; fi; }
setenv PUBLIC_BASE_URL "$SITE"
setenv WEB_ORIGIN "$SITE"
setenv COOKIE_SECURE "$SECURE"

# Останавливаем прежние процессы (повторный запуск)
pkill -f "node dist/main.js" 2>/dev/null || true
pkill -f "node dist/worker.js" 2>/dev/null || true
pkill -f "next start -p 3000" 2>/dev/null || true
sleep 1

(cd apps/api && setsid nohup node dist/main.js > "$ROOT/.local/api.log" 2>&1 &)
(cd apps/api && setsid nohup node dist/worker.js > "$ROOT/.local/worker.log" 2>&1 &)
(cd apps/web && setsid nohup npx next start -p 3000 > "$ROOT/.local/web.log" 2>&1 &)

for i in $(seq 1 60); do
  if curl -sf -o /dev/null http://localhost:4000/api/v1/health && curl -sf -o /dev/null http://localhost:3000/; then
    cat <<MSG

==============================================================
 Стенд запущен: $SITE
 Владельцы (пароль DemoOwner12345): owner@demo.kz (салон), club@demo.kz (клуб), sauna@demo.kz (баня)
 Суперадмин: см. .local/superadmin.txt
 «Тестовый телефон» (сообщения клиентам): $SITE/dev/phone
 Чтобы открыть сайт другим: вкладка PORTS → порт 3000 → Port Visibility → Public
==============================================================
MSG
    exit 0
  fi
  sleep 2
done
echo "Сервисы не ответили за 2 минуты — смотрите .local/api.log и .local/web.log"
exit 1
