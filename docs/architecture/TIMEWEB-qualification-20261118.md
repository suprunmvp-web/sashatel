# Timeweb qualification — staging Web/Auth/PostgreSQL

Дата проверки: 18.11.2026. Дополнение к ARCH-01 / #23. YC IaC в #25 сохраняется без переноса и без apply. Это квалификация и предложение, не разрешение создавать ресурсы.

## Вывод: Б

Timeweb подходит только для изолированного staging с синтетическими данными, без production HA/SLO/PITR обещаний. Переход к созданию заблокирован до review этого вывода, проверки private PostgreSQL + TLS и выбора доказуемо блокируемого state backend. Production на Timeweb пока не квалифицирован: неизвестны физические домены реплик, текущие sync/async гарантии, RPO подтверждённых транзакций и PITR/WAL. Реплики и snapshot не заменяют этих гарантий. Если приватный TLS или необходимые SQL grants недоступны — managed PostgreSQL не принимать даже для этого staging; вернуться к YC/Selectel, не открывать БД в интернет ради удобства.

## Фактически проверено

Authenticated read-only просмотр панели существующего аккаунта: один сервер SashaTel Asterisk 01, 2 CPU/4 GiB/40 GB; список DBaaS пуст, список S3 пуст. Просмотрены формы расчёта DB/VM/S3, кнопки «Заказать» не нажимались. API-token не выпускался; Terraform plan, SQL и runtime тесты не выполнялись. Инвентарь относится к видимому аккаунту, не доказывает квоты или наличие capacity. Секреты и платёжные данные не сохранялись в документ. VPS, DNS и сеть не менялись.

В MSK-1 панель показывает Premium/High CPU/Dedicated CPU как предзаказ; Ultra доступен для выбора. S3 Premium распродан, Standard предлагается в Санкт-Петербурге. Доступность выбора не равна резервированию capacity.

## Матрица доказательств

Все ссылки — официальные; прочитаны 18.11.2026. Дата чтения не является датой обновления страницы. Где дата публикации не указана, свежесть SLA требует ответа поддержки.

| Требование | Подтверждение | Ограничение | Проверка/приёмка |
|---|---|---|---|
| Поддерживаемый PG | [каталог](https://timeweb.cloud/services/postgresql), панель предлагает PG18; PG17 указан в каталоге | Нужен точный minor и policy обновлений; выбираем PG17 только после подтверждения доступности | inventory preset/version; Backend запускает миграции и CI на том же major |
| Runtime/migration roles | [пользователи](https://timeweb.cloud/docs/dbaas/postgresql/users-and-privileges), [роли SQL](https://timeweb.cloud/docs/dbaas/postgresql/roles) | Минимальный 1CPU/1GB/8GB не позволяет новых пользователей; default grants широкие | Не использовать минимум/gen_user в API; проверить pg_roles, memberships, ownership, default privileges |
| FORCE RLS | Обычный механизм PostgreSQL; SQL roles документированы | Выполнение миграций и effective bypass на Timeweb не проверены | Backend: runtime NOSUPERUSER/NOBYPASSRLS, не owner, не может SET ROLE migration; relrowsecurity/relforcerowsecurity; A/B tenant isolation через настоящий pool |
| Авто failover | Панель обещает автоматическое продолжение при сбое master, варианты master+2/+4 replicas | Адрес writer, DNS TTL, fencing, RTO, поведение соединений неизвестны | Поддержка + испытание потери primary с уникальными committed markers; reconnect pool без слепого повтора write |
| Async/sync и RPO | [официальный ответ в DBaaS](https://timeweb.cloud/docs/dbaas) от 11.12.2024 описывает async Patroni/etcd | Исторический ответ, не текущая гарантия. RPO=0 не доказан | Запрос актуального режима, lag metrics, synchronous_commit и поведения при потере реплик |
| Multi-AZ | В панели выбирается одна локация | Разные VM не доказывают разные стойки/DC/AZ | Письменные домены питания/сети/storage и failure test; до этого production HA не принято |
| PITR/WAL | [физические копии](https://timeweb.cloud/docs/dbaas/dbaas-manage/backup) — snapshots с расписанием и количеством; qcow2 export для новых кластеров | Не подтверждены recovery target timestamp/LSN, WAL archive/lag, PITR window | Не называть PITR. Запросить точность/retention/restore SLA; restore к метке между snapshots |
| Restore отдельно | [логический dump/import](https://timeweb.cloud/docs/dbaas/dbaas-manage/logical-backups) | Physical clone в новый кластер не подтверждён | Новый изолированный PG + logical restore; отдельная квота; исходную БД не перезаписывать |
| Private DB/TLS | [подключение](https://timeweb.cloud/docs/dbaas/postgresql/connect-to-database): private IP и TLS по домену | Инструкция включения TLS требует public IP; совместимость private-only verify-full неизвестна | Обязательный pre-create ответ поддержки; после создания TLS hostname validation, CA, private route, negative public scan |
| VPC/NAT | [добавление сервисов](https://timeweb.cloud/docs/vpc/managing-bgp-networks/adding-services-to-bgp), [NAT](https://timeweb.cloud/docs/vpc/nat) | Нет доказательства per-service ACL для выбранной DB сети | Явные маршруты, firewall + DB allowlist где доступна; внешний 5432 закрыт |
| LB/WS | [LB](https://timeweb.cloud/docs/load-balancer) поддерживает TCP/HTTPS/TCP+TLS | WS upgrade/idle timeout и отказоустойчивость LB не доказаны | Staging: reverse proxy на app VM; wss upgrade, ping, reconnect, drain тест. Production LB — отдельно |
| Private S3/scoped keys | [доп. пользователи](https://timeweb.cloud/docs/s3-storage/manage-storage/additional-users) — права по бакетам | Prefix/Put-only/запрет Delete и KMS semantics не подтверждены; private ACL не означает private network endpoint | Разные buckets/keys, anonymous GET denied, cross-bucket denied; API выдаёт короткие signed URLs после tenant auth |
| Versioning/lifecycle | [lifecycle](https://timeweb.cloud/docs/s3-storage/supported-features/object-lifecycle) включает noncurrent versions и multipart cleanup | Versioning не immutable backup; админ может удалить версии | Перезаписать fixture, вернуть старую версию, проверить TTL URL и noncurrent retention |
| IAM/secrets | [API tokens](https://timeweb.cloud/docs/account-management/token): expiry, service restrictions, secret masking; [официальный MCP](https://timeweb.cloud/docs/timeweb-cloud-mcp) | Нет подтверждения read-only verbs/resource-level scope/federation/managed secret manager; project не считать security boundary | Не выдавать account-wide write. Owner-run inventory предпочтителен до доказательства scope; secret injection отдельно |
| Terraform/API | [провайдер](https://github.com/timeweb-cloud/terraform-provider-timeweb-cloud/tree/main/docs/resources): VM/VPC/DB/users/backups/LB/S3/firewall | Ресурсы существуют, но покрытие каждого нужного поля/операции не доказано; секреты могут попадать в state | Зафиксировать release+checksum после review; provider schema tests, plan JSON allowlist только новых staging IDs |
| State locking | [инструкция](https://timeweb.cloud/docs/terraform/zagruzka-sostoyanij-v-object-storage) прямо предупреждает про Terraform >=1.6 | S3 storage не доказывает conditional writes/locking. #25 Terraform1.11.4 сюда не переносить вслепую | Два конкурентных клиента на отдельном test key; один lock, второй timeout, stale lock/recovery; не apply. Не downgrade ради старого примера |

## Конкретный staging, предлагается на review

Новый отдельный project sashatel-staging, отдельная сеть MSK-1, без связи с Asterisk/VPN/production. Только синтетические организации, email и файловые fixtures; максимум 20 одновременных тестовых HTTP сессий как начальная гипотеза, не benchmark.

- Одна новая app VM Ultra 2vCPU/4GiB/50GB, Ubuntu24.04 (проверить доступность образа), Node24 в immutable OCI image. Web/API, лёгкий onboarding jobs worker и email sink — отдельные non-root процессы/контейнеры, лимиты CPU/RAM, отдельные credentials, без docker socket. Одна VM допустима именно для staging: отказ останавливает Web и jobs, автоматического failover нет. DB вынесена отдельно; не размещать здесь медиа или runner недоверенных PR. При росте RSS/очереди jobs выносится без смены DB/API контрактов.
- Отдельный managed PostgreSQL17, один host 2vCPU/4GiB/40GB, без реплик и public IP. Это сознательно не HA. Предлагаемые staging RPO <=24h/RTO <=4h проверяются restore drill, не являются SLA провайдера.
- S3 Standard SPB: fixtures100GB, db-backup10GB, state10GB только если locking доказан. Все private, разные credentials; versioning, lifecycle старых fixture versions30d, незавершённых multipart1d, backup retention7 daily +4 weekly. State никогда не удалять lifecycle автоматически.
- HTTPS reverse proxy на app: один public IPv4, 443 только IP тестировщиков; 22 только IP владельца/деплой-оператора, password/root login disabled. Внутренние API/jobs/sink не публиковать. 5432 только private app/migration source; нет ARI/SIP/RTP/TURN.
- Для браузерного Auth нужен доверенный сертификат. Предложение hostname staging.platform.sashatel.ru, не утверждён и DNS сейчас не меняется. До отдельного DNS/ACME разрешения — временная запись hosts на машинах тестировщиков + локально доверенный CA, HTTPS без обхода проверки сертификата. Такой путь не доказывает публичную доступность или доставку почты. Sink показывает код только тестировщику; пользовательское письмо не отправляется.
- Secrets: до появления проверенного secret manager — owner-controlled encrypted secret bundle, отдельный decryption key вне VM и state; доставлять только в systemd credentials/tmpfs с отдельными UID, не в cloud-init/env Git/CI logs. Это staging механизм с ручным unlock после rebuild, не заявлять автоматический production recovery. Off-provider encrypted backup и независимая копия ключей обязательны; место/стоимость согласовать до хранения.
- Никаких call originate consumers: fake ARI / synthetic events только; live adapter и UIS secrets отсутствуют. Восстановленная очередь никогда не становится разрешением PSTN-вызова.

### Стоимость

Authenticated calculator 18.11.2026, MSK Ultra: app2/4/50 = 5280 ₽/мес; DB2/4/40 = 4000 ₽/мес (форма PG18, PG17 quote ещё проверить); IPv4 =200 ₽/мес. S3 Standard:100GB349 ₽ +10GB79 ₽ +10GB79 ₽; egress в форме1.3 ₽/GB. Итого известные позиции **9987 ₽/мес**, если все три buckets тарифицируются отдельно указанными планами. Это subtotal, не полный quote и не гарантия capacity. Если state уйдёт во внешний backend, убрать79 ₽ и добавить его реальную цену.

Сверху: физические DB backups (в форме для20GB120 ₽, для40GB пока не получен quote — не экстраполировать как факт), off-provider backup/secret storage, версии и рост S3, исходящий трафик, временный restore-cluster, возможные NAT/ACL услуги. VM snapshot необязателен для воспроизводимого app. ALB не нужен для одного staging app; production HA требует отдельного расчёта. Временный restore PG той же конфигурации: ориентир 5.46 ₽/час по увиденному тарифу, actual billing проверить перед тестом. Не использовать устаревшие «от790 ₽» как цену этого состава. Полный authenticated saved plan+quote — следующий артефакт после review; сейчас его нет.

Квоты раннего staging:1VM2CPU/4GiB/50GB; DB2CPU/4GiB/40GB плюс резерв второго такого DB для restore;1IPv4;1VPC;3buckets120GB и версии; TLS/HTTPS доступ из РФ. Нужна проверка route MSK↔S3 SPB и latency. Multi-AZ writer capacity, 3–5 DB hosts, пара ALB, PBX/TURN UDP, SIP carrier routing и failover capacity — production/media review; ранний Web/Auth их не ждёт.

## Безцикловой порядок и владельцы

1. Владелец review вывода Б; отправляет запрос поддержке ниже. Инфраструктура параллельно готовит mapping полей провайдера; Backend/UI продолжают локальные контракты.
2. Read-only inventory/presets/quota + точные PG17/image/privateTLS параметры. Owner проверяет scope, не выпускает широкий write token агенту.
3. Отдельный маленький bootstrap plan: только state/locking, без VM/DB. Пока backend не выбран/создан — локальный encrypted state у одного оператора, без shared apply. Для team automation нужен проверенный S3 conditional locking либо внешний backend с lock, согласованным размещением state и quote. GitHub concurrency само по себе не защищает от owner CLI.
4. После отдельного разрешения bootstrap create и lock drill; это будущие действия, не выполнены. Миграция state с backup/serial/lineage проверкой.
5. Новый staging IaC PR после review; pin Terraform/provider/image digest, offline CI и authenticated saved plan с deny любых изменений existing IDs. Никаких imports Asterisk. Отдельное разрешение на apply этого plan.
6. Infra создаёт только принятые новые ресурсы; Backend выполняет reviewed migration entrypoint отдельной ролью; запускает Web/API/jobs с fake adapter и sink.
7. Совместные acceptance/restore; затем отдельный review public staging DNS/email. Live SIP/PSTN разрешается независимо и позже.

Backend владеет migration entrypoint, grants/schema/RLS, health/readiness semantics, финансовым gate, идемпотентностью и restore queue policy. Предлагаемый delivery: GHCR private OCI digest, scoped read:packages pull на VM, CI push только repo image, migration одноразовым контейнером того же digest с отдельным credential, не на startup каждого API. Конкретные команды и endpoints ещё должны быть подтверждены Backend #14; этот документ не объявляет согласование. Required readiness: DB доступна, schema совместима, fake/live mode явно отражён; liveness не провоцирует restart из-за краткого DB сбоя. Rollback app только на совместимый digest; expand/contract migrations, destructive down не выполнять.

## Доступ без вымышленной личной учётки агента

Существующая browser session уже позволила inventory/quote; для этого новый токен не нужен. Следующий минимальный маршрут — владелец выполняет проверенные GET inventory/quotas/presets команды у себя, передаёт только очищенные ID/version/capacity/price результаты. Пароли/userdata/keys/connection strings исключить из выгрузки. Не выгружать все API ответы.

Альтернатива, если UI прав это действительно позволяет: владелец выпускает time-limited inventory token (например24h), только read/list нужных staging сервисов/presets, скрытие секретов ON, deletion bypass OFF, без DNS/billing/API-key/user management и без Asterisk resource. Если есть только service-wide write — такой токен агенту не предоставлять; owner-run остаётся безопасным вариантом. Документация не доказывает существование требуемого read-only/resource scope.

Для MCP владелец может сам добавить официальный endpoint https://api.timeweb.cloud/api/v1/mcp/search с bearer_token_env_var TIMEWEB_CLOUD_TOKEN в защищённое окружение Codex; token не вставлять в чат, argv, Git или логи. Инструмент сейчас не подключён. До подключения проверить реальные права: MCP confirmation не заменяет IAM. Не нужен новый YC аккаунт или приглашение несуществующего инженера. Будущий deploy account на VM: только pull одобренного image и фиксированный systemd restart helper; нет unrestricted sudo, DB migration secret или provider token в app.

## Acceptance после отдельного разрешения создания

- SQL: migration owner и runtime разные; runtime не superuser/bypass/DDL/role escalation. Через настоящий Node pool чередовать tenantsA/B, reuse connection после error/rollback, без tenant context fail-closed. Проверить FORCE RLS и недоступность чужих файлов/истории.
- Private/TLS: внешний5432/ARI/sink закрыт; pg_stat_ssl и verify-full, неверный CA/hostname rejected; трасса к private IP; доступ только из разрешённой сети.
- HTTPS/WS: TLS trusted, cookie Secure/HttpOnly/SameSite, origin/CORS, upgrade101, ping/reconnect и restart app; миграции не параллелятся.
- Backup: метки и checksums, daily physical плюс encrypted logical export с alert при пропуске; новый isolated DB restore, проверка schema/row counts/RLS; замер RPO/RTO. Restore credentials отдельно восстановить из independent escrow, старые скомпрометированные отозвать.
- S3: anonymous/cross-org/cross-bucket denied; expired URL denied; version restore; outage не публикует объект/не теряет job, bounded retry и durable error.
- Потеря app/DB: очередь сохраняется; не повторять неидемпотентный write после unknown result. После restore все call intents старой эпохи quarantine/cancel, никакой originate; Backend задаёт recovery epoch. PBX отсутствует, его failure test в MEDIA отдельно.
- Rollback: остановить jobs, вернуть предыдущий совместимый digest, readiness+Auth test; если схема несовместима — forward fix или restore в НОВЫЙ DB с review потери новых записей, не слепой down.
- Cleanup: по отдельному разрешению остановить новые сервисы, export evidence/backup, удалить только manifest IDs нового project; state/ключи/backup последними после проверки retention. Asterisk/existing domains никогда не входят в manifest.

## Готовый запрос поддержке Timeweb (не отправлен)

Здравствуйте! Квалифицируем Timeweb Cloud для SaaS SashaTel. Сейчас нужен изолированный staging без клиентских данных; позже отдельно — production. Просим ответить по пунктам со ссылками на действующие гарантии.

Для раннего staging:
1. Доступен ли PG17 (точный minor/EOL/обновления)2vCPU/4GB/40GB в MSK-1? Каковы реальные квоты и capacity для одного кластера и второго временного restore-кластера? В панели часть VM классов — предзаказ: подтвердите Ultra2/4/50 и Ubuntu24.04, сроки выдачи.
2. Можно ли иметь PG без публичного IPv4/IPv6, подключаться по private IP с TLS verify-full и CA/корректным hostname? Документация TLS требует public IP: нужен точный поддержанный способ без публичного5432.
3. Доступны ли SQL CREATE ROLE, NOSUPERUSER/NOBYPASSRLS, отдельный owner/migration/runtime, FORCE ROW LEVEL SECURITY, schema/default grants? Какие provider-managed роли/ограничения мешают этой модели?
4. Как восстановить физический backup в ОТДЕЛЬНЫЙ новый кластер, не изменяя исходный? Какие квоты/цена/retention/экспорт и ограничения? Что гарантируется для consistency snapshot?
5. Поддерживает ли S3 Terraform1.11.4 backend с conditional PutObject If-None-Match:* и атомарным .tflock? Документация говорит >=1.6 не поддерживается. Есть ли актуальная инструкция/поддерживаемый backend locking? Каковы consistency/versioning semantics?
6. Можно ли выдавать API токен read/list only и ограничивать конкретным project/resource, исключив существующий VPS, DNS, billing и key management? Есть ли federation/short-lived credentials/managed secret store и audit?
7. Подтвердите quote VM2/4/50+IPv4, PG2/4/40+daily backups7copies, private network/NAT, S3 Standard100+10+10GB с versioning/egress. S3 в SPB, appDB вMSK: какие private endpoints, маршруты, шифрование/тарифы межлокационного трафика?

Отдельно для production, не блокируя ответ про staging:
8. Текущая репликация PG async или sync? Возможна ли потеря подтверждённых COMMIT при failover/partition? Каковы RPO/RTO, lag metrics, split-brain fencing, поведение при недоступных replicas?
9. В каких физических доменах питания/сети/storage размещены master/реплики? Можно ли распределять их между DC/AZ, выбирать размещение и иметь гарантированную failover/restore capacity?
10. Стабильный writer endpoint при failover: DNS/IP/TTL, reconnect, TLS hostname, read-only period? Как согласовать failover drill?
11. Есть ли настоящий PITR по времени/LSN между snapshots: точность, окно retention, WAL lag/monitoring, отдельный target cluster и гарантии при потере primary/DC? Если нет — просим прямо подтвердить.
12. LB: WS upgrade/idle timeout/drain, fault domains самого LB, private targets, healthchecks, static IP failover; какие гарантии доступны?
13. S3: bucket/prefix/action-scoped keys, запрет Delete, immutable retention/Object Lock, SSE/KMS/key recovery и домены реплик? Для телефонии позже: UDP SIP/RTP ограничения и доступность static IP; текущую диагностику существующего UIS VPS не смешивать с этим запросом.

## Решения и внешние блокеры

Принято пользователем: изоляция организаций, PostgreSQL, отсутствие production/PBX/DNS изменений, отсутствие client VPN, Web/Auth параллельно media. Предложено: вариантБ, один app/jobs staging узел, PGsinglehost, private S3, fake/sink, scope-safe owner-run доступ. Требует owner review: staging состав/допустимые RPO/RTO, временный HTTPS путь, независимое хранилище backup/ключей, будущий budget/apply. Требует проверки: privateTLS/grants, PG17 quote, capacity, locking/backend и Backend release contract.

YC/Selectel остаются альтернативой. Если Timeweb не даёт обязательные privateTLS/RLS/scoped operational controls — не переносить staging. Если HA/PITR/failure domains не подтверждаются — не переносить production, даже если staging успешен. Ни validate, ни зелёный mock CI #25 не считаются cloud/runtime доказательством.
