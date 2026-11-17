# @sashatel/call-lifecycle

Независимое от UI ядро исходящего вызова: JavaScript ES modules, без runtime-зависимостей. Тесты используют node:test; TypeScript — единственная dev-зависимость для проверки публичных контрактов. Реального или демонстрационного SIP-адаптера в поставке нет. Наличие ядра не меняет текущий демо-режим Desktop.

```bash
# Из корня репозитория, Node.js 24 LTS.
npm --prefix packages/call-lifecycle ci --ignore-scripts --no-audit --no-fund
npm --prefix packages/call-lifecycle test
npm --prefix packages/call-lifecycle run test:integration
npm --prefix packages/call-lifecycle run test:contracts
npm --prefix packages/call-lifecycle run test:coverage
npm --prefix packages/call-lifecycle run test:mutations
```

API: [src/index.js](src/index.js). Контракт транспорта: [src/transport.js](src/transport.js).

[Архитектура, таблица состояний, интеграция с Desktop, результаты и ограничения](../../docs/call-lifecycle.md).

[Issue #4: единый владелец, renderer wire API, Audio boundary и integration harness](../../docs/core-desktop-contract.md).
