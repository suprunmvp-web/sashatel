# Внутренний доступ и отображаемое имя

Маршруты используют действующую Web-сессию. Для POST и PATCH обязательны точный Origin, CSRF и JSON. Существующий пользовательский контекст организации и служебный контекст имеют независимые идентификаторы и права.

## Роли

| Роль | Организации | Первичная проверка | Повторное рассмотрение отклонённой заявки | Служебное чтение | Сотрудники |
|---|---|---|---|---|---|
| owner | Список | Да | Да | Да | Список, назначение, отзыв |
| admin | Список | Да | Да | Да | — |
| manager | Список без адреса и почты владельца | — | — | Да | — |
| reviewer, переходная | Прежний список | Да | — | — | — |

- `GET /v1/internal/session` возвращает `role` и `capabilities`. Клиент может использовать их для показа действий. Сервер проверяет полномочия при каждом обращении.
- `GET /v1/internal/staff` доступен Owner и возвращает `items` с `user_id`, `email`, `role`, `active`.
- `POST /v1/internal/staff/access` принимает `{user_id, role}` и возвращает 204. `role` принимает `admin`, `manager` или `null` для отзыва. Повтор назначения не создаёт запись аудита. Изменение доступа закрывает открытые служебные контексты сотрудника.
- Назначение, блокировка и понижение Owner через этот интерфейс запрещены. PostgreSQL дополнительно защищает запись системного Owner и его привязку к проверенному аккаунту.

Миграция 012 сохраняет существующие роли. После сверки списка сотрудников оператор отдельно запускает `ops/bootstrap-system-owner.sql` с полномочиями мигратора. Скрипт требует ровно один действующий аккаунт с проверенной почтой `suprunmvp@gmail.com`, записывает назначение в аудит и безопасно переносит повторный запуск. Если предварительная проверка не проходит, назначения сохраняются в прежнем состоянии. Повышение любого `reviewer` возможно только после отдельного согласования и явного назначения.

## Создание клиента

`POST /v1/internal/organizations` принимает `{lookup_id, inn, display_name}` и UUID в заголовке `Idempotency-Key`. Owner и Admin получают возможность `organizations:create` в ответе внутренней сессии. Сначала сотрудник выполняет обычный поиск по ИНН. Сервер принимает только свежий результат поиска этого сотрудника и сохраняет юридические реквизиты из результата.

Ответ `201 {organization}` возвращается после записи организации со статусом `unverified`, выключенной телефонии и аудита. Клиентское членство и владелец при этом не назначаются. Повтор с теми же ИНН и отображаемым названием возвращает прежнюю организацию с HTTP 200, даже если сотрудник обновил результат поиска. Использование ключа с другими полями даёт 409. Верифицированный ИНН нельзя создать повторно.

## Отображаемое имя

`PATCH /v1/organizations/{id}/display-name`, тело `{"display_name":"Короткое имя"}`.

Действующий клиентский владелец или администратор выбирает эту организацию в своей Web-сессии. Сервер принимает 1–180 символов после удаления пробелов по краям и возвращает `200 {organization}`. ИНН, юридическое наименование и адрес сохраняют прежние значения. Изменение записывается в аудит.

`display_name` добавлен в ответы списка, выбора и восстановления контекста, а также в административный список. До первого изменения сервер возвращает юридическое наименование в качестве отображаемого имени. Для реквизитов, документов и проверки используется `legal_name`.

## Служебный контекст

- `POST /v1/internal/client-context/open`, тело `{"organization_id":"uuid"}`. Возвращает `201 {context}`. В одной Web-сессии одновременно открыт один контекст. Для повторного входа сначала закрывается предыдущий действующий контекст. Конфликт возвращает `409 INTERNAL_CONTEXT_ACTIVE`.
- `GET /v1/internal/client-context` возвращает действующий `200 {context}` текущей Web-сессии или 404. `context` содержит `id`, `expires_at`, `permissions: ["organization:read"]` и `organization` с `id`, `inn`, `legal_name`, `display_name`, `verification_status`.
- `POST /v1/internal/client-context/close`, тело `{"context_id":"uuid"}`. Идемпотентно возвращает 204. UI возвращает сотрудника в админку после ответа.

Контекст действует 15 минут, привязан к Web-сессии и конкретной организации, переоценивает доступ при чтении и закрывается при отзыве служебной роли. Открытие и явное закрытие записываются в аудит. Первый этап поддерживает только чтение карточки через служебный маршрут. Другие клиентские маршруты проверяют обычное членство. Записи о членстве при открытии служебного контекста не создаются.


## Responsible manager

GET /v1/internal/responsible-managers

Owner/Admin only. Returns 200:
{items:[{user_id,email,role}]}

POST /v1/internal/organizations/responsible-manager

Owner/Admin only. Origin, CSRF and JSON required.

Request: {organization_id: UUID, user_id: UUID or null}

Returns 204. Null removes the assignment.
Repeated identical assignment does not duplicate audit events.

Errors:
- 403 INTERNAL_ACCESS_DENIED
- 404 RESOURCE_NOT_FOUND
- 422 INVALID_RESPONSIBLE_MANAGER

GET /v1/internal/organizations supports manager=UUID
or manager=unassigned. Filtering precedes pagination.

New fields:
- responsible_manager_id
- responsible_manager_email
- responsible_manager_active

Disabled staff assignments remain visible for reassignment.
Refresh the organizations list after a successful mutation.
Capability: organizations:assign_manager.
