#!/bin/sh
# Ежедневный полный дамп + постоянный WAL-архив (см. docs/OPERATIONS.md, RPO/RTO).
set -eu
mkdir -p /backups/daily
while true; do
  /bin/sh /scripts/backup.sh || echo "backup failed at $(date -u +%FT%TZ)" >&2
  # следующая копия через 24 часа
  sleep 86400
done
