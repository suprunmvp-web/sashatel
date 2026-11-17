# ARCH-01 — матрица текущего состояния и второй проход

Проверены файлы по закреплённым head SHA, CI и обсуждениям. Срез 17.11.2026. Чтение кода и результата CI выполнено через GitHub connector. Новые runtime-тесты в ARCH-01 не запускались. Удалённого аудита VPS, облачного аккаунта, DNS и поставщика почты в этом задании не было.

## Продуктовый контракт и план

Прочитаны целиком handoff и ТЗ из ветки docs/product-spec-v1-20261117. Изучен лист «Задачи» таблицы «Билдим телефонию», включая ARCH-01 строка 37, DEPLOY-01 39, DB-01 40, EMAIL-01 42, PROVISION-01 45, NET-01 46, RECORD-01 48, INTEGRATION-01 49, OPS-01 50 и SCALE-01 51. Лист не изменялся, новые листы не создавались.

Приняты Web регистрация/email-код/организация по ИНН, Web-only администрирование транков, Desktop-only вызовы, VPN только для инженеров. Утверждена постоплата без скрытого кредитного лимита, тариф SashaTel 3 ₽/мин, оператор отдельно. История и защищённая запись входят в ближайший сквозной результат. Юридическая и финансовая приёмка клиентского пилота остаётся отдельной.

[Handoff](https://github.com/suprunmvp-web/sashatel/blob/docs/product-spec-v1-20261117/docs/product/PROJECT-HANDOFF-RU.md), [ТЗ](https://github.com/suprunmvp-web/sashatel/blob/docs/product-spec-v1-20261117/docs/product/sashatel-spec-v1.0.md), [план, лист «Задачи»](https://docs.google.com/spreadsheets/d/1Lx7pDi7Wchuk6vgNUkeEzzuzJZadhSd2cDXWvTJA6vY/edit#gid=1649692683).

## SHA и CI

| Компонент | Прочитанный head | Проверенный CI | Предел доказательства |
| --- | --- | --- | --- |
| Draft #10 Desktop | a5b19eb5b312f6a20007af1b47598266c8ad48fe | Desktop Integration 44032036025 и Core 44032036094 — success | Linux/Electron тесты, транспорт demo. Физический Mac/Windows, signing и live media не подтверждены этим CI. |
| Draft #14 Backend | c2f0317f7b88fcec5bbcb56fdcb4baf3142acb12 | Backend Control Plane 44035510271 — success | PostgreSQL 17 в service container, Node 24, runtime NOSUPERUSER/NOBYPASSRLS. Gateway fake. |
| Draft #15 Telephony | 97de6a75cb39acb537a9e46b930f4a850453cb61 | UIS provisioning 44038235967 — success | Семь offline tests и реальный отдельный Asterisk с Local-pair/ARI в network namespace. Без внешнего UIS, PSTN и production systemd. |

[Desktop CI](https://github.com/suprunmvp-web/sashatel/actions/runs/44032036025), [Core CI](https://github.com/suprunmvp-web/sashatel/actions/runs/44032036094), [Backend CI](https://github.com/suprunmvp-web/sashatel/actions/runs/44035510271), [Telephony CI](https://github.com/suprunmvp-web/sashatel/actions/runs/44038235967).

## Матрица код / CI / развёрнуто / runtime / неизвестно

| Возможность | Код | CI | Развёрнуто | Runtime evidence и неизвестное |
| --- | --- | --- | --- | --- |
| Web onboarding | В http.ts нет signup, verify-email, reset, create organization или refresh routes | Полный путь не покрыт | Рабочий сервис не установлен аудитом | Нужно AUTH-01/EMAIL-01/организация. Главный site/brandbook не доказывает наличие SaaS. |
| Desktop session | main.cjs читает SASHATEL_OPERATOR_API_TOKEN, удаляет env после чтения; HTTPS read-only статуса | read-status и stale fencing проверяются в #10 | Установка у пользователя не проверена | Нужны настоящий login/refresh/logout/OS store и две организации. |
| Call control | control.ts имеет authorize/outbox/history; server.ts создаёт FakeAri, требует FAKE_ARI_TENANTS | Fake gateway и DB тесты зелёные | Production Backend не обнаружен по owning source | Live ARI и SIP медиа остаются задачей. |
| Operator eligibility | /v1/operator/telephony есть в #14; до live gate false/null/false | Backend CI зелёный | HTTPS origin не проверен | Схема согласована в комментарии #10, общая runtime-сборка не доказана. |
| Tenant SQL | 001 и 002 включают FORCE RLS, composite FK, ControlPlane.transaction делает set_config(...,true) | Тесты на непривилегированной runtime роли | Managed cluster не подтверждён | Проверить migration role/managed restrictions, pooling и глобальные таблицы. |
| Trunk API | GET/POST/DELETE /v1/trunks, AES-GCM envelope, registrar allowlist, durable trunk_jobs | Тестовый adapter и tenant isolation в #14 | Живое подключение Web→worker не подтверждено | server.ts не вызывает provisionNext. backend generation integer и Python UUID revision ещё не соединены adapter. |
| Trunk removal | #14 ждёт adapter.remove и удаляет ciphertext; #15 disabled убирает active pointer | Отдельные ветки тестируются | Не установлено | В #15 остаются старые secret-bearing bundles. REMOVE должен подтверждать purge после runtime teardown и retention policy. |
| Provisioning | Python single-scope manifest/lock/атомарный symlink/rollback | Реальный Asterisk fixture зелёный | Live REGISTER исторически описан на Timeweb | Реальный systemd и состояние VPS сейчас неизвестны. Нельзя повторять старое «Asterisk отсутствует». |
| UIS transport | UDP bind 5062, REGISTER profile | Fixture регистрирующий объект, без связи с UIS | В поздних комментариях есть исходящий REGISTER | Входящий 401 не наблюдался по отчёту. Ожидается Timeweb. Нет текущего доказательства Registered/usable. |
| Media/recording | Lab PJSIP/dialplan, Desktop TestTransport; production WebRTC/запись не подтверждены | ARI Local pair не проверяет Desktop↔UIS media | Не установлено | WSS/DTLS, ICE/TURN, protected recording pipeline и E2E нужны. |
| Биллинг | Wallet reserve и INSUFFICIENT_BALANCE до вызова; used инкрементируется при intent | Пилотные accounting tests | Боевой учёт не подтверждён | Расхождение с постоплатой и dispatch policy. Округление не утверждено. |
| Recovery | Worker pending rollback, idempotent request и node restart fixture | Изолированные проверки | Backup/PITR deployment отсутствует в доказательствах | Systemd reboot, managed DB restore, recording recovery и multi-trunk ещё проверить. |

Owning code — [Backend server](https://github.com/suprunmvp-web/sashatel/blob/c2f0317f7b88fcec5bbcb56fdcb4baf3142acb12/backend/server.ts), [HTTP](https://github.com/suprunmvp-web/sashatel/blob/c2f0317f7b88fcec5bbcb56fdcb4baf3142acb12/backend/http.ts), [control](https://github.com/suprunmvp-web/sashatel/blob/c2f0317f7b88fcec5bbcb56fdcb4baf3142acb12/backend/control.ts), [trunks](https://github.com/suprunmvp-web/sashatel/blob/c2f0317f7b88fcec5bbcb56fdcb4baf3142acb12/backend/trunks.ts), [SQL 001](https://github.com/suprunmvp-web/sashatel/blob/c2f0317f7b88fcec5bbcb56fdcb4baf3142acb12/backend/migrations/001.sql), [SQL 002](https://github.com/suprunmvp-web/sashatel/blob/c2f0317f7b88fcec5bbcb56fdcb4baf3142acb12/backend/migrations/002-uis.sql), [runtime grants](https://github.com/suprunmvp-web/sashatel/blob/c2f0317f7b88fcec5bbcb56fdcb4baf3142acb12/backend/migrations/runtime.sql).

Desktop/telephony code — [main](https://github.com/suprunmvp-web/sashatel/blob/a5b19eb5b312f6a20007af1b47598266c8ad48fe/desktop/main.cjs), [operator reader](https://github.com/suprunmvp-web/sashatel/blob/a5b19eb5b312f6a20007af1b47598266c8ad48fe/desktop/integration/operator-status.mjs), [live worker](https://github.com/suprunmvp-web/sashatel/blob/97de6a75cb39acb537a9e46b930f4a850453cb61/infra/asterisk/uis/live_worker.py), [renderer](https://github.com/suprunmvp-web/sashatel/blob/97de6a75cb39acb537a9e46b930f4a850453cb61/infra/asterisk/uis/uis.py), [real fixture](https://github.com/suprunmvp-web/sashatel/blob/97de6a75cb39acb537a9e46b930f4a850453cb61/infra/asterisk/uis/integration_asterisk.py).

Проверены обсуждения #10/#14/#15. Backend явно запросил scoped apply/status/remove, совместный CI и подтверждение purge, а ответ на последнее wire предложение ещё не опубликован. Поэтому контракт не считается согласованным. [Комментарий Backend в #15](https://github.com/suprunmvp-web/sashatel/pull/15#issuecomment-6941163628), [отправленное предложение в #14](https://github.com/suprunmvp-web/sashatel/pull/14#issuecomment-6941182844).

## Решения

| Положение | Статус | Кто закрывает / когда |
| --- | --- | --- |
| Web signup/email/ИНН и trunk management, Desktop calls, без VPN клиента | Принято в продукте | Реализовать по ТЗ |
| PostgreSQL сохранить | Принято текущей архитектурой и запросом | Замена не предлагается |
| Постоплата без кредитного лимита | Принято в продукте | Backend убрать prepaid gate до продуктового E2E |
| Yandex Cloud, три DB AZ и off-provider backup | Предложено ARCH-01 | Владелец утверждает после capacity/коммерческого review |
| Node 24 LTS / PostgreSQL 17 / Asterisk 22 LTS | Предложено | Backend/Telephony фиксируют patches и совместный manifest |
| RTO/RPO/SLO и 90 дней записей для sizing | Предложено | Владелец и эксплуатация утверждают после restore/load tests |
| Срок хранения, согласия, обработчики ПДн и AI region | Требует решения/юридической проверки | До клиентских данных и передачи AI |
| Три доступные зоны YC и квоты после инцидента | Требует проверки | Письменный capacity plan до заказа |
| Media capacity, UIS transport/SBC/egress и registration failover | Требует проверки | NET-01/MEDIA-01 и оператор |
| Правила Caller ID «На удаление», лимит 8 и округление | Требует продуктового/операторского решения | До алгоритма карусели/боевого учёта |
| Wire Backend integer generation ↔ worker UUID, REMOVE purge | Требует согласования и кода | PROVISION-01 |
| Роли, дата выпуска и исполнители задач | Требует назначения | План не назначает людей автоматически |

## Второй проход собственного решения

| Проверенный сценарий | Последствие | Изменение/контроль в финальном плане | Остаточный риск |
| --- | --- | --- | --- |
| Потеря зоны / октябрьский incident | API/PBX/DB capacity одновременно под угрозой | 3 DB AZ, 2 app/job/PBX/TURN AZ, independent backup, резерв квот restore | Региональный отказ требует DR, активные вызовы теряются |
| Ложное «HA» двух app с локальными sessions/rate limits | login/revoke непоследовательны | БД для auth, доверенный proxy, shared abuse limits, client reconnect | Полную нагрузку 100k аккаунтов ещё измерять |
| Ошибка migration | Потеря совместимости release | Expand/contract, restore rehearsal, separate migrator и один deploy lock | Деструктивный rollback БД требует восстановления и сверки событий |
| Глобальный restart при добавлении транка | Остановка всех tenants узла | Multi-trunk manifest и hot reload/drain до приёма нескольких организаций | Worker текущего PR #15 запрещено считать multi-tenant ready |
| Неопределённый originate после timeout | Двойной платный вызов | Durable attempt, stable IDs, owner fencing, reconcile без повторного originate | Provider CDR задерживается, статус unknown остаётся видимым |
| Split-brain PBX | Два исходящих пути на один trunk | External node fencing перед failover и server-side gate | UIS может ограничить регистрацию и egress |
| Нет S3 / disk full | Потеря записи и истории | Private chunk spool, checksum, quota/alerts, admission policy | Последний незагруженный chunk и текущий audio могут быть потеряны |
| Удаление пользователя/транка | Остаточный доступ и секреты | Revoke auth/identity, новые calls запрещены, REMOVE purge receipt | Backups требуют своей retention, бизнес disable не должен рвать текущий звонок |
| Украденный secret ключ одного сервиса | Массовая утечка | Scoped IAM, KMS envelope, separate recovery account, redacted logs | Root PBX может читать секреты своего узла, ограничить blast radius |
| Неработающая почта | Нет signup и invite | durable retries, bounce/complaint, quota и проверка доставляемости | SaaS onboarding зависит от внешних почтовых сетей |
| Один домен/CA/облачный IAM | Общий отказ ingress и управления | MFA, break-glass, expiry alerts, reproducible bootstrap, independent recovery keys | Общий control plane остаётся shared dependency |
| Медиа через обычный HTTP LB | Односторонний звук/потеря привязки | Отдельные media addresses, ICE/TURN, server assignment | NAT/UDP маршруты требуют реальной сетевой проверки |
| Новая база 300k аккаунтов | Слишком ранние Kubernetes/shards | Growth по CPS/concurrency/IOPS/WS, индекс/partition прежде shard | Архитектурные limits подтверждать периодически |

Самопроверка выявила и исправила арифметику нагрузки до публикации — базовый профиль 98 секунд занятости, 11/1089/3267 sessions. Стоимость ниже учитывает два TURN и два PBX, третий DB host, staging и внешний backup. Прежнее описание worker как «готового provisioning продукта» ограничено single-trunk pilot. Этапы внедрения не предполагают автоматический перенос активного звонка.
