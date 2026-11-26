# REST API

- Базовый путь: `/api/v1` (версионирование в URL, §21).
- Документация OpenAPI генерируется из кода: Swagger UI `/api/v1/docs`, JSON `/api/v1/docs-json` (кроме `APP_ENV=production`: там оба адреса отвечают 404, D-53). Снимок лежит в [openapi.json](openapi.json).
- Полный перечень из 170 операций с параметрами: [API-endpoints.md](API-endpoints.md), сгенерирован скриптом `scripts/gen-api-doc.py`.
- Схемы запросов — Zod-схемы в `packages/shared/src/schemas.ts`, общие для frontend и backend.

## Аутентификация

| Кто | Как | Сессия |
|---|---|---|
| Сотрудник (OWNER, BRANCH_ADMIN) | `POST /auth/staff/login` {email, password} | cookie `bk_sid` (HttpOnly, Secure в production, SameSite=Lax), 12 ч бездействия / 7 дней максимум |
| Суперадминистратор | то же + `totpCode` (TOTP) | сессия помечена `mfaVerified`; критические действия требуют заголовок `X-MFA-Code` с новым кодом (см. ниже) |
| Клиент | `POST /auth/client/otp/request` → `POST /auth/client/otp/verify` | 30 дней бездействия / 90 дней максимум |
| Гость | ссылка управления `/{locale}/manage/{token}` после подтверждения OTP | токен 256 бит, в БД хранится SHA-256 |

**CSRF.** Для изменяющих запросов с cookie-сессией нужен заголовок `X-CSRF-Token`, равный cookie `bk_csrf` (double submit). Токен выдаёт `GET /auth/csrf` или любой вход.

**Коды MFA.** Каждый временной шаг TOTP принимается один раз: код, которым выполнен вход, и код прошлого действия не подходят — `403 MFA_INVALID` «Код уже использован, дождитесь следующего кода в приложении» (при входе — `401 MFA_INVALID`). Неверный код — `403 MFA_INVALID` «Неверный код MFA». После 10 неверных или повторных кодов за 15 минут — `429 RATE_LIMITED` с `Retry-After` (общий счётчик для входа и `X-MFA-Code`).

**Вход и прежняя сессия.** Вход сотрудника или клиента по коду отзывает прежнюю сессию этого браузера (cookie `bk_sid`).

**Временный пароль.** Пока сотрудник не сменил временный пароль, доступны только `/auth/me`, `/auth/staff/change-password` и `/auth/logout`. Остальные маршруты отвечают `403 PASSWORD_CHANGE_REQUIRED`.

## Авторизация (RBAC + tenant + филиал)

Проверки выполняются глобальными guard'ами в таком порядке: аутентификация → CSRF → rate limit → tenant → права → подписка.

- Маршруты `/organizations/:orgId/...` проверяют членство пользователя в организации. Чужая организация или филиал → `404` (существование не раскрывается).
- `@RequirePermission(code)` проверяет право; права филиала проверяются для конкретного `branchId` из URL, query или тела. Если филиал определяется по сущности (запись, отзыв), право проверяет сервис через `assertBranchPermission`.
- Маршрут организации без явного права доступен только владельцу (secure by default).
- При подписке `expired` или `suspended` все изменяющие запросы сотрудников отвечают `403 SUBSCRIPTION_INACTIVE` (решение D-12). Суперадмина это не ограничивает.
- Переводы (`GET|PUT /organizations/:orgId/translations`, `POST …/translations/auto`): BRANCH_ADMIN видит и меняет переводы только страниц и специалистов своих филиалов с правом `pages.edit` (чужой филиал → 404); переводы уровня организации (услуги, категории, акции) — только владелец, для BRANCH_ADMIN → 403.
- Кабинет клиента (`/me/...`) показывает записи и заявки по номеру только при подтверждённом номере (вход по коду).

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
- 400 — `VALIDATION_ERROR` (битый JSON в теле — «Некорректный JSON в теле запроса»; `details` содержит массив `{path, message}`; в том числе несуществующие даты вроде `2026-02-31`, годы вне 1900–2999, конец периода не позже начала, не-UUID `userId` в `PUT /organizations/:orgId/users/:userId/access` и `DELETE /organizations/:orgId/users/:userId`), `OTP_INVALID`, `PROMO_INVALID`, `FILE_INVALID`, `BOOKING_TOO_FAR`;
- 401 — `UNAUTHENTICATED`, `INVALID_CREDENTIALS`;
- 403 — `FORBIDDEN`, `CSRF_INVALID`, `MFA_REQUIRED`, `MFA_INVALID`, `SUBSCRIPTION_INACTIVE`, `BOOKING_DISABLED`, `BRANCH_LIMIT_REACHED`;
- 404 — `NOT_FOUND`;
- 409 — `SLOT_UNAVAILABLE`, `CONFLICT`, `IDEMPOTENCY_IN_PROGRESS`;
- 413 — `FILE_TOO_LARGE` (файл), `PAYLOAD_TOO_LARGE` (тело JSON больше 1 МБ);
- 415 — `UNSUPPORTED_MEDIA_TYPE` (неподдерживаемые `Content-Encoding` или `charset` тела);
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

Повтор с тем же ключом и телом возвращает сохранённый ответ, с другим телом — `422 IDEMPOTENCY_KEY_REUSED`. Ответ с ошибкой не кэшируется. Ключи хранятся 48 часов. Для переноса, отмены и смены статуса область ключа включает действующее лицо (гость по ссылке, клиент, сотрудник): один ключ у разных людей не пересекается. Ключ «в работе» старше 10 минут с тем же телом считается брошенным, запрос выполняется заново (D-49).

## Ограничения частоты (rate limit)

Счётчики хранятся в PostgreSQL (решение D-01), по IP или по пользователю.

| Маршрут | Лимит |
|---|---|
| Любой публичный маршрут без своего правила | 300 запросов/мин на IP и маршрут |
| Любой маршрут вошедшего пользователя без своего правила | 1200/мин на пользователя |
| `POST /auth/staff/login` | 30 / 15 мин на IP; 15 / 15 мин на email; 10 неудачных подряд → блокировка на 15 мин |
| OTP (вход и бронирование) | повтор не чаще 60 с на номер; 5 в час на номер; 30 в час на IP; 5000 в час глобально; 5 попыток ввода на код |
| Коды MFA (вход суперадмина и `X-MFA-Code`) | 10 неверных или повторных за 15 мин на пользователя |
| `POST /public/branches/:slug/availability` | 120/мин на IP |
| `POST /public/branches/:slug/bookings` | 15 / 10 мин на IP (+ honeypot и проверка времени заполнения формы) |
| `POST /public/bookings/:id/confirm` | 30 / 10 мин на IP |
| `GET /public/pages/:slug` | 300/мин на IP |
| `POST /public/analytics/events` | 120/мин на IP |
| `POST /organizations/:orgId/files` | 60 / 10 мин на пользователя |

Значения OTP настраивает суперадмин (`PUT /admin/settings`). IP клиента берётся из `X-Forwarded-For` только от доверенного прокси (`TRUST_PROXY`, только внутренние адреса): подставленный клиентом заголовок ключ лимита не меняет (D-54).

## Ключевые сценарии

**Запись клиента.**
1. `POST /public/branches/{slug}/availability` {date, items:[{serviceId, specialistId|null}]} возвращает слоты.
2. `POST /public/branches/{slug}/bookings` {startAt, items, client, consents, promoCode?, utm?} создаёт резерв `pending_otp` и отправляет OTP; в ответе `holdToken` и `holdExpiresAt`.
3. `POST /public/bookings/{id}/confirm` {holdToken, code} переводит запись в `confirmed` и возвращает `manageToken`.
4. `GET|POST /public/manage/{token}[/availability|/reschedule|/cancel|/review]` — управление записью.

**Стоимость.** `POST /public/branches/{slug}/quote` возвращает `durationMinutes`, совпадающий с длиной слота: учитывается буфер «до» второй и следующих услуг.

**Состояние.** `GET /health` — публичный: доступность БД проверяется при каждом запросе, поле `notifications` (очередь и DLQ) обновляется не чаще раза в 30 с (D-51).

**Webhook WhatsApp.** `GET /integrations/whatsapp/webhook` подтверждает подписку по verify token. `POST` принимает статусы доставки и проверяет подпись `X-Hub-Signature-256`.
