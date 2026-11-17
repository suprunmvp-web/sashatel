# DEPLOY-01a — инфраструктурный bootstrap SashaTel

Base **fff308d7156d52bc3fcecdb024863f0b471679bd (main)**, ветка feature/deploy-01a-foundation. Проектное основание — Draft [ARCH-01 #23](https://github.com/suprunmvp-web/sashatel/pull/23), обновление решений от 18.11.2026. Чужие Draft PR не объединялись.

## Что находится в коде

- bootstrap — отдельный local-state root, state bucket с versioning/KMS и prevent_destroy.
- foundation — VPC/3 подсети/SG/NAT, private app/jobs VM и опциональный restricted bastion, отдельные service accounts и resource-scoped IAM, PG17 (staging один host, production три), три закрытых versioned bucket, KMS, пустые Lockbox containers и HTTPS ALB с healthcheck.
- edge по умолчанию выключен, DNS не создаётся. ALB требует существующего проверенного Certificate Manager certificate ID. При enable_edge резервируется адрес. Capacity/region binding адреса к ALB проверяются authenticated plan и созданием.
- PBX/TURN, правила UIS/SIP/RTP/ARI, Postbox sender и off-provider backup пока входят в отдельные reviewed изменения. Foundation не создаёт ложный статус готовности телефонии.
- Нет payload секретов, паролей DB/users, статических IAM keys или provisioners с remote shell в Terraform. Users/database/grants и приложение — следующий этап, ответственный Backend совместно с DB-01. Secret values загружаются доверенным оператором/сервисом напрямую в Lockbox после создания контейнеров.
- Код не устанавливает приложение на VM. До раннего staging deploy targets ALB будут unhealthy, это ожидаемо. /health должен проверять БД, совместимую версию схемы и доступность HTTP handlers, не разрешение платного вызова.
- Terraform 1.11.4, YC provider 0.244.0, external provider 2.3.5 только для read-only lock probe, все checksums в lockfiles. Ubuntu image ID вводится из проверенного inventory. Backend Node 24.22.3, PG17 patch фиксировать evidence сервиса. Runtime versions — runtime-versions.json.

## Проверки без облака

```bash
terraform -chdir=infra/yandex fmt -check -recursive
for root in bootstrap foundation lock-probe; do
    terraform -chdir="infra/yandex/$root" init -backend=false -input=false -lockfile=readonly
    terraform -chdir="infra/yandex/$root" validate
done
terraform -chdir=infra/yandex/foundation test
```

Init загружает provider из registry, backend=false не читает удалённый state. Семь mock-сценариев дополнительно проверяют bastion без разрешённого источника и включение для фиксированного /32. Mock tests не вызывают cloud API, не создают ресурсы. Их plan является проверкой HCL/provider schema и проектных assertions. Он не доказывает цену, quota, image, zone availability, support restrictions, IAM/ACL, live health или RLS. CI содержит только эти проверки, без cloud secrets/OIDC/apply.

Примеры mock zones a/b/d и ssh key синтетические. Они не являются выбранными зонами/ключом внедрения. Для реального планирования обязательны ровно три подтверждённые зоны, разные 10.x.x.0/24 CIDR и отдельные частные admin /32 через утверждённый ingress. Terraform проверяет непересечение переданных /24 между собой, конфликт с существующими сетями проверяется inventory. NAT обслуживает HTTPS/DNS egress. Через него не предусматривается provider SIP. По умолчанию private nodes не имеют входа с интернета и не обслуживают SSH через public IP.

## State bootstrap и блокировка

State bucket, KMS, credentials, роль оператора и remote locking **сейчас не существуют в подтверждённом окружении**. Bootstrap не может пользоваться своим ещё не созданным backend.

1. Владелец создаёт отдельный admin folder и назначает временного bootstrap исполнителя. На зашифрованном локальном диске под одним оператором выполнить authenticated init/plan bootstrap с локальным state. Plan и state закрыты 0600, копия на независимый шифрованный носитель, shell tracing выключен. Создание bucket/key требует отдельного разрешения и квоты, только после review плана.
2. После разрешённого создания проверить bucket/KMS/versioning, ресурсные IAM и восстановление предыдущей версии state. Выдать state runner доступ к конкретным state keys и .tflock. Credentials отдельно от backend.hcl. Заполнить backend.hcl.example именем **созданного** bucket и ключом staging/foundation.tfstate.
3. В foundation и lock-probe используется S3 backend use_lockfile=true. HashiCorp поддерживает этот механизм, но совместимость conditional lock операций YC для выбранного аккаунта/версии ещё должна быть проверена. Никакого -lock=false. Если тест не проходит, остановить создание foundation и согласовать поддерживаемый backend locking (например, документированный YC YDB mechanism с отдельным lifecycle и дополнительной проверкой версии Terraform).
4. Прежде любых foundation изменений провести два concurrent read-only plan на отдельном disposable key. У lock-probe нет cloud ресурсов и apply ему никогда не нужен. Init с -backend-config, затем первый plan (external data удерживает lock 30 секунд); убедиться, что .tflock появился. Второй plan с -lock-timeout=0s обязан завершиться ошибкой lock. Первый завершает plan и удаляет lock. Прервать первый процесс, проверить orphan lock и регламент восстановления: сверить PID/job/lease и backup, только после этого force-unlock. Повторить lock test. Сохранить redacted логи и state version IDs.
5. Мигрировать bootstrap state только после отдельного review: добавить копию backend block и выполнить init -migrate-state с отдельным bootstrap/bootstrap.tfstate key. Сверить lineage/serial/resource list и закрытые копии. В репозитории bootstrap намеренно оставлен local до этого действия. Отдельные каталоги/keys и каталоги доступа для staging/production. Передача state не даёт runtime service accounts прав на него.

Точные команды read-only lock probe после bootstrap и разрешения проверки backend:

```bash
# backend-probe.hcl — копия backend.hcl с key = "probes/lock.tfstate".
terraform -chdir=infra/yandex/lock-probe init -backend-config=/secure/backend-probe.hcl
# Терминал A — дождаться появления lock, data читает локальный timer.
terraform -chdir=infra/yandex/lock-probe plan -lock-timeout=0s
# Терминал B в эти 30 секунд — ожидается Error acquiring the state lock.
terraform -chdir=infra/yandex/lock-probe plan -lock-timeout=0s
```

Ссылки — [HashiCorp S3 locking](https://developer.hashicorp.com/terraform/language/backend/s3), [документированный YC YDB lock](https://yandex.cloud/en/docs/tutorials/infrastructure-management/terraform-state-lock). Это разные механизмы, реализация S3 lock в этом PR ожидает compatibility proof.

## Authenticated plan и границы прав

После получения read-only inventory, уточнения capacity и bootstrap заполнить private tfvars — cloud_id/folder_id, environment, confirmed zones/CIDR, image ID, публичный SSH ключ, admin VPN /32, глобально уникальный bucket prefix. Не передавать cloud tokens через tfvars. Provider получает краткий IAM token или федеративную identity через штатное окружение. State backend credentials отдельны и ограничены bucket/key. Планы содержат operational data — держать как закрытые artifacts с TTL, не публиковать JSON целиком.

```bash
terraform -chdir=infra/yandex/foundation init -backend-config=/secure/backend-staging.hcl
terraform -chdir=infra/yandex/foundation plan -var-file=/secure/staging.tfvars -out=/secure/staging.tfplan
terraform -chdir=infra/yandex/foundation show -no-color /secure/staging.tfplan
```

Plan требует actual cloud IAM и remote state credentials, сам по себе не доказывает возможность создания и восстановления. Прежде разрешения apply получить quote, перечень resources, replacements/deletes, IAM grants и remaining quota. Public edge оставить false до review сертификата/health/маршрутов. Staging early app deploy использует release manifest Backend/Web и fixtures с fake provider, направленными в закрытую сеть без PSTN. Production не должен стартовать fake ARI как live gateway.

## Следующие шаги после разрешённого создания

Проверить VPC reachability из согласованного admin access (при существующем private admin route использовать его; иначе отдельно включить enable_admin_bastion с утверждёнными admin_public_cidrs /32. Только bastion имеет public IP и SSH ingress, private nodes доступны через ProxyJump, без agent forwarding. Тогда admin_cidrs может быть пустым). Создать runtime/migration DB credentials напрямую через доверенный service API и Lockbox, применить Backend-owned migrations/grants, проверить pool/RLS, установить закреплённую сборку Web/Backend с ресурсными лимитами и health. Наличие папок /admin/ и /{organization_uuid}/ не задаёт роль/tenant: Backend проверяет trusted session и внутренние полномочия на каждом запросе. Public origin platform.sashatel.ru, лендинг sashatel.ru отдельный ресурс вне этого PR; staging.platform.sashatel.ru предложен для staging и требует DNS approval.

Сервисные SA в коде получают доступ к отдельным ресурсам, без folder editor. API читает recordings и DB-runtime secret; jobs — audit/exports upload и разрешённые service secrets. Секрет мигратора не доступен API/jobs. Jobs и API используют разные Linux service users и SA. Пока IAM для recording uploader/PBX и Postbox API не добавлен, его отсутствие должно приводить к отказу, а не выдаче generic editor. Bucket IAM bindings управляются авторитетно для соответствующей роли, сторонние ручные grants до применения нужно инвентаризировать.

Health API — /health, 200 только при готовности; 503 снимает узел из LB, panic_threshold=0. Нужен test kill процесса/API VM и reconnect без повторения команды вызова. Jobs liveness проверяет процесс, readiness — DB и возраст heartbeat/claim, отдельно от API, определяет Backend Engineer. ARI/media live health добавляется только в live SIP milestone.

Откат bootstrap не удаляет state/KMS/DB/buckets. Prevent_destroy и deletion_protection намеренно требуют отдельного review снятия защиты. Откат релиза возвращает прошлый app digest только со совместимой schema. Corruption recovery — в новый PG cluster с outbound worker отключённым, затем reconciliation и новый dispatch epoch, не replay оплаченных звонков. Процедуры отказов и стоимость — в docs/infrastructure/DEPLOY-01a-plan.md.
