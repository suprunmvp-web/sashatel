# Integration Engineer — устойчивый журнал Issue #9

Собственная ветка: `feature/desktop-integration`. База PR только `feat/desktop-softphone-v1`. Не менять ветки других агентов и не merge main.

## Источники, зависимости и ревью

Проверены Issue #9 (редакция 2026-11-15T20:57:24Z), описания/diff/код/документация и комментарии всех пяти PR:

1. #2 `1655e7eefda7d89271abe9a836ab9332ca1ff867` → merge `f59df63`.
2. #6 `c3209723a4d4611bb58818be5a829226ec8f5b32` → merge `d461644`.
3. #3 `cadb039d6aa9573845c170cdfb51c4304e49f4b0` → merge `660a8e9`.
4. #7 `a00833f797bc356db79558ed8f2df329c13b3bdd` → merge `e5f0732`.
5. #8 `156c578d934061522c5647082ab2285b213c7ec2` → merge `be75d50`, конфликты разрешены с интеграционным glue.

Учтены Tech Lead review #2 `5911936502` (single owner/realm/quarantine), #3 `5911936607` (расширяемая local asset policy), #8 `5912232629` (answered только с connectedAt). Последнее уже исправлено в source #8; при интеграции дополнительно обнаружен Core `failed/no-answer` mapping → missed.

Конфликты: `.gitignore`, `desktop/README.md`, `index.html`, `main.cjs`, `preload.cjs`, `package.json`, `package-lock.json`. Сохранены permissions/lifecycle/security Audio, размеры/titlebar UI, оба CSP ограничения (media self/blob и object none), объединены dependencies/scripts, lock пересоздан npm. Один packager с Core build hook, legacy builder не используется.

## Исправленные интеграционные дефекты

- UI больше не запускает собственную DemoCallAdapter FSM: реальный main owner и typed asynchronous bridge.
- Bootstrap Audio импортируется первым; реальный singleton доступен composition root.
- Owner/session/reload fencing, строгий IPC, replay exhaustion recovery без повторного start.
- Потеря Audio lease → advisory с captured callId, никогда не call ended/cleanup.
- Ранний remote hangup Core `failed/no-answer` теперь missed; terminal timer без connectedAt остаётся `—:—`.
- Компактные размеры окна сохранены; call CTA доступен при малой высоте.
- Объединены lint globals mjs и narrow исключение для intentional security control-char regex.
- Electron 45 не запускает binary installer при обычном npm ci: добавлен project postinstall, проверяется чистым install.
- Packager 20 использует named export и object hook args; канонический Core помещается в ASAR runtime, renderer туда доступа не имеет.

## Автоматизация

2026-11-15: попытка создать «SashaTel — Desktop Integration», RRULE FREQ=HOURLY;INTERVAL=1, завершилась `too_many_active_automations`: current_count=5, plan_limit=5. Новая задача **не создана**; другие пять задач не менялись. Почасовая работа этого инженера в Cloud **не подтверждена и не настроена**. После освобождения слота создать отдельную задачу именно для Issue #9/этой ветки/её Draft PR; не присваивать Core/Audio/UI automations.

При продолжении: проверить PR по head ref, новые review/comment IDs+updated_at и CI run/head SHA; не повторять выполненное и не создавать второй PR. Новые события записывать здесь. Физический Mac не тестировался.

## Draft PR и CI

Draft PR #10: https://github.com/suprunmvp-web/sashatel/pull/10. Head 2a8faff прошёл локальную матрицу; GitHub Core run 43763590209 success. Desktop run 43763590272 выявил Ubuntu AppArmor `No usable sandbox` на системном Chromium. CI исправлен установкой bundled SUID sandbox helpers (root:root, 4755) для pinned Chromium/Electron; не отключает AppArmor, userns policy или sandbox. В CI выбран pinned Chromium вместо случайного /usr/bin/chromium. Packaged helper настраивается отдельно после build; архив создаётся до этого шага и сохраняет исходные executable permissions.
