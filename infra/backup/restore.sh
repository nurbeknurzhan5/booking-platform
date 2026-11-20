#!/bin/sh
# Восстановление из дампа в ЧИСТУЮ базу (процедура — docs/OPERATIONS.md, раздел «Восстановление»).
# Использование: PGHOST=... PGUSER=... PGPASSWORD=... sh restore.sh /backups/daily/booking-YYYYMMDDTHHMMSSZ.dump target_db
set -eu
DUMP="$1"
TARGET="${2:?target database name required}"
sha256sum -c "$DUMP.sha256"
echo "Создание базы $TARGET (должна не существовать)..."
createdb "$TARGET"
pg_restore --no-owner --exit-on-error --jobs=4 --dbname="$TARGET" "$DUMP"
psql -d "$TARGET" -c "SELECT count(*) AS migrations FROM _prisma_migrations;" -c "SELECT count(*) AS organizations FROM organizations;"
echo "Восстановлено в $TARGET. Переключите DATABASE_URL и перезапустите api/worker."
