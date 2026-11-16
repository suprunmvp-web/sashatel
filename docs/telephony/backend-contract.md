# Контракт Telephony ↔ Backend для Issue #12

Предложение v1 для согласования Backend Engineer и Tech Lead. На этапе A доступны только локальные номера 1001 и 1002. ARI/AMI/HTTP выключены.

## Авторизация и единственный путь к PSTN

1. Desktop отправляет намерение о звонке Backend по авторизованному API с idempotency key. Backend извлекает tenant и user из сессии, проверяет принадлежность endpoint, права, подписку, минуты, одновременные звонки, допустимость назначения. Backend выбирает разрешённый Caller ID и транк.
2. Backend атомарно резервирует ёмкость и попытку до сетевой команды. Лимит **8 инициаций на нормализованный Caller ID за сутки** применяется по Caller ID вне зависимости от того, сколько пользователей его используют. Повтор того же запроса не потребляет слот дважды. Backend и биллинг должны согласовать часовой пояс и момент зачёта. До согласования блокировать внешние вызовы. Предложение для #12 — считать принятый к dispatch уникальный originate, включая неотвеченные вызовы, в явно настроенном часовом поясе политики. Не возвращать слот при неопределённой доставке и не повторять originate автоматически.
3. Транзакционная запись попытки и outbox связываются с `call_id`. Доверенный серверный worker один имеет доступ к приватному ARI. Он получает только разрешённые сервером назначения, Caller ID и trunk mapping. Команды ARI не формируются из произвольных строк URI, context, application или endpoint, пришедших с клиента. Dispatch и reconciliation привязаны к заранее назначенным channel IDs. Таймаут ответа ARI переводит попытку в unknown до сверки. Перед повторной сетевой командой необходимо доказать, что первая не создала вызов.
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
