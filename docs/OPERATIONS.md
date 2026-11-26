# Эксплуатация: среды, развёртывание, миграции, резервное копирование, мониторинг

## Среды

| Среда | БД | Каналы уведомлений | Назначение |
|---|---|---|---|
| development | `booking_dev` | `dev_inbox` (сообщения в БД; только при `DEV_INBOX_ENABLED=true`) | локальная разработка |
| test | `booking_test` (отдельная, очищается тестами) | `dev_inbox` (только при `DEV_INBOX_ENABLED=true`) | автотесты, E2E |
| production | отдельный сервер PostgreSQL в РК | `whatsapp`, `sms` | эксплуатация |

Production и тестовая БД разделены. Тесты отказываются запускаться, если `TEST_DATABASE_URL` совпадает с `DATABASE_URL`. В production канал `dev_inbox`, флаг `DEV_INBOX_ENABLED=true` и cookie без `Secure` запрещены: приложение не стартует. При `NODE_ENV=production` без явного `APP_ENV` API и воркер тоже не запускаются (fail-closed). «Тестовый телефон» в development и test включается только явно: `DEV_INBOX_ENABLED=true` у API и `NEXT_PUBLIC_DEV_INBOX_ENABLED=true` при сборке сайта (D-44).

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
- `migrate` — одноразовый: `../../node_modules/.bin/prisma migrate deploy` + справочники;
- `api` ×2;
- `worker` ×1 (можно больше: задачи безопасны при параллельном запуске);
- `web` — Next.js standalone; адрес API для rewrites `/api/*` задаётся при сборке образа (build-arg `API_INTERNAL_URL`, по умолчанию `http://api:4000`);
- `caddy` — HTTPS (Let's Encrypt), HSTS, gzip/zstd; журнал без токенов и учётных заголовков (см. «Мониторинг и логи»);
- `backup` — ежедневный дамп.

Compose закрепляет `APP_ENV=production`, `DEV_INBOX_ENABLED=false` и `TRUST_PROXY=1`: перед API один «пишущий» прокси — Caddy (без `trusted_proxies` он отбрасывает присланный клиентом `X-Forwarded-For`), rewrite Next.js присланный заголовок пропускает как есть и запись не добавляет (D-54). Без Caddy (сайт открыт напрямую) `TRUST_PROXY` должен быть `0` — иначе посетитель подставляет `X-Forwarded-For` и обходит лимиты. Если перед Caddy появится балансировщик или CDN, задайте в Caddy `trusted_proxies` с его адресами, `TRUST_PROXY` не меняйте.

Образы: в образе API установлен `openssl` (нужен Prisma); у каждого Dockerfile свой `*.Dockerfile.dockerignore`. Сборку образов и `docker compose … config` проверяет job `docker` в CI (**не проверено: нужен прогон CI**, локально Docker не установлен, D-02).

Webhook WhatsApp: `https://{DOMAIN}/api/v1/integrations/whatsapp/webhook` (verify token = `WHATSAPP_VERIFY_TOKEN`, подпись по `WHATSAPP_APP_SECRET`).

**Обновление версии.** Задать `VERSION`, выполнить `build`, затем `up -d`. Миграции применяются автоматически сервисом `migrate` до запуска api и worker.

## Миграции

- Схема описана в `apps/api/prisma/schema.prisma`, миграции лежат в `apps/api/prisma/migrations`.
- Новая миграция в разработке: `npm run db:migrate:dev -w @booking/api -- --name <имя>` (создаётся SQL-файл; ручные ограничения добавляются отдельным файлом миграции).
- Применение (staging/production): `npm run db:migrate` = `prisma migrate deploy`. Деструктивные изменения выполняются в два релиза (expand → contract).
- Справочники (роли, права, тарифы, направления, шаблоны уведомлений и страниц) загружаются идемпотентно: `node dist/seed/run-reference-seed.js` или `npm run db:seed`.
- Демо-данные для разработки: `npm run db:seed -w @booking/api -- --demo` (в production отключены).

## Резервное копирование

- **Ежедневно** сервис `backup` делает `pg_dump --format=custom` → проверка `pg_restore --list` → SHA-256 → ротация (по умолчанию 14 дней). Файлы попадают в volume `backups`. Файл `.sha256` содержит имя дампа без каталога: проверка `sha256sum -c` работает после копирования в другое место.
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

- **Health check:** `GET /api/v1/health` — статус БД и задержка (на каждый запрос), размер очереди уведомлений и DLQ (обновляется не чаще раза в 30 с, D-51). Docker HEALTHCHECK встроен в образ API.
- **Логи:** структурированный JSON (pino) в stdout. Каждый запрос получает `X-Request-Id`. Заголовки запроса и ответа не пишутся, query-строки не логируются, сегмент пути после `manage`, `waitlist-offers`, `confirm` заменяется на `[REDACTED]` (там токены), номера телефонов маскируются. Журнал Caddy (`infra/Caddyfile`, `format filter`): в адресе, `Referer` и `Location` токены после `manage`, `confirm`, `waitlist`, `waitlist-offers` и query заменяются на `[REDACTED]`, `Cookie`, `Authorization`, `X-Csrf-Token`, `X-Mfa-Code`, `Idempotency-Key`, `Set-Cookie` удаляются. Централизованный сбор настраивается драйвером логов Docker (Loki/Promtail, ELK или Graylog).
- **Алерты (рекомендуется):** health ≠ 200; `notifications.dead > 0`; `pending` растёт дольше 5 минут; ошибки 5xx > 1%; свободное место на диске; отсутствие свежего файла в `backups/daily` больше 26 часов.
- **Админ-панель:** системная статистика, состояние интеграций, очереди сообщений и DLQ с ручным повтором, журнал аудита.

## Масштабирование

- API без состояния — достаточно увеличить `replicas`.
- Воркер можно запускать в нескольких экземплярах: outbox и резервы используют `SKIP LOCKED`, периодические задачи — advisory-блокировки.
- PostgreSQL: пул на экземпляр `DATABASE_POOL_SIZE=20`. При росте подключить pgbouncer (transaction mode) и реплику только для чтения под аналитику.
- Redis в MVP не используется (решение D-01). Rate limit и очереди скрыты за сервисами `RateLimitService` и `JobsService` и могут быть переведены на Redis без изменения бизнес-логики.
