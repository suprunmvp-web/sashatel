# SashaTel Desktop UI

Компактное рабочее место для ручных исходящих звонков. Существующий Electron 45.3.2 + HTML/CSS/JavaScript сохранён; runtime-зависимостей и нового UI-фреймворка нет. JS проверяется TypeScript через JSDoc и строгие контракты.

## Запуск и проверки

Node.js 24 LTS, npm. Из `desktop`:

```sh
npm ci
npm start
npm run typecheck
npm run lint
npm test
npm run test:components
npm run test:electron
npm run build
```

Component tests используют установленный `/usr/bin/chromium`, `CHROMIUM_PATH` либо браузер Playwright (`npx playwright install chromium`). Electron E2E требует дисплей; на Linux CI: `xvfb-run -a npm run test:electron`. Только тестовый launcher передаёт `--no-sandbox` для ограниченной cloud-среды. Production `npm start` этот флаг не использует; Chromium sandbox нужно отдельно проверить в целевой ОС. Electron preferences сохраняют contextIsolation/sandbox/webSecurity и отключённый Node integration.

`build` создаёт распакованное приложение для текущей ОС/архитектуры в `dist/`. Для macOS можно передать `--platform=darwin --arch=arm64`, но такая сборка в этой задаче не проверялась. Это не подписанный установщик. В cloud Electron ZIP получен через HTTPS и сверён с SHA256 из установленного пакета; упаковка воспроизведена командой `npm run build -- --electron-zip-dir=/tmp/sashatel-electron-zips`.

Проверить упакованное приложение тем же E2E:

```sh
SASHATEL_EXECUTABLE=./dist/SashaTel-linux-x64/SashaTel xvfb-run -a npm run test:electron
```

## Реализовано

- Dialer: ввод, вставка форматированного номера РФ, редактирование выделения, backspace, компактная клавиатура, Enter, guards повторных команд. Повторный набор из истории лишь заполняет поле; сам звонок не запускается.
- Call: connecting / ringing / active / terminating / ended / failed из CallPort. UI только читает длительность сервиса; до ответа показано `—:—`. Нижняя навигация скрыта в вызове. Завершение и ошибка возвращают к набору с итоговым сообщением; неподтверждённая очистка не разблокирует новый звонок.
- History: направление, результат, дата/время, длительность, повторный набор, loading/empty/error/retry. В демо — только память текущей сессии.
- Settings: input/output/volume/test/permission/error controls. Индикатор использует только уровень из AudioPort. Без сервиса устройства и тесты недоступны. Добавлена тонкая UI-привязка к опубликованному Audio Device Service из PR #3, без переноса или переписывания сервиса.
- Светлая, тёмная и системная темы; сохранение предпочтения; reduced motion; клавиатурный фокус. Минимум — 400×640 content px, начальный размер — 460×780. Низкое окно уменьшает клавиатуру; Settings прокручивается внутри фиксированной оболочки. Масштаб 125–150% использует прокрутку основной области.
- Изолированный заменяемый SVG `assets/sashatel-logo.svg`: временная существующая плитка S из веб-кабинета, не официальный геометрический знак. Официальный SVG заменяет один файл.

## Что является демонстрацией

В этой ветке нет настоящей телефонии. Call adapter не открывает соединений, не регистрирует SIP, не отправляет звук и не отвечает автоматически. Явно помеченные кнопки событий демонстрируют состояния. Таймер активируется лишь после ручного события «Ответ» демо-адаптера и не является доказательством реального разговора или биллингом. Demo connection всегда «Телефония не подключена». Демо-история не сохраняется после закрытия.

Доступные в соседних Draft PR Core/Audio не объединялись. Эта независимая UI-ветка не создаёт API, backend, SIP, лимитов карусели или аудиографов. Подключение и границы владения: [UI-INTEGRATION.md](UI-INTEGRATION.md).

## Визуальная основа и проверка

Источник — корневой `index.html` веб-кабинета SashaTel: нейтральная палитра, типографика системного стека, радиусы 8/10, одноцветные иконки, статусные цвета. Корневой HTML не изменён. Ветки `ui/reference-fidelity` в опубликованных refs не было; локальные Mac-материалы недоступны и не затронуты.

Реальные Linux Electron screenshots и результаты: [artifacts/README.md](artifacts/README.md). Проверка компиляции не подменяет визуальную проверку. macOS traffic lights, Retina/VoiceOver, TCC, реальные USB/Bluetooth-устройства, сон/пробуждение, подпись и установщик требуют целевой машины и интеграции Audio/Core.

Audio service and security: [audio/README.md](audio/README.md). Integration: [../docs/desktop-integration.md](../docs/desktop-integration.md).
