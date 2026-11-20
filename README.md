# SashaTel

B2B-платформа исходящей телефонии: Web для управления организацией, Desktop для звонков, Backend и Asterisk/PBX.

## С чего начать разработчику

- [Инфраструктура Backend, DNS, хосты и исторический аудит 46/100](docs/engineering/BACKEND-INFRA-AUDIT-RU.md) — архитектурные плюсы, риски, карта устранения.
- [Инженерный handoff: Web Auth / email / E2E, статус и архитектурные решения](docs/engineering/WEB-AUTH-HANDOFF-RU.md) — **актуальный рабочий срез 21.11.2026** для ветки `feature/web-auth-production-20261121`.
- [Продуктовый handoff и решения v1.1](https://github.com/suprunmvp-web/sashatel/blob/docs/product-spec-v1-20261117/docs/product/PROJECT-HANDOFF-RU.md) — канонические продуктовые решения.
- [Полное продуктовое ТЗ v1.0](https://github.com/suprunmvp-web/sashatel/blob/docs/product-spec-v1-20261117/docs/product/sashatel-spec-v1.0.md).
- [Pull requests](https://github.com/suprunmvp-web/sashatel/pulls) — фактическое состояние инженерных изменений.

**Текущий приоритет:** реальная регистрация с паролем и подтверждением email → создание организации → Web E2E через `platform.sashatel.ru`. Лендинг отложен. `/ready` не является подтверждением готовности пользовательского сценария.

**Отделять:** запланировано / закоммичено / протестировано / развёрнуто / подтверждено end-to-end / работает в production. Не помещать секреты в GitHub.
