# Приёмка стенда

Выполняется на Ubuntu после согласования этапа B. В PR приложить только обезличенные результаты. Два отдельных софтфона с выключенным автоответом и адресами VPN из runbook. В качестве registrar и SIP domain указать VPN IP Asterisk, UDP 5060. User/Auth ID совпадают с номером. Кодек PCMA или PCMU. Использовать отдельные наушники и микрофоны.

```bash
pbx() {
    sudo /opt/sashatel-asterisk/22.12.0/sbin/asterisk -C /etc/sashatel-asterisk/asterisk.conf -rx "$1"
}
sudo systemctl is-active sashatel-asterisk
pbx 'core show version'
pbx 'pjsip show transports'
pbx 'pjsip show endpoints'
pbx 'pjsip show contacts'
pbx 'dialplan show from-1001'
pbx 'dialplan show from-1002'
pbx 'cel show status'
pbx 'cdr show status'
pbx 'core show channels count'
sudo ss -lntup
sudo ufw status verbose
sudo fail2ban-client status asterisk
```

| Шаг | Критерий PASS |
| --- | --- |
| Старт и сеть | Версия 22.12.0, SIP только на VPN IPv4, нет AMI/HTTP, UFW активен. Собственный клиент вне VPN не регистрируется. UDP timeout сверить с правилами и входящим трафиком на нужном интерфейсе, одного результата UDP probe мало. |
| Регистрация | По одному контакту на 1001/1002. Qualify даёт Available. Поддельный пароль на контролируемом клиенте отклонён, клиент с неверным VPN IP не допускается. |
| Маршрут | В каждом контексте ровно одно разрешённое направление. С тестового клиента набрать внутренний несуществующий 9999 и один заведомо синтетический внешний формат, ожидать отказа при отсутствии второго канала. Проверить запрет REFER обычной функцией перевода софтфона. Если клиент умеет отправлять 302, проверить отсутствие исходящего leg на адрес из Contact. |
| 1001 → 1002 | 1002 звонит, оператор отвечает вручную. Каждый в свою очередь произносит отдельную заранее не сообщённую фразу. Второй оператор повторяет услышанное. Проверить обе стороны отдельно. |
| 1002 → 1001 | Повторить проверку, завершить с другой стороны. |
| Отмена и пропуск | Отменить до ответа, далее отдельно дождаться 25 секунд без ответа. Не должно быть ANSWER для вызываемого leg, оба leg закрываются, CDR не тарифицируется. |
| Teardown | После hangup оба клиента idle, в CLI 0 активных channels и нет bridge для попытки. В CEL для каждого открытого leg есть HANGUP/CHAN_END, для группы LINKEDID_END. Если сбой или изменение linkedid, сверить всю цепочку и текущие каналы. |
| CDR | У успешных попыток ANSWERED, answer/end заполнены, billsec согласуется с длительностью теста. Связать CEL и CDR по linkedid, отдельные leg по uniqueid. Снимки времени UTC и направлений записать в журнал приёмки. |
| Восстановление | После остановки при 0 активных каналов запустить службу, дождаться повторной регистрации и повторить успешный вызов. Проверить сохранение данных и логи. |

```bash
pbx 'core show channels concise'
pbx 'bridge show all'
sudo tail -n 25 /var/log/sashatel-asterisk/cel-custom/Master.csv
sudo tail -n 10 /var/log/sashatel-asterisk/cdr-custom/Master.csv
sudo journalctl -u sashatel-asterisk -b --no-pager
```

CDR — start, answer, end, src, dst, disposition, billsec, uniqueid, linkedid. CEL — eventtime, eventtype, channame, uniqueid, linkedid, extra. Читать как CSV с кавычками. Настроить хост на UTC. Регистрация и OPTIONS не доказывают ответ. ANSWER и CDR не доказывают слышимость. Для медиа требуется проверка аудио в каждом направлении. [CEL Specification](https://docs.asterisk.org/Configuration/Reporting/Channel-Event-Logging-CEL/CEL-Specification/)

## Матрица этапа A

| Область | Подготовлено | Проверено локально | На VPS |
| --- | --- | --- | --- |
| 22.12.0, checksum, bundled PJPROJECT | Сценарий build и staging | Bash syntax | Скачать, собрать и проверить модули |
| SIP и dialplan | Шаблоны, два направления | Рендер, права, разные секреты, отказ для публичного адреса, конфликтов IP и перезаписи, статическое ограничение dialplan | Загрузка, регистрация и вызовы после допуска |
| UFW, SSH, fail2ban | Команды, unit и jail | Статическая сверка портов | Rules, listeners, auth failures и блокировка |
| CEL/CDR и teardown | Шаблоны и сценарии | Статическая сверка конфигурации | Двустороннее аудио, CSV, завершение и restart |
| Backend и WebRTC | Контракт и границы | Документ | Следующий этап |
