// Billing fragments from the approved SashaTel UI. Values come from the active organization contract.
export const billingMarkup = `<div class="ws-finance-kpis"><div><span>Текущий расход</span><strong>—</strong><small></small></div><div><span>Оплатить до</span><strong>—</strong><small>По расчётному периоду</small></div><div><span>Счетов в списке</span><strong id="billingCount">—</strong><small>Счета</small></div></div>
  <div class="ws-section-heading"><h2>Счета и документы</h2><p>Документ можно скачать после его формирования сервером</p></div>
  <div class="admin-table-frame table-scroll" tabindex="0" role="region" aria-label="Счета и документы"><table class="admin-table ws-invoices"><thead><tr><th>Номер</th><th>Период</th><th>Сумма</th><th>Статус</th><th>Документ</th></tr></thead><tbody id="billingInvoiceRows"><tr><td colspan="5" class="ws-empty">Нет данных</td></tr></tbody></table></div>`;
export const invoiceFields = `<div class="ws-dialog-fields ux-billing-form"><label>Сумма, ₽<input id="wsBillAmount" name="amount" type="text" inputmode="decimal" maxlength="24" required placeholder="Введите сумму"/></label><div class="ux-amount-presets"><button type="button" data-amount="1000">1 000 ₽</button><button type="button" data-amount="10000">10 000 ₽</button><button type="button" data-amount="50000">50 000 ₽</button><button type="button" data-amount="100000">100 000 ₽</button></div><label><span>ИНН <small class="ux-optional">· необязательно</small></span><input id="wsBillInn" name="inn" inputmode="numeric" pattern="[0-9]{10}|[0-9]{12}" placeholder="10 или 12 цифр"/></label></div>`;
export const invoiceMethod = `<div id="invoiceMethod" class="invoice-method"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6zM14 3v5h5m-9 5h5m-5 4h5"/></svg><div><strong>По счёту</strong><small>Сформируйте счёт на любую сумму и оплатите удобным способом</small></div></div>`;
export const invoiceIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6zM14 3v5h5m-9 5h5m-5 4h5"/></svg>`;

export function wireInvoiceForm(form, inn) {
  const amount = form.elements.amount;
  const payerInn = form.elements.inn;
  if (/^(?:\d{10}|\d{12})$/.test(inn ?? '')) payerInn.value = inn;
  const presets = [...form.querySelectorAll('[data-amount]')];
  const normalize = value => value.replace(/\s/g, '').replace(',', '.');
  function sync() {
    amount.setCustomValidity('');
    for (const preset of presets) {
      preset.setAttribute('aria-pressed', String(normalize(amount.value) === preset.dataset.amount));
    }
  }
  for (const preset of presets) preset.onclick = () => {
    amount.value = new Intl.NumberFormat('ru-RU').format(Number(preset.dataset.amount));
    sync();
  };
  amount.addEventListener('input', sync);
  sync();
  return () => {
    const value = normalize(amount.value);
    const valid = /^\d+(?:\.\d{1,2})?$/.test(value) && Number.isFinite(Number(value)) && Number(value) > 0;
    amount.setCustomValidity(valid ? '' : 'Введите сумму больше нуля, до двух знаков после запятой.');
    return amount.reportValidity();
  };
}
