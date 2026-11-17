# SashaTel Desktop

Единая интеграционная Electron-сборка UI + Call Lifecycle Core/owner + Audio Device Service. Это Draft без SIP/Asterisk и без реальных звонков.

```sh
npm ci --ignore-scripts=false
npm start                    # Audio/Settings работают, вызовы заблокированы
SASHATEL_DEMO=1 npm start     # отдельный явно управляемый Demo/Test
npm run build                # host-platform Electron package, Linux проверен
```

Node.js 24. Для Cloud proxy: `NODE_USE_ENV_PROXY=1` при install/build. Для Windows используйте `$env:SASHATEL_DEMO='1'`.

[Архитектура, команды, безопасность, ограничения и Mac checklist](../docs/desktop-integration.md) · [проверки и скриншоты](artifacts/README.md) · [Audio](audio/README.md) · [Core](../docs/core-desktop-contract.md).

`npm test`, `npm run typecheck`, `npm run lint`, `npm run test:components`, `npm run test:audio:electron`, `npm run test:electron`. Packaged E2E: `SASHATEL_EXECUTABLE=./dist/SashaTel-linux-x64/SashaTel npm run test:electron`. Core проверки выполняются отдельно из `packages/call-lifecycle`.
