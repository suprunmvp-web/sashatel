# Desktop · контракт управления транками (#19)

`TrunkApi` в `desktop/src/trunks.d.ts` задаёт операции list/create/retry/remove. UIS использует `auth_mode: registration_credentials`. Create принимает `registrar`, `login` и write-only `password`. Desktop читает только `id`, `registrar`, `auth_mode` и `status`. Настоящий клиент должен получать свежий статус из Backend после каждой операции и при обновлении списка.

Предложение для #14 — GET/POST /v1/trunks, POST /v1/trunks/{id}/retry, DELETE /v1/trunks/{id}. Пути, право на управление в tenant, форматы ошибок и серверную идемпотентность нужно подтвердить. Для retry Backend переиспользует защищённую ссылку на секрет. DELETE и retry подчиняются tenant RBAC. Backend должен различать `configuring`, `registering`, `registered`, `ready`, `rejected`, `degraded`. `registered` подтверждает SIP-регистрацию. Готовность PSTN проверяется отдельно. Статус транка не разрешает вызов.

Текущий адаптер хранит публичные данные в памяти renderer, допускает один UIS-транк и выдаёт только `degraded`. После reload записи исчезают. Деморежим транков не меняет режим звонков. Настоящие credentials вводить не нужно. Для подключения Backend потребуется проверенный HTTPS-клиент в main, узкий IPC и проверка отправителя с существующей политикой. Renderer CSP продолжает запрещать сетевые запросы.
