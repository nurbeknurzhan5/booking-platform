#!/usr/bin/env bash
# Первая настройка стенда в GitHub Codespaces (postCreateCommand): зависимости, секреты, базы, миграции,
# демо-данные, суперадминистратор, сборка. Повторный запуск безопасен: секреты и данные сохраняются.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
mkdir -p .local
ENV_FILE="$ROOT/apps/api/.env"
DB="postgresql://booking_app:booking_dev_only@localhost:5432"

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
TRUST_PROXY=2
COOKIE_SECURE=false
DATABASE_URL=$DB/booking_dev?schema=public
SHADOW_DATABASE_URL=$DB/booking_shadow?schema=public
TEST_DATABASE_URL=$DB/booking_test?schema=public
DATABASE_POOL_SIZE=10
OTP_HMAC_SECRET=$(gen)
ENCRYPTION_KEY=$(gen)
ANALYTICS_SECRET=$(gen)
NOTIFICATION_CHANNELS=dev_inbox
OTP_CHANNELS=whatsapp,sms
STORAGE_DRIVER=local
STORAGE_LOCAL_DIR=./storage
STORAGE_PUBLIC_BASE_URL=/api/v1/media
MAX_UPLOAD_BYTES=5242880
ENV
  echo "    создан apps/api/.env (в git не попадает)"
fi

echo "==> 3/6 Ожидание PostgreSQL и создание баз"
for i in $(seq 1 60); do
  if node -e "const c=new (require('pg').Client)({connectionString:'$DB/booking_dev'});c.connect().then(()=>c.end()).then(()=>process.exit(0),()=>process.exit(1))" 2>/dev/null; then break; fi
  sleep 2
done
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
  OUT="$(cd apps/api && SUPERADMIN_PASSWORD="$PASS" npx tsx src/cli/create-superadmin.ts --email superadmin@demo.kz --name 'Суперадминистратор' 2>&1)"
  {
    echo "Суперадминистратор стенда Codespaces"
    echo "Вход: /login  e-mail: superadmin@demo.kz  пароль: $PASS"
    echo "Второй фактор: добавьте строку otpauth:// ниже в Google Authenticator / Aegis (или введите секрет вручную)"
    echo "$OUT" | grep -o 'otpauth://[^ ]*'
  } > .local/superadmin.txt
fi

echo "==> 6/6 Сборка API и сайта"
npm run build -w @booking/api
(cd apps/web && npx next build)

echo "Готово. Сервисы запускает .devcontainer/start.sh"
