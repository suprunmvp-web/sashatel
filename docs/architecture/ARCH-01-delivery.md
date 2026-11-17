# ARCH-01 — ресурсы, внедрение и приёмка

План для review, владельцы ролей предложены. Изменения инфраструктуры выполняются после отдельного утверждения конкретного Terraform plan и окна. Цель релизной приёмки — Web signup → email code → организация ИНН → UIS в Web → тот же аккаунт Desktop → реальный разрешённый звонок → история и защищённая запись.

## Ресурсы и стоимость

База расчёта — 30 суток/720 часов, Россия, рубли с НДС, on-demand без скидок и грантов. Срез источников 17.11.2026. Это архитектурная оценка, перед заказом сохраняется quote из аккаунта с типами/зонами/налогами/квотами. Точный расход зависит от трафика, WAL, версии секретов, логов и retention.

| Ресурс production | Количество и состав | Расчёт ₽/месяц |
| --- | --- | ---: |
| Web/API VM standard-v3 100% CPU | 2 × 2 vCPU / 4 GiB, по разным AZ | 2×720×(2×1,24+4×0,33) = 5 472 |
| Jobs/ARI controller VM | 2 × 2 vCPU / 4 GiB, разные AZ | 5 472 |
| Asterisk VM | 2 × 4 vCPU / 8 GiB, разные AZ, ownership по trunk | 2×720×(4×1,24+8×0,33) = 10 944 |
| TURN VM | 2 × 2 vCPU / 4 GiB, разные AZ | 5 472 |
| PostgreSQL 17, standard-v3 | 3 × 2 vCPU / 8 GiB, 100 GiB network SSD каждый, три AZ | 3×720×(2×1,8792+8×0,5072+100×0,0218) = 21 591,36 |
| VM диски | 8×30 GiB boot + 2×100 GiB PBX spool = 440 GiB, triple-replicated SSD | 440×720×0,0332 = 10 517,76 |
| ALB | 2 AZ, минимум 2 resource units/AZ | 4×720×2,63 = 7 574,40 |
| Сумма определённых compute/DB/disk/ALB строк | | **67 043,52** |

Ресурсы выбраны по предложенной топологии; 4 vCPU PBX — начальная конфигурация для нагрузочного теста, не обещание пропускной способности. Запас standby включён. Три AZ должны быть подтверждены cloud support, конкретные имена не фиксируются по устаревшей карте. Цена managed DB disk относится к его собственному network SSD SKU, VM диски используют другой SKU. Официальные источники ставок — [Compute price table](https://raw.githubusercontent.com/yandex-cloud/docs/master/md-docs/compute/pricing.md), [PostgreSQL pricing](https://github.com/yandex-cloud/docs/blob/master/md-docs/managed-postgresql/pricing.md), [ALB pricing](https://yandex.cloud/ru/docs/application-load-balancer/pricing). ALB минимум 2 units на AZ, при росте WebSocket потребуется больше units.

| Переменный компонент | Плановый объём и метод оценки | ₽/месяц |
| --- | --- | ---: |
| IP/egress/NAT | До 7 активных адресов (ALB, 2 PBX, 2 TURN, 2 admin/egress), тариф IP уточнить по quote, исходящий 300 GiB pilot | Резерв 2 000–4 000, включая платный NAT/сеть |
| Записи S3 | ~300 GiB steady-state для 90 дней pilot, 2,376 ₽/GiB, requests/playback отдельно | ~713 storage, резерв всей строки 1 000 |
| Trunk secrets | Пример 100 trunks ×2 retained versions =200, 0,0274 ₽/version-hour + GET | 3 945,60 + ~38 при 100k GET → резерв 4 000 |
| Email Postbox | 10k писем, первые 2k бесплатно, далее 80,31666666 ₽/1000 | ~642,53 |
| Логи, метрики, KMS, registry, VM/DB extra backup | Объёмы лимитировать retention, WAL сверх включённого учитывать отдельно | Резерв 5 000–10 000 |
| Внешняя копия backup/recordings в РФ | 300 GiB записей + до 500 GiB DB/export/history | Резерв 3 000–6 000, точная цена второго поставщика требует quote |
| Staging | Отдельные project/VPC/accounts; 1 app 2/4, 1 jobs 2/4, 1 PBX 4/8, 1 TURN 2/4, 1 DB 2/8×100GiB и собственный LB, синтетические данные | Резерв 25 000–35 000 |

Итого плановый месяц **107 700–127 700 ₽**, округлённо **108–128 тыс. ₽**, до дополнительных расходов на поддержку, домены/сертификаты signing Desktop, работу команды, DaData, AI, оператора и платные тестовые звонки. Резервы не выдаются за официальные тарифы. До покупки требуется quote для всего списка, включая независимые копии и monitoring; 30% contingency на этой стадии даёт согласуемый потолок порядка **140–166 тыс. ₽/месяц**. Существующая месячная аренда Timeweb оплачена отдельно и в новой архитектуре не заменяет компоненты.

Хранение S3/операции/egress — [официальный прайс](https://yandex.cloud/ru/services/storage). Цена зависит от фактических GB×период, здесь GiB согласно тарификации cloud. Email и secret version ставки — [Postbox](https://yandex.cloud/ru/docs/postbox/pricing), [Lockbox](https://yandex.cloud/ru/docs/lockbox/pricing). Публичные адреса и NAT тарифицируются отдельно — [VPC](https://yandex.cloud/ru/docs/vpc/pricing). Цена поддержки и резервов должна быть уточнена до утверждения расходов.

100 000 аккаунтов в модели нагрузки не означает 100 000 оплаченных trunks. Стоимость 200 secret versions — отдельное предположение. При 10k trunks и двух версиях Lockbox только storage ~394 560 ₽/месяц. Тогда до такого роста оценить envelope encryption tenant-scoped ciphertext в PostgreSQL/S3 с KEK в KMS, ACL и аудитом, без создания отдельной платной Lockbox версии на каждый trunk. Текущий AES-GCM #14 может стать основой, но key version/rotation/KMS и удаления ещё нужны. Затраты AI считать по минутам отдельно, не помещать в «бесплатный worker».

## Воспроизводимый деплой

Terraform описывает VPC/subnets/SG, VM/managed DB/S3/ALB/IAM/KMS/Postbox, а cloud-init/Ansible — хосты и systemd. State зашифрован и закрыт, блокировки поддерживаются выбранным backend, отдельные state для production/staging. Root SSH через интернет не требуется. CI использует короткую федеративную identity с минимальными permissions. Если федерация недоступна, отдельный ограниченный deploy service account с ротацией, credentials в защищённом CI secret store, никогда в PR.

Одна сборка модульного Backend, разные entrypoints API/jobs/dispatch, pinned Node patch и image digest, SBOM/secret/dependency scan. Репозиторий образов закрыт. Asterisk reproducible build manifest фиксирует архив/hash/dependency versions и текущую конфигурационную ревизию. В release manifest SHA Web/Backend/Desktop/Telephony и migrations, контракт версии, verified environments. UI release не даёт автоматического разрешения calls.

PR CI без production secrets выполняет typecheck, tenant SQL suite PostgreSQL 17 и целевой service minor fixture, migrations с runtime grants, contract HTTP, fake только явно, real Asterisk namespace с запретом внешней сети, ARI teardown и multi-scope tests после реализации. До rollout одобренный plan, backup marker, canary и rollback command. GitHub Actions workflows добавляются в DEPLOY-01, ARCH-01 меняет только Markdown.

Миграции expand/contract. Сначала additive schema и совместимая запись, затем backfill пакетами с progress/retry, переключение читателей, удаление старых колонок отдельным релизом после rollback window. Индексы concurrently отдельным шагом вне общей транзакции, lock_timeout/statement_timeout ограничены. Один migration lock и отдельная роль. Снимок перед миграцией дополняет PITR, не делает DROP безопасным. Отмена rollout API возвращает предыдущий digest только при совместимой схеме. При порче данных остановить writes, PITR в новый кластер и reconcile outbox/provider/object manifests, не повторять outbound из восстановленного outbox автоматически.

API canary readiness включает подключение к БД и версию схемы; liveness не зависит от provider. Drain балансировщика прекращает новые HTTP/WS и даёт клиенту reconnect с cursor. У события call_id/revision/event_id, durable replay либо snapshot после reconnect. Retry requests идемпотентны. Длительность WS и idle heartbeat согласовать с ALB и Desktop; нагрузочный тест не должен держать pg client на сокет. [ALB WebSocket и timeouts](https://yandex.cloud/ru/docs/application-load-balancer/concepts/http-router)

PBX обновляется по одному узлу через drain, проверку нуля каналов, upload backlog и подтверждённое сохранение CDR/CEL. На active UIS account переключать registration только после проверки provider/fencing. Инициации закрыты при неизвестной ревизии/узле. Rollback включает старый config/binary manifest, восстановление private secrets из vault и повторную регистрацию без автоматического звонка.

## Задачи и зависимости

Последовательность после принятия ARCH-01 — DEPLOY-01a описывает IaC/контуры без app rollout. DB-01, EMAIL-01 и OPS-01a идут параллельно после этого. DEPLOY-01b выкатывает совместимую сборку после DB-01 и INTEGRATION-01. AUTH-01 использует EMAIL-01. OPS-01b и restore proof закрываются до первого клиентского E2E. Не дожидаться NET-01 для Web/auth/БД.

| ID / предложенный владелец | Зависимость | Проверяемая приёмка |
| --- | --- | --- |
| DEPLOY-01a / DevOps | ARCH review, cloud capacity и account access | Reviewed Terraform plan, раздельные environment IAM/network/state, список изменений/стоимость, нет public DB/ARI |
| DB-01 / Backend + DevOps | DEPLOY-01a | PG17 HA, migration/runtime grants, TLS, FORCE RLS под реальным pool, failover и PITR в новый кластер, журнал фактического RTO/RPO |
| EMAIL-01 / Backend + DevOps | DNS approval, DEPLOY-01a | Postbox identity, DKIM/SPF/DMARC, реальные code/reset/invite в mail.ru/yandex/gmail, bounce/timeout/retry и ограничение повторов без логирования кода |
| OPS-01a / DevOps | DEPLOY-01a | Dashboards/alerts, отдельный backup account и ключи, log redaction, audit dangerous ops, дежурный маршрут и тест доставки оповещения |
| AUTH-01 + организация / Backend + Web | EMAIL-01, DB-01, auth contract | Глобальный signup/verify/recovery, ИНН/DaData, один owner, два tenant, expiry/revoke/rotation/logout и concurrent retry |
| SESSION-01 / Desktop + Backend | AUTH-01 | Вход тем же аккаунтом, OS key store/main, выбор организации, stale responses и revoke; нет static env token |
| PROVISION-01a / Backend + Telephony | DB-01, согласованный wire | Mapping generation/UUID, scoped profile/secret refs, job ack, applied/registered/ready разные, REMOVE runtime+purge proof, ошибки/повтор/restart по общему CI |
| PROVISION-01b / Telephony | PROVISION-01a | Несколько tenant/trunk на одном узле без ID/path collisions; чужая команда отвергнута; нет глобального restart при изменении одного idle trunk; transport change через drain |
| WEB-TRUNK-01 / Web + Backend | AUTH/организация, PROVISION-01 | Секрет write-only, реальный job/status, разрешённые Caller ID, два tenant, revocation и понятный retry |
| NET-01 / Telephony + owner + providers | Операторские tuples/ответ Timeweb | Контролируемая read-only диагностика, 401/200 доказаны или квалифицирован новый узел. Разрешения на конкретное live изменение отдельно |
| MEDIA-01 / Desktop + Telephony + Backend | SESSION, PROVISION, NET и ARI adapter | WSS/DTLS-SRTP, ICE direct/relay, inbound-only authorized call ingress, реальный двусторонний звук, cancel/late answer/BYE/две legs/owner crash |
| RECORD-01 / Backend + Telephony | DB/S3 и call events | Chunk upload checksum/retry, restart/S3 outage/spool alarm, foreign-tenant deny, revoke/expired access, история своего сотрудника и всей org по роли |
| DEPLOY-01b / DevOps | DB-01, INTEGRATION-01 | Один release manifest, canary/rollback, health/reconnect, public edge abuse tests, отдельный live approval |
| INTEGRATION-01 / Tech Lead + компоненты | Контракты, AUTH/PROVISION/MEDIA | Зафиксированные SHA, реальный HTTP→job→PBX→history, две организации и delete/revoke. Fake mode не запускается в production manifest |
| OPS-01b / DevOps + Backend | DB restore + deployed staging | Потеря app/DB/PBX/S3/vault, ручной DR drill, сохранение evidence и action owner, измеренные показатели |
| SCALE-01 / QA + Telephony | MEDIA/RECORD | 20/40/80 calls, CPS bursts, WS/pool/IOPS, node loss; установлен admission cap и N+1 |
| E2E-01 / QA + владелец | Все P0 runtime gates, approval звонка и записи | Полный пользовательский сценарий от signup до защищённой записи, CLI/audio/teardown/CDR, без ручного SIP/VPN на клиенте |

Рекомендуемые метрики OPS — signup/login/email latency, API errors/RPS/p95, WS disconnect/replay lag, PostgreSQL lock/wait/pool/replication/WAL/backup age, oldest outbox/job claim/duplicates, node revision/drain, SIP registration/error causes/CPS, calls active/orphan/unknown, RTP loss/jitter/RTT, recording disk/upload age/checksum, S3 deny/error и vault failures. Alert thresholds основаны на SLO и capacity; budget alert ограничивает расходы инфраструктуры, не клиентский кредит. PII, auth headers, SIP Digest, коды email, секреты и signed URLs исключаются из логов. Трассировка использует opaque call_id/tenant_id с контролем доступа, не телефонный номер в labels.

## Доступы и конкретные следующие действия

1. Владелец рассматривает cloud recommendation, topology и модель стоимости, назначает ответственных и утверждает только этап проектирования DEPLOY-01a. Для покупки ресурсов требуется отдельный reviewed plan.
2. Нужен read-only доступ к выбранному cloud project и support для проверки квот, трёх AZ, managed DB, ALB, recovery и согласованного VoIP UDP. Для реализации — scoped service accounts, IAM/SG permissions и quota approval. Общий owner-token не требуется.
3. Нужен доступ ответственного к DNS зоне и Postbox identity. Перед DNS изменениями предоставить точный diff, сохранить текущий MX/SPF, не создавать второй SPF.
4. Backend и Telephony фиксируют общий adapter контракт и multi-trunk acceptance. Read-only GitHub достаточен для нынешнего архитектурного этапа; он не даёт cloud/runtime proof.
5. Юрист и владелец определяют retention/consents/обработчиков и backup location, бухгалтерия — тарификацию/округление. Эти решения не блокируют synthetic staging, но нужны до клиентских данных.
6. Для будущего live теста отдельно утверждаются узел/изменения/откат, тестовый адресат и разрешение на звонок/запись. UIS secret поступает только в защищённый provisioning channel.

EMAIL-01 реализует Easy DKIM с двумя CNAME после review DNS diff, SPF добавляется в существующий TXT, DMARC сначала с наблюдением и затем enforcement после проверки всех отправителей. Sandbox/production email identities и лимиты раздельны. [Официальные записи Postbox](https://yandex.cloud/ru/docs/postbox/concepts/dns-records)

Для продвинутой HA ёмкость региона и перенос регистрации остаются внешними блокерами проверки, но все перечисленные инженерные задачи можно начать с synthetic provider в изолированном staging. ARCH-01 не создаёт расписаний или фоновых автоматизаций.
