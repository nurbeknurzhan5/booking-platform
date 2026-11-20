# Эксплуатация: среды, развёртывание, миграции, резервное копирование, мониторинг

## Среды

| Среда | БД | Каналы уведомлений | Назначение |
|---|---|---|---|
| development | `booking_dev` | `dev_inbox` (сообщения в БД) | локальная разработка |
| test | `booking_test` (отдельная, очищается тестами) | `dev_inbox` | автотесты, E2E |
| production | отдельный сервер PostgreSQL в РК | `whatsapp`, `sms` | эксплуатация |

Production и тестовая БД разделены. Тесты отказываются запускаться, если `TEST_DATABASE_URL` совпадает с `DATABASE_URL`. В production канал `dev_inbox` и cookie без `Secure` запрещены: приложение не стартует.

## Production-развёртывание (Docker)

Требования: Linux-сервер в РК (рекомендуется 4 vCPU / 8 ГБ RAM / SSD для 100–1000 организаций), Docker с Compose v2, домен, S3-совместимое хранилище.

```bash
cp infra/.env.prod.example infra/.env.prod          # заполнить домен, пароли, секреты, ключи интеграций
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod build
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d
# создать суперадминистратора (пароль только через переменную окружения):
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod run --rm \
  -e SUPERADMIN_PASSWORD='…' api node dist/cli/create-superadmin.js --email admin@company.kz
```

Сервисы:
- `db` — PostgreSQL 17, UTC, включён WAL-архив;
- `migrate` — одноразовый: `prisma migrate deploy` + справочники;
- `api` ×2;
- `worker` ×1 (можно больше: задачи безопасны при параллельном запуске);
- `web` — Next.js standalone;
- `caddy` — HTTPS (Let's Encrypt), HSTS, gzip/zstd;
- `backup` — ежедневный дамп.

Webhook WhatsApp: `https://{DOMAIN}/api/v1/integrations/whatsapp/webhook` (verify token = `WHATSAPP_VERIFY_TOKEN`, подпись по `WHATSAPP_APP_SECRET`).

**Обновление версии.** Задать `VERSION`, выполнить `build`, затем `up -d`. Миграции применяются автоматически сервисом `migrate` до запуска api и worker.

## Миграции

- Схема описана в `apps/api/prisma/schema.prisma`, миграции лежат в `apps/api/prisma/migrations`.
- Новая миграция в разработке: `npm run db:migrate:dev -w @booking/api -- --name <имя>` (создаётся SQL-файл; ручные ограничения добавляются отдельным файлом миграции).
- Применение (staging/production): `npm run db:migrate` = `prisma migrate deploy`. Деструктивные изменения выполняются в два релиза (expand → contract).
- Справочники (роли, права, тарифы, направления, шаблоны уведомлений и страниц) загружаются идемпотентно: `node dist/seed/run-reference-seed.js` или `npm run db:seed`.
- Демо-данные для разработки: `npm run db:seed -w @booking/api -- --demo` (в production отключены).

## Резервное копирование

- **Ежедневно** сервис `backup` делает `pg_dump --format=custom` → проверка `pg_restore --list` → SHA-256 → ротация (по умолчанию 14 дней). Файлы попадают в volume `backups`.
- **Непрерывно** PostgreSQL копирует WAL-сегменты в volume `walarchive` (`archive_command`). Это позволяет восстановление на момент времени (PITR) от последнего базового бэкапа (`pg_basebackup`, еженедельно — настраивается при выборе инфраструктуры).
- Копии нужно дополнительно синхронизировать во внешнее хранилище в другом ЦОД РК (например, `rclone`/`aws s3 sync` по cron).
- Локально и на Windows: `infra/backup/backup-local.ps1 -Database booking_dev -User booking_app -VerifyRestore` делает дамп, восстанавливает его во временную БД, сверяет количество строк и удаляет временную БД. Процедура проверена 2026-11-19: 1 организация, 461 запись, 4 миграции совпали.

## Восстановление

1. Остановить приложение: `docker compose … stop api worker web`.
2. Восстановить дамп в новую БД: `docker compose … exec backup sh /scripts/restore.sh /backups/daily/<file>.dump booking_restored`. Скрипт проверит контрольную сумму, создаст БД, восстановит её и покажет контрольные счётчики.
3. Для PITR: восстановить базовую копию, положить `recovery.signal`, задать `restore_command = 'cp /wal-archive/%f %p'` и `recovery_target_time`.
4. Указать `POSTGRES_DB=booking_restored` или переименовать БД, затем выполнить `up -d` (migrate проверит миграции).
5. Проверить `GET /api/v1/health`, вход суперадмина и публичную страницу.
6. Проверять процедуру восстановления ежеквартально.

## RPO / RTO (предложение, утверждается после выбора инфраструктуры — R-08)

| Показатель | Только ежедневный дамп | Дамп + WAL-архив |
|---|---|---|
| RPO (потеря данных) | ≤ 24 ч | ≤ 15 мин (`archive_timeout=900`) |
| RTO (время восстановления) | ≤ 4 ч | ≤ 4 ч |

## Мониторинг и логи

- **Health check:** `GET /api/v1/health` — статус БД, задержка, размер очереди уведомлений и DLQ. Docker HEALTHCHECK встроен в образ API.
- **Логи:** структурированный JSON (pino) в stdout. Каждый запрос получает `X-Request-Id`. Cookie, Authorization, CSRF и MFA-коды редактируются, query-строки не логируются (там могут быть токены), номера телефонов маскируются. Централизованный сбор настраивается драйвером логов Docker (Loki/Promtail, ELK или Graylog).
- **Алерты (рекомендуется):** health ≠ 200; `notifications.dead > 0`; `pending` растёт дольше 5 минут; ошибки 5xx > 1%; свободное место на диске; отсутствие свежего файла в `backups/daily` больше 26 часов.
- **Админ-панель:** системная статистика, состояние интеграций, очереди сообщений и DLQ с ручным повтором, журнал аудита.

## Масштабирование

- API без состояния — достаточно увеличить `replicas`.
- Воркер можно запускать в нескольких экземплярах: outbox и резервы используют `SKIP LOCKED`, периодические задачи — advisory-блокировки.
- PostgreSQL: пул на экземпляр `DATABASE_POOL_SIZE=20`. При росте подключить pgbouncer (transaction mode) и реплику только для чтения под аналитику.
- Redis в MVP не используется (решение D-01). Rate limit и очереди скрыты за сервисами `RateLimitService` и `JobsService` и могут быть переведены на Redis без изменения бизнес-логики.
