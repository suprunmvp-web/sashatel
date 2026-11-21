import {api,isPreview as preview} from "./session.js";
import {setupPhone} from "./phone.js";
import {notify} from "./notifications.js";
const root = document.querySelector("main");
const state = {
  page: "register",
  name: "",
  email: "",
  surname: "",
  challengeId: null,
  delivery: null,
  canVerify: true,
  expiresAt: 0,
  resendAt: 0,
  lookup: null,
  organization: null,
  organizations: [],
  createKey: null,
  busy: false,
  error: "",
  generation: 0,
};
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
// Presentation-only OПФ abbreviation; retain full DaData name for API and persistence.
const displayLegalName = (name) => {
  const full = String(name ?? "").trim();
  const forms = [
    [/^Индивидуальный предприниматель\s+/iu, "ИП "],
    [/^Общество с ограниченной ответственностью\s+/iu, "ООО "],
    [/^Публичное акционерное общество\s+/iu, "ПАО "],
    [/^Непубличное акционерное общество\s+/iu, "АО "],
    [/^Акционерное общество\s+/iu, "АО "],
    [/^Закрытое акционерное общество\s+/iu, "ЗАО "],
    [/^Открытое акционерное общество\s+/iu, "ОАО "],
    [/^Автономная некоммерческая организация\s+/iu, "АНО "],
    [/^Некоммерческое партнерство\s+/iu, "НП "],
    [/^Потребительский кооператив\s+/iu, "ПК "],
  ];
  for (const [pattern, short] of forms) {
    if (pattern.test(full)) return full.replace(pattern, short);
  }
  return full;
};
const icon = (name) => `<span data-icon="${name}"></span>`;
const button = (text, action, secondary = false) =>
  `<button type="button" class="button ${secondary ? "secondary" : ""}" data-action="${action}">${text}</button>`;
const field = (label, name, value = "", attributes = "") =>
  `<label>${label}<input name="${name}" value="${esc(value)}" ${attributes} required></label>`;
const password = (autocomplete) =>
  `<label>Пароль<div class="password-row"><input name="password" type="password" autocomplete="${autocomplete}" required ${autocomplete === "new-password" ? 'minlength="8"' : ""} maxlength="256" placeholder="********"><button type="button" class="icon-button" data-action="password" aria-label="Показать пароль">${icon("eye")}</button></div></label>`;
const confirmPassword = () =>
  `<div class="confirm-password" id="confirm-password" hidden><label for="repeat-password">Повторите пароль</label><div class="password-row"><input id="repeat-password" name="repeat_password" type="password" autocomplete="new-password" minlength="8" maxlength="256" placeholder="********" disabled required><button type="button" class="icon-button" data-action="password" aria-label="Показать пароль" data-for="repeat-password">${icon("eye")}</button></div></div>`;
function accountTitle() {
  return `<h1 class="serif" tabindex="-1">Добро пожаловать,<br><em>${esc(state.name)}!</em></h1>`;
}
function routeOrganization(id) {
  history.replaceState(null, "", "/"+id+"/"+(preview?"?preview=1":""));
}
function clearOrganizationRoute() {
  history.replaceState(null, "", location.pathname + location.search);
}
function challenge(response) {
  state.challengeId = response.challenge_id;
  state.canVerify=true;
  state.delivery=null;
  state.expiresAt = Date.now() + response.expires_in * 1000;
  state.resendAt = Date.now() + response.resend_after * 1000;
}
function setAccount(account) {
  state.name = account.first_name ?? account.display_name ?? "";
  state.surname = account.last_name ?? "";
  state.email = account.email;
}
function go(page) {
  state.generation++;
  state.busy = false;
  state.error = "";
  state.page = page;
  if (page === "register" || page === "login") {
    const dest = "/" + page + "/";
    if (location.pathname !== dest) history.replaceState(null, "", dest + location.search);
  }
  render();
}
function announceError(message) {
  state.error = message;
  if (message) notify(message, "error");
}
function savedTheme() {
  try {
    return localStorage.getItem("sashatel.web.theme") === "light"
      ? "light"
      : "dark";
  } catch {
    return "dark";
  }
}
function render() {
  root.classList.toggle("workspace", state.page === "cabinet");
  document.body.classList.toggle("auth-shell", state.page !== "cabinet");
  document.body.classList.toggle("auth-verifying", state.page === "verify");
  document.body.classList.toggle("auth-welcome", state.page === "welcome");
  document.body.classList.toggle("auth-waiting", state.page === "waiting");
  document.body.classList.toggle("auth-lookup", state.page === "lookup");
  document.body.classList.toggle("auth-confirm", state.page === "confirm");
  document.body.classList.toggle("in-workspace", state.page === "cabinet");
  document.documentElement.dataset.theme =
    state.page === "cabinet" ? savedTheme() : "dark";
  let html;
  switch (state.page) {
    case "register":
      html = `<h1 class="greeting" tabindex="-1">Давайте <em>познакомимся.</em></h1><div class="auth-switch">Уже есть аккаунт? <button class="text-button" data-action="login">Войти</button></div><form novalidate data-form="register"><div class="name-row">${field("Имя", "display_name", state.name, 'autocomplete="given-name" maxlength="80" placeholder="Иван"')}${field("Фамилия", "surname", state.surname, 'autocomplete="family-name" maxlength="80" placeholder="Иванов"')}</div>${field("Почта", "email", state.email, 'type="email" autocomplete="username" maxlength="254" placeholder="m@example.ru"')}<div class="phone-field"><label for="phone">Номер телефона</label><div class="phone-row"><button type="button" id="country-button" aria-label="Код страны" aria-expanded="false" aria-controls="country-picker"><span id="country-code" class="country-flag" aria-hidden="true">🇷🇺</span>${icon("chevron-down")}</button><div class="phone-entry"><span id="phone-prefix">+7</span><input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" maxlength="18" placeholder="999 123-45-67" required></div></div><div id="country-picker" hidden><label class="country-search">Страна или код<input id="country-search" type="search" autocomplete="off" placeholder="Поиск страны"></label><div id="country-options" role="group" aria-label="Страны"></div></div></div>${password("new-password")}${confirmPassword()}<div class="consents"><label class="check"><input type="checkbox" name="news"><span>Получать новости и обновления SashaTel</span></label><label class="check"><input type="checkbox" name="terms" required><span>Я принимаю <a class="legal-link" href="/legal/terms/" target="_blank" rel="noopener noreferrer">Пользовательское соглашение</a> и даю согласие на обработку персональных данных в соответствии с <a class="legal-link" href="/legal/privacy/" target="_blank" rel="noopener noreferrer">Политикой обработки персональных данных</a>.</span></label></div><button class="button" type="submit">Зарегистрироваться</button></form>`;
      break;
    case "login":
      html = `<h1 class="greeting" tabindex="-1">Добро <em>пожаловать.</em></h1><div class="auth-switch">Впервые в SashaTel? <button class="text-button" data-action="register">Создать аккаунт</button></div><form novalidate data-form="login">${field("Email", "email", state.email, 'type="email" autocomplete="username" maxlength="254" placeholder="m@example.ru"')}${password("current-password")}<a href="/recovery/${preview?"?preview=1":""}">Забыли пароль?</a><button class="button" type="submit">Войти</button><p class="legal-note">Продолжая, вы можете ознакомиться с документами: <a class="legal-link" href="/legal/terms/" target="_blank" rel="noopener noreferrer">Пользовательское соглашение</a> и <a class="legal-link" href="/legal/privacy/" target="_blank" rel="noopener noreferrer">Политика обработки персональных данных</a>.</p></form>`;
      break;
    case "verify":
      html = `<section class="verify-screen" aria-labelledby="verify-heading"><div class="verify-emblem" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg></div><h1 id="verify-heading" tabindex="-1">Подтвердите вашу почту</h1><p class="verify-intro">Мы отправили 6-значный код на <strong class="email">${esc(state.email)}</strong>.<br>Введите его для подтверждения.</p><form novalidate data-form="verify" class="verify-form"><div class="otp-field"><label class="otp-label" for="verify-code">Код подтверждения</label><div class="otp-box" id="otp-box"><div class="otp-cells" aria-hidden="true">${Array.from({length:6},(_,i)=>`<span class="otp-cell" data-otp-cell="${i}"></span>`).join("")}</div><input class="otp-input" id="verify-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" aria-label="Шестизначный код подтверждения" required></div></div><button class="button" type="submit">Подтвердить</button></form><div class="verify-actions"><p>Не получили код? <button class="verify-link" id="resend" data-action="resend" type="button">Отправить повторно</button></p><p>Не та почта? <button class="verify-link" data-action="edit-email" type="button">Изменить email</button></p></div><p class="verify-delivery" id="delivery-state" role="status"></p></section>`;
      break;
    case "organizations":
      html = '<h1 tabindex="-1">Выберите организацию</h1><div class="actions">'+state.organizations.map(org=>'<button class="button secondary" data-org="'+esc(org.id)+'">'+esc(org.legal_name)+'</button>').join('')+'</div>'+button("Создать организацию","lookup",true)+'<button class="text-button" data-action="logout">Выйти</button>';
      break;
    case "welcome":
      html = `<section class="welcome-screen" aria-labelledby="welcome-heading"><div class="welcome-head"><h1 id="welcome-heading" class="serif" tabindex="-1">Добро пожаловать, <em>${esc(state.name)}!</em></h1><p class="welcome-description">Как хотите начать работу с SashaTel?</p></div><div class="playground-welcome-choices"><section class="playground-choice" aria-labelledby="choice-create"><div class="playground-choice-icon">${icon("building-2")}</div><h2 id="choice-create">Создать организацию</h2><p>Настройте кабинет для своей команды.</p><button type="button" class="button" data-action="lookup">Создать организацию</button></section><section class="playground-choice" aria-labelledby="choice-join"><div class="playground-choice-icon">${icon("users")}</div><h2 id="choice-join">Присоединиться к команде</h2><p>Вас приглашают в существующую организацию?</p><button type="button" class="button secondary" data-action="waiting">Ожидать приглашения</button></section></div><button class="text-button welcome-logout" data-action="logout">Выйти из аккаунта</button></section>`;
      break;
    case "waiting":
      html = `<section class="playground-waiting"><div class="lookup-emblem">${icon("mail")}</div><h1>Ожидаем приглашения</h1><p>Попросите владельца организации пригласить вас на <strong class="email">${esc(state.email)}</strong>.</p><button class="button" data-action="welcome">Вернуться к выбору</button><button class="text-button" data-action="logout">Выйти</button></section>`;
      break;
    case "lookup":
      html = `<section class="lookup-screen" aria-labelledby="lookup-heading">
        <div class="lookup-emblem" aria-hidden="true">${icon("building-2")}</div>
        <h1 id="lookup-heading" class="serif" tabindex="-1">Добавьте <em>организацию.</em></h1>
        <p class="lookup-intro">Укажите ИНН — мы найдём и заполним реквизиты.</p>
        <form novalidate data-form="lookup" class="company-lookup-form">
          <div class="inn-control">
            ${field("ИНН организации или ИП", "inn", state.lookup?.inn ?? "", 'inputmode="numeric" autocomplete="off" minlength="10" maxlength="12" pattern="[0-9]{10}([0-9]{2})?" placeholder="7707083893" aria-controls="inn-suggestions" aria-autocomplete="list"')}
            <div id="inn-suggestions" class="inn-suggestions" role="listbox" aria-label="Результаты поиска" hidden></div>
          </div>
          <div class="company-form-fields">
            <label class="company-locked-field">Название организации<span class="company-locked-input"><input type="text" name="legal_name" value="${esc(state.lookup?displayLegalName(state.lookup.legal_name):'')}" disabled><img src="/assets/lock.svg" class="company-lock-icon" alt="" aria-hidden="true" width="20" height="20"></span></label>
            <label class="company-locked-field">Юридический адрес<span class="company-locked-input"><textarea name="legal_address" rows="2" disabled>${esc(state.lookup?.legal_address??'')}</textarea><img src="/assets/lock.svg" class="company-lock-icon" alt="" aria-hidden="true" width="20" height="20"></span></label>
          </div>

        </form>
        <div class="company-complete" ${state.lookup?'':'hidden'}>
          <label class="check playground-consent"><input type="checkbox" id="company-consent"><span>Подтверждаю, что уполномочен действовать от имени организации</span></label>
          <button type="button" class="button" data-action="create" id="company-create" disabled>Создать организацию</button>
        </div>
        <button class="text-button lookup-back" data-action="welcome">Вернуться к выбору</button>
      </section>`;
      break;
    case "confirm":
      html = `<section class="confirm-screen" aria-labelledby="confirm-heading"><div class="confirm-heading"><p class="confirm-step">ПОЧТИ ГОТОВО</p><h1 id="confirm-heading" class="serif" tabindex="-1">Подтвердите<br><em>организацию.</em></h1><p class="confirm-intro">Проверьте данные перед созданием кабинета.</p></div><section class="confirm-card" aria-label="Реквизиты организации"><div class="confirm-identity"><span class="confirm-company-label">ВАША ОРГАНИЗАЦИЯ</span><h2>${esc(displayLegalName(state.lookup.legal_name))}</h2></div><dl class="confirm-details"><div><dt>ИНН</dt><dd class="mono">${esc(state.lookup.inn)}</dd></div><div><dt>Юридический адрес</dt><dd>${esc(state.lookup.legal_address)}</dd></div></dl></section><p class="confirm-owner-note">Вы станете владельцем кабинета. Телефонию подключим отдельно после проверки организации.</p><div class="confirm-actions">${button("Создать организацию", "create")}<button type="button" class="text-button" data-action="lookup">Изменить ИНН</button></div></section>`;
      break;
    case "cabinet":
      html = `<div class="workspace-header"><div><div class="eyebrow">КАБИНЕТ ОРГАНИЗАЦИИ</div><h1 tabindex="-1">${esc(state.organization.legal_name)}</h1><div class="meta"><span>ИНН <span class="mono">${esc(state.organization.inn)}</span></span><span>${esc(state.name)} · Владелец</span></div></div><div class="workspace-controls"><button class="icon-button" data-action="theme" aria-label="Переключить тему">${icon(document.documentElement.dataset.theme === "dark" ? "sun" : "moon")}</button><button class="text-button" data-action="logout">Выйти</button></div></div><div class="warning">Организация не верифицирована. Телефония выключена.</div><section class="empty"><h2>Здесь начинается работа команды</h2><p>Звонков пока нет. После подключения телефонии и первого звонка здесь появятся данные организации.</p><p class="hint">Подключение телефонии будет доступно на следующем этапе.</p></section>`;
      break;
    default:
      html = ``;
  }
  root.innerHTML = `${html}<p class="error" role="alert" tabindex="-1" hidden></p>`;
  if(state.page==="verify") {
    syncOtp();
    const notice=root.querySelector("#delivery-state");
    if(notice&&state.delivery)notice.textContent=state.delivery.state==="failed"?"Письмо не доставлено. Попробуйте отправить ещё раз.":"";
  }
  window.renderSashaIcons?.(root);
  root.querySelector("h1")?.focus();
  if(state.page==="verify"){
    root.querySelector(".otp-input")?.focus({preventScroll:true});
    syncOtp();
  }

  setupPhone();

  tick();
}
function syncOtp() {
  const field=root.querySelector(".otp-input");
  if(!field)return;
  const digits=field.value.replace(/\D/g,"").slice(0,6);
  if(field.value!==digits)field.value=digits;
  const active=document.activeElement===field;
  root.querySelectorAll("[data-otp-cell]").forEach((cell,i)=>{
    cell.textContent=digits[i]||"";
    cell.classList.toggle("otp-cell--active",active&&i===Math.min(digits.length,5));
    cell.classList.toggle("otp-cell--filled",i<digits.length);
  });
}
function tick() {
  const verify=root.querySelector('[data-form="verify"] [type="submit"]');if(verify)verify.disabled=state.busy||state.canVerify===false;
  const resend = root.querySelector("#resend");
  if (!resend) return;
  const seconds = Math.max(0, Math.ceil((state.resendAt - Date.now()) / 1000));
  resend.disabled = state.busy || seconds > 0;
  resend.textContent = seconds ? `Отправить повторно (${seconds})` : "Отправить повторно";
  const remaining = Math.ceil((state.expiresAt - Date.now()) / 1000);
  // No visible validity countdown; expiry is enforced by the server.
}
async function run(action, success) {
  if (state.busy) return;
  const generation = state.generation;
  state.busy = true;
  announceError("");
  // Requests run silently. Prevent duplicate submissions without changing
  // visible button labels or adding loading text to the form.
  root.querySelectorAll("button,input").forEach((el) => {
    el.disabled = true;
  });
  try {
    const result = await action();
    if (generation === state.generation) await success(result);
  } catch (error) {
    if (generation !== state.generation) return;
    if (error.code === "ACCESS_EXPIRED" || error.code === "SESSION_REVOKED") {
      clearOrganizationRoute();
      go("login");
    }
    if (error.retryAfter) state.resendAt = Date.now() + error.retryAfter * 1000;
    announceError(
      error.message || "Не удалось выполнить запрос. Повторите позже.",
    );
  } finally {
    if (generation === state.generation) {
      state.busy = false;
      root.querySelectorAll("button,input").forEach((el) => {
        el.disabled = false;
      });
      tick();
    }
  }
}
async function enter(result) {
  if (result.account) setAccount(result.account);
  const available=result.organizations||[];
  // Reuse the existing server context instead of selecting it again on every navigation.
  const selected=result.organization||(
    available.length===1 ? (await api.openOrganization(available[0].id)).organization : null
  );
  if (selected) {
    state.organization=selected;
    location.replace("/"+selected.id+"/"+(preview?"?preview=1":""));
    return;
  }
  clearOrganizationRoute();
  state.organizations=available;
  go(available.length ? "organizations" : "welcome");
}
// Lookup results must come from the authenticated Backend/DaData API, never fixtures.
let lookupSequence=0;
let lookupTimer=null;
let lookupController=null;
let lookupSuggestions=[];
function resetLookupDropdown(dropdown) {
  dropdown.hidden=true;
  dropdown.innerHTML="";
}
function setLookupMessage(dropdown,message) {
  dropdown.hidden=false;
  dropdown.innerHTML=`<div class="inn-lookup-status" role="status">${esc(message)}</div>`;
}
async function requestCompanySuggestions(query,sequence,controller) {
  const dropdown=root.querySelector("#inn-suggestions");
  if(!dropdown||sequence!==lookupSequence||state.page!=="lookup")return;
  // No transient "searching" row; only show results, an actual empty result
  // or a real retrieval error.
  resetLookupDropdown(dropdown);
  try {
    const result=await api.suggestOrganizations(query,{signal:controller.signal});
    if(controller.signal.aborted||sequence!==lookupSequence||state.page!=="lookup")return;
    const current=root.querySelector('[name="inn"]');
    if(!current||current.value!==query)return;
    lookupSuggestions=(Array.isArray(result?.items)?result.items:[]).filter(item=>
      typeof item?.inn==="string"&&item.inn.startsWith(query)&&
      typeof item?.legal_name==="string"&&item.legal_name.trim()).slice(0,20);
    if(!lookupSuggestions.length) {
      setLookupMessage(dropdown,"Организации не найдены");
      return;
    }
    dropdown.hidden=false;
    dropdown.innerHTML=lookupSuggestions.map((item,index)=>
      `<button type="button" class="inn-result${item.verified?' inn-result--verified':''}" data-action="select-inn" data-index="${index}" role="option" aria-disabled="${item.verified?'true':'false'}" ${item.verified?'disabled':''}><span class="inn-result-icon">${icon("building-2")}</span><span><strong>${esc(displayLegalName(item.legal_name))}</strong><small>ИНН ${esc(item.inn)}${item.verified?' · Уже верифицирована в SashaTel':''}</small></span>${icon(item.verified?"lock":"arrow-right")}</button>`
    ).join("");
    window.renderSashaIcons?.(dropdown);
  }catch(error){
    if(controller.signal.aborted||sequence!==lookupSequence||state.page!=="lookup")return;
    setLookupMessage(dropdown,"Не удалось получить организации. Повторите ввод.");
  }
}
root.addEventListener("input", (event) => {
  if (state.page === "lookup" && event.target.name === "inn") {
    const field = event.target;
    const inn = field.value.replace(/\D/g, "").slice(0,12);
    if (field.value !== inn) field.value = inn;
    const dropdown = root.querySelector("#inn-suggestions");
    if (state.lookup && state.lookup.inn !== inn) {
      state.lookup = null;
      root.querySelector('[name="legal_name"]').value = "";
      root.querySelector('[name="legal_address"]').value = "";
      root.querySelector(".company-complete").hidden = true;
      // A selected suggestion or Enter triggers lookup.
    }
    clearTimeout(lookupTimer);
    lookupController?.abort();
    lookupController=null;
    const sequence=++lookupSequence;
    lookupSuggestions=[];
    resetLookupDropdown(dropdown);
    if(!state.lookup&&inn.length>=4) {
      lookupController=new AbortController();
      const controller=lookupController;
      lookupTimer=setTimeout(()=>{void requestCompanySuggestions(inn,sequence,controller);},300);
    }
  }
  if (event.target.name === "password" && state.page === "register") {
    const confirmation = root.querySelector("#confirm-password");
    if (confirmation && event.target.value && confirmation.hidden) {
      confirmation.hidden = false;
      confirmation.querySelector("input").disabled = false;
      requestAnimationFrame(() => confirmation.classList.add("is-visible"));
    }
    if (confirmation && !event.target.value && !confirmation.hidden) {
      confirmation.classList.remove("is-visible");
      confirmation.hidden = true;
      const repeat = confirmation.querySelector("input");
      repeat.disabled = true;
      repeat.value = "";
    }
  }
  if(event.target.name==="code"){
    event.target.value=event.target.value.replace(/\D/g,"").slice(0,6);
    syncOtp();
  }
});
root.addEventListener("paste", (event) => {
  if (event.target.name !== "code") return;
  const code = event.clipboardData
    .getData("text")
    .replace(/\D/g, "")
    .slice(0, 6);
  event.preventDefault();
  event.target.value = code;
  syncOtp();
});
root.addEventListener("focusin",event=>{if(event.target.name==="code")syncOtp();});
root.addEventListener("focusout",event=>{if(event.target.name==="code")requestAnimationFrame(syncOtp);});
root.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  if (state.busy) return;
  if (!form.checkValidity()) {
    const invalid=form.querySelector(":invalid");
    const message=invalid?.name==="terms"
      ? "Для регистрации примите условия соглашения и обработки данных."
      : invalid?.name==="password" || invalid?.name==="repeat_password"
        ? "Пароль должен содержать минимум 8 символов."
        : "Заполните обязательные поля и проверьте введённые данные.";
    announceError(message);
    invalid?.focus();
    return;
  }
  const values = Object.fromEntries(new FormData(form));
  if (values.email) state.email = values.email.trim();
  if (values.display_name) state.name = values.display_name.trim();
  if (values.surname) state.surname = values.surname.trim();
  const phoneInput=form.querySelector("#phone");
  const phoneNumber=phoneInput ? "+"+(phoneInput.dataset.dial||"7")+String(values.phone).replace(/\D/g,"") : null;
  const passwordField = form.querySelector("[name=password]");
  if (values.password && form.dataset.form==="register" && ((!preview && [...values.password].length<8) || [...values.password].length>128 || new TextEncoder().encode(values.password).length>512)){announceError("Пароль: от 8 до 128 символов, не более 512 байт.");return;}
  if (form.dataset.form === "register" && values.password !== values.repeat_password) {
    announceError("Пароли не совпадают.");
    return;
  }
  if (passwordField) passwordField.value = "";
  switch (form.dataset.form) {
    case "register":
      // Register uses the server-approved section17 DTO. Consent controls are not wire fields.
      if (!state.name || !state.surname) {
        announceError("Укажите имя.");
        return;
      }
      void run(
        () =>
          api.register({
            email: state.email,
            first_name: state.name,
            last_name: state.surname,
            phone: phoneNumber,
            password: values.password,
          }),
        (result) => {
          challenge(result);
          go("verify");
        },
      );
      break;
    case "login":
      void run(
        () => api.login({ email: state.email, password: values.password }),
        enter,
      );
      break;
    case "verify":
      void run(
        () =>
          api.verify({ challenge_id: state.challengeId, code: values.code }),
        enter,
      );
      break;
    case "lookup":
      // Enter also resolves only a real, full INN via Backend.
      clearTimeout(lookupTimer);
      lookupController?.abort();
      ++lookupSequence;
      lookupSuggestions=[];
      void run(
        () => api.lookup({ inn: values.inn }),
        (result) => {
          state.lookup = result;
          state.createKey = crypto.randomUUID();
          go("lookup");
        },
      );
      break;
  }
});
root.addEventListener("change", event => {
  if (event.target.id === "company-consent") {
    const create = root.querySelector("#company-create");
    if (create) create.disabled = !event.target.checked;
  }
});

root.addEventListener("change", (event) => {
  if (event.target.id === "company-consent") {
    const create = root.querySelector("#company-create");
    if (create) create.disabled = !event.target.checked;
  }
});
root.addEventListener("click", (event) => {
  const org=event.target.closest("[data-org]")?.dataset.org;
  if(org&&!state.busy){void run(()=>api.openOrganization(org),result=>{location.assign("/"+result.organization.id+"/"+(preview?"?preview=1":""));});return;}
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action || state.busy) return;
  if (action === "theme" && state.page === "cabinet") {
    const theme =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("sashatel.web.theme", theme);
    } catch {}
    const control = root.querySelector("[data-action=theme]");
    control.innerHTML = icon(theme === "dark" ? "sun" : "moon");
    window.renderSashaIcons?.(root);
    return;
  }
  if (action === "select-inn") {
    const selected=event.target.closest('[data-index]');
    const index=selected?Number(selected.dataset.index):-1;
    const item=Number.isInteger(index)?lookupSuggestions[index]:null;
    const form=root.querySelector('form[data-form="lookup"]');
    if(item&&!item.verified&&form) {
      clearTimeout(lookupTimer);
      lookupController?.abort();
      ++lookupSequence;
      lookupSuggestions=[];
      form.elements.namedItem('inn').value=item.inn;
      resetLookupDropdown(root.querySelector("#inn-suggestions"));
      void run(
        ()=>api.lookup({inn:item.inn}),
        result=>{
          state.lookup=result;
          state.createKey=crypto.randomUUID();
          go("lookup");
        },
      );
    }
    return;
  }
  if (action === "password") {
    const button = event.target.closest("[data-action=password]");
    const input = button.dataset.for
      ? root.querySelector("#" + button.dataset.for)
      : root.querySelector("[name=password]");
    input.type = input.type === "password" ? "text" : "password";
    button.setAttribute(
      "aria-label",
      input.type === "text" ? "Скрыть пароль" : "Показать пароль",
    );
    button.innerHTML = icon(input.type === "text" ? "eye-off" : "eye");
    window.renderSashaIcons?.(root);
    return;
  }
  if (action === "resend") {
    void run(
      () => api.resend({ challenge_id: state.challengeId }),
      (result) => {
        challenge(result);
        notify("Новый код отправлен", "success");
        root.querySelector("[name=code]").value = "";
        tick();
        root.querySelector("[name=code]").focus();
      },
    );
    return;
  }
  if (action === "create") {
    void run(
      () =>
        api.createOrganization(
          { lookup_id: state.lookup.lookup_id, confirm: true },
          state.createKey,
          state.lookup,
        ),
      enter,
    );
    return;
  }
  if (action === "logout") {
    void run(
      () => api.logout(),
      () => {
        clearOrganizationRoute();
        state.organization = null;
        go("login");
      },
    );
    return;
  }
  if ((action === "login" || action === "register") && action !== state.page) {
    // Switching screens is not a form submission. Clear potentially autofilled
    // credentials before removing the old form so password managers do not
    // mistake this navigation for a completed login/signup.
    const oldForm = root.querySelector('form[data-form="login"], form[data-form="register"]');
    if (oldForm) {
      if (oldForm.contains(document.activeElement)) document.activeElement.blur();
      for (const passwordInput of oldForm.querySelectorAll('input[type="password"], input[name="password"], input[name="repeat_password"]')) {
        passwordInput.value = "";
        passwordInput.defaultValue = "";
        passwordInput.autocomplete = "off";
        passwordInput.disabled = true;
      }
      oldForm.setAttribute("autocomplete", "off");
    }
  }
  go(action === "edit-email" || action === "verify-back" ? "register" : action);
});
setInterval(tick, 1000);
let checking=false;
setInterval(async()=>{if(checking||state.busy||state.page!=="verify"||!api.challengeStatus||document.hidden)return;const generation=state.generation,id=state.challengeId;checking=true;try{const c=await api.challengeStatus(id);if(generation!==state.generation)return;state.delivery=c.delivery;state.canVerify=c.can_verify;state.expiresAt=Date.parse(c.expires_at);state.resendAt=Date.parse(c.resend_at);const notice=root.querySelector("#delivery-state");if(notice)notice.textContent=c.delivery.state==="failed"?"Письмо не доставлено. Попробуйте отправить ещё раз.":"";tick();}catch(e){if(generation===state.generation&&e.code!=="RATE_LIMITED")announceError(e.message);}finally{checking=false;}},5000);
// Session lifetime is owned by the API; the preview stores only a labelled, non-secret fixture.
async function bootstrap() {
  go("loading");
  try {
    const result = await api.resume();
    // An unfinished registration challenge must not hijack an explicit sign-in route.
    // The user can have an existing verified account while this browser holds a newer challenge.
    if (result?.challenge && !location.pathname.startsWith("/login")) {
      if(result.account)setAccount(result.account);
      if(result.challenge.email)state.email=result.challenge.email;
      Object.assign(state, {
        challengeId: result.challenge.id,
        expiresAt: result.challenge.expiresAt,
        resendAt: result.challenge.resendAt,
        delivery: result.challenge.delivery,
        canVerify:result.challenge.can_verify,
      });
      go("verify");
      return;
    }
    if (result?.account) {
      setAccount(result.account);
      if(result.pendingCreate?.lookup){state.lookup=result.pendingCreate.lookup;state.createKey=result.pendingCreate.key;go("lookup");return;}
      const route = location.pathname.match(/^\/([0-9a-f-]{36})\//i);
      if (route) {
        await enter({ ...result, organization: { id: route[1] } });
      } else await enter(result);
      return;
    }
    clearOrganizationRoute();
    go(location.pathname.startsWith("/login")?"login":"register");
  } catch (error) {
    clearOrganizationRoute();
    go(location.pathname.startsWith("/login")?"login":"register");
    announceError(error.message);
  }
}
window.addEventListener("hashchange", () => {
  if (location.hash === "#content") return;
  void bootstrap();
});
void bootstrap();
