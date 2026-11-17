import { countries } from "./countries.js";
const names = new Intl.DisplayNames(["ru"], { type: "region" });
const options = countries
  .map(([code, dial]) => ({ code, dial, name: names.of(code) }))
  .sort((a, b) => a.name.localeCompare(b.name, "ru"));
export function setupPhone() {
  lifecycle.abort();
  lifecycle = new AbortController();
  const input = document.querySelector("#phone");
  if (!input) return;
  const trigger = document.querySelector("#country-button");
  const picker = document.querySelector("#country-picker");
  const search = document.querySelector("#country-search");
  const list = document.querySelector("#country-options");
  let selected = { code: "RU", dial: "7" };
  function validate() {
    const digits = input.value.replace(/\D/g, "");
    input.setCustomValidity(
      digits.length < 4 || digits.length + selected.dial.length > 15
        ? "Проверьте номер телефона."
        : "",
    );
  }
  function close() {
    picker.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  }
  function draw() {
    const query = search.value.trim().toLocaleLowerCase("ru");
    list.replaceChildren();
    for (const country of options.filter((c) =>
      `${c.name} ${c.code} +${c.dial}`.toLocaleLowerCase("ru").includes(query),
    )) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "country-option";
      button.textContent = country.name;
      const code = document.createElement("span");
      code.textContent = `+${country.dial}`;
      button.append(code);
      button.addEventListener("click", () => {
        selected = country;
        document.querySelector("#country-code").textContent =
          `${country.code} +${country.dial}`;
        input.dataset.dial = country.dial;
        close();
        validate();
        input.focus();
      });
      list.append(button);
    }
    if (!list.childElementCount) list.textContent = "Страна не найдена";
  }
  input.dataset.dial = "7";
  input.addEventListener("beforeinput", (e) => {
    if (e.data && /[^\d\s()+-]/.test(e.data)) e.preventDefault();
  });
  input.addEventListener("input", () => {
    input.value = input.value.replace(/[^\d\s()+-]/g, "");
    validate();
  });
  input.addEventListener("paste", (e) => {
    e.preventDefault();
    const raw = e.clipboardData.getData("text");
    input.setRangeText(
      raw.replace(/[^\d\s()+-]/g, ""),
      input.selectionStart,
      input.selectionEnd,
      "end",
    );
    input.value = input.value.slice(0, 18);
    validate();
  });
  trigger.addEventListener("click", () => {
    if (!picker.hidden) {
      close();
      return;
    }
    picker.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    search.value = "";
    draw();
    search.focus();
  });
  search.addEventListener("input", draw);
  picker.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      trigger.focus();
    }
    if (["ArrowDown", "ArrowUp"].includes(e.key)) {
      const buttons = [...list.querySelectorAll("button")];
      const current = buttons.indexOf(document.activeElement);
      const next =
        e.key === "ArrowDown"
          ? Math.min(current + 1, buttons.length - 1)
          : Math.max(current - 1, 0);
      buttons[next]?.focus();
      e.preventDefault();
    }
  });
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!e.target.closest(".phone-field")) close();
    },
    { signal: lifecycle.signal },
  );
  trigger.closest("form").addEventListener("focusout", () => {
    queueMicrotask(() => {
      if (!document.activeElement.closest(".phone-field")) close();
    });
  });
}
let lifecycle = new AbortController();
// Each render replaces the phone DOM; release its document listener first.
