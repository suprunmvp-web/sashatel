# SashaTel — Design System / Brandbook

Интерактивный HTML-брендбук SashaTel (ООО «Полезный звонок»).

## Vercel
1. Add New Project → Import Git Repository → `suprunmvp-web/sashatel`.
2. **Root Directory:** `brandbook` (обязательно — корневой `index.html` репозитория относится к другому продукту).
3. **Framework Preset:** `Other`.
4. **Build Command:** пусто (без сборки).
5. **Output Directory:** `.` (корень выбранной папки).
6. Deploy.

## Локально
```bash
cd brandbook
python3 -m http.server 8000
```
Открыть: http://localhost:8000

## Файлы
- `index.html` — брендбук и пример аналитики
- `style.css` — типографика Geist, темы, сетка, responsive
- `app.js` — анимация Particle Field и демонстрационные взаимодействия

## Ограничения
Это концептуальный документ дизайн-системы, не production-реализация телефонии.
Particle Field анимируется через requestAnimationFrame; фактическая частота зависит от монитора и производительности устройства.
Публичные тексты и метрики внутри HTML — демонстрационные.
