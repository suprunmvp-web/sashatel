# DEPLOY-01a — план, стоимость и приёмка

Срез 18.11.2026, base fff308d7156d52bc3fcecdb024863f0b471679bd из main, связь с [ARCH-01 #23](https://github.com/suprunmvp-web/sashatel/pull/23). Текущая ответственность DevOps — bootstrap, инфраструктура DB-01/EMAIL-01/OPS-01. Прикладные API, финансовый gate и авторизация принадлежат Backend Engineer. Подтверждение направления не разрешает apply, покупку или DNS changes.

## План без циклов

| Шаг | Вход и ответственный | Выход / приёмка |
| --- | --- | --- |
| B0 — account/inventory | Владелец приглашает назначенного инфраструктурного инженера; read-only роли и support request | Реальные cloud/folder IDs, подтверждённые zones/capacity, независимость отказных доменов, quote и reviewer |
| B1 — bootstrap state | DevOps; утверждённый B0 plan и отдельное разрешение на создание state bucket/KMS | Encrypted local state → bucket/versioning/roles → реальная lock-probe → проверка restore state → remote migration. Ни один компонент не считается существующим до проверки |
| B2 — private staging foundation | DevOps; B1, quote и создание по утверждённому плану | VPC, admin route, private VM, PG, buckets, пустые secrets. Облако/доступность ещё проверяются runtime |
| S1 — ранний staging Backend/Web/fixtures | Backend и Web готовят совместимый ранний release, DevOps размещает; B2 и DB credentials/migrations | HTTP auth-скелет, схемы/fixtures, basic health, синтетические email и UIS. Можно начать без MEDIA-01/ответа Timeweb и без полного INTEGRATION-01 |
| D/E/O — DB/Email/Operations | DB infrastructure DevOps + SQL Backend; DNS/email DevOps + auth Backend; OPS DevOps | Pool/RLS restore, sender/domain approval, реальные delivery tests, telemetry/audit. Идут параллельно после B2, не ждут SIP |
| I1 — совместные интеграционные испытания | Tech Lead + Web/Backend/Desktop/Telephony; S1 и готовность конкретных контрактов | Совместимый manifest SHA, global account/verify/organization/trunk jobs и scoped identities; fixtures изолированы. Ошибки исправляются с повторением только затронутых тестов |
| L1 — live SIP/PSTN gate | Владелец отдельно разрешает конкретный network/trunk/call plan после NET/MEDIA/PROVISION готовности | Approved caller/destination, live registration/media/teardown/CDR/recording, без автоматического повторения неизвестного originate |
| R1 — rollout принятой сборки | DevOps; принятый I1, restore/security proof и требуемые L1 gates | Reviewed authenticated production plan, backup, canary, health, release ID, rollback. Early production API rollout возможен с telephony admission false, live функции включаются только после L1 |

DEPLOY-01a заканчивается опубликованным IaC и offline CI. S1 — следующий разрешаемый deploy, ему достаточно согласованного минимального Backend/Web контракта и отдельного fake окружения. Общая сквозная приёмка не является условием начала S1. Полная продуктовая запись/история нужна перед объявлением E2E готовым, а не перед созданием VPC.

## Уточнённая продуктовая граница

Новая организация неверифицирована. Trunk выключен по умолчанию, activation и новые calls требуют verification и актуального Backend разрешения. Кредитный лимит опционален и по умолчанию отсутствует; Backend согласует точную модель отдельно. Финансовая блокировка не закрывает кабинет, документы и оплату и не обрывает текущий разговор. Внутренние роли SashaTel не выводятся из клиентского owner/admin. Серверный аудит — durable источник истины; Telegram получает асинхронную очищенную копию без credential/recording URL/полного номера и не участвует в успешности операции. Web/Desktop без частиц.

Приняты адреса sashatel.ru (лендинг), platform.sashatel.ru (Web/API того же origin), platform.sashatel.ru/admin/ (внутренняя админка), platform.sashatel.ru/{organization_uuid}/ (организация). UUID проверяется как route parameter, каждую операцию авторизует серверная сессия и membership. Предлагаемые media адреса — media-01.sashatel.ru и media-02.sashatel.ru, TURN — turn-01.sashatel.ru и turn-02.sashatel.ru, staging — staging.platform.sashatel.ru. Эти DNS имена пока не создавались.

## Почему отдельные VM и что даёт каждая реплика

| Пара / ресурс | Функция и физическая граница | Failover / fencing | Остаточный риск и доказательство |
| --- | --- | --- | --- |
| app 2×2/4 production | API/Web stateless, резерв к потере одного процесса/host/AZ, 8080 только от ALB | ALB health снимает отказавший target; session/replay в БД, клиент reconnect | Общая БД/ALB/region. Убить VM, проверить чужой tenant deny и отсутствие повторного POST. При пике один target должен выдерживать 100% admission load |
| jobs 2×2/4 | Роль содержит email/Dadata/service access и фоновые CPU задачи, отделена от public API blast radius. Разные процессы на app VM возможны, но root app тогда раскрывает jobs secrets и общий host отказ выключает API и очередь сразу | Durable claims/leases и fencing поколений в Backend, один owner операции, дедупликация | Fencing Backend ещё зависит от adapter. Kill/restart worker после send-before-ack, verify no duplicate email/call, lag alarm. Нет основания выдавать наличие двух VM за exactly-once |
| PBX 2×4/8, отдельный этап | Asterisk имеет SIP secrets, real-time RTP, privileged локальный provisioner; физически отделить от API/jobs | Ownership по trunk, запрет новых calls на draining node, внешний fence старого узла до передачи trunk/egress/registration | Активный вызов падает с узлом; UIS может запретить concurrent registration. Тест isolate old node, проверить новый owner epoch и отсутствие dual originate; аудио не «спасается» |
| TURN 2×2/4, отдельный этап | Public relay с bandwidth/abuse risk и публичным IP, отделён от PBX CPU и socket exhaustion | Выдать оба ICE servers, новые allocations выбирают доступный; authenticated quota и short credentials | Уже созданная allocation на погибшем TURN теряется, ICE restart не гарантирует продолжения. Kill TURN и проверить честный сбой/новый call через второй, relay abuse deny |
| DB третий host 2/8 | Третья независимая AZ уменьшает риск потери quorum/доступности при одном сбое и обслуживании, остаётся managed topology | Sync replica/auto-master service, app reconnect и идемпотентные transactions | Потеря региона, lag и обслуживание. Service-supported failover, потеря replica и PITR drill с marker, сверка фактического patch и replication state |
| Managed NAT/ALB | Убирают ручной single gateway/server с публичного HTTP ingress | Управляемая platform реализация, минимум ALB 2 units/AZ | SLA/ёмкость/zone placement проверить support и runtime, нельзя выводить HA NAT из слова managed |

В S1 используется 1 app +1 jobs +1 DB в отдельном staging folder. Его отказоустойчивость намеренно не заявлена. Это среда разработки, а не перенесённый в production single node. Production foundation задаёт 2 app/2 jobs/3 DB. Секции PBX/TURN не создаются данным IaC и требуют самостоятельного reviewed manifest. Разделение Linux пользователей защищает от ошибок приложения, но не от root host компрометации, поэтому физическое разделение jobs/API здесь имеет функцию безопасности.

## Стоимость и квоты

Базовая арифметика из проверенного 17–18.11 официального прайса, 720h, рубли с НДС, без скидок. CPU/RAM VM standard-v3 100% — 1,24/0,33 ₽ за час единицы; DB — 1,8792/0,5072, DB network SSD — 0,0218 ₽/GiB-hour; VM triple-replicated SSD — 0,0332; ALB unit — 2,63 ₽/h. Staging VM boot30GiB, DB100GiB.

| Состав | Известная база / месяц |
| --- | ---: |
| Staging foundation app/jobs2×2/4 + DB1×2/8/100 + VM boot60GiB, edge off | 14 103,36 ₽ |
| Staging с 1-AZ ALB (2 units), после сертификата | +3 787,20 ₽, итого 17 890,56 ₽ |
| Production foundation app/jobs4×2/4 + DB3×2/8/100 + VM boot120GiB | 35 403,84 ₽ |
| Production edge 2 AZ×2 ALB units | +7 574,40 ₽, итого 42 978,24 ₽ |
| Позднее 2 PBX4/8 +2 TURN2/4 +boot120GiB+spool200GiB | +24 065,28 ₽, всего production 67 043,52 ₽ |
| Production full + ранний staging с edge | **84 934,08 ₽** |

При отсутствии existing private admin access один опциональный bastion2vCPU/2GiB/20GiB добавляет2738,88₽/месяц плюс IP. Отдельный staging и production bastion добавляют5477,76₽/месяц к сумме84934,08₽. Это operational access endpoint с /32 SSH и без app/data credentials. Его отказ блокирует только обслуживание, recovery доступен через cloud control plane/console; тест — отключить bastion и восстановить управление через console без остановки приложения.

Это сумма измеримых фиксированных ресурсов, не полная цена услуги. Расчёт staging один DB: 2×720×(2×1,24+4×0,33)+720×(2×1,8792+8×0,5072+100×0,0218)+60×720×0,0332. Не включён запуск PBX в staging — isolated fixtures в CI уже есть; runtime staging media отдельное изменение/quote.

Переменные/дополнительные расходы — state bucket и backup versions, KMS/Lockbox payload versions/GET, 300GiB записей pilot и API playback egress, NAT/active и reserved IP, provider RTP/TURN bandwidth, Postbox принятые письма, audit/metrics/registry, snapshot/WAL сверх включённого, независимые копии и support. На стадии ARCH-01 для полного pilot было зарезервировано 108–128 тыс. ₽/месяц со staging. Уточнение до точного quote зависит от account SKUs, активных IP, backup retention/объёмов и service quota. Эту вилку не выдавать за коммерческую оферту. Нет экономии надёжности через прерываемые VM.

Для запроса capacity production full + early staging + одно DB restore и replacement PBX нужен минимум — Compute **32 vCPU /60GiB** (20/40 prod +4/8 stage +4/8 spare; два bastion добавляют4vCPU/4GiB до32/60), MDB **14 vCPU /56GiB**, **7 DB hosts** (3+1+3 restore), VM disk **670GiB** (440prod+60stage+130spare+40 для двух опциональных bastion), DB disk **700GiB**, до 10 public static IP как верхняя начальная квота, ALB минимум6/максимум12 units суммарно prod/stage. Объём backup storage/restore disk добавляется отдельно. Разнести capacity по подтверждённым AZ так, чтобы потеря одной оставляла резерв для запуска, не только глобальную quota. Удобный safe request — 32 Compute vCPU/64GiB и 16 MDB vCPU/64GiB с указанным распределением; это quota, не покупка или заявленная физическая бронь.

Источники ставок — [Compute таблица](https://raw.githubusercontent.com/yandex-cloud/docs/master/md-docs/compute/pricing.md), [MDB](https://github.com/yandex-cloud/docs/blob/master/md-docs/managed-postgresql/pricing.md), [ALB](https://yandex.cloud/ru/docs/application-load-balancer/pricing). Финальный quote фиксирует ID sku/platform/disk type, часы, НДС, units, region/AZ и стоимость idle reserved IP, без вывода секретов.

## Матрица проверки

| Уровень | Выполнено / требуется | Что это доказывает |
| --- | --- | --- |
| Локально / offline CI | Terraform fmt, init -backend=false, schema validate на 0.244.0, mock plans/assertions, checksums Linux/macOS | Корректность HCL и заявленных инвариантов. Нет настоящего cloud plan |
| Authenticated inventory/plan | Реальные zone/image/preset/capacity/IAM, encryption service permissions, static IP/ALB, backend state/lock, price export | Сопоставление конфигурации аккаунту и планируемые изменения. Не доказывает успешное создание |
| После создания | Cloud routing/ACL, DB TLS/RLS через pool, live LB health, failover/recovery, secret IAM, запись/egress/restore | Runtime готовность конкретного environment и SHA |
| Отдельный live gate | UIS/provider reachability, authorised call/media/teardown/CDR | Доступность SIP/PSTN в согласованной конфигурации |

## Restore / security acceptance

| Тест | Условие PASS / владелец |
| --- | --- |
| RLS через настоящий managed pool | Backend создаёт fixtures A/B, чередует concurrent transactions одним runtime pool, проверяет SELECT/INSERT/UPDATE и FK. После exception/rollback/cancel следующий checkout не наследует tenant. Runtime не owner/superuser/BYPASSRLS, migrator отдельный. DevOps предоставляет TLS/private6432 и pool mode, Backend SQL/grants |
| Потеря app | Остановить один approved staging target, ALB исключил, сессия/revoke не потеряны, reconnect не redial. DevOps + Backend |
| Потеря DB primary / replica | Поддерживаемый service failover, marker до отказа доступен, pool reconnect, расходы/ledger без дубля, write admission закрыт при uncertainty. DevOps + Backend |
| PITR | Восстановить в **новый** cluster/folder с запретом egress SIP/email. До старта jobs поставить recovery epoch и tombstone/dispatch quarantine для всех старых originate. Сверить provider/CEL/ledger; никакой job replay до подтверждения. Сделать marker tests RPO/RTO и скрин/лог evidence, затем test два tenant |
| PBX loss | Изолированный fixture, активный разговор может оборваться; old owner внешне fenced, неизвестный originate не повторяется, orphan legs проверены и завершаются. Telephony + Backend |
| S3 unavailable / full spool | Retry/checksum/idempotent upload, private staging и partial recording status, admission согласно Backend политике, не потерять acknowledged object. Telephony + DevOps |
| Keys recovery | Отдельный recovery admin + независимое хранилище ключей/manifest. Проверить расшифровку restore ciphertext при доступном KEK и контролируемый отказ при отозванном ключе. Scheduled KMS deletion запрещён до проверки retained backups |
| Secret removal | Подтверждённый purge всех worker bundles + runtime unregister/disable, Backend ciphertext удаляется по утверждённому REMOVE receipt, секретов нет в stdout/artifacts/audit/Telegram |
| Public isolation | Из внешней сети DB6432/5432, ARI8088/8089 и AMI5038 недоступны, только HTTPS edge и утверждённые media порты будущего этапа. Из private API нет прямой команды PSTN |
| Tenant/admin/audit | UUID и /admin/ не дают прав, foreign tenant route/recording denied, внутренние роли separate, durable audit survives Telegram outage |
| State restore/lock | Реальная concurrent lock contention, interrupted lock recovery, восстановление bucket version/lineage, no runtime SA access to state |

Рекомендованные RTO/RPO из #23 остаются проектными целями до измерения. KMS HA не является независимым ключевым backup. План локальной off-provider logical copy и записей должен включать export key management и проверку restore за пределами YC. Ни одна автоматизация фонового выполнения не создаётся этим PR.
