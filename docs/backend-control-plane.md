# SashaTel Control Plane — архитектура и контракт на согласование

Refs #12, #11, draft #10. База PR — main. Интеграционный контракт Desktop проверен по feature/desktop-integration.

## Аудит и решение

PR #10 связывает Electron IPC, DesktopCallOwner и Audio. Локальный owner управляет UI lifecycle, media lease и cleanup. Демо-история живёт в renderer. Main crash оставляет состояние внешнего SIP неизвестным. Production transport, серверная история и WSS/ICE ещё отсутствуют. Backend публикует авторитетное состояние вызова, Desktop адаптер связывает server call_id с локальным callId и сохраняет существующий IPC контракт и owner epoch.

Выбор — модульный монолит Node.js 24 / TypeScript / PostgreSQL. HTTP, WebSocket для уведомлений, отдельный интерфейс ARI. PostgreSQL хранит разрешения, резерв и журнал в одной транзакции. Worker отправляет команды из transactional outbox, принимает события, сверяет каналы и CDR/CEL.

## Хранение и изоляция

- Глобальные users с soft-delete. Organizations, memberships, roles и permission grants. Предлагаем supervisor для роли lead из #12, отдельно organization_admin и глобальный superadmin. Последнему выдаётся явный целевой tenant scope для админских действий, доступ к телефонии назначается через membership.
- Devices и sessions принадлежат membership. Одна активная телефонная сессия на user через partial unique index и атомарное замещение. Секреты сессий случайные, в БД хеши. Короткий срок access и ротация refresh с отзывом семейства при повторном использовании.
- Subscriptions, entitlements, wallets, append-only usage_ledger. Хранить единицы квоты и валюту явно, раздельные компоненты для оператора и SashaTel. Резерв, списание, освобождение, корректировка с уникальным ключом события и ссылками на вызов и исходную запись.
- SIP endpoints привязаны к membership и устройству, trunks и number pools к организации. Caller ID нормализован. Суточный счётчик привязан к физическому исходящему номеру. Общий номер требует общего счётчика даже при доступе из нескольких пулов.
- Call authorizations, calls, channels, call events, outbox, audit log. Составные внешние ключи (organization_id, id), tenant scope из сессии. RLS с FORCE и transaction-local scope, runtime роль без BYPASSRLS. Отдельные роли для миграций и worker. История не каскадируется при удалении пользователя.

## Desktop API v1

- POST /v1/sessions создаёт сессию для явного membership, POST /v1/sessions/refresh ротирует токен, DELETE /v1/session отзывает его. кабинет и телефония используют отдельные permissions. OS credential storage для refresh. Rate limits по источнику и аккаунту для входа, по tenant и membership для команд.
- POST /v1/calls принимает destination E.164, Idempotency-Key и текущий session epoch. Ответ 202 содержит call_id, state и expires_at и подтверждает принятие серверной команды. Повтор в том же tenant/membership с тем же payload возвращает тот же call_id. Изменённый запрос даёт 409 IDEMPOTENCY_CONFLICT. Проверка текущего доступа выполняется до выдачи сохранённого ответа.
- GET /v1/calls и GET /v1/calls/{id} выдают историю и подтверждённый статус в пределах прав. Чужой идентификатор получает 404. POST /v1/calls/{id}/hangup идемпотентен и требует право на конкретный вызов.
- WebSocket получает упорядоченные серверные события с cursor, call_id и event_id. При reconnect клиент запрашивает snapshot и продолжает с cursor. Истёкший cursor требует полного snapshot. Блокировка закрывает подписку.
- SIP provision после согласования media topology. Короткоживущие endpoint credentials, WSS с доверенным сертификатом и allowlist origin/host, ограниченные ICE/TURN адреса и краткоживущие TURN credentials. Trunk и ARI credentials серверные.

## Авторизация, отправка и восстановление

В транзакции блокировать актуальные строки сессии, пользователя и membership, бюджет, tenant concurrency и счётчик номера в едином порядке с операциями отзыва. Проверить организацию, права, подписку, минуты/кредит, параллелизм, разрешённый транк и Caller ID. Резервировать бюджет и слот, создавать grant с TTL и запись outbox атомарно. Коды USER_REVOKED, ORGANIZATION_SUSPENDED, INSUFFICIENT_BALANCE, NUMBER_LIMIT_REACHED и CALL_CONCURRENCY_LIMIT. Граница суток должна быть единой для номера. Предложение для пилота — Europe/Moscow, требует согласования.

На старте worker повторно проверяет grant и доступ. Перед выдачей команды атомарно расходует один из восьми слотов на Caller ID. Истёкший grant освобождает резерв до отправки. При неоднозначном ответе ARI слот попытки сохраняется, вызов переходит в reconciling. Повторный originate возможен только после согласования протокола дедупликации и доказательства отсутствия предыдущего эффекта. До этого worker сверяет детерминированные channel IDs и события. Call_id передаётся как correlation variable, Asterisk channel_id и linkedid сохраняются как внешние идентификаторы. CEL/CDR сводятся по instance ID, linkedid и channel IDs. Settlement и переход terminal выполняются идемпотентно. CDР и CEL определяют факт и длительность для тарификации.

Состояния authorized → dispatching → ringing → connected → terminating → ended, с failed/expired и reconciling для неопределённого результата. Поздние события дополняют журнал, terminal state не откатывается. Отзыв блокирует новые grants и endpoint access, ставит hangup в outbox для критической блокировки. Исчерпание резерва требует bounded call duration на стороне Asterisk. При недоступности Backend новые внешние звонки запрещены. Для активных звонков нужен согласованный локальный hard stop. Для race revoke/start требуется enforcement на границе выхода в trunk: при недоступной проверке отказ, при отзыве после допуска идемпотентное завершение. Одна транзакция PostgreSQL не предоставляет общей атомарности с ARI.

## Открытые вопросы для Telephony Engineer

Согласовать Stasis/dialplan без прямого исходящего маршрута из SIP endpoint, границу fail-closed проверки перед trunk, отзыв регистрации и активных каналов, приватный ARI и отдельные credentials, детерминированные ID для обоих плеч, источник CEL/CDR, поведение при reconnect и hard stop. Первый сквозной тест после согласования — внутренний двухсторонний вызов на стенде #11 с отказом при отзыве и проверкой истории после reconnect.

## Проверки реализации

PostgreSQL integration suite с параллельными транзакциями: чужой tenant/роль, два устройства, stale session, revoke перед start, истёкший grant, двойной idempotency key, девятая попытка, конкурентное исчерпание кошелька, повторный terminal event и settlement. Fake ARI с явными событиями, режимами timeout и reconnect для тестов. Живой адаптер требует стенда #11.
