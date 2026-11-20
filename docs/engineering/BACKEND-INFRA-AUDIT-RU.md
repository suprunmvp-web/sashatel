# SashaTel — Backend: инфраструктура, история аудита и карта устранения рисков

**Дата среза:** 21.11.2026. **Основание:** проверка текущей GitHub-ветки `feature/web-auth-production-20261121`, предыдущие инфраструктурные проверки и исторический архитектурный аудит от 19.11.2026. **Не является повторным аудитом live-системы**. Данные динамических IP, DNS, подов, VM и внешних сервисов требуют перепроверки перед операционными действиями.

**Рабочая инструкция для следующего инженера:** сначала [продуктовый handoff](https://github.com/suprunmvp-web/sashatel/blob/docs/product-spec-v1-20261117/docs/product/PROJECT-HANDOFF-RU.md), затем [спецификация](https://github.com/suprunmvp-web/sashatel/blob/docs/product-spec-v1-20261117/docs/product/sashatel-spec-v1.0.md), затем [инженерный handoff по регистрации](./WEB-AUTH-HANDOFF-RU.md), текущие PR/commits/CI и только потом эти исторические наблюдения.

## 1. Историческая оценка Backend 0–100

**Аудит 19.11.2026: 46/100**. Это результат **статического review** исходников ветки `feature/backend-integration-v11-20261119` на SHA `0e6d096`. **Не измерение текущей ветки, не интеграционное тестирование, не оценка production-нагрузки**. Переносить 46/100 на более поздние коммиты без повторного аудита некорректно.

| Направление | Исторический балл / 100 |
| --- | ---: |
| Backend / PostgreSQL | 68 |
| Авторизация / изоляция | 72 |
| Caller ID | 62 |
| SIP / Asterisk / ARI | 25 |
| Восстановление после сбоев | 40 |
| Биллинг | 35 |
| Масштабирование | 38 |
| Полнота продуктовых функций | 32 |
| Эксплуатация / безопасность | 50 |
| **Общая архитектурная оценка** | **46** |

Баллы направлений и общий балл относятся к исходному аудиту; общий не является средним арифметическим таблицы. Исторические более ранние оценки (например, 32/100) относятся к **другим срезам** и не сравниваются напрямую с 46 без одинаковой методологии. **Текущая оценка на 21.11.2026: не пересчитана.**

### Сильные стороны, выявленные аудитом

- PostgreSQL как источник бизнес-состояния, а не браузер/Desktop/Asterisk.
- RLS/FORCE RLS и tenant-scoped операции для базовой изоляции организаций.
- Заложены идемпотентность и outbox, явное состояние `unknown` для неопределённых исходов.
- Формализованный атомарный лимит Caller ID и требование конкурентной корректности.
- Docker образ с digest и секреты вне исходного кода; контролируемый релизный контракт.

**Не путать заложенный механизм с проверенной готовностью:** некоторые инварианты требовали доработки в связанных PR, и аудит не подтверждал реальные PSTN-вызовы.

### Главные слабые места / почему это важно

| Узкое место | Риск | Что требуется до коммерческого релиза |
| --- | --- | --- |
| Недоведённый Call Orchestrator, ARI и dispatch | Нет доказанного реального пользовательского звонка | Приватный ARI worker, state machine, event reconciliation, реальные PSTN E2E |
| Нет проверенного recovery по ARI/перезапускам | Потеря/дублирование фактов звонка, некорректные списания | Crash/timeout/partition tests, idempotency, durable events |
| Несовпадения старого prepay/wallet-кода с утверждённой постоплатой | Неправомерная блокировка вызовов/начисления | Убрать reserve-before-call; биллинг только подтверждённого разговора с человеком |
| Глобальный суточный Caller ID limit, multi-PBX и конкурентные гонки | Превышение 8 инициаций на физический номер/день | Atomic hold→commit→release, Europe/Moscow, реальные стресс-тесты |
| Транк provisioning ручной/частичный | Клиент не может сам подключить оператора | Версионированный PJSIP provisioning, actual SIP registration + PSTN readiness + diagnostics |
| Недостаточная tenant isolation на всех интеграциях | Межорганизационная утечка секретов/данных | Роль/ownership/RLS tests на каждом API, audit |
| Не доказана масштабируемость и observability | Отказы без понятной причины и безопасного восстановления | Traces/correlation IDs, metrics, load and chaos tests, rollback |
| Коммерческая готовность ниже инфраструктурной | `/ready` успешен, но клиентский путь не работает | Browser E2E от регистрации до подтверждённого звонка и истории |

**Принцип:** не переписывать всё с нуля; усиливать наиболее рискованные вертикальные пути и подтверждать каждый тестами и фактом эксплуатации. Для подтверждения качества сначала критические корректность/безопасность, затем удобство и масштабирование.

## 2. Карта окружений, хостов и DNS

Все следующие имена и ID — **инвентаризация ранее подтверждённой инфраструктуры**, не живой мониторинг.

| Компонент | Домен/адрес | Где размещён, что проверено |
| --- | --- | --- |
| Клиентский Web | `https://platform.sashatel.ru` | Vercel, проект `sashatel`. На 21.11.2026 UI Vercel показал `Valid Configuration`, Production domain; полноценный Web onboarding не подтверждён |
| Legacy Web | `https://sashatel.vercel.app` | Vercel Production, сохранён как дополнительный домен; ранее был старый HTML |
| Backend публичный | `https://api.sashatel.ru` | Cloudflare Tunnel → `http://127.0.0.1:8080` на YC VM. `/ready` ранее отвечал HTTP 200 |
| Backend VM | `51.250.73.145` (**динамический**) / `10.128.0.32` | Yandex Cloud VM `sashatel-staging-api-1`, ID `fhmrp237c2cf2o6a13et`; IP может смениться |
| PostgreSQL | `rc1a-9ipemveejfvapbam.mdb.yandexcloud.net:6432` / private `10.128.0.6` | Yandex Managed PostgreSQL 17; кластер `c9q4m71biboeon47tm3i`, база `sashatel` |
| PBX / Asterisk lab | `129.101.102.107` | Timeweb, `sashatel-asterisk-01`, Asterisk 22.12.0; прежний UIS registration `Registered` ≠ PSTN ready |
| YC folder | `sashatel-staging` | Folder ID `b1gi9a6fgkr55k6csn9s` |
| Yandex VM SG | `sashatel-staging-api` | SG ID `enpjltubkf25scmu60jn`; ранее inbound 80/443, restricted SSH/22; проверить и закрыть лишнее через Tunnel |
| Cloudflare Tunnel | `sashatel-staging-api` | ID `fccac12d-95b8-4071-ae45-7916949f44f8`; ранее healthy connector; token перевыпущен по сообщению владельца |
| YC container registry image | digest `sha256:fc298ec73e651c8862edd15ed9902a3380aef95c15171c1e56bbc4e7d155fd91` | Исторически запущенный образ `cr.yandex/crpjs1v75pobqqd0ij5t/sashatel-backend`; **не** новый исходник Auth |

**DNS/SSL цепочка (по ранее подтверждённой конфигурации):**
- Регистратор домена `sashatel.ru`: REG.RU. Авторитативные NS Cloudflare: `courtney.ns.cloudflare.com` и `zod.ns.cloudflare.com`.
- `platform.sashatel.ru`: **CNAME** `platform` → `28d9a9da4d0fa75a.vercel-dns-017.com`, **DNS only / proxy off**, TTL Auto. Состояние Vercel `Valid Configuration` подтверждено скриншотом.
- `api.sashatel.ru`: Cloudflare DNS **Tunnel** record, маршрутизация remote-managed Tunnel `sashatel-staging-api` → `http://127.0.0.1:8080` на VM. Не создавать дублирующий CNAME.
- `sashatel.ru` apex пока **не обязан** обслуживать лендинг: лендинг поставлен на паузу.
- Старый Caddy/ACME для `51-250-73-145.sslip.io` был неработающим временным подходом; теперь Cloudflare Tunnel. Не использовать старую схему как источник рабочего HTTPS.
- В прошлом наблюдалась неравномерная DNS-пропагация через резолверы; не диагностировать отсутствие Backend только по одному локальному `dig`.

**Безопасность / эксплуатационные долги:** проверить обновлённый token tunnel и системную службу без вывода секрета; восстановить альтернативный административный доступ вместо временного serial-console пароля; удалить пароль из metadata cloud-init после этого; сузить inbound SG, проверить runtime ACL; не публиковать PostgreSQL, ARI, SIP credentials. Секреты — файлы на VM вне GitHub (исторически `/etc/sashatel/staging/`); не переносить их в документацию.

## 3. Куда смотреть в коде

- [Backend entrypoint](../../backend/server.ts): сборка приложения, зависимости, `/ready`, mail polling, feature flags.
- [Auth domain](../../backend/web-auth.ts): регистрация, OTP, session cookies, организация, `deliverOne()`.
- [Email provider](../../backend/resend-mail.ts): интеграция Resend; **пока без классификации HTTP-ошибок**.
- [Mail/DaData ports](../../backend/web-ports.ts): исторический `EmailSink` и DaData adapter; `EmailSink` исключён из runtime-пути через `server.ts`, физически файл ещё существует.
- [HTTP routing](../../backend/http.ts), [Web HTTP](../../backend/web-http.ts): маршруты/Origin/CSRF/cookie wiring.
- [Control plane](../../backend/control.ts), [trunks](../../backend/trunks.ts), [global carousel](../../backend/global-carousel.ts), [ARI client](../../backend/ari-client.ts): бизнес-инварианты телефонии.
- [Baseline auth schema](../../backend/migrations/004-web.sql), [mail lease migration](../../backend/migrations/007-mail-lease.sql), [migration runner](../../backend/migrate.ts).
- [Backend tests](../../backend/web-auth.test.ts), [migration tests](../../backend/migration.test.ts), [integration tests](../../backend/integration.test.ts).
- [Dockerfile](../../backend/Dockerfile), [release contract](../../backend/release-contract.md), [backend CI](../../.github/workflows/backend-control-plane.yml), [YC staging image workflow](../../.github/workflows/yc-staging-backend-image.yml).
- Реальный **Web onboarding** развивается в отдельной ветке `feature/web-onboarding-preview`, PR #24; код не присутствует в текущем корне Backend-ветки. Текущая Vercel Production в этой ветке не доказывает готовность Web.

## 4. Актуальный код по состоянию последней проверки

**Ветка:** `feature/web-auth-production-20261121`. Из GitHub проверено наличие:
- `backend/resend-mail.ts`; `server.ts` подключает `ResendMailProvider`, читает `RESEND_API_KEY_FILE`, требует `EMAIL_MODE=resend`.
- `007-mail-lease.sql` + запись в `migrate.ts`, **не применена к staging**.
- `web-auth.ts` **уже содержит** вариант `deliverOne()` с `lease_token`, SQL claim, `this.mail.send()` вне SQL transaction и fencing на finalize. Это **исходник, не подтверждённый тестами**. Есть риски: не проверены runtime permissions/миграции, гонка expiry/replace после claim, lease TTL относительно timeout, классификация permanent/transient 4xx/5xx, корректность обработки терминальных ошибок, отсутствие подтверждения конкретного провайдера.

Известный потенциальный баг именно в новом коде: в SQL claim `WITH candidate ... FOR UPDATE OF j SKIP LOCKED` и join `web_auth.browsers` работают при наличии колонок миграции 007; без неё API job poll будет падать. До релиза миграция обязательна. Отдельно проверить SQL plan, privileges, корректность статусов (terminal vs retryable) и CI с реальным PostgreSQL.

**Не подтверждено:** `npm run typecheck` / `npm test` на этом SHA, реальная SMTP/API-доставка, sender domain SPF/DKIM/DMARC, DaData key, полный клиентский E2E, trunk worker, реальные звонки, billing. Не утверждать, что это готово.

## 5. Архитектурные исправления по приоритетам

**P0 — рабочий регистрационный контур:** валидация Auth и HTTP-контракта, безопасная email-очередь с leased worker, retry/error classification, rate limits, анти-enumeration, Resend sender authentication, secret files, DaData, тесты PostgreSQL/конкуренции; server + Web proxy + browser E2E. Текущая новая очередь не должна попадать в staging, пока P0 тесты не пройдут.

**P1 — телефония как самостоятельная вертикаль:** self-service credentials → encrypted trunk storage → versioned PJSIP provisioning → SIP status → реальный PSTN test call → CDR/ARI event reconciliation → история. Не считать регистрацию UIS готовностью звонков. Для multi-carrier предусмотреть профили возможностей, но **не зашивать UIS как единственный провайдер**.

**P2 — инварианты звонка:** atomic global limit 8/CallerID/Europe-Moscow, transactional reservation/commit/release, правильная обработка concurrent calls; private ARI, idempotent dispatch, crash recovery. Только доказанный human-answer имеет биллинговые минуты.

**P3 — эксплуатация:** health/dependency readiness, central metrics, structured logs, alerts, backup+restore drills, schema+image rollback compatibility, staging→release path, ограничение прав, нагрузки и failover. Multi-PBX развертывать по реальной нагрузке, но доменная модель обязана учитывать его заранее.

**P4 — продуктовая готовность:** Desktop actual calls, запись и защищённый доступ к ней, история, статистика, CRM/webhooks, корректная постоплата; сценарии владельца/сотрудника, безопасность, mobile/Web UX.

## 6. Как обновлять этот документ

- После каждого проверенного инфраструктурного изменения фиксировать **дату, среду, SHA, команду/метод проверки и результат**, без токенов/паролей.
- После нового технического аудита создать отдельный dated-review с методикой и не затирать историческую оценку 46/100.
- Не путать DNS `Valid Configuration`, `/ready` 200, CI green, deployment green, SIP `Registered` и реальный E2E. Это разные уровни.
- Не деплоить feature branch в production без review и gate; не изменять applied migrations по checksum.
