# SashaTel Asterisk | этап A

Issue [#11](https://github.com/suprunmvp-web/sashatel/issues/11), ветка `feature/asterisk-foundation`. Цель этапа B — отдельный пустой Ubuntu 24.04 LTS VPS, 2 vCPU, 4 ГБ RAM, 40 ГБ NVMe. Схема рассчитана на три отдельных статических RFC1918 IPv4 в готовой WireGuard-сети на wg0 без NAT между участниками. Конфигурация SIP/RTP незашифрована внутри VPN. Реальный PSTN-транк отсутствует.

## Контекст и решения

Прочитаны `brandbook/AI_DESIGN_STANDARD.md`, `brandbook/README.md`, `brandbook/version.json` из main, `docs/desktop-integration.md` и `docs/core-desktop-contract.md` из `feature/desktop-integration`, Issue #11, [PR #10](https://github.com/suprunmvp-web/sashatel/pull/10), [Issue #12](https://github.com/suprunmvp-web/sashatel/issues/12). Версия брендбука 1.1.48. Quiet Technology требует различать процесс, регистрацию, доступность контакта, ответ, медиа и завершение. Desktop сохраняет single call owner, узкий IPC и текущий запрет сети. Реальный транспорт потребует устойчивого media host, подтверждаемого teardown и reconciliation после падения owner.

Применён DevOps Engineer 1.2.0. Версионированные конфиги и unit, отдельная сборка без root, smoke и rollback до ввода в эксплуатацию. Выбран Asterisk **22.12.0 LTS** как актуальный point release зрелой LTS-линии по проверке 16.11.2026, bundled PJPROJECT. Ветка 22 полностью поддерживается до 16.10.2028, EOL 16.10.2029. Новая ветка 24 тоже LTS. Перед каждым развёртыванием проверить advisories для 22.x. При появлении исправленного релиза обновить версию и прогнать приёмку. Скрипт фиксирует tarball и сверяет официальный SHA-256 по HTTPS. Это воспроизводимая процедура с фиксированным upstream релизом. Ubuntu security updates и версии зависимостей могут меняться. Сохранить хеш архива, Git SHA, build log, Ubuntu image ID и `dpkg-query -W` в журнале установки. [Релизы](https://www.asterisk.org/downloads/asterisk/all-asterisk-versions/) · [Поддержка](https://docs.asterisk.org/About-the-Project/Asterisk-Versions/) · [Bundled PJPROJECT](https://docs.asterisk.org/Getting-Started/Installing-Asterisk/Installing-Asterisk-From-Source/Prerequisites/PJSIP-pjproject/) · [Advisories](https://github.com/asterisk/asterisk/security/advisories)

## Что предоставить владельцу перед этапом B

- ID проекта и VPS, регион, публичный IPv4, статус публичного IPv6, текущий Ubuntu image и доступность консоли восстановления и snapshot. Подтвердить выделенный пустой сервер и окно изменений.
- SSH login с ключом, порт, закреплённый fingerprint хоста из консоли, один доверенный административный исходный IPv4/CIDR. Владелец добавляет публичный ключ оператора. Первичная установка требует sudo для пакетов, UFW, fail2ban, установки файлов и unit. Можно оставить sudo у владельца, выполняющего согласованные команды. Постоянная эксплуатация требует только чтения журналов и доступа к согласованным диагностическим командам. Право на произвольный Asterisk CLI равно праву управления вызовами и назначается отдельно.
- Имя VPN-интерфейса, его протокол и inbound порт, если VPS сам принимает VPN-подключения, доверенные публичные источники для VPN либо параметры уже существующего overlay. Указать частный IPv4 сервера и точные адреса /32 клиентов 1001 и 1002, подтвердить маршруты и отсутствие SNAT.
- Окно smoke, два оператора/софтфона и приватный канал передачи двух раздельных временных SIP-паролей. Указать срок хранения логов, CDR/CEL и место зашифрованного бэкапа. Пароли генерируются на VPS и передаются через согласованный менеджер секретов.
- Для отдельного будущего этапа Билайн запросить официальный профиль подключения. Нужны SIP registrar/proxy/SBC FQDN и порты, транспорт и TLS trust/SNI, сигнализация и RTP CIDR/порты, регистрация либо IP-auth, realm и usernames, разрешённый исходящий IP и список подтверждённых Caller ID, формат E.164/CLI и заголовки From/PAI, кодеки, DTMF, правила NAT, CPS/каналы, SIP/Q.850 причины и условия тарификации. Оператор должен подтвердить требования к тестовым номерам и входящим маршрутам.

## B.0 | Аудит и допуск владельца

Сначала выполнить [чек-лист владельца](owner-handoff.md) в режиме чтения. Выполнить сборку и проверку путей и хешей до изменения firewall. Блок установки ниже имеет явную точку остановки перед привилегированными изменениями. После аудита владелец утверждает точный diff для Timeweb и UFW, включая IPv6, вход WireGuard, существующие правила SSH и порядок отката. Продолжать только при работающей консоли и подтверждённых маршрутах.

## B.1 | Порядок изменений после допуска

1. В панели Timeweb подтвердить ОС и ресурсы, проверить доступ в recovery console, снять snapshot и зафиксировать исходные сетевые правила. На периметре оставить SSH с административного /32 и нужный порт VPN с подтверждённых источников. SIP, RTP, HTTP/ARI и AMI на публичном интерфейсе закрыть для IPv4 и IPv6. При действующем private overlay согласовать его требования отдельно.
2. Сверить fingerprint и открыть второй SSH-сеанс по ключу. Проверить sudo, console и действующий маршрут управления. Только после успешного второго входа применить SSH drop-in с `PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`. Проверить `sudo sshd -t`, `sudo sshd -T`, выполнить `sudo systemctl reload ssh` и ещё раз войти. Держать исходную сессию открытой.
3. До запуска Asterisk подтвердить WireGuard из B.0. На чистом выделенном VPS установить UFW при необходимости и включить защиту с утверждённым набором правил. При существующем UFW/nftables применить только утверждённый diff. Сохранять действующие пути SSH over IPv4/IPv6 до повторного входа. Не менять policy forwarding.

```bash
cat /etc/os-release
df -h /
free -h
nproc
timedatectl status
ip -br addr
sudo ss -lntup
sudo ufw status verbose

```

Задать `ADMIN_CIDR`, `SSH_PORT`, `PBX_IP`, `SIP_1001`, `SIP_1002` по подтверждённым значениям. Для VPN, завершающегося на VPS, добавить согласованное ingress правило VPN до включения UFW. Проверить `IPV6=yes` в UFW и существующие правила. Удалять конфликтующие широкие allow только после подтверждения recovery-доступа.

```bash
sudo ufw allow from "${ADMIN_CIDR:?}" to any port "${SSH_PORT:?}" proto tcp
for peer in "${SIP_1001:?}" "${SIP_1002:?}"; do
    sudo ufw allow in on wg0 from "$peer" to "${PBX_IP:?}" port 5060 proto udp
    sudo ufw allow in on wg0 from "$peer" to "$PBX_IP" port 10000:10199 proto udp
done
sudo ufw --dry-run default deny incoming
sudo ufw --dry-run enable
# Только после утверждения точного набора правил и проверки консоли.
sudo ufw default deny incoming
sudo ufw enable
sudo ufw status verbose
```

Проверить новый SSH-сеанс и VPN-маршруты. SIP и RTP привязаны к VPN IPv4. Правила UFW для VPN-интерфейса и точных /32 обязательны. Фактический RTP bind сверить через ss во время звонка. Для этапа B с публичным NAT нужен отдельный дизайн. За VPN оставить `direct_media=no`, `rtp_symmetric=yes`, `force_rport=yes`, `rewrite_contact=yes`. При отсутствии аудио проверить SDP и маршруты туда и обратно. Не добавлять public media address или SIP ALG в эту схему.

## Сборка и установка

Владелец передаёт одобренный checkout по SSH либо предоставляет read-only доступ к GitHub. Далее из корня checkout, в отдельном shell с `set -euo pipefail`, под непривилегированным оператором. Если целевые каталоги или unit уже существуют, остановиться и сверить прежнее развёртывание.

```bash
set -euo pipefail
umask 077
sudo apt-get update
sudo apt-get install --no-install-recommends build-essential ca-certificates curl pkg-config python3 patch libedit-dev libjansson-dev libsqlite3-dev libssl-dev libxml2-dev uuid-dev
lab=infra/asterisk
scratch=$(mktemp -d)
bash "$lab/build.sh" "$scratch/stage" 2>&1 | tee "$scratch/build.log"
git rev-parse HEAD > "$scratch/git-sha"
dpkg-query -W > "$scratch/packages.txt"
tree="$scratch/stage/opt/sashatel-asterisk/22.12.0"
test -x "$tree/sbin/asterisk"
"$tree/sbin/asterisk" -V
(cd "$tree" && find . -type f -print0 | sort -z | xargs -0 sha256sum) > "$scratch/staged.sha256"
sha256sum "$scratch/"{git-sha,packages.txt,build.log,staged.sha256}
# STOP. Сохранить evidence bundle до применения B.1.
```

После B.1 продолжить в той же сессии. Установка пакета fail2ban может запустить дистрибутивный SSH jail. На свежем VPS установить его с отключённым автозапуском через штатную политику пакетного менеджера либо заранее согласовать его влияние на SSH. Для существующего fail2ban сохранить остальные jail.

```bash
command -v fail2ban-client
sudo test ! -e /opt/sashatel-asterisk/22.12.0
sudo test ! -e /etc/sashatel-asterisk
sudo test ! -e /etc/systemd/system/sashatel-asterisk.service
sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin sashatel-pbx
sudo install -d -o root -g root -m 0755 /opt/sashatel-asterisk/22.12.0
sudo cp -R --no-preserve=ownership "$scratch/stage/opt/sashatel-asterisk/22.12.0/." /opt/sashatel-asterisk/22.12.0/
sudo chmod -R a+rX,go-w /opt/sashatel-asterisk/22.12.0
python3 "$lab/render.py" "$scratch/config" --bind "${PBX_IP:?}" --peer-1001 "${SIP_1001:?}" --peer-1002 "${SIP_1002:?}"
sudo install -d -o root -g sashatel-pbx -m 0750 /etc/sashatel-asterisk
sudo install -o root -g sashatel-pbx -m 0640 "$scratch/config/"*.conf /etc/sashatel-asterisk/
rm -- "$scratch/config/"*.conf
rmdir -- "$scratch/config"
(cd /opt/sashatel-asterisk/22.12.0 && sha256sum --check "$scratch/staged.sha256")
sudo install -o root -g sashatel-pbx -m 0640 "$lab/check-vpn.py" /etc/sashatel-asterisk/
sudo -u sashatel-pbx /usr/bin/python3 /etc/sashatel-asterisk/check-vpn.py /etc/sashatel-asterisk/pjsip.conf
sudo install -m 0644 "$lab/sashatel-asterisk.service" /etc/systemd/system/
sudo install -m 0644 "$lab/sashatel-asterisk.fail2ban.example" /etc/fail2ban/jail.d/sashatel-asterisk.local
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/sashatel-asterisk.service
sudo systemctl enable --now sashatel-asterisk
sudo systemctl is-active sashatel-asterisk
sudo stat -c '%a %U %G %n' /run/sashatel-asterisk/asterisk.ctl /var/log/sashatel-asterisk /var/lib/sashatel-asterisk
sudo test "$(sudo stat -c '%a:%U:%G' /run/sashatel-asterisk/asterisk.ctl)" = 600:sashatel-pbx:sashatel-pbx
sudo -u sashatel-pbx test -w /var/log/sashatel-asterisk
sudo -u sashatel-pbx test -w /var/lib/sashatel-asterisk
sudo test -f /var/log/sashatel-asterisk/security
sudo fail2ban-client -t
sudo systemctl enable --now fail2ban
sudo fail2ban-client reload
sudo fail2ban-client status asterisk
```

Для выдачи и ротации паролей выполнить [процедуру владельца](owner-handoff.md#выдача-и-ротация). Открывать тестовым клиентам доступ к VPN после проверки службы и jail. Аутентификация PJSIP по уникальным секретам и IP ACL, без анонимного endpoint. Контексты допускают только противоположный внутренний номер, без шаблонов и транков. Перевод звонка отключён, а попытки переадресации игнорируются опцией Dial i. Fail2ban — дополнительная защита после firewall. Сверить установленный filter через `sudo fail2ban-regex /var/log/sashatel-asterisk/security /etc/fail2ban/filter.d/asterisk.conf` на записи одного контролируемого отказа аутентификации. При проверке блокировки сохранить отдельный административный канал и затем снять бан с тестового /32. Проверить фактический порядок ban/allow в UFW.

## Операционная диагностика и резервирование

- `sudo journalctl -u sashatel-asterisk -b --no-pager`, `sudo systemctl status sashatel-asterisk`, `sudo ss -lntup`, `sudo ufw status numbered`. Сокеты HTTP, AMI и ARI отсутствуют. Ошибка binding требует проверить поднятие VPN до запуска сервиса. После исправления маршрута выполнить `sudo systemctl restart sashatel-asterisk` и приёмку снова.
- `pjsip show endpoints`, `pjsip show contacts`, `pjsip show transports`, `dialplan show from-1001`, `dialplan show from-1002`, `core show channels` через CLI из [приёмки](smoke.md). SIP/RTP debug только кратковременно на стенде, при явной диагностической необходимости. После использования выполнить `pjsip set logger off` и `rtp set debug off`. Диагностику и вывод с персональными данными хранить приватно.
- Логи `messages`, `security`, `cdr-custom/Master.csv`, `cel-custom/Master.csv` под `/var/log/sashatel-asterisk`. До длительной эксплуатации настроить согласованную ретенцию и сигнал о местах на диске. `logger rotate` относится к логам logger. CEL/CDR архивировать в окне остановки Asterisk, затем запустить и проверить создание новых файлов. Ротация должна сохранять доступ fail2ban к security log.
- Перед изменением скачать зашифрованный бэкап /etc/sashatel-asterisk, runtime state из /var/lib/sashatel-asterisk, закрытых журналов, unit, jail, SSH/UFW настроек и версии установленного артефакта. Для согласованного снимка данных остановить PBX после освобождения каналов. Проверить восстановление на изолированной машине и разрешения файлов. При crash зафиксировать окно потери событий, сверить реальные каналы и CSV. До reconciliation статус попытки неизвестен. Повторный originate после неизвестного исхода запрещён.
- При частичной установке остановить unit, если он создан. Сверить наличие пользователя, артефакта, приватной конфигурации, unit и jail. Повторить только пропущенный шаг при совпадении хешей и прав. При дрейфе архивировать конфиги и журналы, затем откатить добавленные ресурсы в обратном порядке. Не повторять установку поверх существующих файлов и не сбрасывать общий firewall.
- Rollback новой установки: `sudo systemctl disable --now sashatel-asterisk`, проверить отсутствие listener и активных каналов, удалить добавленный jail и `sudo fail2ban-client reload`. Удалить только добавленные правила UFW по точному выражению или заново проверенному номеру. Удалить unit и выполнить `sudo systemctl daemon-reload`. Конфиги и журналы архивировать закрыто, бинарники удалить после сверки пути. При блокировке SSH восстановить согласованные настройки из панели/консоли, сохранив административный доступ. Если выбран rollback snapshot, сохранить последние журналы отдельно и подтвердить допустимость потери последующих изменений. После отката перепроверить SSH, VPN и отсутствие SIP/RTP listeners.
