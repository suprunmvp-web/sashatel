import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const base =
  process.env.PREVIEW_URL || "http://127.0.0.1:4173/brandbook/onboarding/";
const evidence = process.env.EVIDENCE_DIR || "./evidence";
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ chromiumSandbox: true });
const results = [];
const errors = [];
const id = "279a66cd-c1cc-4d19-9c09-3490e9049d0a";
async function ready(page, text) {
  await page.getByRole("heading", { name: text, exact: true }).waitFor();
}
async function scenario(page, value) {
  await page.locator("summary").click();
  await page.locator("#scenario").selectOption(value);
  await page.locator("summary").click();
}
async function screenshot(page, name) {
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  assert.equal(overflow, false, name + " horizontal overflow");
}
async function register(page) {
  await ready(page, "Начните с знакомства");
  await page
    .getByLabel("Как к вам обращаться", { exact: true })
    .fill("Александра");
  await page
    .getByLabel("Рабочий email", { exact: true })
    .fill("preview@example.test");
  assert.equal(
    await page.locator("[name=password]").getAttribute("autocomplete"),
    "new-password",
  );
  await page.locator("[name=password]").fill("fixture-password-123");
  await page
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();
  await ready(page, "Проверьте почту");
}
async function welcome(page) {
  await page.getByLabel("Код из письма").fill("123456");
  await page.getByLabel("Код из письма").press("Enter");
  await ready(page, /Добро пожаловать/);
}
try {
  for (const width of [1440, 1024, 768, 390]) {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
      });
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (["error", "warning"].includes(m.type())) errors.push(m.text());
      });
      await page.goto(base + "?preview=1");
      await ready(page, "Начните с знакомства");
      if (theme === "dark")
        await page.getByRole("button", { name: "Переключить тему" }).click();
      await screenshot(page, `${width}-${theme}-register`);
      await register(page);
      await screenshot(page, `${width}-${theme}-verify`);
      await page.reload();
      await ready(page, "Проверьте почту");
      await page.getByLabel("Код из письма").fill("000000");
      await page.getByLabel("Код из письма").press("Enter");
      await page.getByRole("alert").waitFor();
      assert.match(
        await page.getByRole("alert").textContent(),
        /неверный или истёк/,
      );
      assert.equal(
        await page
          .getByRole("alert")
          .evaluate((el) => el === document.activeElement),
        true,
      );
      await screenshot(page, `${width}-${theme}-code-error`);
      // Real paste event including separators, as delivered by the browser clipboard.
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.evaluate(() => navigator.clipboard.writeText("123 456"));
      await page.getByLabel("Код из письма").fill("");
      await page
        .getByLabel("Код из письма")
        .press(process.platform === "darwin" ? "Meta+V" : "Control+V");
      assert.equal(
        await page.getByLabel("Код из письма").inputValue(),
        "123456",
      );
      await welcome(page);
      await screenshot(page, `${width}-${theme}-welcome`);
      await page.getByRole("button", { name: "Ожидать приглашения" }).click();
      await ready(page, "Ожидайте приглашения");
      await screenshot(page, `${width}-${theme}-waiting`);
      await page
        .getByRole("button", { name: "Создать свою организацию" })
        .click();
      await ready(page, "Найдём вашу компанию");
      await page.getByLabel("ИНН организации или ИП").fill("1234567890");
      await page.getByLabel("ИНН организации или ИП").press("Enter");
      await page.getByRole("alert").waitFor();
      await screenshot(page, `${width}-${theme}-inn-error`);
      await page.getByLabel("ИНН организации или ИП").fill("7707083893");
      await page.getByLabel("ИНН организации или ИП").press("Enter");
      await ready(page, "Это ваша организация?");
      await screenshot(page, `${width}-${theme}-confirm`);
      await page.getByRole("button", { name: "Отмена", exact: true }).click();
      await ready(page, /Добро пожаловать/);
      await page
        .getByRole("button", { name: "Создать организацию", exact: true })
        .click();
      await page.getByLabel("ИНН организации или ИП").press("Enter");
      await ready(page, "Это ваша организация?");
      await scenario(page, "create-unknown");
      await page
        .getByRole("button", { name: "Создать кабинет", exact: true })
        .click();
      await page.getByRole("alert").waitFor();
      await screenshot(page, `${width}-${theme}-create-error`);
      await page
        .getByRole("button", { name: "Создать кабинет", exact: true })
        .click();
      await ready(page, "ООО «Тестовая организация SashaTel»");
      assert.match(page.url(), new RegExp(id));
      await screenshot(page, `${width}-${theme}-cabinet`);
      const saved = await page.evaluate(() =>
        JSON.stringify({ ...localStorage, ...sessionStorage }),
      );
      assert.equal(saved.includes("fixture-password-123"), false);
      assert.equal(saved.includes("Bearer"), false);
      await page.reload();
      await ready(page, "ООО «Тестовая организация SashaTel»");
      // Long Cyrillic legal name tests the same rendered API DTO boundary.
      await page.evaluate(() => {
        const key = "sashatel.onboarding.preview.fixture";
        const f = JSON.parse(sessionStorage.getItem(key));
        f.organization.legal_name =
          "Общество с ограниченной ответственностью «Межрегиональная производственная и телекоммуникационная компания Северо-Западного федерального округа»";
        sessionStorage.setItem(key, JSON.stringify(f));
      });
      await page.reload();
      await ready(page, /Межрегиональная/);
      await screenshot(page, `${width}-${theme}-long-name`);
      await page.getByRole("button", { name: "Выйти", exact: true }).click();
      await ready(page, "Войти в SashaTel");
      await page.reload();
      await ready(page, "Начните с знакомства");
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await page
        .getByLabel("Email", { exact: true })
        .fill("preview@example.test");
      await page.locator("[name=password]").fill("fixture-password-123");
      assert.equal(
        await page.locator("[name=password]").getAttribute("autocomplete"),
        "current-password",
      );
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await ready(page, /Межрегиональная/);
      await scenario(page, "session-expired");
      await page.reload();
      await ready(page, "Войти в SashaTel");
      await page.getByRole("alert").waitFor();
      await screenshot(page, `${width}-${theme}-session-expired`);
      // A new tab has no preview authentication; UUID alone cannot create a session.
      const closedReturn = await context.newPage();
      await closedReturn.goto(base + "?preview=1#/organizations/" + id);
      await ready(closedReturn, "Начните с знакомства");
      await context.close();
      results.push(
        `${width} ${theme}: path, paste, cancellation, retries, reload, logout, expiration, long name pass`,
      );
    }
  }
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 1024, height: 1000 },
    });
    const page = await context.newPage();
    await page.goto(base + "?preview=1");
    await ready(page, "Начните с знакомства");
    if (theme === "dark")
      await page.getByRole("button", { name: "Переключить тему" }).click();
    await page.getByLabel("Как к вам обращаться", { exact: true }).fill("Вера");
    await page.getByLabel("Рабочий email").fill("preview@example.test");
    await page.locator("[name=password]").fill("fixture-password-123");
    await page
      .getByRole("button", { name: "Показать пароль", exact: true })
      .click();
    assert.equal(
      await page.locator("[name=password]").getAttribute("type"),
      "text",
    );
    await page
      .getByRole("button", { name: "Скрыть пароль", exact: true })
      .click();
    await scenario(page, "delivery");
    await page
      .getByRole("button", { name: "Создать аккаунт", exact: true })
      .click();
    await page.getByRole("alert").waitFor();
    await screenshot(page, `1024-${theme}-delivery-error`);
    assert.equal(await page.locator("[name=password]").inputValue(), "");
    await scenario(page, "normal");
    await page.locator("[name=password]").fill("fixture-password-123");
    await page.locator("[name=password]").press("Enter");
    await ready(page, "Проверьте почту");
    await page.getByRole("button", { name: "Исправить email" }).click();
    await ready(page, "Начните с знакомства");
    assert.equal(
      await page.getByLabel("Рабочий email").inputValue(),
      "preview@example.test",
    );
    await page.getByLabel("Рабочий email").fill("corrected@example.test");
    await page.locator("[name=password]").fill("fixture-password-123");
    await page
      .getByRole("button", { name: "Создать аккаунт", exact: true })
      .click();
    await ready(page, "Проверьте почту");
    await page.clock.install();
    await page.clock.fastForward(61000);
    await page
      .getByRole("button", { name: "Отправить код ещё раз", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Подождите" })
      .waitFor({ state: "hidden" });
    assert.equal(await page.locator("#resend").isDisabled(), true);
    await page.clock.fastForward(61000);
    await scenario(page, "delivery");
    await page
      .getByRole("button", { name: "Отправить код ещё раз", exact: true })
      .click();
    await page.getByRole("alert").waitFor();
    await screenshot(page, `1024-${theme}-resend-error`);
    await scenario(page, "normal");
    await welcome(page);
    await page
      .getByRole("button", { name: "Создать организацию", exact: true })
      .click();
    await page.getByLabel("ИНН организации или ИП").fill("7707083893");
    for (const issue of ["lookup-missing", "lookup-down", "offline"]) {
      await scenario(page, issue);
      await page.getByLabel("ИНН организации или ИП").press("Enter");
      await page.getByRole("alert").waitFor();
      await screenshot(page, `1024-${theme}-${issue}`);
    }
    await scenario(page, "normal");
    await page.getByLabel("ИНН организации или ИП").press("Enter");
    await ready(page, "Это ваша организация?");
    // Double click while create is pending must still yield one organization.
    await page
      .getByRole("button", { name: "Создать кабинет", exact: true })
      .dblclick();
    await ready(page, "ООО «Тестовая организация SashaTel»");
    await page.goto(
      base + "?preview=1#/organizations/11111111-1111-4111-8111-111111111111",
    );
    await ready(page, "Войти в SashaTel");
    await page.getByRole("alert").waitFor();
    assert.match(await page.getByRole("alert").textContent(), /недоступен/);
    await context.close();
    results.push(
      `${theme}: delivery/resend/edit-email/lookup outages/double-submit/foreign UUID pass`,
    );
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base);
  await ready(page, "Начните с знакомства");
  await page.getByLabel("Как к вам обращаться", { exact: true }).fill("Тест");
  await page.getByLabel("Рабочий email").fill("fixture@example.test");
  await page.locator("[name=password]").fill("fixture-password-123");
  await page
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").textContent(), /не подключён/);
  assert.equal(await page.locator("[name=password]").inputValue(), "");
  await context.close();
  assert.deepEqual(errors, []);
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  await writeFile(
    `${evidence}/results.json`,
    JSON.stringify(
      {
        sha,
        results,
        consoleErrors: errors,
        blocked: [
          "real Backend signup/email/DaData/cookie-refresh/tenant isolation",
          "native password-manager autofill UI",
        ],
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ sha, results, errors }, null, 2));
} finally {
  await browser.close();
}
