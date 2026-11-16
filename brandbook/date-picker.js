(() => {
  const byId = id => document.getElementById(id);
  const trigger = byId('date-range-button');
  const panel = byId('date-range-panel');
  const presets = byId('date-presets');
  const months = byId('date-months');
  const apply = byId('date-apply');
  const previous = byId('date-prev');
  const next = byId('date-next');
  const dayMs = 86400000;
  const date = (year, month, day = 1) => Date.UTC(year, month, day);
  const monthOf = (time, offset = 0) => {
    const value = new Date(time);
    return date(value.getUTCFullYear(), value.getUTCMonth() + offset);
  };
  const format = options => new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'UTC' });
  const short = format({ day: 'numeric', month: 'short' });
  const full = format({ day: 'numeric', month: 'long', year: 'numeric' });
  const title = format({ month: 'long', year: 'numeric' });
  const dayCount = new Intl.NumberFormat('ru-RU');
  const plural = new Intl.PluralRules('ru-RU');
  const today = date(2026, 10, 30);
  const firstAvailable = date(2026, 0);
  const relative = days => [today - (days - 1) * dayMs, today];
  const options = [
    ['Сегодня', relative(1)], ['Вчера', [today - dayMs, today - dayMs]],
    ['7 дней', relative(7)], ['14 дней', relative(14)], ['30 дней', relative(30)],
    ['Этот месяц', [monthOf(today), today]],
    ['Прошлый месяц', [monthOf(today, -1), monthOf(today) - dayMs]],
    ['Квартал', [date(2026, 9), today]], ['Всё время', [firstAvailable, today]]
  ];
  const weekdays = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  const compact = matchMedia('(max-width: 980px)');
  let applied = [...options[5][1]];
  let appliedPreset = 5;
  let draft = [...applied];
  let activePreset = appliedPreset;
  let view = monthOf(today, -1);

  function rangeLabel([start, end], includeYear = false) {
    if (end === null) return short.format(start) + ' — …';
    const startYear = new Date(start).getUTCFullYear();
    const endYear = new Date(end).getUTCFullYear();
    const first = short.format(start) + (startYear === endYear ? '' : ' ' + startYear);
    return first + ' — ' + short.format(end) + (includeYear ? ' ' + endYear : '');
  }

  function showRange() {
    const [start, end] = draft;
    const count = (end - start) / dayMs + 1;
    const unit = { one: 'день', few: 'дня', many: 'дней', other: 'дня' };
    byId('date-summary').textContent = rangeLabel(draft) +
      (end === null ? '' : ' · ' + dayCount.format(count) + ' ' + unit[plural.select(count)]);
    apply.disabled = end === null;
    presets.querySelectorAll('button').forEach((button, index) => {
      button.setAttribute('aria-pressed', String(index === activePreset));
    });
  }

  function renderMonth(start, index) {
    const weekday = (new Date(start).getUTCDay() + 6) % 7;
    const nextMonth = monthOf(start, 1);
    const days = [];
    for (let time = start; time < nextMonth; time += dayMs) {
      const [from, to] = draft;
      const selected = time >= from && time <= (to ?? from);
      const classes = [selected ? 'in-range' : '', time === from ? 'range-start' : '', time === (to ?? from) ? 'range-end' : ''].join(' ');
      days.push(`<button type="button" class="${classes}" aria-pressed="${selected}" aria-label="${full.format(time)}" data-day="${time}" ${time > today || time < firstAvailable ? 'disabled' : ''}>${new Date(time).getUTCDate()}</button>`);
    }
    return `<section class="date-month" aria-labelledby="date-month-${index}"><h5 id="date-month-${index}">${title.format(start).replace(/ г\.$/, '')}</h5><div class="date-days">${weekdays.map(label => `<span aria-hidden="true">${label}</span>`).join('')}${'<span aria-hidden="true"></span>'.repeat(weekday)}${days.join('')}</div></section>`;
  }

  function render(focusDay) {
    months.innerHTML = renderMonth(view, 0) + (compact.matches ? '' : renderMonth(monthOf(view, 1), 1));
    previous.disabled = view <= firstAvailable;
    next.disabled = monthOf(view, compact.matches ? 0 : 1) >= monthOf(today);
    showRange();
    if (focusDay !== undefined) months.querySelector(`[data-day="${focusDay}"]`)?.focus({ preventScroll: true });
  }

  function alignView() {
    view = monthOf(draft[1] ?? draft[0], compact.matches ? 0 : -1);
    if (view < firstAvailable) view = firstAvailable;
  }

  function close(restoreFocus = true) {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  }

  presets.innerHTML = options.map(([label], index) => `<button type="button" data-preset="${index}">${label}</button>`).join('');
  presets.addEventListener('click', event => {
    const button = event.target.closest('[data-preset]');
    if (!button) return;
    activePreset = Number(button.dataset.preset);
    draft = [...options[activePreset][1]];
    alignView();
    render();
  });

  months.addEventListener('click', event => {
    const button = event.target.closest('[data-day]');
    if (!button || button.disabled) return;
    const time = Number(button.dataset.day);
    draft = draft[1] === null ? [Math.min(draft[0], time), Math.max(draft[0], time)] : [time, null];
    activePreset = -1;
    render(time);
  });

  previous.addEventListener('click', () => { view = monthOf(view, -1); render(); if (previous.disabled) next.focus(); });
  next.addEventListener('click', () => { view = monthOf(view, 1); render(); if (next.disabled) previous.focus(); });
  trigger.addEventListener('click', () => {
    if (!panel.hidden) { close(); return; }
    draft = [...applied];
    activePreset = appliedPreset;
    alignView();
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    render();
    (presets.querySelector('[aria-pressed="true"]') || previous).focus();
  });
  byId('date-cancel').addEventListener('click', () => close());
  apply.addEventListener('click', () => {
    applied = [...draft];
    appliedPreset = activePreset;
    byId('date-range-label').textContent = rangeLabel(applied, true);
    close();
  });
  compact.addEventListener('change', () => {
    if (!panel.hidden) { alignView(); render(); }
  });
  document.addEventListener('pointerdown', event => {
    if (!panel.hidden && !panel.contains(event.target) && !trigger.contains(event.target)) close(false);
  });
  document.addEventListener('focusin', event => {
    if (!panel.hidden && !panel.contains(event.target) && !trigger.contains(event.target)) close(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); close(); }
  });
})();
