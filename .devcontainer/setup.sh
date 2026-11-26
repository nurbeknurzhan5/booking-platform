#!/usr/bin/env bash
# Первая настройка стенда в GitHub Codespaces (postCreateCommand): зависимости, секреты, базы, миграции,
# демо-данные, суперадминистратор, сборка. Повторный запуск безопасен: секреты и данные сохраняются.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
mkdir -p .local
ENV_FILE="$ROOT/apps/api/.env"
WEB_ENV_FILE="$ROOT/apps/web/.env.local"
DB="postgresql://booking_app:booking_dev_only@localhost:5432"

# Добавляет строку KEY=VALUE, только если ключа ещё нет (повторный запуск не меняет существующие значения и секреты).
ensure_env() { grep -q "^$2=" "$1" 2>/dev/null || printf '%s=%s
' "$2" "$3" >> "$1"; }

echo "==> 1/6 Установка зависимостей"
npm ci --no-audit --no-fund

echo "==> 2/6 Конфигурация API (секреты генерируются один раз)"
if [ ! -f "$ENV_FILE" ]; then
  gen() { node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"; }
  cat > "$ENV_FILE" <<ENV
NODE_ENV=development
APP_ENV=development
PORT=4000
LOG_LEVEL=info
WEB_ORIGIN=http://localhost:3000
PUBLIC_BASE_URL=http://localhost:3000
# X-Forwarded-For не используется: Next.js пропускает заголовок клиента как есть, а перезаписывает ли его
# прокси Codespaces — не гарантировано (D-54). Лимиты по IP общие для стенда.
TRUST_PROXY=0
COOKIE_SECURE=false
DATABASE_URL=$DB/booking_dev?schema=public
SHADOW_DATABASE_URL=$DB/booking_shadow?schema=public
TEST_DATABASE_URL=$DB/booking_test?schema=public
DATABASE_POOL_SIZE=10
OTP_HMAC_SECRET=$(gen)
ENCRYPTION_KEY=$(gen)
ANALYTICS_SECRET=$(gen)
NOTIFICATION_CHANNELS=dev_inbox
DEV_INBOX_ENABLED=true
OTP_CHANNELS=whatsapp,sms
STORAGE_DRIVER=local
STORAGE_LOCAL_DIR=./storage
STORAGE_PUBLIC_BASE_URL=/api/v1/media
MAX_UPLOAD_BYTES=5242880
ENV
  echo "    создан apps/api/.env (в git не попадает)"
fi
# Стенд разработки: «Тестовый телефон» включается явным флагом (API — DEV_INBOX_ENABLED, сайт — при сборке).
ensure_env "$ENV_FILE" DEV_INBOX_ENABLED true
ensure_env "$WEB_ENV_FILE" NEXT_PUBLIC_DEV_INBOX_ENABLED true

echo "==> 3/6 Ожидание PostgreSQL и создание баз"
PG_READY=0
for i in $(seq 1 60); do
  if node -e "const c=new (require('pg').Client)({connectionString:'$DB/booking_dev'});c.connect().then(()=>c.end()).then(()=>process.exit(0),()=>process.exit(1))" 2>/dev/null; then PG_READY=1; break; fi
  sleep 2
done
[ "$PG_READY" = 1 ] || { echo "PostgreSQL не ответил за 2 минуты (контейнер db)" >&2; exit 1; }
node -e "
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: '$DB/booking_dev' });
  await c.connect();
  for (const db of ['booking_test', 'booking_shadow']) {
    const r = await c.query('SELECT 1 FROM pg_database WHERE datname = \$1', [db]);
    if (!r.rowCount) await c.query('CREATE DATABASE ' + db);
  }
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
"

echo "==> 4/6 Миграции и демо-данные"
npm run build -w @booking/shared
(cd apps/api && npx prisma generate && npx prisma migrate deploy && npx tsx prisma/seed.ts --demo)

echo "==> 5/6 Суперадминистратор (пароль и ключ MFA — в .local/superadmin.txt)"
if [ ! -f .local/superadmin.txt ]; then
  PASS="$(node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))")"
  OUT="$(cd apps/api && SUPERADMIN_PASSWORD="$PASS" npx tsx src/cli/create-superadmin.ts --email superadmin@demo.kz --name 'Суперадминистратор' 2>&1)"     || { echo "Не удалось создать суперадминистратора: $OUT" >&2; exit 1; }
  URI="$(printf '%s
' "$OUT" | grep -o 'otpauth://[^ ]*' || true)"
  [ -n "$URI" ] || { echo "Не найден ключ MFA (otpauth://) в выводе create-superadmin" >&2; exit 1; }
  # Файл пишется целиком через временный: при сбое повторный запуск создаст его заново.
  {
    echo "Суперадминистратор стенда Codespaces"
    echo "Вход: /login  e-mail: superadmin@demo.kz  пароль: $PASS"
    echo "Второй фактор: добавьте строку otpauth:// ниже в Google Authenticator / Aegis (или введите секрет вручную)"
    echo "$URI"
  } > .local/superadmin.txt.tmp
  mv .local/superadmin.txt.tmp .local/superadmin.txt
fi

echo "==> 6/6 Сборка API и сайта"
npm run build -w @booking/api
(cd apps/web && NEXT_PUBLIC_DEV_INBOX_ENABLED=true npx next build)

echo "Готово. Сервисы запускает .devcontainer/start.sh"
