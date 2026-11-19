# UIS staging, provisioning и Backend #14

PR #15 добавляет генератор выключенного по умолчанию UDP REGISTER trunk. Подтвердить UDP, registrar/proxy, source bind IPv4, signalling/RTP CIDRs и порты, Caller ID, формат и согласованный тестовый номер с UIS до активации. TCP/TLS, NAT bind и IP-auth требуют отдельного профиля. [Диагностика REGISTER](uis-registration.md)

## Офлайн staging

```bash
python3 infra/asterisk/uis/test_uis.py
python3 infra/asterisk/verify-static.py
# Следующие команды предназначены для будущего доверенного worker.
python3 infra/asterisk/uis/uis.py "$WORKER_STATE" stage "$PROFILE_FILE" "$VAULT_SECRET_FILE"
python3 infra/asterisk/uis/uis.py "$WORKER_STATE" select "$REVISION"
python3 infra/asterisk/uis/uis.py "$WORKER_STATE" select "$PREVIOUS_REVISION"
python3 infra/asterisk/uis/uis.py "$WORKER_STATE" select off
```

Staging root принадлежит runner и имеет режим 0700. Secret file — приватный JSON с полями username/password, переданный из vault по защищённому каналу в runtime tmpfs. Удалить после staging. Не передавать значения через argv, stdout, Git или журнал. Строгий алфавит секрета намеренно исключает символы, способные менять синтаксис Asterisk. Если оператор выдал несовместимый пароль, остановить provisioning и согласовать поддерживаемое представление. Ревизии содержат секрет и подлежат приватной ретенции. Операции select меняют только атомарный указатель в staging, без вызова Asterisk.

## Интерфейс для #14

- Provision request v1: request_id, tenant_id, trunk_id, expected_revision, revision, enabled, profile_ref, secret_ref. Backend проверяет принадлежность trunk и authorizes request. Worker проверяет tenant/trunk scope ссылок, разрешённый provider и fencing expected_revision. Повтор того же request_id возвращает результат. Конфликт версии даёт отказ без изменения активной сборки. Отключение использует тот же fencing.
- События: request_id, tenant_id, trunk_id, revision, status, observed_at, reason_code. staged означает рендер, applied означает загрузку runtime, registered требует наблюдения PJSIP Registered, usable требует действующих ACL и проверенного маршрута. Сообщения всегда без URI, пароля и полного вывода CLI.
- Pilot фиксирует один trunk, один канал и один destination, Caller ID и номер берутся из заранее утверждённого профиля. Backend проверяет точное совпадение нормализованного номера с активной ревизией, права, подписку, лимиты, резерв и commit dispatch. Для единственной outbound команды доверенный ARI adapter использует фиксированный endpoint `Local/approved@uis-smoke-dispatch/n` с собственным ARI app и идентификаторами legs. Внешний номер не интерполируется в ARI endpoint. Связать leg IDs с call_id и linkedid через ARI/CEL, включая PJSIP leg внутри Dial. Разрыв ARI, drift ревизии, revoke и неопределённый originate закрывают новые попытки. Для существующего вызова нужно завершить Local и PJSIP legs и подтвердить teardown, без повторного originate.
- ARI предоставляет привилегированное originate API. Доступ только у доверенного Backend adapter по приватному каналу. Desktop SIP contexts не включают uis-smoke-dispatch, API не принимает произвольные endpoint/context/app. Входящие UIS вызовы не маршрутизируются. В staging-профиле нет входящей идентификации UIS SIP endpoint и ingress context пуст. Наличие ARI в текущем lab не предполагается.

## Будущее применение и откат

Provisioning worker для live publish/reload ещё требуется реализовать. Он сериализует изменения, проверяет predecessor и ноль каналов, отключает dispatch на время смены конфигурации и использует approve/deny для сети отдельно. `acl.json` — проверенный список сетей для согласования firewall, без автоматического применения. Правила должны ограничивать source/destination UIS на внешнем UDP 5062 и RTP в подтверждённом диапазоне. Проверить, что UDP lab 5060 на wg0 остаётся доступен обоим peer. При несовпадении SBC/NAT свериться с оператором.

Под будущим управляемым rollout скопировать пару файлов из выбранной неизменяемой ревизии в отдельный root-owned каталог, доступ группе sashatel-pbx только на чтение. Включать оба файла через согласованные include в pjsip.conf и extensions.conf. Коммерческий trunk и ARI не включены stage-командой. Изменение transport требует planned restart. Перед открытием dispatch проверить обе конфигурации, Registered, lab и что ни один Desktop context не достигает UIS. Runtime-проверка ARI Local/bridge и отмены обязательна на изолированном Asterisk до PSTN.

При ошибке закрыть dispatch, отключить регистрацию, восстановить предыдущую пару файлов или убрать оба include, выполнить согласованный restart и проверить отсутствие регистрации UIS при off, SIP lab и каналы. После сбоя между публикацией и загрузкой оставить dispatch закрытым до сверки running revision. Учёт PSTN и один supervised вызов выполняются по отдельному допуску владельца.
