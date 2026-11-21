# ARCH-01 v2 — принятые уточнения и DEPLOY-01a

Срез 18.11.2026. Направление принято владельцем для дальнейшей проработки. Yandex Cloud Россия основной кандидат; создание ресурсов, DNS/apply и действующий VPS требуют отдельного разрешения. IaC готовится в отдельной ветке feature/deploy-01a-foundation от main fff308d7156d52bc3fcecdb024863f0b471679bd, без merge Draft #10/#14/#15/#23.

## Актуальные продуктовые условия

| Условие | Статус и ответственность |
| --- | --- |
| Новые организации неверифицированы; activation транка и новые звонки требуют verification | Принято владельцем, Backend реализует gate |
| Транки выключены по умолчанию | Принято, Web показывает сохранённый сервером статус |
| Кредитный лимит опционален и по умолчанию отсутствует | Принято, Backend согласует детали финансового gate, DevOps не вводит другой учёт |
| Финансовая блокировка закрывает новые звонки, сохраняет кабинет/документы/оплату и текущий разговор | Принято, отдельная политика admission, не общий deny account |
| Внутренние роли SashaTel отделены от клиентских | Принято, internal admin права не следуют из org owner/admin |
| Серверный аудит обязателен, Telegram лишь очищенная асинхронная копия | Принято, outage Telegram не отменяет операцию и не теряет durable audit |
| Web/Desktop без частиц | Принято |
| sashatel.ru лендинг; platform.sashatel.ru Web; /admin/ internal; /{organization_uuid}/ org | Принято, UUID/path не авторизация; API по /v1 того же origin |
| staging.platform.sashatel.ru, media-01/02.sashatel.ru, turn-01/02.sashatel.ru | Предложено, DNS не создавались |

Исходный аудит 17.11 в трёх ARCH-01 файлах сохраняет исторический срез кода/CI. Эта таблица заменяет прежние абсолютные формулировки о кредитном лимите и отсутствие верификации организации. Ключевые технические пробелы fake ARI/single-trunk worker остаются задачами компонентов, а не ограничениями публичного продукта.

## Порядок без циклов

B0 account/read-only inventory/capacity и quote → B1 отдельно разрешённый bootstrap state+lock proof → B2 private staging foundation → S1 ранний Backend/Web и isolated fixtures. После B2 параллельно DB-01, EMAIL-01 и OPS-01. S1 не зависит от Timeweb/MEDIA-01 и полной совместной E2E приёмки.

I1 проверяет совместимый manifest компонентов по мере готовности API и adapter, затем L1 — отдельное разрешение конкретных live SIP/PSTN действий, затем R1 rollout принятой сборки. Инфраструктурный bootstrap не ждёт полного INTEGRATION-01; безопасный ранний deploy не включает реальный call gate. Полный release с вызовами и записью требует I1+L1 и restore/security acceptance.

Владельцы — DevOps DEPLOY-01a, DB infrastructure/EMAIL/OPS; Backend auth/finance/RLS SQL/jobs/adapter; Telephony node provisioning/ARI/media; Web routing/UI; Desktop session/media host; Tech Lead release manifest, QA приёмка, владелец live approvals. Назначенная этому чату зона не включает самостоятельную замену Backend контракта.

## Что готовит DEPLOY-01a

Два Terraform root — bootstrap с local state на шифрованном диске, foundation с отдельным remote state после bootstrap. Terraform1.11.4/provider0.244.0 и checksums. VPC/SG/private VM/PG17/private versioned S3/KMS/Lockbox metadata, optional HTTPS ALB. Ни state backend, ни locking не объявляются существующими до создания и двух concurrent read-only plan на disposable key. При несовместимости S3 conditional locking stop, отдельный backend review.

Production foundation содержит app2/jobs2 и DB3 в подтверждённых AZ; staging app1/jobs1/DB1. PBX/TURN применяются позже отдельным gate, только после проверки провайдерских CIDR и публичных media границ. Node24.22.3 и Ubuntu24.04 зафиксированы как runtime baseline, image ID вводится из authenticated inventory. В HCL нет паролей DB, secret values, статических access keys и DNS records.

Физическое разделение jobs и API защищает от общей root-компрометации и конкуренции фоновых задач за ресурсы. Пара app покрывает host/AZ отказ через ALB, пара jobs требует durable claim и generation fencing Backend. Пара PBX требует внешнего fence старого owner и согласования registration failover UIS; потерянный активный звонок не восстанавливается бесшовно. TURN pair даёт другой relay для новой allocation, но не переносит существующую. DB третий host уменьшает риск потери write availability/quorum при одном сбое. Тесты конкретных механизмов и остаточные риски вынесены в план DEPLOY-01a.

Фиксированная база раннего staging без edge ~14 103,36 ₽/месяц, с edge ~17 890,56; production foundation+edge ~42 978,24; production с PBX/TURN ~67 043,52. Переменные расходы, staging/backup/ключи/почта/трафик доводят pilot estimate до прежнего резерва108–128тыс.₽, уточняется quote аккаунта. Не выдавать только VM base за полную стоимость. Диски/backup/restore и квоты включены отдельно.

## Зоны и внешние проверки

Официальные источники перечитаны 18.11 — [сообщение23.10](https://yandex.cloud/ru/blog/new-zone), [сообщение10.11](https://yandex.cloud/ru/blog/recovery), [операционные рекомендации](https://yandex.cloud/ru/recommendations), [PG HA25.08](https://yandex.cloud/ru/docs/managed-postgresql/concepts/high-availability), [PG backup16.10](https://yandex.cloud/ru/docs/managed-postgresql/concepts/backup). Логическое имя a и ввод f не подтверждают доступную нам capacity. Поддержке подготовлен, но не отправлен запрос по трём DB AZ, spare/failover/restore, ALB/IP и VoIP filtering.

Если YC не подтверждает HA/restore capacity или сетевой путь UIS/условия поддержки, перейти к эквивалентному Selectel capacity review. Одноузловый production не используется как обход ограничения. Решение ждать ответа или менять кандидата принимает владелец на основании конкретных ответов; длительность ожидания пока не утверждена.

## Доказательства и границы

Проверка fmt/schema/mock test подтверждает кодовую конфигурацию и проектные assertions. Authenticated plan ещё требует account metadata/identity, существующего state и подтверждённых зон. Только создание/restore/network probes доказывают IAM, pool/RLS, failover, readiness и реальные затраты. Перед созданием фиксируется reviewed plan и отдельный quote/approval, до live provider — ещё один gate.

Restore/security acceptance — настоящий managed pool с alternate tenant и error rollback; потеря app/DB/PBX; S3 outage/spool; key recovery; отсутствие публичных DB/ARI; quarantine восстановленного outbox и новый dispatch epoch до запуска jobs. Telegram outage не должен затрагивать durable audit. Эти проверки получают timestamp/environment/SHA и measured RPO/RTO, а не только checkbox.

Текущая нехватка доступа не блокирует завершение IaC/CI/запроса support. Владельцу предоставляется конкретный порядок создания пустых folders, приглашения инженера с scoped read-only roles, отдельного plan SA и последующего ограниченного apply SA. Общий owner-token не нужен.
