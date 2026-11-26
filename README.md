# Платформа онлайн-записи для сервисного бизнеса (SaaS, Казахстан)

Multi-tenant платформа для салонов красоты, барбершопов, массажа, бань, автомоек, детейлинга, автосервисов и других сервисных организаций. В ней есть:
- организации, филиалы, услуги, специалисты и ресурсы, расписания;
- онлайн-запись на одной странице с подтверждением по ссылке и защитой от двойного бронирования, групповая бронь мест;
- лист ожидания: освободившееся время автоматически предлагается клиентам из очереди;
- публичные страницы филиалов на ru/kk/en с шаблонами;
- кабинеты клиента, администратора, владельца и суперадминистратора;
- подписки;
- уведомления через официальный WhatsApp Business Platform, автоответ на входящие сообщения о записях, автоматическая реактивация клиентов (с согласием на рекламу и отпиской «СТОП»);
- аналитика с UTM.

Основание: [ТЗ.txt](ТЗ.txt) (версия 4.0). Задачи: [docs/TASKS.md](docs/TASKS.md). Ход работ: [docs/PROGRESS.md](docs/PROGRESS.md).

## Стек (утверждён, [DECISIONS.md](docs/DECISIONS.md))

Next.js 16 + React 19 + Tailwind 4 · NestJS 11 · PostgreSQL 17 · Prisma 7 · Zod (общие схемы) · очереди, outbox и rate limit на PostgreSQL (без Redis) · REST `/api/v1` + OpenAPI · Jest, Playwright · Docker.

```
apps/api        NestJS: HTTP API (dist/main.js) и фоновый воркер (dist/worker.js)
apps/web        Next.js: публичные страницы, запись, кабинеты, суперадмин
packages/shared Zod-схемы, перечисления, права, расчёт цены, статусы — общие для API и web
infra           Dockerfile'ы, docker-compose.prod.yml, Caddy, резервное копирование
docs            архитектура, решения, ERD, API, безопасность, аналитика, эксплуатация, тесты
```

## Онлайн-проверка без хостинга (GitHub Codespaces)

**Code → Codespaces → Create codespace on main**: весь стенд (PostgreSQL, API, воркер, сайт) с демо-данными поднимается
автоматически, ссылка на сайт — во вкладке PORTS (порт 3000). Подробно: [docs/CODESPACES.md](docs/CODESPACES.md).
Проверки GitHub Actions: CI при каждом push, E2E — вручную (Actions → E2E).

## Быстрый старт (локально)

Требуются Node.js ≥ 22 и PostgreSQL 15+ (нужны расширения btree_gist, citext, pgcrypto — входят в стандартную поставку).

```bash
npm install
# 1. Базы: booking_dev и booking_test (+ booking_shadow для prisma migrate dev), пользователь с правом CREATEDB
cp .env.example apps/api/.env            # заполнить DATABASE_URL / TEST_DATABASE_URL и три секрета (32 байта base64)
echo NEXT_PUBLIC_DEV_INBOX_ENABLED=true > apps/web/.env.local   # «Тестовый телефон» на сайте (только для разработки)
npm run build:shared
npm run db:migrate                       # prisma migrate deploy
npm run db:seed -w @booking/api -- --demo   # справочники + демо-организация
SUPERADMIN_PASSWORD='длинный-пароль' npm run superadmin:create -w @booking/api -- --email admin@local.kz
#    (выведет otpauth:// — добавьте в Google Authenticator / Aegis)

npm run dev:api      # http://localhost:4000/api/v1/docs — Swagger
npm run dev:worker   # отправка уведомлений, освобождение резервов и т.д.
npm run dev:web      # http://localhost:3000
```

Демо-данные:
- публичная страница: http://localhost:3000/ru/b/demo-salon;
- владелец: `owner@demo.kz` / `DemoOwner12345`;
- администратор филиала: `admin@demo.kz` / `DemoAdmin12345`;
- компьютерный клуб «Пиксель» (ПК, VIP-ПК, залы PlayStation 5): http://localhost:3000/ru/b/demo-club, владелец `club@demo.kz` / `DemoOwner12345`;
- банный комплекс «Тёплый берег» (финская сауна, русская баня, хаммам, пармейстер): http://localhost:3000/ru/b/demo-sauna, владелец `sauna@demo.kz` / `DemoOwner12345`;
- **«Тестовый телефон»** — http://localhost:3000/dev/phone: пока WhatsApp не подключён, все сообщения клиентам (ссылки подтверждения записи, коды входа в кабинет, напоминания) показываются здесь, ссылки кликабельны. API: `GET /api/v1/dev/inbox[?phone=+7701…]`. Включается только явно: `DEV_INBOX_ENABLED=true` в `apps/api/.env` и `NEXT_PUBLIC_DEV_INBOX_ENABLED=true` в `apps/web/.env.local` (при сборке сайта); без флагов — 404. В production запрещено: API не запустится;
- карта 2ГИС: с ключом `NEXT_PUBLIC_2GIS_KEY` — официальная MapGL; без ключа локально показывается временная карта на тайлах 2ГИС, в production — только кнопки «Открыть в 2GIS» и «Маршрут»;
- вернуть dev-базу к чистым демо-данным: `npm run db:reset:dev -w @booking/api -- --yes`. Команда удаляет все данные, кроме учётных записей суперадминистраторов (пароль и MFA сохраняются). В production запрещена.

## Проверки

```bash
npm test              # 213 unit + integration тестов (нужна БД booking_test)
npm run db:reset:test -w @booking/api   # пересоздать тестовую БД (только TEST_DATABASE_URL с «test» в имени)
npm run test:e2e      # 68 E2E (Playwright: ноутбук, монитор, планшет, телефон), при запущенных api/worker/web
npm run lint
npm run typecheck
node apps/api/scripts/load-test.mjs http://localhost:4000 --concurrency 8
```

## Production

[docs/OPERATIONS.md](docs/OPERATIONS.md): Docker Compose (PostgreSQL, миграции, 2×API, воркер, web, Caddy с HTTPS, ежедневный бэкап + WAL), миграции, резервное копирование и восстановление, мониторинг, RPO/RTO. Переменные: [`.env.example`](.env.example), [`infra/.env.prod.example`](infra/.env.prod.example).

## Документация

| Документ | Содержание |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | архитектура, изоляция, ядро бронирования, outbox |
| [DECISIONS.md](docs/DECISIONS.md) | утверждённые и предложенные решения, что нужно от заказчика |
| [ERD.md](docs/ERD.md) | модель данных, ограничения, индексы, правила удаления |
| [API.md](docs/API.md), [API-endpoints.md](docs/API-endpoints.md), [openapi.json](docs/openapi.json) | соглашения, права, лимиты, ошибки, 170 операций |
| [SECURITY.md](docs/SECURITY.md) | меры безопасности и что проверить до запуска |
| [ANALYTICS.md](docs/ANALYTICS.md) | правила подсчёта, атрибуция, боты, внутренние просмотры |
| [TESTING.md](docs/TESTING.md) | тесты, конкурентные и нагрузочные результаты |
| [CODESPACES.md](docs/CODESPACES.md) | онлайн-стенд в GitHub Codespaces без хостинга |
| [OPERATIONS.md](docs/OPERATIONS.md) | развёртывание и обслуживание |
| `apps/web/content/legal/` | черновики политики, соглашения, правил обработки ПД (нужна проверка юриста) |
