# REST API

- Базовый путь: `/api/v1` (версионирование в URL, §21).
- Документация OpenAPI генерируется из кода: Swagger UI `/api/v1/docs`, JSON `/api/v1/docs-json`. Снимок лежит в [openapi.json](openapi.json).
- Полный перечень из 144 операций с параметрами: [API-endpoints.md](API-endpoints.md), сгенерирован скриптом `scripts/gen-api-doc.py`.
- Схемы запросов — Zod-схемы в `packages/shared/src/schemas.ts`, общие для frontend и backend.

## Аутентификация

| Кто | Как | Сессия |
|---|---|---|
| Сотрудник (OWNER, BRANCH_ADMIN) | `POST /auth/staff/login` {email, password} | cookie `bk_sid` (HttpOnly, Secure в production, SameSite=Lax), 12 ч бездействия / 7 дней максимум |
| Суперадминистратор | то же + `totpCode` (TOTP) | сессия помечена `mfaVerified`; критические действия требуют заголовок `X-MFA-Code` |
| Клиент | `POST /auth/client/otp/request` → `POST /auth/client/otp/verify` | 30 дней бездействия / 90 дней максимум |
| Гость | ссылка управления `/{locale}/manage/{token}` после подтверждения OTP | токен 256 бит, в БД хранится SHA-256 |

**CSRF.** Для изменяющих запросов с cookie-сессией нужен заголовок `X-CSRF-Token`, равный cookie `bk_csrf` (double submit). Токен выдаёт `GET /auth/csrf` или любой вход.

**Временный пароль.** Пока сотрудник не сменил временный пароль, доступны только `/auth/me`, `/auth/staff/change-password` и `/auth/logout`. Остальные маршруты отвечают `403 PASSWORD_CHANGE_REQUIRED`.

## Авторизация (RBAC + tenant + филиал)

Проверки выполняются глобальными guard'ами в таком порядке: аутентификация → CSRF → rate limit → tenant → права → подписка.

- Маршруты `/organizations/:orgId/...` проверяют членство пользователя в организации. Чужая организация или филиал → `404` (существование не раскрывается).
- `@RequirePermission(code)` проверяет право; права филиала проверяются для конкретного `branchId` из URL, query или тела. Если филиал определяется по сущности (запись, отзыв), право проверяет сервис через `assertBranchPermission`.
- Маршрут организации без явного права доступен только владельцу (secure by default).
- При подписке `expired` или `suspended` все изменяющие запросы сотрудников отвечают `403 SUBSCRIPTION_INACTIVE` (решение D-12). Суперадмина это не ограничивает.

| Право | Уровень | OWNER | BRANCH_ADMIN (по умолчанию) |
|---|---|---|---|
| appointments.view / appointments.manage | филиал | ✓ | ✓ / ✓ |
| clients.view | филиал | ✓ | ✓ |
| resources.manage | филиал | ✓ | ✓ |
| analytics.view | филиал | ✓ | ✓ |
| services.manage, specialists.manage, schedules.manage, reviews.manage, pages.edit, branch.settings.manage | филиал | ✓ | выдаёт владелец |
| org.manage, branches.manage, users.manage, promotions.manage, booking_settings.manage, notifications.manage, integrations.manage, audit.view, subscription.view | организация | ✓ | — |

## Формат ошибок

```json
{ "error": { "code": "SLOT_UNAVAILABLE", "message": "Выбранное время уже недоступно…", "details": {} } }
```

Коды перечислены в `packages/shared/src/errors.ts`. Основные HTTP-статусы:
- 400 — `VALIDATION_ERROR` (`details` содержит массив `{path, message}`), `OTP_INVALID`, `PROMO_INVALID`, `FILE_INVALID`;
- 401 — `UNAUTHENTICATED`, `INVALID_CREDENTIALS`;
- 403 — `FORBIDDEN`, `CSRF_INVALID`, `MFA_REQUIRED`, `SUBSCRIPTION_INACTIVE`, `BOOKING_DISABLED`, `BRANCH_LIMIT_REACHED`;
- 404 — `NOT_FOUND`;
- 409 — `SLOT_UNAVAILABLE`, `CONFLICT`, `IDEMPOTENCY_IN_PROGRESS`;
- 413 — `FILE_TOO_LARGE`;
- 422 — `CLIENT_ACTIVE_LIMIT`, `CLIENT_OVERLAP`, `CANCEL_DEADLINE_PASSED`, `RESCHEDULE_DEADLINE_PASSED`, `INVALID_STATUS_TRANSITION`, `IDEMPOTENCY_KEY_REUSED`;
- 429 — `RATE_LIMITED`, `OTP_RATE_LIMITED`, `OTP_ATTEMPTS_EXCEEDED` (с заголовком `Retry-After`).

## Идемпотентность

Заголовок `Idempotency-Key` (8–100 символов `[A-Za-z0-9_-]`) поддерживают:
- `POST /public/branches/:slug/bookings`
- `POST /public/bookings/:id/confirm`
- `POST /public/manage/:token/reschedule|cancel`
- `POST /me/appointments/:id/reschedule|cancel`
- `POST /organizations/:orgId/appointments`
- `POST /organizations/:orgId/appointments/:id/status|reschedule`

Повтор с тем же ключом и телом возвращает сохранённый ответ, с другим телом — `422 IDEMPOTENCY_KEY_REUSED`. Ответ с ошибкой не кэшируется. Ключи хранятся 48 часов.

## Ограничения частоты (rate limit)

Счётчики хранятся в PostgreSQL (решение D-01), по IP или по пользователю.

| Маршрут | Лимит |
|---|---|
| Любой публичный маршрут без своего правила | 300 запросов/мин на IP и маршрут |
| Любой маршрут вошедшего пользователя без своего правила | 1200/мин на пользователя |
| `POST /auth/staff/login` | 30 / 15 мин на IP; 15 / 15 мин на email; 10 неудачных подряд → блокировка на 15 мин |
| OTP (вход и бронирование) | повтор не чаще 60 с на номер; 5 в час на номер; 30 в час на IP; 5000 в час глобально; 5 попыток ввода на код |
| `POST /public/branches/:slug/availability` | 120/мин на IP |
| `POST /public/branches/:slug/bookings` | 15 / 10 мин на IP (+ honeypot и проверка времени заполнения формы) |
| `POST /public/bookings/:id/confirm` | 30 / 10 мин на IP |
| `GET /public/pages/:slug` | 300/мин на IP |
| `POST /public/analytics/events` | 120/мин на IP |
| `POST /organizations/:orgId/files` | 60 / 10 мин на пользователя |

Значения OTP настраивает суперадмин (`PUT /admin/settings`).

## Ключевые сценарии

**Запись клиента.**
1. `POST /public/branches/{slug}/availability` {date, items:[{serviceId, specialistId|null}]} возвращает слоты.
2. `POST /public/branches/{slug}/bookings` {startAt, items, client, consents, promoCode?, utm?} создаёт резерв `pending_otp` и отправляет OTP; в ответе `holdToken` и `holdExpiresAt`.
3. `POST /public/bookings/{id}/confirm` {holdToken, code} переводит запись в `confirmed` и возвращает `manageToken`.
4. `GET|POST /public/manage/{token}[/availability|/reschedule|/cancel|/review]` — управление записью.

**Webhook WhatsApp.** `GET /integrations/whatsapp/webhook` подтверждает подписку по verify token. `POST` принимает статусы доставки и проверяет подпись `X-Hub-Signature-256`.
