# Контракт Telephony ↔ Backend для Issue #12

Предложение v1 для согласования Backend Engineer и Tech Lead. На этапе A доступны только локальные номера 1001 и 1002. ARI/AMI/HTTP выключены.

## Авторизация и единственный путь к PSTN

1. Desktop отправляет намерение о звонке Backend по авторизованному API с idempotency key. Backend извлекает tenant и user из сессии, проверяет принадлежность endpoint, права, подписку, минуты, одновременные звонки, допустимость назначения. Backend выбирает разрешённый Caller ID и транк.
2. При принятии intent Backend атомарно создаёт hold для выбранного нормализованного Caller ID, минут и одновременного вызова. Для дневного лимита инвариант `held + used <= 8` действует на общий Caller ID, включая конкурентные запросы разных пользователей. Повтор того же idempotency key возвращает существующую попытку. Cancel/expiry до commit освобождает hold. Backend и биллинг согласуют часовой пояс суток. При переходе суток до dispatch Backend в одной транзакции проверяет ёмкость нового периода и переносит hold либо блокирует dispatch.
3. Первая durable commit dispatch в сторону назначения атомарно переводит hold в used, фиксирует период, `call_id`, стабильные channel IDs, trunk/Caller ID и запись dispatch. Worker выполняет серверное решение, исключая параллельное выполнение команды по тому же dispatch. Потеря ответа ARI или падение после commit сохраняют used и переводят попытку в unknown до reconciliation. Автоматический повтор originate для committed dispatch запрещён. Отмена после commit инициирует teardown и сохраняет used. Проверка #14/#15 перед PSTN: 8 разрешённых и 9-я отклонённая, конкурентный 8-й слот, идемпотентный повтор, cancel/expiry до commit, гонка cancel с commit и потеря ответа с последующей сверкой без повторного originate. Текущий #14, по ревью Tech Lead, списывает used при intent. Нужна правка #14 и совместная проверка перед PSTN. Fake adapter используется только в изолированных тестах. Команды ARI формируются из утверждённых сервером назначений и mapping, без пользовательских context/application/endpoint.
4. У Desktop endpoint нет dialplan-маршрута к транку, Local-каналам или passthrough. Запретить transfer/REFER, SIP redirect и доступ клиента к management API. Для будущего PSTN выбрать исходящий Stasis workflow с отдельным серверным ingress и egress. Авторизованный ARI worker создаёт управляемые legs и мост. Транк и SIP credentials доступны только PBX/операционному контуру. Потеря Backend/ARI останавливает новые внешние инициации. Тестировать каждое обходное направление из клиентского контекста.

## Идентификаторы и события

| Поле | Смысл |
| --- | --- |
| `call_id` | UUID бизнес-попытки, назначается Backend до originate, уникален и привязан к tenant. Одна попытка может иметь несколько legs. |
| `channel_id` | ARI Channel.id отдельного leg. Назначается сервером при originate и сверяется с CEL/CDR UniqueID на выбранном релизе. Ключ сопоставления включает PBX instance ID. |
| `linkedid` | Asterisk correlation ID. Может меняться при bridged calls и не является разрешением или стабильным ID заявки. Сохранять наблюдаемые связи и историю по PBX instance. |
| `event_id` | ID в durable ingestion, UTC occurred_at/received_at, schema_version, source, PBX instance/epoch, channel_id, linkedid при наличии. Обработку делать повторяемой, raw payload хранить ограниченно. |

- `call.ringing` по наблюдаемому состоянию destination leg. Early media и активный caller leg не означают ответ.
- `call.answered` по подтверждённому `ChannelStateChange: Up` назначенного destination leg или reconcile с CEL ANSWER того же leg. Фиксировать timestamp и отдельно bridge/media evidence. Asterisk local Answer или открытый ARI WebSocket не являются доказательством ответа абонента.
- `call.ended` по teardown всех отслеживаемых legs и освобождению мостов. Использовать ARI ChannelDestroyed плюс сверку текущих каналов и CEL HANGUP/CHAN_END/LINKEDID_END. StasisEnd означает выход из приложения, его одного недостаточно. Причины нормализовать в completed/cancelled/no_answer/busy/rejected/failed, сохраняя raw cause/cause_txt и SIP-коды когда известны.
- `call.error` для отказа originate, transport fault, dial/media timeout или явного terminal failure. Различать завершённый отказ и неизвестное состояние. После WS reconnect сверять активные каналы, мосты и долговременный журнал. Пропуск события не освобождает резерв и не создаёт успешный результат. CDR/CEL используются в reconciliation и отчётности с учётом leg, исключая двойной учёт.

## Будущие WSS и ARI

- SIP over WSS на отдельном hostname, валидный TLS сертификат с автоматическим обновлением, ограниченный доступ и short-lived endpoint credentials. SIP peer связан с авторизованной сессией, ограничен контекстом, без транковых привилегий. WSS защищает сигнализацию. Для медиа — DTLS-SRTP и ICE. TURN с краткоживущими credentials при необходимости, без открытого relay. Проверить fingerprints, negotiated SRTP, ICE paths, NAT, UDP/TURN и сценарии потери соединения.
- Управление ARI через отдельный loopback/private канал. Публичный WSS proxy пропускает только SIP WebSocket route, исключает ARI, HTTP admin и AMI. Для удалённого Backend использовать приватную сеть и TLS с аутентификацией сервиса. Секреты только в хранилище сервисов. Протокол deny-by-default и проверка попыток обхода до запуска.
- Desktop PR #10 сохраняет один call owner, устойчивый media host, минимальный IPC, reviewed CSP/permissions, CANCEL и late 2xx ACK/BYE. Сверка после process crash и подтверждение teardown обязательны. SIP registration, медиа и готовность PSTN проверяются разными сигналами. Интеграция с #12 начинается на тестовых endpoint. Подключение оператора — отдельный gate.

[ARI](https://docs.asterisk.org/Configuration/Interfaces/Asterisk-REST-Interface-ARI/) · [WebRTC](https://docs.asterisk.org/Configuration/WebRTC/Configuring-Asterisk-for-WebRTC-Clients/) · [Issue #12](https://github.com/suprunmvp-web/sashatel/issues/12)
