#!/bin/sh
# Резервная копия PostgreSQL: pg_dump в custom-формате, проверка, ротация.
# Переменные: PGHOST PGUSER PGPASSWORD PGDATABASE BACKUP_RETENTION_DAYS
set -eu
: "${PGDATABASE:?PGDATABASE не задан}"
: "${PGHOST:?PGHOST не задан}"
TS=$(date -u +%Y%m%dT%H%M%SZ)
DIR=/backups/daily
FILE="$DIR/${PGDATABASE}-${TS}.dump"
mkdir -p "$DIR"
# незавершённый дамп не остаётся на диске (и не принимается за копию)
trap 'rm -f "$FILE.partial"' EXIT
pg_dump --format=custom --compress=9 --no-owner --file="$FILE.partial" "$PGDATABASE"
# проверка, что архив читается
pg_restore --list "$FILE.partial" > /dev/null
mv "$FILE.partial" "$FILE"
# в .sha256 — имя без каталога: копию можно проверить после переноса в другое место
(cd "$DIR" && sha256sum "$(basename "$FILE")" > "$(basename "$FILE").sha256")
echo "backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
# ротация
find "$DIR" -name "*.dump" -mtime +"${BACKUP_RETENTION_DAYS:-14}" -delete
find "$DIR" -name "*.sha256" -mtime +"${BACKUP_RETENTION_DAYS:-14}" -delete
find /wal-archive -type f -mtime +"${BACKUP_RETENTION_DAYS:-14}" -delete 2>/dev/null || true
# Рекомендуется дополнительно копировать $DIR во внешнее хранилище (S3 в другом ЦОД РК).
