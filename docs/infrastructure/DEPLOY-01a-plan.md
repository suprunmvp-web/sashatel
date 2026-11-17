# DEPLOY-01a — bootstrap и ранний staging (актуальный план)

18.11.2026. Решение владельца: YC выбран, Timeweb остаётся резервом; порт IaC остановлен. #25, base main fff308d7156d52bc3fcecdb024863f0b471679bd. Production HA, PBX/TURN, live calls и полный мониторинг вне этого этапа. Ничего ниже не является разрешением apply/DNS. Прежние production оценки не являются staging заказом.

## 1. Authenticated inventory, выполнено read-only в панели

Cloud cloud-chinook-677: **b1g4eft3gb4r2ag0s57v**.
Ресурсные каталоги:
- sashatel-admin: **b1gga2v07q1av7123dp0** (bootstrap).
- sashatel-staging: **b1gi9a6fgkr55k6csn9s** (ранний deploy).
- sashatel-production: **b1gou85cm06pvufkk3oe** (запрещён для данного plan).

Production: сеть default **enph699olhqado0tvo9e**, описание Auto-created network, создана18.11.2026 02:14 (время как отображено панелью). Журнал VPC содержит Create default network (operation enps5l0jcdghph27l6g4), Create network (enpnepode9g4emid3d0h), затем пять Create subnet в ту же минуту, субъект — учётная запись владельца. Это подтверждает автоматическую default-сеть, а не deployment из #25; точный исходный UI checkbox журнал не устанавливает.

| Подсеть | ID | CIDR |
| --- | --- | --- |
| default-ru-central1-a | e9b52mpdtv3pk5rk2lvm | 10.128.0.0/24 |
| default-ru-central1-b | e2l8880pfgeuno3h8f3r | 10.129.0.0/24 |
| default-ru-central1-d | fl8ui3pkfu011btmpt0g | 10.130.0.0/24 |
| default-ru-central1-e | ajckqb3mn59cva3cpqba | 10.131.0.0/24 |
| default-ru-central1-f | b1l7f13r50iu4a0atv1j | 10.132.0.0/24 |

Default SG **enptvhvs1m5djr45ce55**: ingress ANY0.0.0.0/0, egress ANY0.0.0.0/0; вкладка привязок сообщает «не назначена ни на один ресурс». Не исправляли/не удаляли. Не использовать её для staging.

В staging тоже уже есть default VPC **enpthm9vaqno3a8ogprk**, SG **enpvu58hp9c0qk5ktjmn**, auto-created18.11 02:08; dashboard показывает5подсетей и3каталога данных MetaData Hub. Они не импортируются и не удаляются. Полный API inventory admin/staging и происхождение MetaData Hub ещё не проверены; не считать каталоги пустыми.

Plan guard scripts/review-plan.py запрещает ссылки на перечисленные production IDs, существующие staging VPC/SG, неверный folder и любые update/delete/replacement. Проверяется весь PRIVATE JSON, включая prior_state. Это дополнительный барьер, не замена IAM: apply identity не получает production permissions, никакого cloud-wide editor. Новая сеть имеет собственное имя sashatel-staging и CIDR10.60.3.0/24, без peering/default resource lookups.

## 2. Подтверждённые квоты и оставшиеся gates

Read-only cloud quota page:
- Compute: instances0/12, CPU всего0/6; d0/2, a0/2, e0/2, b/f не выделены. RAM всего0/64GiB, d0/16GiB. SSD обычный d0/10GiB, всего0/40; **ssdIOM3 quota не выделена**. План app+bastion требует d4CPU/6GiB/50GiB network-ssd-io-m3: нужно увеличить CPU d до4 и ssdIOM3 d до50GiB (предлагаемый запас60GiB). Общий CPU6 достаточен; не просить production32CPU.
- MDB: clusters0/16, CPU0/2, memory0/16GiB, SSD0/4096GiB. Один PG2/8/100 помещается; одновременный restore ещё2/8/100 требует MDB CPU **4**; memory16 и SSD4096 уже достаточны.
- YDB: serverless databases0/10, RU/s0/1000, storage0/300GiB; bootstrap1DB/10RU/s/1GiB помещается. Это квоты, не проверка выдачи сервиса.
- ALB units/static IP, KMS/Lockbox/S3 quotas, immutable image ID, PG17 preset/patch, допустимая зона и фактическая capacity не проверены. Не считать auto-created subnet доказательством capacity.
- Billing подключён по сообщению владельца; dashboard показывает0руб расходов. Статус billing ACTIVE и связь с cloud ещё проверить в inventory, без раскрытия платёжных данных.

Критерии раннего staging: Compute и PG в одной доступной зоне (кандидат d), restore capacity1host, HTTPS/сертификат, S3/KMS/YDB доступ. Три DB AZ, парные PBX/TURN и SIP UDP review здесь не требуются.

## 3. Минимальный план создания

B1 — admin folder, локальный state на зашифрованном диске владельца:
1 KMS AES256 key +1 private versioned SSE-KMS state bucket +1 YDB Serverless database (10RU/s,1GiB, provisioned capacity0). Terraform1.11.4/provider0.244.0. Ключи доступа и payloads не создавать Terraform.
После отдельного review B1 create — документная таблица sashatel-state-lock с partition key LockID:String через Document API. Это отдельная явная bootstrap операция; таблица пока не существует и не выдаётся за Terraform-managed объект.
Затем конкурентный lock probe на отдельном state key. State backend выбран: **S3 + YDB Document API**, endpoints/dynamodb_table в backend.hcl.example. use_lockfile=false. Terraform1.11.4 это поддерживает; механизм deprecated с1.11, upgrade запрещён без separately tested migration. Не заявлять YDB product database — только locks.
Источник: [официальная инструкция YC, обновлена06.11.2026](https://yandex.cloud/ru/docs/storage/tutorials/terraform-state-lock).

B2 — staging folder, отдельный remote state:
- новая VPC,1subnet, NAT gateway/route, explicit SG;
- app1×standard-v3 2CPU100%/4GiB/30GiB network-ssd-io-m3; Web/proxy+Backend embedded fake worker;
- bastion1×2CPU/2GiB/20GiB, staticIPv4, SSH только owner-approved/32, нет forwarding agent и data secrets;
- PG17 PROD service class (это режим ManagedPG, не product production),1host s3-c2-m8/100GiB network-ssd, TLS6432 private-only, transaction pooling,30daysbackup;
-3private versioned SSE-KMS buckets recordings/audit/exports: только synthetic files (начальная гипотеза10GiB каждый);1dataKMS;4empty Lockbox containers, separate process identities;
- отдельная jobs VM **не создаётся**: актуальный Backend server.ts уже запускает worker внутри процесса. Jobs SA сохраняется для будущего разделения и scoped permissions, workload на ней пока нет. Полный metrics stack/registry VM не создаются.

B3 — отдельный HTTPS/DNS plan после readiness и certificate approval:
ALB1zone минимум2units,1staticIPv4,443→private app8080; staging.platform.sashatel.ru. Публично доверенный сертификат Certificate Manager ACME DNS01; local CA/hosts не путь пользовательской приёмки.
DNS diff: ADD _acme-challenge.staging.platform.sashatel.ru CNAME TTL300 → точное challenge value из созданного certificate request; после ISSUED ADD staging.platform.sashatel.ru A TTL300 → reserved ALB IPv4. Это шаблон будущего diff: значения ещё не существуют. До выполнения — read current A/AAAA/CNAME/CAA, показать old→new diff, конфликты/CAA согласовать, не менять parent zone/NS/production records. Не выпускать wildcard. TLS certificate/export payloads не помещать в Terraform state.
B2 enable_edge=false, B3 отдельный reviewed saved plan enable_edge=true с существующим ISSUED certificate_id. Bootstrap и B2 не ждут DNS. User Auth acceptance ждёт B3.

## 4. Стоимость, все категории и границы точности

Оценка720h с НДС, без гранта/скидок; ставки из [Compute](https://yandex.cloud/ru/docs/compute/pricing), [MDB](https://yandex.cloud/ru/docs/managed-postgresql/pricing), [VPC](https://yandex.cloud/ru/docs/vpc/pricing), [ALB](https://yandex.cloud/ru/docs/application-load-balancer/pricing), [S3](https://yandex.cloud/ru/docs/storage/pricing), [KMS](https://yandex.cloud/ru/docs/kms/pricing), [Lockbox](https://yandex.cloud/ru/docs/lockbox/pricing), [YDB](https://yandex.cloud/ru/docs/ydb/pricing/serverless). Проверка18.11. Не authenticated SKU quote.

| Статья | Расчёт ₽/30days |
| --- | ---: |
| App CPU/RAM |720×(2×1.24+4×0.33)=2736 |
| Bastion CPU/RAM |720×(2×1.24+2×0.33)=2260.80 |
| Их boot SSD50GiB |50×720×0.0332=1195.20 |
| PG2CPU/8GiB/100SSD |720×(2×1.8792+8×0.5072+100×0.0218)=7197.12 |
| ALB2units (только B3) |720×2×2.63=3787.20 |
|2activeIPv4 (B2 один, B3 второй) |2×720×0.26352=379.47 |
| NAT gateway |720×0.39528=284.60 |
|S3 state1GiB+fixtures30GiB, без free tier |31×2.376=73.66 |
|2active KMS versions, без операций |2×720×0.00439=6.32 |
|4Lockbox payload versions, когда заполнены |4×720×0.0274=78.91 |
|Итого перечисленные позиции B1+B2+B3 |**17999.28** |

Это НЕ полный коммерческий quote. Полная формула дополнительно включает: YDB consumed RU/storage; S3 requests/versions; KMS crypto и Lockbox GET; network/NAT/S3 egress сверх free allowances; DB backup/WAL сверх included storage; одноразовый restore DB; image registry хранение/egress (GHCR delivery требует Backend ACK); минимальные retained logs/audit; independent encrypted backup вне cloud и ключевой escrow. Их нельзя объявить нулевыми без inventory/usage. Бюджет гипотезы: synthetic1GiB DB,30GiB fixtures,20kS3PUT/200kGET,<=100GiB каждого egress allowance,4secretversions,2keyversions. YDB и независимое хранилище ещё требуют цены/лимитов; финальный полный quote пока **не готов**, apply gate закрыт.
Restore PG2/8/100 на4h — ориентир7197.12/720×4=39.98₽ плюс backup/egress, фактический RTO не гарантирован. Не резервировать production hosts. Остановка VM не прекращает disk/staticIP/DB charges.

## 5. Исполнение и один список действий владельца

Панель доступна; IDs больше не спрашиваем. Для authenticated Terraform plan пока нет CLI/cloud identity в рабочем окружении; браузерная cookie не является Terraform credential.

1. Владелец на своём компьютере устанавливает официальный YC CLI и Terraform1.11.4, входит через yc init, выбирает cloud b1g4eft3gb4r2ag0s57v. Никакие tokens/keys в чат не отправляет. Первый plan выполняет сам; это не новая личная учётка агента.
2. До plan: yc resource-manager cloud get b1g4eft3gb4r2ag0s57v; yc resource-manager folder list --cloud-id b1g4eft3gb4r2ag0s57v; yc compute zone list; yc compute image get-latest-from-family ubuntu-2404-lts --folder-id standard-images; yc managed-postgresql resource-preset list. Сохранить только IDs/version/zone/preset и квоты в очищенный report, без connection strings/userdata. Quota changes пока не отправляем без owner решения; точные изменения в§2.
3. Скачать текущий #25; зашифрованный local каталог mode0700 вне Git для tfvars/plan/state. Bootstrap tfvars: cloud_id выше, folder_id=b1gga2v07q1av7123dp0, globally-unique state_bucket. В локальной shell экспортировать YC_TOKEN из yc iam create-token без echo/set-x, выполнить bootstrap init/plan, сохранить binary plan локально. show-json только в private file; scripts/review-plan.py bootstrap PRIVATE_JSON; не загружать полный plan в GitHub.
4. Передать сюда очищенную сводку resource addresses/actions/counts и provider errors, image/preset/quotas. Для работы именно агента вместо owner-run допустим plan SA со scoped read permissions на admin/staging и key file в защищённом окружении либо workload federation protected repo/ref; никакого общего owner-token. Нельзя принять Terraform plan с offline fixture IDs за authenticated.
5. Review B1 exact plan+quote → отдельное разрешение создания. Затем B1/Document table/locking proof; только после этого B2 authenticated plan с настоящим remote state и B3 plan. До B1 staged foundation plan не может быть полноценным remote-state plan; не имитировать наличие bucket. DNS только отдельным review B3.

Plan permissions SA: folder-scoped resource-manager.auditor, compute.viewer, vpc.viewer, managed-postgresql.viewer, alb.viewer, iam.serviceAccounts.viewer, kms.viewer, lockbox.viewer, storage.configViewer, ydb.viewer, certificate-manager.viewer на нужных admin/staging. Не читать payloads/objects и не давать production roles. После B1 для state отдельный bucket-scoped storage.viewer (plan читает state), key-scoped KMS decrypt и YDB lock-table Get/Put/Delete/Describe (проверить поддержанную IAM granularность; если только ydb.editor — только выделенная lockDB). S3 backend может требовать scoped static key даже при WIF provider auth; не считать federation автоматической авторизацией S3. Key создаёт владелец вне Terraform, безопасное окружение, rotation/revoke.
Будущий apply SA отдельно, временно admin-folder storage.admin/kms.admin/ydb.admin; staging compute.editor/vpc.admin/managed-postgresql.editor/alb.editor/storage.admin/kms.admin/lockbox.admin/iam.serviceAccounts.admin+user. Это перечисление по операциям root, требует проверки ошибок actual plan/API; не cloud admin. Владелец назначает права, агент сам не расширяет.

## 6. После отдельно разрешённого apply: проверки/rollback

B1: bucket private/versioning/KMS, locked access deny; Document table LockID:String. Dedicated lock-probe key: два изолированных TF_DATA_DIR, два параллельных plan; первый держит lock30s, второй -lock-timeout=5s обязан отказать. Затем после штатного выхода второй проходит. Kill первого → stale lock остаётся, force-unlock только после подтверждения отсутствия live operator, затем plan проходит. Проверить state serial/lineage и restore версии; не применять probe.
B2: private routes, SSH/32 и hostkey, внешний5432/ARI закрыты, DB TLS verify-full. Backend мигрирует одной migration identity, runtime без superuser/BYPASSRLS/owner escalation, pool A/B tenant tests и forced RLS.
B3: trustedHTTPS, readiness200/schema; cookie/CSRF/Auth email sink flow, WS reconnect если используется; sink != доставка почты пользователю.
Restore: markerA → backup/time checkpoint → markerB; новый изолированный PG, restore к checkpoint, проверкаAесть/Bнет, schema/grants/RLS, secret recovery без ключей из восстановленногоdisk. Отдельная restore quota CPU4 обязательна. Отключить внешние dispatch consumers, старый outbox quarantine/recovery epoch по Backend; не replay call intents. Измерить RPO/RTO, сравнить rows/checksums и удалить rehearsal только отдельным разрешением.
Rollback app — предыдущий compatible digest; DB expand/contract, не destructive down. При corruption новый DB с reviewed cutover и оценкой потери новых записей. Bootstrap/state/KMS/DB/buckets защищены от destroy, не удалять ради отката. Cleanup только новых manifest IDs после backup review, не default сети/MetaDataHub/production/Timeweb.

## 7. Release contract и фактическая валидация

Backend #14 прочитан по реальному коду: npm start=node server.ts; bind127.0.0.1:8080; worker embedded; DATABASE_URL+explicit FAKE_ARI_TENANTS; migrations001/002/003/runtime.sql; в package scripts нет migrate и в PR diff нет OCI manifest. Не объявлять onboarding release готовым из архитектурного описания.
Запрос release-v1/точного ACK: [#14 comment6963786484](https://github.com/suprunmvp-web/sashatel/pull/14#issuecomment-6963786484). Нужны digest/registry/start/bind, executable migration entrypoint/order/transactionality+compatibility range, readiness/liveness, file-secret injection adapter, runtime grants и SIGTERM/drain, sink/fake guard, restore epoch. Инфраструктура принимает Backend-owned SQL/API и не пишет конкурирующую модель. Ответ/двусторонний ACK пока отсутствует; запуск blocked, независимая IaC подготовка нет.

Локально: bootstrap validate,7Terraform mock tests (включая1app/1subnet/1DB staging),4plan-scope negative tests прошли. Authenticated inventory в панели выполнен. CLI authenticated plan, resource capacity, настоящий lock probe, DB/RLS/TLS, restore и публичныйHTTPS пока НЕ выполнены. Наличие schema validate не подтверждает работающее облако.

## Текущее исполнение: интеграционная ветка staging

Владелец разрешил создание утверждённого bootstrap/staging после authenticated plan и самостоятельной проверки состава, без отдельных подтверждений каждого ресурса; разрешены только новые staging/ACME DNS records при подтверждённом владении. Production/Timeweb/live calls остаются запрещены. Рабочая ветка integration/staging-web-auth-20261118 от9740fa8; чужие ветки не меняются, Draft PR в main не объединяются.

Cloud Shell после повторного подключения запущен: YC CLI1.41.0; authenticated folder list повторно подтвердил три IDs, admin bucket list вернул []. Загрузка кода/команд Terraform в Cloud Shell остановлена автоматической проверкой: требуется явно разрешить именно эту передачу кода в YC. Запрос владельцу отправлен. Локальный YC CLI1.46.0 установлен в workspace без изменения shell profile; секреты не переносились. Authenticated Terraform plan и apply пока не выполнены.

DNS: Google DoH и Cloudflare DoH18.11 возвращают Status3/NXDOMAIN для sashatel.ru NS/SOA и staging.platform.sashatel.ru. Это блокирует public ACME; не доказывает отсутствие регистрации/владения. Нельзя обойти это staging A-record без родительской делегации. Владельцу задан только вопрос о регистрации/регистраторе, NS/MX/покупка не выполнялись.

Release source candidates и ещё не предоставленные runtime SHA/digests фиксируются в infra/staging/release-manifest.json. check-release.py обязан отказать на текущем incomplete manifest; зелёные тесты guard не означают готовый onboarding. Запросы поставки: Backend#14 comment6964121680, Web#24 comment6964123029. Только настоящий API, telephony disabled, test sink с доступом только тестировщиков. Приложения/миграции пока не поставлены, инструкция получения кода и рабочий URL ещё не существуют.
