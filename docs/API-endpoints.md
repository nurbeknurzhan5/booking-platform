# Справочник endpoint'ов (сгенерирован из OpenAPI)

Файл создаётся скриптом `scripts/gen-api-doc.py` из `docs/openapi.json`. Схемы тел запросов и ответов — в Swagger UI (`/api/v1/docs`).
Права доступа по ролям и лимиты частоты описаны в [API.md](API.md).

## admin

| Метод | URL | Назначение | Параметры | Тело | Доступ |
|---|---|---|---|---|---|
| `GET` | `/api/v1/admin/audit-logs` |  | organizationId, action |  | суперадмин + MFA |
| `GET` | `/api/v1/admin/business-categories` |  |  |  | суперадмин + MFA |
| `GET` | `/api/v1/admin/integrations` | Состояние интеграций (без секретов) |  |  | суперадмин + MFA |
| `GET` | `/api/v1/admin/notifications` | Очередь сообщений (фильтр по статусу: dead — DLQ) | status |  | суперадмин + MFA |
| `GET` | `/api/v1/admin/notifications/stats` |  |  |  | суперадмин + MFA |
| `POST` | `/api/v1/admin/notifications/{id}/retry` | Повторить сообщение из DLQ | id |  | суперадмин + MFA |
| `GET` | `/api/v1/admin/organizations` | Список организаций | search |  | суперадмин + MFA |
| `POST` | `/api/v1/admin/organizations` | Создать организацию (+ владелец + подписка) |  | да | суперадмин + MFA |
| `GET` | `/api/v1/admin/organizations/{id}` |  | id |  | суперадмин + MFA |
| `PATCH` | `/api/v1/admin/organizations/{id}` |  | id | да | суперадмин + MFA |
| `POST` | `/api/v1/admin/organizations/{id}/branches` | Создать филиал организации | id | да | суперадмин + MFA |
| `POST` | `/api/v1/admin/organizations/{id}/owners` | Назначить владельца | id | да | суперадмин + MFA |
| `POST` | `/api/v1/admin/organizations/{id}/restore` | Восстановить доступ организации (требует X-MFA-Code) | id | да | суперадмин + MFA |
| `PUT` | `/api/v1/admin/organizations/{id}/subscription` | Установить/изменить подписку (требует X-MFA-Code) | id | да | суперадмин + MFA |
| `GET` | `/api/v1/admin/organizations/{id}/subscription/history` |  | id |  | суперадмин + MFA |
| `POST` | `/api/v1/admin/organizations/{id}/subscription/payments` | Зафиксировать оплату и (опционально) продлить подписку | id | да | суперадмин + MFA |
| `POST` | `/api/v1/admin/organizations/{id}/suspend` | Временно заблокировать организацию (требует X-MFA-Code) | id | да | суперадмин + MFA |
| `GET` | `/api/v1/admin/payments` | Все оплаты |  |  | суперадмин + MFA |
| `GET` | `/api/v1/admin/plans` |  |  |  | суперадмин + MFA |
| `POST` | `/api/v1/admin/plans` |  |  | да | суперадмин + MFA |
| `PATCH` | `/api/v1/admin/plans/{id}` |  | id | да | суперадмин + MFA |
| `GET` | `/api/v1/admin/settings` |  |  |  | суперадмин + MFA |
| `PUT` | `/api/v1/admin/settings` |  |  | да | суперадмин + MFA |
| `GET` | `/api/v1/admin/stats` | Системная статистика платформы |  |  | суперадмин + MFA |
| `GET` | `/api/v1/admin/users` |  | search |  | суперадмин + MFA |
| `POST` | `/api/v1/admin/users/{id}/block` |  | id | да | суперадмин + MFA |
| `POST` | `/api/v1/admin/users/{id}/reset-password` | Восстановить доступ сотруднику: временный пароль и смена при входе | id | да | суперадмин + MFA |
| `POST` | `/api/v1/admin/users/{id}/unblock` |  | id | да | суперадмин + MFA |

## analytics

| Метод | URL | Назначение | Параметры | Тело | Доступ |
|---|---|---|---|---|---|
| `GET` | `/api/v1/organizations/{orgId}/analytics` | Аналитика: просмотры, уникальные, клики, конверсия, UTM-источники, популярные услуги и специалисты | branchId, from, to, granularity |  | сотрудник организации (RBAC) |
| `POST` | `/api/v1/public/analytics/events` | Событие аналитики публичной страницы (просмотр, клик, начало записи) |  | да | публичный |

## appointments

| Метод | URL | Назначение | Параметры | Тело | Доступ |
|---|---|---|---|---|---|
| `GET` | `/api/v1/organizations/{orgId}/appointments` | Записи (календарь/список) с фильтрами | page, pageSize, branchId, from, to, status, specialistId, clientId |  | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/appointments` | Создать запись вручную (сразу confirmed) |  | да | сотрудник организации (RBAC) |
| `GET` | `/api/v1/organizations/{orgId}/appointments/{id}` | Запись с историей статусов и переносов | id |  | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/appointments/{id}/reschedule` | Перенести запись | id | да | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/appointments/{id}/status` | Выполнено / неявка / отмена администратором (с причиной) | id | да | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/availability` | Свободные слоты (для ручной записи и переноса администратором) |  | да | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/quote` | Расчёт стоимости |  | да | сотрудник организации (RBAC) |

## auth

| Метод | URL | Назначение | Параметры | Тело | Доступ |
|---|---|---|---|---|---|
| `POST` | `/api/v1/auth/client/otp/request` | Запросить OTP для входа клиента по телефону |  | да | по маршруту |
| `POST` | `/api/v1/auth/client/otp/verify` | Подтвердить OTP: вход/регистрация клиента, привязка гостевых записей |  | да | по маршруту |
| `GET` | `/api/v1/auth/csrf` | Выдать CSRF-токен (cookie bk_csrf + тело) |  |  | по маршруту |
| `POST` | `/api/v1/auth/logout` | Выход (отзыв текущей сессии) |  |  | по маршруту |
| `GET` | `/api/v1/auth/me` | Текущий пользователь и членство в организациях |  |  | по маршруту |
| `GET` | `/api/v1/auth/session` | Текущая сессия: { authenticated: false } для гостя, иначе профиль |  |  | по маршруту |
| `POST` | `/api/v1/auth/staff/change-password` | Сменить пароль (обязательно после выдачи временного) |  | да | по маршруту |
| `POST` | `/api/v1/auth/staff/login` | Вход сотрудника (email + пароль; суперадмин — + TOTP) |  | да | по маршруту |

## availability

| Метод | URL | Назначение | Параметры | Тело | Доступ |
|---|---|---|---|---|---|
| `POST` | `/api/v1/public/bookings/{id}/abandon` | Отказаться от резерва (слот освобождается сразу) | id | да | публичный |
| `POST` | `/api/v1/public/bookings/{id}/confirm` | Подтвердить запись кодом OTP | id | да | публичный |
| `POST` | `/api/v1/public/bookings/{id}/extend` | Продлить резерв (если разрешено владельцем) | id | да | публичный |
| `POST` | `/api/v1/public/bookings/{id}/resend-otp` | Повторно отправить OTP (с ограничением частоты) | id | да | публичный |
| `POST` | `/api/v1/public/branches/{slug}/availability` | Свободные слоты на дату для набора услуг (специалист или автоподбор) | slug | да | публичный |
| `POST` | `/api/v1/public/branches/{slug}/availability/overview` | Запись на одной странице: слоты на дату, число окон по 14 дням и по каждому специалисту | slug | да | публичный |
| `POST` | `/api/v1/public/branches/{slug}/bookings` | Создать временный резерв и отправить OTP (атомарно, без двойного бронирования) | slug | да | публичный |
| `POST` | `/api/v1/public/branches/{slug}/quote` | Предварительный расчёт стоимости и длительности (промокод проверяется на сервере) | slug | да | публичный |
| `GET` | `/api/v1/public/manage/{token}` | Запись по ссылке управления | token |  | публичный |
| `POST` | `/api/v1/public/manage/{token}/availability` | Свободные слоты для переноса (с учётом освобождения текущего времени) | token | да | публичный |
| `POST` | `/api/v1/public/manage/{token}/cancel` | Отменить запись (до дедлайна, установленного владельцем) | token | да | публичный |
| `POST` | `/api/v1/public/manage/{token}/reschedule` | Перенести запись (без повторного OTP; атомарно) | token | да | публичный |

## clients

| Метод | URL | Назначение | Параметры | Тело | Доступ |
|---|---|---|---|---|---|
| `GET` | `/api/v1/me/appointments` | Мои записи: upcoming / history / cancelled |  |  | клиент (сессия) |
| `POST` | `/api/v1/me/appointments/{id}/availability` |  | id | да | клиент (сессия) |
| `POST` | `/api/v1/me/appointments/{id}/cancel` |  | id | да | клиент (сессия) |
| `POST` | `/api/v1/me/appointments/{id}/reschedule` |  | id | да | клиент (сессия) |
| `POST` | `/api/v1/me/appointments/{id}/review` | Оставить отзыв о завершённом визите | id | да | клиент (сессия) |
| `GET` | `/api/v1/me/profile` |  |  |  | клиент (сессия) |
| `PATCH` | `/api/v1/me/profile` | Изменить имя, язык и согласия на уведомления |  | да | клиент (сессия) |
| `GET` | `/api/v1/organizations/{orgId}/clients` | Клиенты (поиск по имени/телефону) со статистикой посещений | page, pageSize, search |  | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/clients/merge` | Объединить дубли (история записей сохраняется, действие в аудите) |  | да | сотрудник организации (RBAC) |
| `GET` | `/api/v1/organizations/{orgId}/clients/{clientId}` | Карточка клиента: история записей, посещения, отмены, неявки, отзывы, согласия | clientId |  | сотрудник организации (RBAC) |
| `PATCH` | `/api/v1/organizations/{orgId}/clients/{clientId}` |  | clientId | да | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/clients/{clientId}/anonymize` | Обезличить персональные данные клиента по его запросу | clientId |  | сотрудник организации (RBAC) |

## dev

| Метод | URL | Назначение | Параметры | Тело | Доступ |
|---|---|---|---|---|---|
| `GET` | `/api/v1/dev/inbox` |  | phone |  | публичный |

## health

| Метод | URL | Назначение | Параметры | Тело | Доступ |
|---|---|---|---|---|---|
| `GET` | `/api/v1/health` | Проверка работоспособности (API + БД + очередь) |  |  | публичный |

## notifications

| Метод | URL | Назначение | Параметры | Тело | Доступ |
|---|---|---|---|---|---|
| `GET` | `/api/v1/organizations/{orgId}/notifications` | Журнал уведомлений организации | appointmentId |  | сотрудник организации (RBAC) |

## organizations

| Метод | URL | Назначение | Параметры | Тело | Доступ |
|---|---|---|---|---|---|
| `GET` | `/api/v1/organizations/{orgId}` | Профиль организации, статус подписки и права текущего пользователя |  |  | сотрудник организации (RBAC) |
| `PATCH` | `/api/v1/organizations/{orgId}` | Изменить профиль организации |  | да | сотрудник организации (RBAC) |
| `GET` | `/api/v1/organizations/{orgId}/audit-logs` | Журнал действий организации |  |  | сотрудник организации (RBAC) |
| `GET` | `/api/v1/organizations/{orgId}/branches` | Филиалы (для администратора — только назначенные) |  |  | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/branches` | Создать филиал (в пределах лимита тарифа) |  | да | сотрудник организации (RBAC) |
| `GET` | `/api/v1/organizations/{orgId}/branches/{branchId}` | Филиал | branchId |  | сотрудник организации (RBAC) |
| `PATCH` | `/api/v1/organizations/{orgId}/branches/{branchId}` | Изменить филиал | branchId | да | сотрудник организации (RBAC) |
| `DELETE` | `/api/v1/organizations/{orgId}/branches/{branchId}` | Архивировать филиал | branchId |  | сотрудник организации (RBAC) |
| `GET` | `/api/v1/organizations/{orgId}/branches/{branchId}/booking-settings` | Правила бронирования филиала | branchId |  | сотрудник организации (RBAC) |
| `PUT` | `/api/v1/organizations/{orgId}/branches/{branchId}/booking-settings` | Изменить правила бронирования (только владелец) | branchId | да | сотрудник организации (RBAC) |
| `GET` | `/api/v1/organizations/{orgId}/integrations` | Состояние интеграций организации (без секретов) |  |  | сотрудник организации (RBAC) |
| `GET` | `/api/v1/organizations/{orgId}/notification-settings` | Настройки уведомлений организации |  |  | сотрудник организации (RBAC) |
| `PUT` | `/api/v1/organizations/{orgId}/notification-settings` | Изменить настройки уведомлений |  | да | сотрудник организации (RBAC) |
| `GET` | `/api/v1/organizations/{orgId}/subscription` | Подписка организации (только чтение для владельца) |  |  | сотрудник организации (RBAC) |
| `GET` | `/api/v1/organizations/{orgId}/users` | Сотрудники организации |  |  | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/users` | Создать администратора филиала с временным паролем |  | да | сотрудник организации (RBAC) |
| `DELETE` | `/api/v1/organizations/{orgId}/users/{userId}` | Отозвать доступ сотрудника | userId |  | сотрудник организации (RBAC) |
| `PUT` | `/api/v1/organizations/{orgId}/users/{userId}/access` | Выдать/отозвать права администратора по филиалам | userId | да | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/users/{userId}/reset-password` | Восстановить доступ администратору филиала: временный пароль и смена при входе | userId | да | сотрудник организации (RBAC) |

## promotions

| Метод | URL | Назначение | Параметры | Тело | Доступ |
|---|---|---|---|---|---|
| `GET` | `/api/v1/organizations/{orgId}/promotions` | Промокоды и акции с количеством использований |  |  | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/promotions` |  |  | да | сотрудник организации (RBAC) |
| `PUT` | `/api/v1/organizations/{orgId}/promotions/{id}` |  | id | да | сотрудник организации (RBAC) |
| `DELETE` | `/api/v1/organizations/{orgId}/promotions/{id}` |  | id |  | сотрудник организации (RBAC) |

## public-pages

| Метод | URL | Назначение | Параметры | Тело | Доступ |
|---|---|---|---|---|---|
| `POST` | `/api/v1/admin/files` | Загрузка изображения платформы (превью шаблона) |  | да | суперадмин + MFA |
| `GET` | `/api/v1/admin/pages` | Публичные страницы для модерации | blocked |  | суперадмин + MFA |
| `POST` | `/api/v1/admin/pages/{pageId}/moderation` | Заблокировать/разблокировать страницу с причиной | pageId | да | суперадмин + MFA |
| `GET` | `/api/v1/admin/templates` |  |  |  | суперадмин + MFA |
| `POST` | `/api/v1/admin/templates` |  |  | да | суперадмин + MFA |
| `PATCH` | `/api/v1/admin/templates/{id}` |  | id | да | суперадмин + MFA |
| `POST` | `/api/v1/admin/templates/{id}/status` | Опубликовать / отключить шаблон | id | да | суперадмин + MFA |
| `GET` | `/api/v1/media/platform/{asset}/{file}` |  | asset, file |  | публичный |
| `GET` | `/api/v1/media/{scope}/{owner}/{asset}/{file}` |  | scope, owner, asset, file |  | публичный |
| `GET` | `/api/v1/organizations/{orgId}/branches/{branchId}/page` | Редактор: черновик, версии, переводы | branchId |  | сотрудник организации (RBAC) |
| `PUT` | `/api/v1/organizations/{orgId}/branches/{branchId}/page/draft` | Сохранить черновик (посетители видят прежнюю опубликованную версию) | branchId | да | сотрудник организации (RBAC) |
| `GET` | `/api/v1/organizations/{orgId}/branches/{branchId}/page/history` |  | branchId |  | сотрудник организации (RBAC) |
| `GET` | `/api/v1/organizations/{orgId}/branches/{branchId}/page/preview` | Предпросмотр черновика (опционально — с другим шаблоном) | branchId, locale, templateId, colorScheme |  | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/branches/{branchId}/page/publish` | Опубликовать черновик | branchId |  | сотрудник организации (RBAC) |
| `PUT` | `/api/v1/organizations/{orgId}/branches/{branchId}/page/status` | Статус страницы: active / temporarily_closed / disabled | branchId | да | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/branches/{branchId}/page/versions/{publicationId}/restore` | Восстановить версию в черновик | branchId, publicationId |  | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/files` | Загрузить изображение (JPEG/PNG/WebP, до 5 МБ) — логотип, фото, услуги, специалисты |  | да | сотрудник организации (RBAC) |
| `GET` | `/api/v1/organizations/{orgId}/files` |  | kind |  | сотрудник организации (RBAC) |
| `DELETE` | `/api/v1/organizations/{orgId}/files/{id}` |  | id |  | сотрудник организации (RBAC) |
| `GET` | `/api/v1/organizations/{orgId}/translations` | Переводы контента со статусами (missing / auto_translated / verified / manually_edited) | entityType, locale |  | сотрудник организации (RBAC) |
| `PUT` | `/api/v1/organizations/{orgId}/translations` | Ручное редактирование переводов (не перезаписывается автопереводом) |  | да | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/translations/auto` | Поставить автоперевод в очередь (ручные переводы — только с overwriteManual) |  | да | сотрудник организации (RBAC) |
| `GET` | `/api/v1/public/pages/{slug}` | Опубликованная страница филиала по постоянной ссылке (ru/kk/en) | slug, locale |  | публичный |
| `GET` | `/api/v1/public/pages/{slug}/can-edit` | Может ли текущий пользователь редактировать страницу (кнопка «Редактировать») | slug |  | публичный |
| `GET` | `/api/v1/templates` | Каталог опубликованных шаблонов |  |  | сотрудник |

## resources

| Метод | URL | Назначение | Параметры | Тело | Доступ |
|---|---|---|---|---|---|
| `GET` | `/api/v1/organizations/{orgId}/branches/{branchId}/resources` |  | branchId |  | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/branches/{branchId}/resources` | Создать ресурс (кабинет, зал, оборудование, автомобиль, пост) | branchId | да | сотрудник организации (RBAC) |
| `GET` | `/api/v1/organizations/{orgId}/branches/{branchId}/resources/{resourceId}` |  | branchId, resourceId |  | сотрудник организации (RBAC) |
| `PATCH` | `/api/v1/organizations/{orgId}/branches/{branchId}/resources/{resourceId}` |  | branchId, resourceId | да | сотрудник организации (RBAC) |
| `DELETE` | `/api/v1/organizations/{orgId}/branches/{branchId}/resources/{resourceId}` |  | branchId, resourceId |  | сотрудник организации (RBAC) |

## reviews

| Метод | URL | Назначение | Параметры | Тело | Доступ |
|---|---|---|---|---|---|
| `GET` | `/api/v1/admin/reviews` | Отзывы на модерацию (жалобы) | reported |  | суперадмин + MFA |
| `POST` | `/api/v1/admin/reviews/{id}/moderate` | Модерация отзыва с указанием причины | id | да | суперадмин + MFA |
| `GET` | `/api/v1/organizations/{orgId}/reviews` |  | branchId |  | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/reviews/{id}/reply` | Ответ организации на отзыв (текст отзыва изменить нельзя) | id | да | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/reviews/{id}/report` | Пожаловаться на отзыв (рассматривает суперадминистратор) | id | да | сотрудник организации (RBAC) |
| `POST` | `/api/v1/public/manage/{token}/review` | Отзыв по ссылке управления записью (гостевой клиент) | token | да | публичный |

## schedules

| Метод | URL | Назначение | Параметры | Тело | Доступ |
|---|---|---|---|---|---|
| `GET` | `/api/v1/organizations/{orgId}/branches/{branchId}/schedule` | Недельное расписание и исключения (resourceId не указан — расписание филиала) | branchId, resourceId |  | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/branches/{branchId}/schedule/exceptions` | Добавить исключение: праздник, выходной, временное закрытие, особые часы | branchId | да | сотрудник организации (RBAC) |
| `DELETE` | `/api/v1/organizations/{orgId}/branches/{branchId}/schedule/exceptions/{exceptionId}` |  | branchId, exceptionId |  | сотрудник организации (RBAC) |
| `PUT` | `/api/v1/organizations/{orgId}/branches/{branchId}/schedule/weekly` | Заменить недельное расписание (рабочее время и перерывы) | branchId | да | сотрудник организации (RBAC) |
| `GET` | `/api/v1/organizations/{orgId}/branches/{branchId}/shifts` | Смены специалистов за период (до 62 дней) и режим графика | branchId, from, to |  | сотрудник организации (RBAC) |
| `PUT` | `/api/v1/organizations/{orgId}/branches/{branchId}/shifts` | Назначить или изменить смену; при записях вне новой смены — 409 SHIFT_CONFLICT со списком, если не force | branchId | да | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/branches/{branchId}/shifts/copy` | Скопировать смены дня на другие даты | branchId | да | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/branches/{branchId}/shifts/fill` | Заполнить смены по недельному графику на период | branchId | да | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/branches/{branchId}/shifts/remove` | Снять специалиста со смены; при записях — 409 SHIFT_CONFLICT со списком, если не force | branchId | да | сотрудник организации (RBAC) |
| `GET` | `/api/v1/organizations/{orgId}/branches/{branchId}/shifts/status` | Заполнен ли график на завтра и записи вне смен | branchId |  | сотрудник организации (RBAC) |

## services

| Метод | URL | Назначение | Параметры | Тело | Доступ |
|---|---|---|---|---|---|
| `GET` | `/api/v1/organizations/{orgId}/service-categories` |  |  |  | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/service-categories` |  |  | да | сотрудник организации (RBAC) |
| `PATCH` | `/api/v1/organizations/{orgId}/service-categories/{categoryId}` |  | categoryId | да | сотрудник организации (RBAC) |
| `DELETE` | `/api/v1/organizations/{orgId}/service-categories/{categoryId}` |  | categoryId |  | сотрудник организации (RBAC) |
| `GET` | `/api/v1/organizations/{orgId}/services` | Каталог услуг (администратор видит услуги своих филиалов) | branchId |  | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/services` | Создать услугу |  | да | сотрудник организации (RBAC) |
| `GET` | `/api/v1/organizations/{orgId}/services/{serviceId}` |  | serviceId |  | сотрудник организации (RBAC) |
| `PATCH` | `/api/v1/organizations/{orgId}/services/{serviceId}` | Изменить услугу (цены в существующих записях не меняются — snapshot) | serviceId | да | сотрудник организации (RBAC) |
| `DELETE` | `/api/v1/organizations/{orgId}/services/{serviceId}` |  | serviceId |  | сотрудник организации (RBAC) |

## specialists

| Метод | URL | Назначение | Параметры | Тело | Доступ |
|---|---|---|---|---|---|
| `GET` | `/api/v1/organizations/{orgId}/branches/{branchId}/specialists` |  | branchId |  | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/branches/{branchId}/specialists` | Создать специалиста в филиале | branchId | да | сотрудник организации (RBAC) |
| `PUT` | `/api/v1/organizations/{orgId}/branches/{branchId}/specialists/by-service/{serviceId}` | Назначить специалистов филиала на услугу (остальные снимаются) | branchId, serviceId | да | сотрудник организации (RBAC) |
| `GET` | `/api/v1/organizations/{orgId}/branches/{branchId}/specialists/{specialistId}` |  | branchId, specialistId |  | сотрудник организации (RBAC) |
| `PATCH` | `/api/v1/organizations/{orgId}/branches/{branchId}/specialists/{specialistId}` |  | branchId, specialistId | да | сотрудник организации (RBAC) |
| `DELETE` | `/api/v1/organizations/{orgId}/branches/{branchId}/specialists/{specialistId}` |  | branchId, specialistId |  | сотрудник организации (RBAC) |

## waitlist

| Метод | URL | Назначение | Параметры | Тело | Доступ |
|---|---|---|---|---|---|
| `GET` | `/api/v1/me/waitlist` | Мои заявки в листах ожидания |  |  | клиент (сессия) |
| `POST` | `/api/v1/me/waitlist/{id}/cancel` | Выйти из листа ожидания | id |  | клиент (сессия) |
| `GET` | `/api/v1/organizations/{orgId}/waitlist` | Заявки листа ожидания (по филиалам, доступным пользователю) | page, pageSize, branchId, status |  | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/waitlist` | Добавить клиента в лист ожидания |  | да | сотрудник организации (RBAC) |
| `PATCH` | `/api/v1/organizations/{orgId}/waitlist/{id}` | Изменить приоритет заявки | id | да | сотрудник организации (RBAC) |
| `POST` | `/api/v1/organizations/{orgId}/waitlist/{id}/cancel` | Удалить заявку из листа ожидания | id |  | сотрудник организации (RBAC) |
| `POST` | `/api/v1/public/branches/{slug}/waitlist` | Встать в лист ожидания (отправляет OTP для подтверждения номера) | slug | да | публичный |
| `GET` | `/api/v1/public/waitlist-offers/{token}` | Предложение освободившегося времени по ссылке из уведомления | token |  | публичный |
| `POST` | `/api/v1/public/waitlist-offers/{token}/accept` | Записаться на предложенное время (первый подтвердивший получает слот) | token |  | публичный |
| `POST` | `/api/v1/public/waitlist-offers/{token}/decline` | Отказаться от предложения (и при желании выйти из листа ожидания) | token | да | публичный |
| `POST` | `/api/v1/public/waitlist/{id}/cancel` | Выйти из листа ожидания по токену заявки | id | да | публичный |
| `POST` | `/api/v1/public/waitlist/{id}/confirm` | Подтвердить заявку кодом OTP | id | да | публичный |
| `POST` | `/api/v1/public/waitlist/{id}/resend-otp` | Повторно отправить OTP для заявки | id | да | публичный |
