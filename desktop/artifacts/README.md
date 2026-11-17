# Desktop UI — фактическая проверка

Базовые девять снимков Electron из UI PR #8 получены Playwright из **запущенного Electron 45.3.2 на Linux/Xvfb**, не из макетов. E2E выполнен на исходниках и на распакованном `dist/SashaTel-linux-x64/SashaTel`; последний запуск обновляет PNG из упакованного приложения. Анимации при захвате завершены, CSS приложения не подменялся. Номера тестовые, реальные звонки/медиа не выполнялись.

| Экран | Снимок |
| --- | --- |
| Dialer, светлая тема | [electron-dialer-light.png](electron-dialer-light.png) |
| Dialer, тёмная тема | [electron-dialer-dark.png](electron-dialer-dark.png) |
| Connecting, демо | [electron-connecting-dark.png](electron-connecting-dark.png) |
| Active, демо | [electron-active-dark.png](electron-active-dark.png) |
| Failed, демо | [electron-failed-dark.png](electron-failed-dark.png) |
| История | [electron-history-dark.png](electron-history-dark.png) |
| Настройки | [electron-settings-dark.png](electron-settings-dark.png) |
| Dialer, 400×640 | [electron-dialer-minimum.png](electron-dialer-minimum.png) |
| Настройки, 400×640 | [electron-settings-minimum.png](electron-settings-minimum.png) |

## Проверки

- `npm run typecheck`: строгая проверка JS/JSDoc + контрактов TypeScript.
- `npm run lint`: ESLint.
- `npm test`: 33 unit tests — валидация, защита от повторных команд, запрет автоматического ответа, время до/после ответа, история и redial, ошибки команд, terminating/quarantine, cleanup подписчиков, перевод публичного Audio API без media-эффектов.
- `npm run test:components`: 8 Chromium scenarios — реальный clipboard, редактирование selection, Enter, переходы/пустые состояния/ошибки/retry, сохранение темы, contract-driven audio, stop/late result cleanup. Axe WCAG 2 A/AA + 2.1 AA: Dialer/History/Settings в двух темах; размеры 400×640, 460×780, 760×900, 320×512. Полная видимость call CTA проверяется внутри main при поддерживаемом минимуме, а не только по границе окна.
- `DISPLAY=:98 npm run test:electron`: один составной E2E — настоящее окно, preload, security preferences, реальный переход Connecting → Ringing → Active → Failed, история, настройки, снимки, resize, zoom 125/150%, отсутствие pageerror.
- `npm run build -- --electron-zip-dir=/tmp/sashatel-electron-zips`: упаковка Linux x64. ZIP проверен по SHA256 из npm Electron checksums.
- Тот же E2E с `SASHATEL_EXECUTABLE=./dist/SashaTel-linux-x64/SashaTel`: запуск упакованного приложения.
- `git diff --check`: без ошибок whitespace.

Регрессия из [Tech Lead review 5912232629](https://github.com/suprunmvp-web/sashatel/pull/8#pullrequestreview-5912232629): до исправления новые проверки дали 19 passed / 14 failed, после — 33 passed / 0 failed. Проверены terminal snapshots без ответа, ранний remote hangup, disposed/неизвестная причина, отсутствующий/невалидный timestamp, `connectedAt=0`, connected→ended и отсутствие переноса ответа на следующий вызов. Снимок истории теперь содержит реальные демо-события answered/missed/cancelled/failed. Unknown проверен UI component test через контракт, без добавления фиктивных production-событий.

Тесты исправили регрессии повторного Enter, сброса выбора устройств до отправки команды, недоступного stop во время pending diagnostic, late audio после навигации, контраста вторичного текста и скрытого CTA на минимальном размере.

## Границы доказательств

Audio в component tests — детерминированный double, не физическое устройство. UI-фасад проверяет публичный контракт PR #3; сам независимый аудиосервис/его IPC/security не включён в эту ветку. `--no-sandbox` передаётся **только cloud E2E launcher**; проверка preferences не доказывает работу ОС sandbox в целевой среде. Production start сохраняет sandbox и не содержит этого флага.

Не проверены macOS/Windows, TCC, реальные микрофон/гарнитура/аудиовыход, физическая слышимость, Bluetooth, hardware suspend, Retina/VoiceOver, установщик, подпись/нотаризация, SIP и Backend. На macOS отдельно пройти checklist Audio-ветки после согласованной интеграции. CI workflow добавлен, но его GitHub-статус нужно смотреть отдельно от локальных результатов.


## Operator availability — decision #20

Two additional captures below come from the **running Chromium UI contract fixture**, using a fake CallPort with legacy `registered`. They are not Electron captures, real registration, real Backend readiness or screenshots of an actual connected telephone. They demonstrate the neutral unconfirmed state in both themes. The original nine Electron captures above remain the baseline UI evidence; the current Electron source/build/packaged regressions are rerun, with fresh CI captures available in the workflow artifact.

| Theme / explicit fixture provenance | Capture |
| --- | --- |
| Light, Chromium fake-port fixture | [chromium-operator-status-light.png](chromium-operator-status-light.png) |
| Dark, Chromium fake-port fixture | [chromium-operator-status-dark.png](chromium-operator-status-dark.png) |

The new component regression fails on the old mapping and checks `registered` never yields connected/ready text or a positive-colored indicator; unexpected values are unavailable. No raw SIP/registration/trunk diagnostics or management buttons are visible to the operator. Ready requires a separately approved Backend operator contract and is not implemented here.
