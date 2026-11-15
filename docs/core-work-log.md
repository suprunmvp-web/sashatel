# Call Lifecycle Core — обработанные задачи

Область: Core, его тесты, типы, документация и CI. Не UI/Audio/Backend/Asterisk.

| Источник | Базовый commit / ветка | Обработанный результат |
| --- | --- | --- |
| PR #2 | `1655e7eefda7d89271abe9a836ab9332ca1ff867`, `feat/call-lifecycle-core` | FSM, RU policy, transport contract, 198 tests. Не реализовывать повторно. |
| Tech Lead review `5911936502` | PR #2, 2026-11-15 | Приняты ограничения JS realm lease/cleanup и отсутствие реальной Electron/SIP integration; отдельная задача Issue #4. Inline threads на момент чтения отсутствовали. |
| Issue #4 | новая ветка `feat/core-desktop-contract` от `1655e7e` | Реализованы in-process owner facade, typed renderer/snapshot/error API, test-only integration harness, отрицательные contract tests и CI. 215/215 tests (17 integration), 9 negative type fixtures, 7/7 detected mutations. Draft PR по head этой ветки; это кандидат для ревью, не merged production integration. |

Следующий автоматический запуск должен сначала проверить PR с head `feat/core-desktop-contract`, его актуальный commit/CI и **новые** comments/reviews. Не создавать второй PR по Issue #4 и не повторять её реализованные критерии. Новые замечания к этому результату вносить в ту же собственную ветку; для отдельной новой задачи использовать отдельную Core-ветку от указанной базы.

Постоянный почасовой облачный запуск «SashaTel — Call Lifecycle Core» настроен в исходном диалоге 2026-11-15. Его prompt ограничивает область Core и запрещает duplicate work, merge, force-unlock и реальные звонки. Работоспособность каждой будущей проверки подтверждается её фактическим run/CI, а не наличием этой записи. Облачный automation ID и credentials в репозиторий не включены.
