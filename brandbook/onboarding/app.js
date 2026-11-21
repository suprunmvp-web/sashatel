import { setupPhone } from "./phone.js";
import { createUnavailableApi } from "./api.js";
const preview = new URLSearchParams(location.search).get("preview") === "1";
// Failure fixtures are selected by the test runner, never by product navigation.
const scenario = {
  get value() {
    return (
      sessionStorage.getItem("sashatel.onboarding.preview.scenario") || "normal"
    );
  },
};
const api = preview
  ? (await import("./preview-api.js")).createPreviewApi(() => scenario.value)
  : createUnavailableApi();
const root = document.querySelector("main");
const state = {
  page: "register",
  name: "",
  email: "",
  surname: "",
  challengeId: null,
  expiresAt: 0,
  resendAt: 0,
  lookup: null,
  organization: null,
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
const icon = (name) => `<span data-icon="${name}"></span>`;
const button = (text, action, secondary = false) =>
  `<button type="button" class="button ${secondary ? "secondary" : ""}" data-action="${action}">${text}</button>`;
const field = (label, name, value = "", attributes = "") =>
  `<label>${label}<input name="${name}" value="${esc(value)}" ${attributes} required></label>`;
const password = (autocomplete) =>
  `<label>Пароль<div class="password-row"><input name="password" type="password" autocomplete="${autocomplete}" required ${autocomplete === "new-password" ? 'minlength="12"' : ""} maxlength="256" placeholder="Не менее 12 символов"><button type="button" class="icon-button" data-action="password" aria-label="Показать пароль">${icon("eye")}</button></div></label>`;
function accountTitle() {
  return `<h1 class="serif" tabindex="-1">Добро пожаловать,<br><em>${esc(state.name)}!</em></h1>`;
}
function routeOrganization(id) {
  const url = new URL(location.href);
  url.hash = `/organizations/${id}`;
  history.replaceState(null, "", url);
}
function clearOrganizationRoute() {
  history.replaceState(null, "", location.pathname + location.search);
}
function challenge(response) {
  state.challengeId = response.challenge_id;
  state.expiresAt = Date.now() + response.expires_in * 1000;
  state.resendAt = Date.now() + response.resend_after * 1000;
}
function setAccount(account) {
  state.name = account.display_name;
  state.email = account.email;
}
function go(page) {
  state.generation++;
  state.busy = false;
  state.error = "";
  state.page = page;
  render();
}
function announceError(message) {
  state.error = message;
  const error = root.querySelector("[role=alert]");
  error.textContent = message;
  error.hidden = !message;
  if (message) error.focus();
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
  document.body.classList.toggle("in-workspace", state.page === "cabinet");
  document.documentElement.dataset.theme =
    state.page === "cabinet" ? savedTheme() : "dark";
  let html;
  switch (state.page) {
    case "register":
      html = `<h1 class="greeting" tabindex="-1">Давайте <em>познакомимся.</em></h1><div class="auth-switch">Уже есть аккаунт? <button class="text-button" data-action="login">Войти</button></div><form data-form="register"><div class="name-row">${field("Имя", "display_name", state.name, 'autocomplete="given-name" maxlength="80" placeholder="Иван"')}${field("Фамилия", "surname", state.surname, 'autocomplete="family-name" maxlength="80" placeholder="Иванов"')}</div>${field("Почта", "email", state.email, 'type="email" autocomplete="username" maxlength="254" placeholder="you@company.ru"')}<div class="phone-field"><label for="phone">Номер телефона</label><div class="phone-row"><button type="button" id="country-button" aria-label="Код страны" aria-expanded="false" aria-controls="country-picker"><span id="country-code">RU +7</span>${icon("chevron-down")}</button><input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" maxlength="18" placeholder="999 123-45-67" required></div><div id="country-picker" hidden><label class="country-search">Страна или код<input id="country-search" type="search" autocomplete="off" placeholder="Поиск страны"></label><div id="country-options" role="group" aria-label="Страны"></div></div></div>${password("new-password")}<div class="consents"><label class="check"><input type="checkbox" name="news"><span>Получать новости и обновления SashaTel</span></label><label class="check"><input type="checkbox" name="terms" required><span>Принимаю пользовательское соглашение и согласен на обработку персональных данных</span></label></div><button class="button" type="submit">Зарегистрироваться ${icon("arrow-right")}</button></form>`;
      break;
    case "login":
      html = `<h1 tabindex="-1">Войти в SashaTel</h1><form data-form="login">${field("Email", "email", state.email, 'type="email" autocomplete="username" maxlength="254"')}${password("current-password")}<button class="button" type="submit">Войти</button></form><div class="switch"><span>Первый раз здесь?</span><button class="text-button" data-action="register">Создать аккаунт</button></div>`;
      break;
    case "verify":
      html = `<div class="eyebrow">ПОДТВЕРЖДЕНИЕ EMAIL</div><h1 tabindex="-1">Проверьте почту</h1><p class="intro">Введите код подтверждения для<br><span class="email">${esc(state.email)}</span></p><form data-form="verify"><label>Код из письма<input class="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="12" aria-describedby="code-hint" required><span class="hint" id="code-hint">6 цифр · можно вставить код целиком</span></label><button class="button" type="submit">Подтвердить email</button></form><p class="status" id="expiry"></p><button class="text-button" id="resend" data-action="resend">Отправить код ещё раз</button><br><button class="text-button" data-action="edit-email">Исправить email</button>`;
      break;
    case "welcome":
      html = `<div class="eyebrow">EMAIL ПОДТВЕРЖДЁН</div>${accountTitle()}<p>Как вы планируете начать работу?</p><div class="choice"><h2>Открыть свой кабинет</h2><p>Создайте организацию по ИНН. Реквизиты появятся автоматически после поиска.</p>${button("Создать организацию", "lookup")}</div><div class="choice"><h2>Присоединиться к команде</h2><p>Если кабинет уже есть, попросите владельца пригласить вас.</p>${button("Ожидать приглашения", "waiting", true)}</div><button class="text-button" data-action="logout">Выйти</button>`;
      break;
    case "waiting":
      html = `<div class="eyebrow">ПРИСОЕДИНЕНИЕ К КОМАНДЕ</div><h1 tabindex="-1">Ожидайте приглашения</h1><p>Попросите владельца организации отправить приглашение на <span class="email">${esc(state.email)}</span>.</p><div class="warning">Приглашений пока нет.</div>${button("Создать свою организацию", "lookup")}<button class="text-button" data-action="welcome">Назад</button>`;
      break;
    case "lookup":
      html = `<div class="eyebrow">НОВАЯ ОРГАНИЗАЦИЯ</div><h1 tabindex="-1">Найдём вашу компанию</h1><p class="intro">Введите ИНН. Проверьте юридическое название на следующем шаге.</p><form data-form="lookup">${field("ИНН организации или ИП", "inn", state.lookup?.inn ?? "", 'inputmode="numeric" autocomplete="off" minlength="10" maxlength="12" pattern="[0-9]{10}([0-9]{2})?" aria-describedby="inn-hint"')}<span class="hint" id="inn-hint">10 цифр для организации, 12 — для ИП</span><button class="button" type="submit">Найти организацию ${icon("arrow-right")}</button></form><button class="text-button" data-action="welcome">Назад</button>`;
      break;
    case "confirm":
      html = `<div class="eyebrow">ПОДТВЕРЖДЕНИЕ РЕКВИЗИТОВ</div><h1 tabindex="-1">Это ваша организация?</h1><p>Кабинет будет создан для юридического лица ниже.</p><dl class="summary"><dt>Юридическое название</dt><dd>${esc(state.lookup.legal_name)}</dd><dt>ИНН</dt><dd class="mono">${esc(state.lookup.inn)}</dd><dt>Адрес</dt><dd>${esc(state.lookup.legal_address)}</dd></dl><p class="hint">Вы станете единственным Владельцем. Проверка организации и подключение телефонии выполняются отдельно.</p><div class="actions">${button("Создать кабинет", "create")}${button("Изменить ИНН", "lookup", true)}</div><button class="text-button" data-action="welcome">Отмена</button>`;
      break;
    case "cabinet":
      html = `<div class="workspace-header"><div><div class="eyebrow">КАБИНЕТ ОРГАНИЗАЦИИ</div><h1 tabindex="-1">${esc(state.organization.legal_name)}</h1><div class="meta"><span>ИНН <span class="mono">${esc(state.organization.inn)}</span></span><span>${esc(state.name)} · Владелец</span></div></div><div class="workspace-controls"><button class="icon-button" data-action="theme" aria-label="Переключить тему">${icon(document.documentElement.dataset.theme === "dark" ? "sun" : "moon")}</button><button class="text-button" data-action="logout">Выйти</button></div></div><div class="warning">Организация не верифицирована. Телефония выключена.</div><section class="empty"><h2>Здесь начинается работа команды</h2><p>Звонков пока нет. После подключения телефонии и первого звонка здесь появятся данные организации.</p><p class="hint">Подключение телефонии будет доступно на следующем этапе.</p></section>`;
      break;
    default:
      html = ``;
  }
  root.innerHTML = `${html}<p class="error" role="alert" tabindex="-1" hidden></p>`;
  window.renderSashaIcons?.(root);
  root.querySelector("h1")?.focus();
  setupPhone();
  tick();
}
function tick() {
  const resend = root.querySelector("#resend");
  if (!resend) return;
  const seconds = Math.max(0, Math.ceil((state.resendAt - Date.now()) / 1000));
  resend.disabled = state.busy || seconds > 0;
  resend.textContent = seconds
    ? `Отправить ещё раз через ${seconds} с`
    : "Отправить код ещё раз";
  const remaining = Math.ceil((state.expiresAt - Date.now()) / 1000);
  root.querySelector("#expiry").textContent =
    remaining > 0
      ? `Код действует ещё ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
      : "Срок действия кода истёк. Запросите новый.";
}
async function run(action, success) {
  if (state.busy) return;
  const generation = state.generation;
  state.busy = true;
  announceError("");
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
  if (result.organization) {
    state.organization = (
      await api.openOrganization(result.organization.id)
    ).organization;
    routeOrganization(state.organization.id);
    go("cabinet");
  } else {
    clearOrganizationRoute();
    go("welcome");
  }
}
root.addEventListener("input", (event) => {
  if (event.target.name === "code")
    event.target.value = event.target.value.replace(/\D/g, "").slice(0, 6);
});
root.addEventListener("paste", (event) => {
  if (event.target.name !== "code") return;
  const code = event.clipboardData
    .getData("text")
    .replace(/\D/g, "")
    .slice(0, 6);
  event.preventDefault();
  event.target.value = code;
});
root.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  if (state.busy || !form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form));
  if (values.email) state.email = values.email.trim();
  if (values.display_name) state.name = values.display_name.trim();
  if (values.surname) state.surname = values.surname.trim();
  const passwordField = form.querySelector("[name=password]");
  if (passwordField) passwordField.value = "";
  switch (form.dataset.form) {
    case "register":
      // New profile fields are preview-only until Backend accepts the extended contract.
      // Do not silently add unsupported properties to the production register DTO.
      if (!state.name || !state.surname) {
        announceError("Укажите имя.");
        return;
      }
      void run(
        () =>
          api.register({
            email: state.email,
            display_name: state.name,
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
      void run(
        () => api.lookup({ inn: values.inn }),
        (result) => {
          state.lookup = result;
          state.createKey = crypto.randomUUID();
          go("confirm");
        },
      );
      break;
  }
});
root.addEventListener("click", (event) => {
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
  if (action === "password") {
    const input = root.querySelector("[name=password]");
    const button = root.querySelector("[data-action=password]");
    input.type = input.type === "password" ? "text" : "password";
    button.setAttribute(
      "aria-label",
      input.type === "text" ? "Скрыть пароль" : "Показать пароль",
    );
    button.innerHTML = icon(input.type === "text" ? "eye-off" : "eye");
    window.renderSashaIcons?.(root);
    input.focus();
    return;
  }
  if (action === "resend") {
    void run(
      () => api.resend({ challenge_id: state.challengeId }),
      (result) => {
        challenge(result);
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
  go(action === "edit-email" ? "register" : action);
});
setInterval(tick, 1000);
// Session lifetime is owned by the API; the preview stores only a labelled, non-secret fixture.
async function bootstrap() {
  go("loading");
  try {
    const result = await api.resume();
    if (result?.challenge) {
      setAccount(result.account);
      Object.assign(state, {
        challengeId: result.challenge.id,
        expiresAt: result.challenge.expiresAt,
        resendAt: result.challenge.resendAt,
      });
      go("verify");
      return;
    }
    if (result?.account) {
      setAccount(result.account);
      const route = location.hash.match(/^#\/organizations\/([0-9a-f-]+)$/i);
      if (route) {
        await enter({ ...result, organization: { id: route[1] } });
      } else await enter(result);
      return;
    }
    clearOrganizationRoute();
    go("register");
  } catch (error) {
    clearOrganizationRoute();
    go("login");
    announceError(error.message);
  }
}
window.addEventListener("hashchange", () => {
  if (location.hash === "#content") return;
  void bootstrap();
});
void bootstrap();
