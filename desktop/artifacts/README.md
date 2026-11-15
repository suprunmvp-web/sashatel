# Фактическая проверка интегрированного Desktop

2026-11-15, Cloud Linux x64, Node 24.22.1, Electron 45.3.2, Playwright 1.58.2. PNG захвачены из настоящего Electron через Playwright, headless Ozone (без Xvfb в этой среде). Финальный захват — из `dist/SashaTel-linux-x64/SashaTel`, с каноническим Core внутри ASAR. Ни CSS, ни приложение не подменялись при захвате. **Chromium sandbox включён** (`chromiumSandbox:true`), `--no-sandbox` отсутствует и проверяется E2E. В CI используется Xvfb.

## Матрица

| Проверка | Результат | Журнал |
| --- | --- | --- |
| Чистый npm ci в пустом каталоге, project postinstall, Electron binary | PASS, 144 packages; binary установлен | [clean-install.log](logs/clean-install.log) |
| Strict JS/JSDoc typecheck + ESLint | PASS | [static.log](logs/static.log) |
| Core contracts (включая expected-negative fixtures) | PASS | [core-contracts.log](logs/core-contracts.log) |
| Core unit/integration/coverage | 215/215, lines/functions 100%, branches 99.68% | [core-coverage.log](logs/core-coverage.log) |
| Core mutations | 7/7 обнаружены | [core-mutations.log](logs/core-mutations.log) |
| Объединённые Audio/security/UI + новые bridge/media tests | 95/95 | [desktop-unit.log](logs/desktop-unit.log) |
| Chromium components/user flows/axe (обе темы) | 7/7, axe без нарушений | [components.log](logs/components.log) |
| Audio real Electron, synthetic PCM + lifecycle/resource/security | 14/14 | [audio-electron.log](logs/audio-electron.log) |
| UI real Electron source | 4/4 | [ui-electron.log](logs/ui-electron.log) |
| Electron Linux x64 build / ASAR | PASS | [build.log](logs/build.log) |
| Portable archive распакован вне checkout, самостоятельный launch | PASS | [installed-smoke.log](logs/installed-smoke.log) |
| UI E2E из пакета | 4/4 | [packaged-electron.log](logs/packaged-electron.log) |

Новые интеграционные проверки проходят путь UI facade → IPC → существующий owner/Core. Включены double start, explicit answer, no-answer history, reload active, replay/stale/invalid commands, session exhaustion/quarantine и настоящий Audio service lease loss → advisory без call ended. В Electron UI Settings выполняет selection/volume/microphone PCM/tone/stop on navigation. Audio native tests включают 20 capture/release циклов, реальные закрытия tracks/contexts, late result и имитированные disconnect/suspend/lock.

## Снимки

| Экран | Файл |
| --- | --- |
| Dialer светлый | [electron-dialer-light.png](electron-dialer-light.png) |
| Dialer тёмный | [electron-dialer-dark.png](electron-dialer-dark.png) |
| Demo/Test connecting | [electron-connecting-dark.png](electron-connecting-dark.png) |
| Demo/Test explicit connected | [electron-active-dark.png](electron-active-dark.png) |
| Ошибка транспорта Demo/Test | [electron-failed-dark.png](electron-failed-dark.png) |
| История answered/missed/cancelled/failed | [electron-history-dark.png](electron-history-dark.png) |
| Settings без физических устройств | [electron-settings-dark.png](electron-settings-dark.png) |
| Settings с измеряемым синтетическим PCM | [electron-settings-measured-pcm.png](electron-settings-measured-pcm.png) |
| Reload того же owner | [electron-reload-owner.png](electron-reload-owner.png) |
| Обычный запуск, SIP недоступен | [electron-default-unavailable.png](electron-default-unavailable.png) |
| Dialer минимум | [electron-dialer-minimum.png](electron-dialer-minimum.png) |
| Settings минимум | [electron-settings-minimum.png](electron-settings-minimum.png) |

Звонки — только локальные управляемые тестовые события. Audio Electron использует синтетический WAV и fake devices Chromium; в native Cloud inventory 0 inputs / 0 outputs. Отправка generated tone проверена, слышимость не подтверждена. Физические Mac/TCC/USB/Bluetooth/sleep, macOS bundle, Windows installer и подпись/notarization **не проверялись**. Linux результат — запуск переносимой сборки, не установка OS installer. Checklist и ограничения: [архитектура](../../docs/desktop-integration.md).

Исторические результаты независимых PR сохранены в их документации; текущая матрица выше относится к интеграционной ветке. Почасовая Cloud automation не создана: лимит 5/5 активных задач.
