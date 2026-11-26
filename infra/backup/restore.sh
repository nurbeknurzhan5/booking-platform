#!/bin/sh
# Восстановление из дампа в ЧИСТУЮ базу (процедура — docs/OPERATIONS.md, раздел «Восстановление»).
# Использование: PGHOST=... PGUSER=... PGPASSWORD=... sh restore.sh /backups/daily/booking-YYYYMMDDTHHMMSSZ.dump target_db
set -eu
DUMP="${1:?usage: restore.sh <dump-file> <target-db>}"
TARGET="${2:?target database name required}"
[ -f "$DUMP" ] || { echo "Нет файла дампа: $DUMP" >&2; exit 1; }
[ -f "$DUMP.sha256" ] || { echo "Нет контрольной суммы: $DUMP.sha256" >&2; exit 1; }
# sha256sum -c ищет файл по пути из .sha256 — проверяем из каталога дампа
(cd "$(dirname "$DUMP")" && sha256sum -c "$(basename "$DUMP").sha256")
echo "Создание базы $TARGET (должна не существовать)..."
createdb "$TARGET"
pg_restore --no-owner --exit-on-error --jobs=4 --dbname="$TARGET" "$DUMP"
psql -d "$TARGET" -c "SELECT count(*) AS migrations FROM _prisma_migrations;" -c "SELECT count(*) AS organizations FROM organizations;"
echo "Восстановлено в $TARGET. Переключите DATABASE_URL и перезапустите api/worker."
