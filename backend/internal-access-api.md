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


## Internal permissions update (migration 014)

Owner, Admin and Manager can read the staff directory.
Owner and Admin have staff:manage capability.
Admin can change, deactivate and restore existing Admin/Manager staff.
Admin cannot modify their own access or grant internal roles to customers
through the existing staff access endpoint.
Owner protection remains unchanged.
Legacy reviewer remains limited to the existing review workflow.
Manager can now perform organization reviews.

New capability: staff:list.


## Organization verification revocation

POST /v1/internal/organizations/revoke-verification

Capability: organizations:revoke_verification.
Roles: Owner, Admin, Manager.

Request:
{organization_id: UUID, evidence_reference: string, explanation: string}

Returns 200:
{organization_id, verification_status: "unverified", review_id}

Errors:
- 403 INTERNAL_ACCESS_DENIED
- 404 RESOURCE_NOT_FOUND
- 409 REVOCATION_REQUIRES_VERIFIED
- 422 INVALID_REVIEW

Records both review history and application audit.
New call admission requires verified organization status.
Uncommitted reservations are revalidated before dispatch.
Existing connected calls are not interrupted solely by verification revocation.


## Internal billing API

Roles: Owner and Admin.
Capabilities: billing:read, billing:manage.

GET /v1/internal/billing/summary?organization_id=UUID

GET /v1/internal/billing/history?organization_id=UUID&offset=0&limit=50

POST /v1/internal/billing/transactions

Required Idempotency-Key: UUID.

Body:
- organization_id: UUID
- kind: payment | debit
- amount_kopeks: positive decimal integer string
- reference: confirmed payment reference or adjustment reference
- reason: explanation

Returns 201 for new transaction and 200 for exact replay.

POST /v1/internal/billing/due-date

Body:
- organization_id: UUID
- invoice_id: UUID
- due_at: UTC ISO timestamp
- reason: explanation

Payments settle existing outstanding invoices in due-date order.
A debit is an account adjustment, not a reversal of a bank payment.
Financial writes and application audit share one transaction.
The old prepaid wallet remains unused.

Future invoice allocation, billing periods, document issuance,
bank reconciliation and historical balance reconciliation
require separate implementation and acceptance tests.


## Billing schedules and organization billing

GET /v1/organizations/{organization_id}/billing
GET /v1/organizations/{organization_id}/billing/invoices
GET /v1/internal/billing/invoices?organization_id=UUID
POST /v1/internal/billing/schedule

Client billing requires active selected organization and
Owner or Admin membership. Internal billing requires
active internal Owner or Admin access.

Schedule body:
- organization_id: UUID
- next_period_end: YYYY-MM-DD
- reason: string

The period end uses Europe/Moscow calendar dates.
Changing the period end does not change invoice due dates,
historical charges or payments. Repeated identical changes
do not produce duplicate audit entries.

Invoice records expose amounts, due dates and payment status.
These are accounting records, not downloadable legal documents.

Automatic period closure, allocation of remaining advances,
document issuance and bank reconciliation remain separate
implementation requirements.


## Internal billing overview

GET /v1/internal/billing/overview?from=YYYY-MM-DD&to=YYYY-MM-DD

Roles: Owner, Admin, Manager.
Capability: billing:overview.

Inclusive calendar dates in Europe/Moscow.
Maximum range: 366 days.

Organization counts describe the current organization directory.
Usage is grouped by settlement recorded_at.
Payments are grouped by ledger recorded_at.
Historical bank receipt dates are not inferred.

New issued invoice records automatically allocate previously
unallocated confirmed payments. Allocation is not a second
payment and must not increase cash receipts.

Voided invoice allocations require explicit reconciliation.
This migration does not issue invoices automatically.


## Organization staff directory

GET /v1/organizations/{organization_id}/staff

Requires an authenticated account with active Owner
or Admin membership in the selected organization.

Returns membership ID, user ID, first name, last name,
email, phone, email verification, registration timestamp,
role and active status.

The existing employee role is exposed as manager.
Historical registration timestamps remain null when unknown.
No password hashes or authentication credentials are returned.


## Organization staff access

POST /v1/organizations/{organization_id}/staff/access

Requires selected organization and active Owner or Admin membership.

Body:
- membership_id: UUID
- role: admin | manager
- active: boolean

Owner membership is protected.
Self-modification is denied.
Role and access changes revoke legacy phone sessions and
clear selected organization contexts for the affected user.

Memberships and historical calls are retained.
Account access to unrelated organizations is preserved.

Repeated identical mutations do not duplicate audit entries.


## Staff invitations

POST /v1/internal/invitations
POST /v1/organizations/{organization_id}/invitations

Body: email, role (admin | manager).

GET /v1/account/invitations

POST /v1/account/invitations/accept

POST /v1/internal/invitations/revoke
POST /v1/organizations/{organization_id}/invitations/revoke

Accept and revoke body: invitation_id.

Invitations expire after seven days. Acceptance requires
an active account with matching verified email.

Existing memberships and internal staff records cannot
be overwritten by accepting an invitation.

Email delivery is implemented separately.
