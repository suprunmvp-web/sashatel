# SashaTel — staging: передача состояния на 20.11.2026

Статус: **инфраструктура частично подготовлена, Backend ещё НЕ развёрнут и НЕ проверен через /ready**. Этот документ — оперативный handoff, а не подтверждение production readiness. Без паролей, токенов и закрытых ключей.

## Подтверждено пользователем / проверено по консоли

- Yandex Cloud: cloud `cloud-chinook-677`, folder `sashatel-staging` (`b1gi9a6fgkr55k6csn9s`).
- VM `sashatel-staging-api-1` (`fhmrp237c2cf2o6a13et`), Ubuntu 24.04, частный IP `10.128.0.32`, на момент проверки публичный IP `51.250.73.145` (динамический). Docker Engine `29.10.0`, Compose `v5.8.0` работают. Внешний SSH не заработал; **рабочий административный доступ — серийная консоль Yandex Cloud**. `ssh.service` включён и запущен, `ssh.socket` отключён.
- VM имеет исходящий HTTPS-доступ к GitHub. На VM загружены `/opt/sashatel/staging/compose.yaml` и `/opt/sashatel/staging/release.sh` из ветки `feature/yc-staging-deployment-20261119`; `release.sh` исполняемый. Попытка получить `deploy/yc-staging/.env.example` вернула 404: **такого файла в ветке нет**.
- Файл `/etc/sashatel/staging/auth-key` создан на VM с использованием `openssl rand -hex 32`, владелец UID/GID 1000:1000, права `0400`; содержимое **не печаталось**. Каталог остальных секретов ещё не заполнен по подтверждённым данным.
- `docker ps -a` на момент проверки был пуст.
- Managed PostgreSQL 17 cluster `sashatel-staging-postgresql-17`, ID `c9q4m71biboeon47tm3i`: пользователь сообщил `Running/Alive`; single host, 2 vCPU, 8 ГБ, 16 ГБ network-ssd; автоматические backup 7 дней, защита от удаления включена. Облачный тип окружения `PRODUCTION` — настройка сервиса YC; проектная метка `environment=staging`.
- По подтверждению пользователя через UI YC **созданы** два пользователя PostgreSQL: `sashatel_migrator` (владелец схемы/миграции) и `control_runtime` (непривилегированный runtime). Пользователь также **создал** базу `sashatel`, владелец `sashatel_migrator`. Их существование, SCRAM, привязка к базе, гранты и доступ ещё **не проверены SQL-соединением**. Пароли в чат не передавались.
- Container Registry ID `crpjs1v75pobqqd0ij5t`; опубликованный immutable image: `cr.yandex/crpjs1v75pobqqd0ij5t/sashatel-backend@sha256:fc298ec73e651c8862edd15ed9902a3380aef95c15171c1e56bbc4e7d155fd91`. Публикация образа **не означает**, что он запущен.
- Vercel project `sashatel`, связанный с `suprunmvp-web/sashatel`; основной домен `https://sashatel.vercel.app/` продолжает отдавать прежний HTML из `main`. Проверенный preview инфраструктурной ветки READY, **не является новой готовой Web-платформой**. Старый HTML сохранён в GitHub в ветке `backup/legacy-html-20261120` (исходный `index.html` идентичен `main` по blob SHA `9f761601103e560c8cb227cad4d2d4944ee69e8d`). Пользователь хочет использовать **этот же** домен для новой полноценной Web-платформы; не переключать домен до интеграционного QA.

## Следующие действия — выполнять по порядку

1. Открыть в Yandex Cloud кластер PostgreSQL → **Хосты**; получить **FQDN** и проверить доступ VM к TCP `6432` и security groups без открытия PostgreSQL в публичный интернет. Проверить наличие базы `sashatel` и обеих ролей.
2. Убедиться, что пароли обеих PostgreSQL-ролей сохранены в защищённом месте. **Не запрашивать и не публиковать их в чате / GitHub / VM metadata / shell history.** Надёжно доставить в `/etc/sashatel/staging/database-url` и `migration-database-url` с host FQDN, db `sashatel`, правильными логинами и TLS. Скачать/проверить CA Yandex Managed PostgreSQL в `database-ca.pem`. Соблюсти права доступа для контейнера UID 1000.
3. Проверить согласованность IAM registry-pull service account, metadata token, docker login; `release.sh` использует `jq` — убедиться, что он установлен. Проверить `compose.yaml` и `release.sh` на точном закреплённом commit/image digest.
4. Определить **реально действительный и доступный staging Web origin** (Vercel preview может быть защищён); создать закрытый `/etc/sashatel/staging/staging.env` с `BACKEND_IMAGE` (immutable digest), `STAGING_SECRETS_DIR=/etc/sashatel/staging`, `WEB_ORIGIN` и необходимыми параметрами. Не добавлять env/secrets в репозиторий.
5. Проверить snapshot/backup и миграционные права (отдельный `sashatel_migrator`), выполнить checksum migrations по `release.sh` и проверить RLS и права непривилегированного `control_runtime`. **Не запускать повторную миграцию вслепую после ошибки.**
6. Запустить Backend из проверенного image через `release.sh`, проверить `curl -fsS http://127.0.0.1:8080/ready`, контейнеры и логи; API пока только на loopback VM. Для доступа извне нужен безопасный TLS reverse proxy и серверная auth-проверка, **не открывать напрямую 8080**.
7. **Важный security debt:** временный пароль пользователя `ubuntu` ранее добавлялся в cloud-init `user-data` / метаданные VM ради входа в серийную консоль. После настройки надёжного альтернативного доступа **убрать пароль из metadata и заблокировать временный пароль**. До восстановления доступа не отключать единственный рабочий способ администрирования. Учесть Terraform drift; временную локальную копию SSH-ключа без passphrase удалить после восстановления штатного доступа.
8. Привязать Web UI к **реальным API параллельно с разработкой экранов**: регистрация/организация, транки, номера, история, статистика, финансы, интеграции, внутренняя админка. Сначала проверить соответствие актуальному контракту, доступность endpoint-ов и полноценные E2E; пока сервисы отсутствуют, показывать честные состояния, не подставлять моки и не заявлять готовность. Сначала Vercel preview, затем переключить `sashatel.vercel.app` с возможностью rollback через резервную ветку.
9. До реальных SIP/PSTN-вызовов отдельно проверить Asterisk/ARI, Caller ID, транки, ограничения карусели, классификацию и постоплатный биллинг. `LIVE_CALL_DISPATCH=disabled` в staging не менять без тестов и разрешённой отдельной процедуры.

## Опорные исходники

- Product decisions: `docs/product/PROJECT-HANDOFF-RU.md` и `docs/product/sashatel-spec-v1.0.md` в ветке `docs/product-spec-v1-20261117` (с учётом изменений 19.11.2026).
- Brand: `brandbook/AI_DESIGN_STANDARD.md`, `brandbook/icon-registry.json`.
- Staging deployment: `deploy/yc-staging/README.md`, `compose.yaml`, `release.sh` в `feature/yc-staging-deployment-20261119`.
- Backend current working branch to inspect: `feature/backend-integration-v11-20261119`; код маршрута != готовый работающий API. В частности, нужно проверить подключение trunk service в `backend/server.ts`.
- Backup legacy HTML: `backup/legacy-html-20261120`.

**Точка возобновления:** пользователь должен прислать **FQDN PostgreSQL из вкладки «Хосты»**. После этого заниматься реальным DB connectivity, secrets, migration и API deployment — не возвращаться к прежним многократным попыткам внешнего SSH.
