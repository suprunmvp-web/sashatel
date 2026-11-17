# AUTH-01 / SESSION-01 / ORG-01 — контракт и миграция

Статус — проект технического контракта, обновлён явными решениями владельца 17.11.2026. Продуктовые решения раздела 14 утверждены владельцем и заменяют соответствующие положения прежнего ТЗ; технические механизмы остаются проектом. Этот diff меняет только документацию. HTTP ниже ещё не реализован. Продуктовые требования имеют приоритет над пилотным API.

## Источники и проверенный срез

- [Handoff](https://github.com/suprunmvp-web/sashatel/blob/docs/product-spec-v1-20261117/docs/product/PROJECT-HANDOFF-RU.md) и [ТЗ v1.0](https://github.com/suprunmvp-web/sashatel/blob/docs/product-spec-v1-20261117/docs/product/sashatel-spec-v1.0.md), прочитаны 17.11.2026.
- Backend #14, c2f0317f7b88fcec5bbcb56fdcb4baf3142acb12, migrations/001.sql, control.ts, http.ts, migrations/003-operator.sql и интеграционные тесты. В Desktop проверены main.cjs и integration/operator-status.mjs: env token загружается в main, reader сбрасывает bearer при 401, refresh отсутствует. [CI PostgreSQL 17 — success](https://github.com/suprunmvp-web/sashatel/actions/runs/44035510271/job/133877306483).
- Desktop #10, a5b19eb5b312f6a20007af1b47598266c8ad48fe. [Desktop CI](https://github.com/suprunmvp-web/sashatel/actions/runs/44032036025) и [Core CI](https://github.com/suprunmvp-web/sashatel/actions/runs/44032036094) — success. Vercel brandbook status — failure, отдельно от этих suites.
- Комментарии #14/#10, включая вопросы Desktop о refresh, logout и смене организации. Проверены актуальные обсуждения, подтверждение общей модели сессий ещё отсутствует.

## 1. Аудит существующего кода

| Область | Реализовано в #14 | Расхождение и действие |
| --- | --- | --- |
| Идентичность | Глобальный users с UNIQUE login и scrypt | login не гарантирует email, отсутствуют verified_at, recovery, canonical email и версия хеша |
| Организации | memberships связывают user с tenant | Нет ИНН/DaData, создания, приглашений, owner и атомарной передачи |
| Роли | manager, supervisor, organization_admin, superadmin | Продукт owner/admin/employee. supervisor имеет tenant-wide cabinet, в Desktop такой доступ недопустим. superadmin должен стать отдельной платформенной привилегией |
| Телефония | manager/supervisor имеют call, admin отдельно trunks.manage | Нужна проверка client audience. Desktop даже администратору выдаёт только operator/read-own/call scopes |
| Сессия | 15 минут opaque bearer, hash в БД, tenant+membership+device | Вход требует заранее известный tenant, отсутствует account-only login и выбор организации |
| phone_epoch | Каждый login увеличивает глобальный epoch пользователя | Любой Web login на этом маршруте разлогинит Desktop. Смена организации также заменяет предыдущую сессию. Разделить family/context/phone lease |
| Operator GET | Проверяет сессию, увеличивает timestamp снимка | Не меняет phone_epoch, не отзывает вызов. Пока возвращает false/null/false |
| Tenant isolation | FORCE RLS на tenant-таблицах, составные FK | Runtime читает глобальные users и number_attempts. Для новой модели выделить узкую identity-boundary и функции чтения собственных memberships без произвольного tenant override |
| Звонки и история | Стабильные call_id, FK на membership/session, серверные события | Нет записей/production media. Сессии и memberships нельзя физически удалять с каскадом |
| Деньги | authorize требует wallet и резерв, settlement ограничен reserved | Пилотный обязательный wallet gate отличается от утверждённой постоплаты с optional credit limit. Новый продуктовый gate проверяет просрочку и доступ, без обязательного аванса; индивидуальный кредитный лимит optional и по умолчанию отсутствует (§14) |
| Logout/expiry | Отзыв bearer; перед dispatch сессия проверяется снова | После dispatch нет гарантии hangup при logout/expiry. Нельзя выдавать это за согласованную политику текущего разговора |

Текущие scrypt параметры не версионированы. Предлагается сохранить verify старого формата, новые хеши хранить с явными scrypt N/r/p/salt/key-length, целевой baseline N=131072,r=8,p=1 и maxmem >=256 MiB, с ограничением параллелизма KDF и измерением на сервере. Rehash при успешном входе. Пароль 12–128 Unicode codepoints, до 512 UTF-8 bytes, без trim/нормализации/обрезания. Точный baseline — техническое предложение для нагрузочной проверки.

## 2. Одна identity, три уровня доступа

1. Account session family — глобальный user, client_type web|desktop, device_id, auth_epoch, абсолютный/idle срок. Web и Desktop создают независимые семьи.
2. Organization context — один active context на семью, membership_id, organization_id, context_epoch, audience. Переключение меняет только эту семью, атомарно отзывает прежний context.
3. Phone lease — один на user глобально для MVP, принадлежит Desktop family/context и монотонному fencing_epoch. Web login/refresh/read никогда не меняют lease. Получение второго lease при живом первом даёт PHONE_SESSION_IN_USE, без скрытого вытеснения.

Новые таблицы account_families, refresh_credentials, access_credentials, organization_contexts, phone_leases, email_challenges, recovery_grants, organization_invitations, ownership_transfers. Токены opaque random 256-bit, БД хранит digest, refresh использует отдельный pepper из secret manager. Семья содержит auth_epoch, context содержит membership authorization_version, lease содержит fence. revoked_at и причины сохраняются для аудита.

В organization хранить nullable owner_membership_id с deferred составным FK на активное membership этой организации. Роль membership — admin|employee; owner определяется единственным указателем, имеет owner capabilities. Для self-service создания owner обязателен, для внутреннего создания допускается временное отсутствие owner. Активность/verified email назначаемого owner и запрет его удаления клиентским admin обеспечиваются транзакциями с блокировкой organization и deferred constraint trigger. Внутренние роли SashaTel owner/admin/manager хранятся вне клиентских memberships, с аудитом и явным scope закреплённых организаций для manager. Служебный actor сохраняет собственную identity.

Desktop scopes независимо от организационной роли — operator.read, calls.start-own, calls.read-own, calls.hangup-own, recordings.read-own. Web owner/admin — org.read, members.manage (с защитой owner), trunks.manage, calls.read-tenant, recordings.read-tenant, billing.read/manage. Employee Web — onboarding, приглашения и свой аккаунт. Участие employee даёт звонки по умолчанию, отдельного клиентского переключателя звонков нет.

## 3. Общая HTTP форма

Предлагаемые routes заменяют пилотный POST /v1/sessions, сохраняют /v1/calls и /v1/operator/telephony с новым middleware. Все поля обязательны, кроме явно optional; additionalProperties=false. UUID канонические, timestamp UTC RFC3339, email <=254 bytes. Email хранить оригинальный и canonical: trim, IDNA/lowercase domain, case-insensitive uniqueness всего адреса как явная продуктовая политика; без удаления точек/plus. Существующие коллизии разбираются перед UNIQUE.

Все ответы no-store. Ошибка JSON:
`{ "code": string, "message": string, "request_id": UUID, "retry_after_seconds"?: integer }`.
Message безопасный пользовательский текст; клиенты ветвятся по code. 400 INVALID_REQUEST; 401 INVALID_CREDENTIALS, ACCESS_EXPIRED, SESSION_REVOKED, REFRESH_EXPIRED, REFRESH_REUSED; 403 EMAIL_UNVERIFIED, MEMBERSHIP_REVOKED, ORGANIZATION_SUSPENDED, PERMISSION_DENIED; 404 RESOURCE_NOT_FOUND для чужих tenant ресурсов; 409 IDEMPOTENCY_CONFLICT, ORGANIZATION_CONTEXT_CHANGED, ACTIVE_CALL_CONFLICT, PHONE_SESSION_IN_USE; 422 INN_INVALID; 429 RATE_LIMITED + Retry-After; 503 EMAIL_DELIVERY_UNAVAILABLE, ORGANIZATION_LOOKUP_UNAVAILABLE, AUTH_UNAVAILABLE. Проверка access expiry раньше бизнес-gate; refresh reuse возвращает 401. Полные реквизиты и секреты исключены из ошибок.

Web identity использует same-origin Backend/BFF. Refresh и account access в Secure HttpOnly host-only cookies (SameSite=Lax, Path=/; отдельные имена), origin allowlist и CSRF token на изменяющих запросах, GET без эффектов кроме наблюдаемого timestamp. Desktop передаёт access через Authorization: Bearer. Public client_type не является доказательством audience; сервер выдаёт credentials через отдельные Web cookie и Desktop device-authorisation flows.

Типы:
`Account={id:UUID,email:string,email_verified:boolean,display_name:string}`.
`Organization={id:UUID,inn:string,legal_name:string,membership_id:UUID,role:"owner"|"admin"|"employee",status:"active"|"suspended"}`.
`Context={id:UUID,organization:Organization,context_epoch:integer,expires_at:timestamp}`.
`DesktopTokens={access_token:string,token_type:"Bearer",expires_in:300,refresh_token:string,refresh_expires_at:timestamp,family_id:UUID,account:Account,context:Context|null}`.
Web ответ login/refresh — `{account:Account,family_id:UUID,access_expires_in:300,context:Context|null}`, токены только cookies. Account-only access не читает tenant resources.

## 4. AUTH-01 endpoints

| Route | Request | Success и ограничения |
| --- | --- | --- |
| POST /v1/auth/register | {email,password,display_name} | Web only. 202 {challenge_id:UUID,expires_in:600,resend_after:60}. Создать pending identity и email job атомарно; одинаковый ответ для существующего адреса, synthetic challenge без изменения существующего пароля |
| POST /v1/auth/email/verify | {challenge_id,code:string} | 200 {verified:true}; только действительный registration challenge. Создаёт account-only Web family/cookies. Повтор 400 CODE_INVALID_OR_EXPIRED |
| POST /v1/auth/email/resend | {challenge_id} | 202 {challenge_id,expires_in:600,resend_after:60}; предыдущий код инвалидируется только при принятии нового email job в одной транзакции |
| POST /v1/auth/login | {email,password,device_id} | Web cookies, 200 Web ответ. Неподтверждённый email — 403 EMAIL_UNVERIFIED только после проверки пароля; никакого tenant access |
| POST /v1/auth/refresh | Web {} + refresh cookie; Desktop {refresh_token} | 200 Web ответ или DesktopTokens; ротация, scope/client binding и актуальные версии проверяются сервером |
| POST /v1/auth/logout | Web {} + cookie; Desktop {refresh_token} | 204, отзыв всей текущей семьи, access/context и refresh descendants атомарно. Разрешён только этому client binding. Повтор 204, даже expired credential при сохранённом digest |
| POST /v1/auth/logout-all | {} + account access + fresh password step-up | 204, auth_epoch++, все семьи revoked; судьба текущего разговора по §8 |
| POST /v1/auth/password/forgot | {email} | 202 {challenge_id,expires_in:600,resend_after:60}, одинаково для неизвестного адреса |
| POST /v1/auth/password/verify | {challenge_id,code} | 200 {reset_token,expires_in:300}, одноразовый purpose-bound reset grant |
| POST /v1/auth/password/reset | {reset_token,new_password} | 204, grant consumed, хеш изменён, auth_epoch++, все семьи revoked в одной транзакции; затем обычный login |

Register/email-resend/forgot требуют browser CSRF/origin checks и pre-auth nonce cookie. Синтетические challenges indistinguishable по wire, verification всегда отклоняется. Не менять пароль до reset grant. Ошибки email-провайдера не раскрывают существование аккаунта: 503 только при общей недоступности приёма durable jobs.

Codes — 6 цифр из CSPRNG, TTL 10 минут, 5 неверных попыток на challenge, после исчерпания нужен новый challenge. Хранить HMAC(secret_pepper, challenge_id/purpose/code), сравнивать constant-time, успешное потребление UPDATE с condition consumed_at IS NULL/attempts<5/expires_at>now. Код purpose- и account-bound, новый resend отзывает предыдущий. Resend cooldown 60 секунд, максимум 5/час на адрес и 20/час на IP. Login 10/мин на IP и 10/15мин на canonical email, progressive backoff без постоянной блокировки аккаунта. Register/forgot 5/час на адрес и 20/час на IP, daily email cap и метрики abuse. Числа предложены для пилота, централизованная конфигурация. Rate limiter account hashes не раскрывает email. Recovery и verification имеют разные purposes и бюджеты. Проверка email доказывает контроль ящика.

## 5. Desktop login и OS

Предложение для #10 — system browser + device authorization с PKCE, единая account identity. Web-only регистрация и recovery доступны по ссылкам.

- POST /v1/auth/desktop/authorizations {device_id,code_challenge,code_challenge_method:"S256"} → 201 {device_code,user_code,verification_uri,expires_in:300,interval:5}. device_code 256-bit, user_code 10 base32 символов, сервер хранит digest. verification_uri фиксированный HTTPS Web origin.
- Web POST /v1/auth/desktop/authorizations/approve {user_code} с verified Web account, CSRF, свежим password step-up и явным подтверждением устройства → 204. Нельзя подтверждать чужой code без отображения device metadata.
- POST /v1/auth/desktop/token {device_code,code_verifier} → 200 DesktopTokens с context:null; pending 428 AUTHORIZATION_PENDING, slow polling 429, denied/expired 400 AUTHORIZATION_DENIED_OR_EXPIRED. Одноразовый exchange, проверка PKCE и аудит. App main генерирует verifier, открывает браузер по фиксированному allowlisted URI, renderer получает только безопасный статус.
- Desktop main держит access только в памяти, refresh в macOS Keychain/Windows Credential Manager/Linux Secret Service через проверенную обёртку Electron safeStorage с отказом при plaintext/basic_text backend. PKCE verifier живёт только до exchange; пароль в Desktop не вводится. Refresh/token/code отсутствуют в renderer, localStorage, IPC responses, argv, URL и логах. Статический env bearer остаётся только пилотным fixture.
- При каждом login/startup main загружает свои account/context snapshots. Один refresh promise на family, все параллельные 401 ожидают его. Retry оригинального POST только с тем же Idempotency-Key; start автоматически не повторяется после неопределённого результата, сначала GET call.
- Device_id — метаданные, не доверенный аппаратный ключ. Для production threat model обсудить sender-constrained refresh; PKCE не заменяет серверные revocation checks.

## 6. SESSION-01 и refresh

Access TTL 5 минут. Refresh idle TTL 7 дней, absolute family TTL 30 дней для Web и Desktop, без автоматического продления absolute TTL. Нужны явные sign-in после absolute expiry. Предложения TTL подлежат утверждению.

Refresh блокирует user/auth_epoch и family, проверяет revoked/client binding/expiry, помечает старый digest used_at и создаёт ровно одного потомка. Хранить chain до absolute expiry + окно security audit. Повтор used credential отзывает всю семью и context, возвращает REFRESH_REUSED. Никакого grace window с двумя валидными потомками. Потеря ответа rotation требует нового login. Это осознанный UX/security tradeoff для подтверждения #10. Desktop использует единственный main broker, Web BFF сериализует refresh по family между вкладками. Не считать добросовестные параллельные запросы допустимыми без этого coordinator.

Logout также принимает сохранённый использованный refresh digest и отзывает семью независимо от победившего refresh. При refresh-first потомок сразу отзывается logout; при logout-first refresh получает SESSION_REVOKED. Ответ refresh, пришедший в клиент после logout, отбрасывается локальным login_generation и не сохраняет refresh в OS.

GET account/org/operator не меняет lease/auth_epoch, не продлевает refresh TTL и не создаёт новую family. Refresh не меняет phone fence. Web login не инвалидирует Desktop. Account credentials проверяются серверно при каждом чувствительном запросе, access TTL не даёт права звонить после revocation.

## 7. Организации и ownership

| Route | Request | Response |
| --- | --- | --- |
| GET /v1/account | account credential | 200 {account:Account} |
| GET /v1/organizations | verified account credential | 200 {items:Organization[]}; только active memberships, включая suspended org для понятного отказа |
| POST /v1/session/organization | {organization_id,expected_context_epoch:integer|null} | 200 {context:Context}; тот же account family. Web заменяет context cookie. Desktop дополнительно получает scoped access_token и expires_in=300. Старая context credential сразу недействительна |
| POST /v1/organizations/lookup | {inn:string} | Web verified only, 200 {lookup_id:UUID,inn,legal_name,legal_address,expires_at}; сервер проверяет checksum 10/12 цифр, обращается к DaData, сохраняет snapshot на 15 минут |
| POST /v1/organizations | {lookup_id,confirm:true} + Idempotency-Key | Web verified only, 201 {organization:Organization}; owner membership создаётся атомарно. Context выбирается отдельным route |

Организация создаётся одной транзакцией с owner, entitlement_defaults и billing_profile(mode=postpaid,credit_limit_minor=NULL), audit/outbox для внутреннего кабинета. Транк и звонки изначально недоступны до фактического provisioning. Новые организации неверифицированы, новые транки выключены. credit_limit_minor=NULL означает отсутствие ограничения; индивидуальный положительный лимит задают внутренние сотрудники по правилам §14. Обязательный аванс не вводится. DaData lookup выполняется до transaction, create проверяет freshness и привязку lookup к account, перечитывает snapshot. При outage 503 и повтор lookup, без частичной организации. Idempotency scope account+key, различный lookup даёт conflict; дубликат ИНН — 409 ORGANIZATION_ALREADY_EXISTS без раскрытия владельца. Утверждено 18.11: одна организация на нормализованный ИНН, филиалы внутри неё.

Приглашения — Web POST /v1/organizations/{id}/invitations {email,role:"admin"|"employee"} → 202 {id,expires_at}; GET metadata и POST /v1/invitations/{token}/accept {} → 200 {organization:Organization}. Токен 256-bit, hash, TTL 7 дней, одноразовый, привязан к canonical verified email. Token из ссылки сразу обменять в защищённый Web flow и удалить из URL через redirect, Referrer-Policy=no-referrer. Invite token не даёт account session. При существующем membership повтор acceptance идемпотентен и не повышает роль автоматически.

Передача — owner-only Web POST /v1/organizations/{id}/ownership-transfers {target_membership_id} с password step-up → 202 {transfer_id,challenge_id,expires_in:600}. Цель — активный verified member этой организации с admin capability. POST /v1/organizations/{id}/ownership-transfers/{transfer_id}/confirm {code} → 200 {organization:Organization}. Код отправляется текущему owner, purpose transfer, включает target/version. Под lock organization и обеих memberships проверить owner/version, потребить challenge, заменить owner pointer, прежнего owner сделать admin, увеличить authorization_version обеих memberships, записать audit. Конкурирующий transfer получает 409 OWNERSHIP_CHANGED. Admin не может изменять owner ни через role update, ни invitation, ни delete. Истёкший или сменивший owner transfer недействителен.

Удаление membership — soft revoke + authorization_version++, отозвать scoped contexts/phone grants/endpoint access, без изменения account families остальных организаций и без удаления calls/recordings. Владелец не может выйти до transfer или явного закрытия организации. При удалении последнего admin owner остаётся управляющим субъектом. Исторические имена и IDs сохраняются как snapshots с контролем PII retention.

## 8. Разговоры и гонки — решения для утверждения

Уже утверждено ТЗ: просрочка и выключение транка запрещают новые звонки, текущий разговор продолжается. Удаление сотрудника запрещает будущий доступ и сохраняет историю. Судьба текущего разговора при остальных событиях ещё требует продуктового решения.

Предложенная матрица, до утверждения не реализовывать автоматически:

| Событие | Новые starts | Текущий разговор — предложение |
| --- | --- | --- |
| access expiry, обычный refresh | При expiry требуется refresh | Продолжить, call control через renewed family |
| logout текущей Desktop family / logout-all / password reset | Запретить, отозвать endpoint и pending grants | Завершить через idempotent hangup всех legs; подтвердить teardown |
| удаление membership / ручная security-блокировка user/org | Немедленно запретить | Завершить, статус reconciling до доказательства teardown |
| смена организации | Запретить смену при pending/active/unknown call, 409 ACTIVE_CALL_CONFLICT | Сохранить старый context до окончания; Web другой семьи может переключаться |
| второй Desktop / потеря lease heartbeat | Новый lease выдавать только после fencing старого и reconciliation | Не вытеснять активный разговор молча; PHONE_SESSION_IN_USE |
| потеря сети/закрытие окна/падение main | Запретить новые попытки до bootstrap reconciliation | Backend контролирует уже созданный call, Desktop не объявляет ended по локальному таймеру |
| потеря refresh-ответа/reuse | Семья revoked | Применить подтверждённую политику security revocation; предложение hangup |
| просрочка оплаты / обычное выключение транка | Запретить | Продолжить по утверждённому ТЗ |

Общий порядок lock для account-sensitive операций: user → family → organization → memberships в sorted ID → context/phone lease → call. Cross-tenant выборки допускаются только в узком account service с проверкой user. Billing/worker/админские операции должны использовать совместимый порядок, иначе нынешние org→user locks могут дать deadlock.

Start и revocation проверяют версии в одной DB transaction, создают grant с phone fence и context_id. Gateway повторяет проверку/fencing на границе выхода в trunk. Grant до revoke не является бессрочным правом originate. Refresh не создаёт grant и не снимает quarantine. Context switch/refresh response содержит context_epoch; late old response не может перезаписать новый context. Call control после expiry отдельного access требует живой family и тот же call ownership/fence; logout-revoked family не восстанавливается через hangup endpoint. Завершение при revocation исполняет серверный worker.

## 9. /v1/operator/telephony и история

Сохраняется согласованный wire из #10:
`200 {telephony_available:boolean,caller_id:string|null,can_call:boolean,observed_at_ms:number}`.
Desktop-scoped context и operator.read, собственный разрешённый Caller ID. now timestamp строго возрастает в context; no-store. Смена context немедленно очищает snapshot на клиенте. GET не приобретает lease и не отзывает текущий разговор. До готовности call gate false/null/false.

POST /v1/calls повторно проверяет актуальные user/family/membership/org, phone lease/fence, entitlement, overdue state, trunk/Caller ID и concurrency/номерные ограничения. Advisory true не резервирует право и не гарантирует последующий start. Web credential получает 403 CLIENT_SCOPE_DENIED. В продуктовой модели заменить pilot available>=reserve_per_call и reserved cap на актуальные правила просрочки и optional credit limit (§14). Пилотные единицы не использовать как неявный продуктовый бюджет; учитывать фактический usage. Пилотный ledger оставить для исторической сверки, без переноса его единиц в рубли.

GET /v1/calls и recording endpoint всегда используют audience и ownership: Desktop только собственные, Web owner/admin вся своя организация. Запись выдавать через authenticated stream или короткий signed URL после проверки доступа, с tenant-bound storage keys. Возврат записи и детальная CDR история — ещё отдельная реализация.

## 10. План миграции без потери истории

1. Утвердить открытые решения §12 и согласовать wire с #10; заморозить новую альтернативную реализацию auth.
2. Additive migration: email/canonical/verified_at/hash_version, families/contexts/credentials/challenges, owner pointer и audit metadata. Существующие sessions/calls FK сохранить. Новый код читает старую историю.
3. Разобрать pilot login values: не-email → приглашение/claim flow; подтверждённые email доказываются новым кодом; коллизии не объединять автоматически. mapping старых user_id сохранить. backfill owner только по подтверждённому владельцем списку, не назначать первого admin. Неизвестный owner не выдумывается; internally created org может остаться без клиентского owner и обслуживается только через проверенный внутренний scope. Все старые org проходят явный verification backfill.
4. manager → employee; organization_admin → admin; supervisor mapping требует явного выбора owner, никаких скрытых расширений роли. superadmin убрать из tenant roles в отдельные platform grants, права персонально проверить.
5. Новые Web/ Desktop families внедрить через один shared auth service. Новые audience scopes закрывают Desktop trunk/admin/history-tenant. Legacy sessions пометить pilot-only, запретить регистрацию/обмен на production family и автоматический перенос секретов.
6. Calls сохраняют historical session_hash и membership_id; добавить nullable family/context/lease IDs для новых вызовов. Никакого переписывания call_id, времён, charges и неизвестных состояний. Legacy активные calls завершить/сверить до cutover phone epoch. Legacy endpoint отключить для новых starts при cutover, teardown подтверждать.
7. Переключить только тестовую организацию на postpaid entitlement, добавить утверждённые части overdue policy, nullable индивидуальный credit limit и реальный usage settlement; пилотный wallet остаётся изолированным fixture. Проверить поздние CDR с объёмом выше старого резерва. Продукт не наследует значения pilot wallet/credit: лимит новых организаций NULL, индивидуальное назначение аудируется.
8. Тестовый rollout Web → email → org/DaData → invite → Desktop browser sign-in → org selection → lease → operator GET → calls/history/recording. Затем совместный стенд Backend/Telephony, без PSTN до отдельного допуска.
9. После проверки клиентов прекратить выдачу legacy tokens, дождаться expiry/reconciliation, убрать legacy auth в отдельной миграции. Rollback до cutover возвращает только тестовую группу на legacy; после новых credentials/data rollback через forward-fix, не восстанавливать использованные refresh/коды и старые phone fences.

## 11. Контрактные тесты и инфраструктура

Будущий suite исполняет HTTP через настоящий Backend с PostgreSQL runtime role без BYPASSRLS. Это план, эти тесты на предложенный auth ещё не запускались.

- Две организации, один account, разные роли; org list без чужих memberships; forged tenant/context/recording/trunk IDs дают отказ. Администратор в A остаётся employee в B. Desktop admin account не получает Web scopes.
- Verified/unverified login, duplicate email и canonical collisions, email outage, resend заменяет старый код, concurrent verify только один успех, 5 неверных попыток, expiry, purpose mismatch, repeat reset/transfer.
- Refresh rotation/reuse, idle/absolute TTL, blocked account, revoked membership, used-token logout, параллельные 401 с одним refresh, response-loss требует login, logout-first/refresh-first и late refresh не оживляет session.
- Web login не отзывает Desktop; status read не меняет lease, два Desktop не могут получить активный lease; switch/start race, context versions и late old snapshot; server restart не сбрасывает fences.
- Создание по ИНН и повтор key, timeout DaData, duplicate INN race, запрет owner assignment клиентом, один owner, concurrent transfer, admin cannot edit owner, former owner admin, soft delete не удаляет историю.
- Access expiry в connected call, logout/удаление/блокировка во время originate unknown, hangup всех legs и CDR после revoke, overdue и trunk disable сохраняют текущий разговор.
- Migration fixture со старыми calls/sessions, orphan/canonical collision reports, FORCE RLS missing scope, pool connection scope leak, повтор migrations, crash между outbox и email delivery.
- Реальная доставка email проверяется на выделенном тестовом домене/ящике с очищенным evidence; sink tests отдельно, без заявления о доставке клиенту. Desktop suite использует pinned backend SHA и OS secret store, renderer/log redaction.

Инфраструктурному агенту:
- PostgreSQL backups/PITR и restore drill, раздельные migrator/runtime/auth/outbox identities, FORCE RLS, connection-local scope, bounded pools, time sync.
- Email transactional provider с API credential в secret manager, SPF/DKIM/DMARC и sender domain, bounce/abuse monitoring. Код и body писем не логировать; email outbox payload encrypt и короткая retention, scope/attempt counters DB atomic.
- HTTPS для Web/API, exact origin/CORS и cookie/CSRF policy, доверенные proxy headers, security headers, без wildcard credential origins.
- Secret manager/KMS для code HMAC, refresh pepper, SIP encryption keys; key versions/rotation, запрет plaintext в CI artifacts.
- Shared rate limiter с атомарными счетчиками и fail-closed для verify/login/resend при outage; provider throttling и durable jobs.
- Workers email retry с backoff, expiry cleanup, family/token retention, invitation expiry, revocation dispatch и reconciliation. Это требования к реализации, автоматизации в этой задаче не создаются.
- DaData server-side key и квоты, contract-safe timeout/circuit breaker, encrypted PII backups, access/audit retention. Логи без codes/passwords/tokens, correlation request_id.

## 12. Повторный аудит и решения до реализации

Повторная проверка выявила: старый epoch смешивает login и phone lease; audiences нужны даже для admin Desktop; owner pointer и role admin различаются; refresh reuse может быть добросовестной гонкой и требует coordinator; email/ИНН не доказывают полномочий представителя; read timestamp не должен менять права; бюджет pilot противоречит постоплате. Эти вопросы отражены в модели и плане миграции.

Необходимо утвердить:
1. Судьбу активного разговора при logout, reset/reuse, membership revoke и lease timeout (§8). Утверждённые overdue/trunk-disable правила уже учтены.
2. Browser device authorization + PKCE для Desktop вместо ввода пароля в Electron; поддерживаемые OS и отказ при недоступном secure storage. Вопрос направить #10, молчание не означает согласие.
3. TTL/codes/rate limits и strict refresh reuse без grace, включая потерю ответа и Web multi-tab coordinator.
4. Уникальность организации по ИНН и поведение филиалов/KPP. Передача owner требует кода текущего owner и password step-up; нужна ли дополнительно акцептация цели.
5. Подтверждённый список owner и mapping supervisor для pilot migration.

Выполнено в этой задаче — сверка источников, кода/CI/комментариев, проект HTTP, review schema и threat/race self-audit. Новые runtime auth, email/DaData, миграции и тесты этого контракта не реализованы. Зелёный CI старых #14/#10 подтверждает только существующие suites.

## 13. Проверка документа перед публикацией

Проверены охват всех десяти пунктов запроса, ссылки на закреплённые heads, таблицы HTTP и конфликт pilot/product. Дополнительная проверка совместимости: login использует INSERT INTO sessions VALUES без списка колонок, а migration 003 добавляет колонку с DEFAULT. PostgreSQL допускает её значение по умолчанию при текущем INSERT, поэтому это не подтверждённая runtime ошибка. При дальнейшем расширении схемы использовать именованные поля во всех INSERT и сохранить regression login после всех миграций.

Security follow-up: code resend не должен бесконечно обнулять суммарный бюджет попыток, общий лимит verify — 20 неуспехов/час на адрес независимо от challenge; исчерпание даёт 429. Device authorization ограничить 5 созданий/час на IP/device и 5 неверных user_code/15мин на Web family, code обмена hash/TTL/consumed_at проверять атомарно. Phone lease heartbeat 15 секунд, stale после 45 секунд только закрывает новые starts; выдача нового lease требует fenced teardown/reconciliation, без автоматического объявления старого call завершённым. Эти значения — предложения до согласования TTL.


## 14. Обновление по явным решениям владельца — нормативный приоритет

Этот раздел заменяет противоречащие положения исходного ТЗ и прежних разделов документа. Изменения касаются проектирования. Реализация полного биллинга в этот diff не входит.

### Внутренние роли и серверная авторизация

Внутренние роли SashaTel — Владелец, Администратор, Менеджер. Это отдельная система полномочий от клиентских owner/admin/employee. Предлагаемые таблицы platform_memberships(user_id, role, active, authorization_version) и platform_organization_assignments(platform_membership_id, organization_id, active). Internal Manager читает и обслуживает исключительно закреплённые организации. Internal Owner/Admin имеют платформенный scope согласно серверной role policy. Назначение platform role не происходит через публичную регистрацию или клиентское membership.

Каждая служебная операция проверяет действительный actor, активную внутреннюю роль, актуальный organization assignment и permission. Авторизация повторяется под блокировками в транзакции изменения. Отзыв закрепления немедленно запрещает новые операции, подписки и получение выгрузок. actor_user_id служебного сотрудника никогда не заменяется user_id клиента. Impersonation и выдача клиентской сессии из служебного доступа не входят в контракт.

UUID — только идентификатор. Scope проверяется для list/detail/update/delete, вложенных объектов, recordings, exports, signed-download grants, jobs и event replay. Фоновая работа наследует зафиксированное ограничение scope и перепроверяет право перед выдачей результата. Служебный доступ к транкам не подразумевает возврат SIP plaintext. Cross-scope объект возвращает 404 RESOURCE_NOT_FOUND, запрещённая операция в доступной организации — 403 PERMISSION_DENIED. Новые runtime роли не получают BYPASSRLS.

### Создание, назначение owner и верификация

Self-service создание атомарно назначает создателя единственным клиентским owner. Организация из внутренней админки может иметь owner_membership_id=NULL. Указатель позволяет максимум одного owner; NULL разрешён для internally_created до первого назначения owner. Замена существующего owner атомарна, без промежуточного NULL; самостоятельное снятие без замены не утверждено. Клиентские API не могут снять последнего owner или перейти к NULL. Не назначать случайного admin при миграции.

Внутренний сотрудник в своём scope может назначить/заменить клиентского owner без подтверждения и уведомления клиента. Обязательны собственная серверная identity, permission org.owner.assign, проверка активного членства цели в той же организации, expected ownership_version, атомарное изменение и audit. Проверка подтверждённого email цели остаётся предложением безопасности для согласования, а не дополнительным требованием владельца. Бывший owner становится клиентским admin, если его membership сохраняется. Самостоятельная передача клиентским owner по §7 сохраняет подтверждение; internal assignment использует отдельный административный маршрут и не создаёт email challenge. Конкурентная замена даёт 409 OWNERSHIP_CHANGED.

Каждая новая организация verification_status=unverified независимо от способа создания. Верификация — внутренняя проверка подписанного договора и реквизитов, а не email/DaData lookup. Внутренние сотрудники в scope могут установить или снять её, permission org.verify. Хранить verification_version, actor/time, ссылку на подтверждающий документ с проверкой scope и ограниченные audit metadata. Не хранить в аудите содержимое договора.

Каждый новый trunk enabled=false. Активация требует verified organization на Backend и повторной проверки в provisioning/dispatch. UI disabled недостаточен. Предлагаемые раздельные поля — enabled intent, registration status, effective eligibility; registration не включает trunk автоматически. При снятии verification новые активации/starts запрещены и старые jobs не могут включить trunk. При снятии verification текущие разговоры продолжаются штатно. До верификации клиентские owner/admin меняют ИНН и юридическое название, employee не меняет. После verification изменения применяет сотрудник SashaTel после проверки запроса; до применения действуют прежние реквизиты. Старые документы сохраняют прежние реквизиты.

### Optional credit limit и финансовые действия

Новые организации по умолчанию credit_limit_minor=NULL — ограничение отсутствует. Положительное целое значение в минимальных единицах валюты означает установленный индивидуальный лимит. Ноль и отрицательные значения не кодируют отсутствие лимита, дают 422 INVALID_CREDIT_LIMIT. Удаление настройки записывает NULL.

Internal Manager может установить/удалить лимит и проводить пополнения/списания только закреплённых организаций. Internal Owner/Admin используют платформенный scope. Каждый тип операции имеет отдельное permission и аудит. Пополнение/списание задаётся положительным amount_minor и kind=credit|debit, с currency, reason и Idempotency-Key; signed amount от клиента не принимается. Повтор не создаёт вторую проводку. Корректировка оформляется новой связанной записью, история не переписывается.

Достижение лимита запрещает новые вызовы и сохраняет текущие. При снижении лимита ниже текущей экспозиции новые вызовы блокируются сразу. Удаление лимита снимает только credit-limit gate, остальные причины запрета сохраняются. Нужна транзакционная защита конкурентных starts/изменений лимита. Точная формула экспозиции и учёт ещё не финализированных разговоров — технический/финансовый контракт для отдельного решения, не копирование pilot reserve_per_call.

Клиентский API billing summary включает credit_limit только если он установлен, например {credit_limit:{amount_minor:500000,currency:"RUB"}}; при отсутствии ключ опущен. UI показывает положительную сумму только при наличии настройки. Валюта и масштаб единиц должны быть явными. Это не новая обязательная предоплата. После погашения задолженности до balance>=0 финансовая блокировка автоматически снимается, остальные gates сохраняются.

### Дата оплаты

Изменить будущую месячную дату оплаты могут только внутренние Owner/Admin, permission billing.payment_date.change. Internal Manager получает 403 независимо от закрепления организации. Request содержит proposed_day, expected_version и contract_amendment_confirmed=true — явное подтверждение сотрудником, что договор изменён. false/отсутствие подтверждения даёт 422 CONTRACT_CHANGE_CONFIRMATION_REQUIRED.

Меняется только будущая месячная дата оплаты, расчетный период остаётся прежним. Выставленные счета не пересчитываются и не получают новую дату автоматически. До определения поведения короткого месяца нельзя реализовывать молчаливый clamp 29–31 числа. Нужны отдельные правила effective_from и границы будущего расписания в контракте реализации.

### Надёжный аудит и Telegram

Изменение и audit event коммитятся одной PostgreSQL transaction. Событие содержит event_id, server timestamp, actor_user_id, actor_type=platform|customer, проверенную role/scope snapshot, organization_id, action, target_type/id, request_id и безопасный before/after diff. Для ownership указывать прежний/новый membership; для verification — состояние/версию; для credit limit — старое/новое значение; для проводки — ID, kind, amount/currency; для даты — старое/новое правило и подтверждение договора.

Append-only audit доступен по отдельному разрешению, runtime не может UPDATE/DELETE. Ошибка сохранения обязательного audit откатывает изменение. Контроль retention/backup и обнаружение пропусков — серверные требования. Время берётся с сервера. Raw HTTP requests, passwords, codes, refresh, SIP-секреты, договоры и лишние персональные данные в audit не включаются.

Telegram получает асинхронную очищенную проекцию через transactional outbox, с retry/backoff, event_id dedup и allowlist полей/адресата. Сбой Telegram не отменяет уже закоммиченную операцию и не заменяет серверный audit. Повторная доставка допустима, действие по Telegram автоматически не исполняется. В этой задаче Telegram сообщения и автоматизации не создаются.

### Затронутые миграции — план

| Изменение | Additive schema / constraint | Совместимость |
| --- | --- | --- |
| Internal roles/scope | platform_memberships, assignments, permission mapping, authorization_version, scope-aware RLS/functions | Пилотный superadmin не превращать автоматически во внутреннего Owner; подтвердить назначения |
| Customer owner | nullable owner_membership_id, ownership_version, creation_source, deferred same-tenant FK и guards | Self-service требует owner атомарно; internally created допускает временный NULL; старые calls/memberships сохраняются |
| Verification | status=unverified DEFAULT, version, evidence reference и actor/time | Не считать старые организации verified по факту существования; backfill только по подтверждённой проверке |
| Trunk activation | enabled DEFAULT false, activation/verification version и job fencing | Сохранить регистрационные наблюдения, запретить активацию stale job после снятия verification |
| Credit limit | nullable positive amount_minor + currency/version, check >0 OR NULL | Без переноса pilot wallet/credit values; ledger финансовых корректировок append-only, idempotency scope |
| Payment schedule | future payment-day rule/version, contract-confirmation audit reference | Без UPDATE уже выставленных счетов и без смены расчётного периода |
| Audit/outbox | typed actor/target, sanitized before/after, append-only grants, delivery jobs | Существующие audit rows сохраняются; старую provenance помечать unknown, не выдумывать actor |

Номера файлов миграций назначать после сверки текущего head, не менять уже применённые 001–003. Запуск миграций в этом documentation diff не выполнялся.

### Обязательные дополнительные тесты

- Matrix internal Owner/Admin/Manager × assigned/unassigned org; клиентский owner/admin не получает platform privileges; platform actor не превращается в клиента.
- UUID/IDOR для всех вложенных объектов, recording download, CSV export result и событий; отзыв assignment во время job/подписки закрывает выдачу, pooled connection не переносит scope.
- Self-service создаёт ровно одного owner, internal create допускает NULL; internal scoped assignment проходит без клиентского кода/уведомления; клиентский admin не меняет owner; concurrent replacement оставляет одного owner и корректный actor audit.
- Все новые org unverified и trunks disabled; прямой HTTP enable unverified отклоняется; verify/revoke race с activation/start; stale provisioning result не обходит verification version.
- NULL limit допускает отсутствие credit gate; положительный лимит виден в клиентском summary, отсутствие скрывает поле; zero/negative invalid; set/remove и достигнутый лимит блокируют только starts. Concurrent start/limit change не обходят утверждённый расчёт экспозиции.
- Manager credit/debit/limit только assigned; replay key не дублирует проводку; missing mandatory audit откатывает финансовое изменение.
- Payment date Owner/Admin only, Manager denied; отсутствие contract confirmation отклонено; future rule меняется без изменения периода и существующих invoices. Edge cases короткого месяца ожидают продуктового решения.
- Audit содержит настоящего actor, organization, время и before/after; redaction не пропускает секреты/сырые запросы; Telegram outage/retry не теряет audit и не повторяет бизнес-действие.

### Действующие правила — утверждение владельца 18.11.2026

Долг запрещает новые звонки и сохраняет кабинет, историю, биллинг, документы и оплату. Вход не блокируется. После погашения до баланса >=0 финансовый запрет автоматически снимается; verification, trunk, permissions и telephony availability проверяются отдельно.

Пять рабочих дней начинаются после договорной даты оплаты, сама дата не включается. После окончания пятого рабочего дня при отрицательном балансе новые starts запрещены. Дополнительного grace period нет. Расчётный период сохраняется.

Дата короткого месяца=min(anchor_day,days_in_month), исходный anchor сохраняется. 31 января → 28/29 февраля → 31 марта → 30 апреля. Выставленные документы автоматически не переписываются.

Предложение для будущего billing-этапа — versioned производственный календарь РФ с федеральными праздниками и переносами для пятидневки, timezone Europe/Moscow. Годовой набор дат утверждает ответственный сотрудник с источником и audit. При отсутствии утверждённого года нет weekday fallback и автоматической блокировки по неподтверждённому deadline. Региональные/договорные исключения согласовать до реализации расписания. Это предложение календаря ещё не утверждено.

### История заменённых решений

- Исходная постоплата без лимита → 17.11 optional positive credit limit, default NULL.
- Обязательный owner для всех → 17.11 временный NULL допустим при internal create, self-service назначает создателя.
- Пять открытых вопросов §14 → 18.11 утверждены изменения реквизитов, кабинет при долге, восстановление >=0, отсчёт рабочих дней и short-month anchor.
- Уникальность ИНН и TTL → 18.11 утверждены одна организация на ИНН (филиалы внутри); email code 10min, 5 попыток, resend60s; access5min; Web refresh7d idle/30d absolute; strict reuse без grace, потерянный refresh response требует login.
- Desktop browser/PKCE, судьба разговора при Desktop logout/reuse и pilot owner mapping остаются будущими решениями и не задерживают новый Web onboarding.

## 15. Первый ограниченный кодовый этап

Additive global identity/email proof → Web login/refresh/logout → DaData lookup/create organization. Один self-service owner, org unverified, новые trunks disabled. Настоящий transactional audit важных изменений. Email port + test sink, real delivery отдельной приёмкой DevOps. Invitations, internal admin, financial ledger/scheduler и новый Desktop login — следующие этапы.

Точные request/response формы §3–4/7 направляются Web UI и Desktop для review. Web — HttpOnly cookie + CSRF; Desktop текущий механизм пока не переключает. CSRF bootstrap предлагается GET /v1/auth/csrf → 200 {csrf_token:string}, pre-auth host cookie Secure/HttpOnly/SameSite=Lax, token передаётся X-CSRF-Token, сервер сверяет Origin и session-bound HMAC. Token доступен Web memory, credentials не выдаются JS. Это wire proposal до явного подтверждения UI.

Тесты нового кода — concurrent register/email uniqueness, concurrent verify/expiry/attempts/resend, email error/retry без orphan, login/logout/refresh race/reuse, повтор organization create/INN conflict, rollback при audit failure, tenant isolation и совместимость всех миграций с прежними calls/IDs. Старый зелёный CI не подтверждает этот этап. Runtime пока не изменён.
