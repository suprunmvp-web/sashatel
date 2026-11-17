# Запрос capacity и доступов YC — готовый текст владельцу

Срез источников 18.11.2026. Сообщение в поддержку не отправлялось. Заполнить только cloud/folder IDs и контакт ответственного, без токенов, SIP credentials, телефонов или персональных данных клиентов.

## Официальные факты и границы проверки

- Сообщение YC от 23.10.2026 описывает новую физическую локацию под прежним логическим именем ru-central1-a и поэтапный доступ. Само имя AZ не доказывает нынешнюю географию/независимость ресурсов конкретного аккаунта. [Источник](https://yandex.cloud/ru/blog/new-zone)
- Сообщение от 10.11.2026 описывает последствия октябрьского инцидента, новую ru-central1-f с запуском 11.11 и ограничения квот/части сервисов. Факт публичного запуска не равен наличию нужного PostgreSQL/network SSD/ALB capacity для нас. [Источник](https://yandex.cloud/ru/blog/recovery)
- Операционные рекомендации, перечитанные 18.11.2026, описывают восстановление связности a, контролируемый запуск DB hosts/cluster и ALB zonal shift. Это живой документ с разными историческими этапами, единую дату актуальности всех блоков установить нельзя. Состояние конкретного аккаунта/хоста требует inventory/support. [Рекомендации](https://yandex.cloud/ru/recommendations)
- Документация PostgreSQL HA от 25.08.2026 описывает два host в разных AZ как HA и три host в трёх AZ как вариант с большим запасом, auto-failover и особенности sync/async. Это описание сервиса, не capacity reservation. [HA](https://yandex.cloud/ru/docs/managed-postgresql/concepts/high-availability)
- Документация backup от 16.10.2026 описывает PITR через WAL и создание нового кластера при restore. Нужно свободное место/квота и свежий WAL, фактическое время восстанавливать тестом. [Backup](https://yandex.cloud/ru/docs/managed-postgresql/concepts/backup)

## Текст для поддержки

Здравствуйте. Готовим инфраструктуру B2B SaaS SashaTel в регионе Россия. Рассматриваем Yandex Cloud основным кандидатом. На этом этапе просим capacity review и расчёт, без создания платных ресурсов.

Cloud ID: <ID>. Folders для staging/production/admin: <ID или ещё не созданы>. Контакт: <назначенный владелец infrastructure>.

1. Подтвердите доступные нам сейчас три независимые AZ/физические отказные домены для PostgreSQL17, Compute standard-v3, network SSD и ALB. Укажите текущие ограничения после октябрьского инцидента, включая новую локацию под именем a и зону f. Возможно ли новое создание, restart, failover, замена узла и restore в этих зонах? Где есть очереди/ограничения резервирования?
2. Начальная production конфигурация — app2×2vCPU/4GiB, jobs2×2/4, позднее PBX2×4/8 и TURN2×2/4; boot30GiB на VM, PBX spool100GiB каждый. Managed PG17 —3×2vCPU/8GiB/100GiB network-ssd, по трём AZ. Staging ранний —app1×2/4, jobs1×2/4, PG1×2/8/100GiB. Нужна возможность одновременно восстановить отдельный PG3×2/8/100GiB и заменить PBX4/8 со130GiB диска. Дополнительно два опциональных restricted bastion2vCPU/2GiB/20GiB по одному на environment, если нет existing private admin path. Просим подтвердить по зонам физическую capacity, не только общий quota limit.
3. Предлагаем запросить Compute32vCPU/64GiB и MDB16vCPU/64GiB, не менее7 DB hosts и13 VM, VM disks670GiB и DB disks700GiB плюс snapshot/backup. Уточните service-specific quota names, ограничения per-AZ/host class и доступность spare при потере наиболее загруженной зоны.
4. Какой текущий PG17 minor и preset соответствуют 2vCPU/8GiB? Поддерживается ли network-ssd для всех трёх зон? Как выполняется sync-replica failover и что меняется при деградации? Подтвердите private TLS endpoint/port6432 и transaction pooling, runtime NOSUPERUSER/NOBYPASSRLS, отдельную migration role и возможность FORCE RLS.
5. Подтвердите PITR window30дней, лимиты WAL lag, расположение/доступность backups при потере зоны/аккаунта, механизмы независимого экспорта и восстановления. Требуется отдельный кластер для rehearsal и резерв capacity до RTO измерения. Как получить статус последнего архивированного WAL и проверить ключи?
6. ALB2AZ минимум2units/AZ, staging1AZ2units, max12units совокупно. Нужны HTTPS и WebSocket Upgrade, статический публичный адрес, private targets и healthchecks. Какие зоны/подсети сейчас допустимы, нет ли active zonal shift или ограничений создания? Является ли резервируемый VPC public IP совместимым с listener в нашей комбинации зон?
7. Нужна квота до10 статических public IPv4 на отдельном этапе с подтверждённым egress ownership. Есть ли ограничения VoIP SIP UDP/TCP/TLS, source ports5060/5062, входящих ответов на исходящий REGISTER, RTP UDP10000–19999, TURN3478/5349 и relay20000–39999? Как влияет DDoS/anti-abuse/filtering, NAT/rport и idle timeout? Можем ли получить redacted packet/path diagnostics совместно с UIS без public SIP any-any?
8. Подтвердите managed NAT availability/failure domains, текущие сроки и rate limits на Compute/DB/ALB/KMS/S3; SLA и порядок escalation при отказе. Нужны Object Storage private/versioning/SSE-KMS, Lockbox metadata+payload IAM, Postbox sender verification и соответствующие квоты.
9. Просим quote по resource SKU, region/AZ, НДС, on-demand720h, disks, idle IP, ALB units, NAT/egress, backups/WAL/restore rehearsal, KMS/Lockbox version/GET, Postbox10k писем и monitoring. Capacity/quote не является заказом и не разрешает создание ресурсов.

## Критерии выбора / перехода к Selectel

YC остаётся кандидатом при подтверждении трёх независимых PG AZ, возможности создания/перезапуска/restore с резервом, работающих сетевых путей UIS и обслуживания публичного media, поддерживаемого state locking и приемлемой операционной модели. Ответ «квота увеличена» без capacity для restore недостаточен.

Если подтверждены отсутствие нужной HA/restore capacity, неприемлемые ограничения SIP/UDP или невозможность согласовать диагностику/срок устранения, готовим эквивалентный plan Selectel. Если поддержка не даёт конкретного ответа, закупка остаётся приостановлена, владелец решает допустимый срок ожидания и момент перехода. Не выбирать одноузловую DB в YC ради обхода capacity gate. Selectel проверяем по той же форме — PostgreSQL17, ru-6 Multi-AZ, PG backup/PITR, сети UIS, secrets, S3, ingress и квоты; переносимый SQL и контейнеры сохраняются, Terraform/provider и IAM переписываются отдельным PR.

## Текущие действия и доступы (заменяет прежний порядок)

YC выбран владельцем; новые сравнения и production capacity request остановлены. Актуальный read-only inventory, Cloud/Folder IDs, реальные квоты, безопасный owner-run план, доступы и единственный список действий владельца — в [DEPLOY-01a-plan.md](DEPLOY-01a-plan.md), §§1–6. Личной учётки инженера для AI не существует; приглашать её не нужно. Исторический запрос выше НЕ отправлялся и не является текущим staging scope. Не запрашивать production quota по этому шаблону.
