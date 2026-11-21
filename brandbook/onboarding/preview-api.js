import { ApiError } from "./api.js";
const KEY = "sashatel.onboarding.preview.fixture";
const CONTRACT = { expires_in: 600, resend_after: 60 };
const ORG_ID = "279a66cd-c1cc-4d19-9c09-3490e9049d0a";
export function validInn(value) {
  if (!/^\d{10}(\d{2})?$/.test(value)) return false;
  const sum = (weights) =>
    (weights.reduce((n, weight, i) => n + weight * Number(value[i]), 0) % 11) %
    10;
  return value.length === 10
    ? sum([2, 4, 10, 3, 5, 9, 4, 6, 8]) === +value[9]
    : sum([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === +value[10] &&
        sum([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === +value[11];
}
export function createPreviewApi(scenario) {
  let data;
  try {
    data = JSON.parse(sessionStorage.getItem(KEY));
  } catch {
    /* invalid fixture */
  }
  data ||= {
    account: null,
    organization: null,
    signedIn: false,
    challenge: null,
    lookup: null,
  };
  const save = () => sessionStorage.setItem(KEY, JSON.stringify(data));
  async function delay() {
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (scenario() === "offline")
      throw new ApiError(
        "AUTH_UNAVAILABLE",
        "Нет соединения. Проверьте сеть и повторите.",
      );
  }
  function authorized() {
    if (
      !data.signedIn ||
      scenario() === "session-expired" ||
      Date.now() >= data.sessionExpires
    ) {
      data.signedIn = false;
      save();
      throw new ApiError("ACCESS_EXPIRED", "Сессия истекла. Войдите снова.");
    }
  }
  function challenge() {
    data.challenge = {
      id: crypto.randomUUID(),
      expiresAt: Date.now() + CONTRACT.expires_in * 1000,
      resendAt: Date.now() + CONTRACT.resend_after * 1000,
      attempts: 0,
    };
    save();
    return { challenge_id: data.challenge.id, ...CONTRACT };
  }
  function signedIn() {
    data.signedIn = true;
    data.sessionExpires = Date.now() + 300000;
    save();
  }
  return {
    async resume() {
      await delay();
      if (data.signedIn) {
        authorized();
        return { account: data.account, organization: data.organization };
      }
      return data.challenge
        ? { challenge: data.challenge, account: data.account }
        : null;
    },
    async register({ email, display_name }) {
      await delay();
      if (scenario() === "delivery")
        throw new ApiError(
          "EMAIL_DELIVERY_UNAVAILABLE",
          "Не удалось отправить письмо. Повторите отправку позже.",
        );
      if (scenario() === "rate")
        throw new ApiError(
          "RATE_LIMITED",
          "Слишком много запросов. Повторите через минуту.",
          60,
        );
      data.account = { email, display_name, email_verified: false };
      data.signedIn = false;
      data.organization = null;
      data.lookup = null;
      return challenge();
    },
    async verify({ challenge_id, code }) {
      await delay();
      const c = data.challenge;
      if (
        !c ||
        c.id !== challenge_id ||
        ++c.attempts > 5 ||
        code !== "123456" ||
        Date.now() >= c.expiresAt ||
        scenario() === "expired"
      ) {
        save();
        throw new ApiError(
          "CODE_INVALID_OR_EXPIRED",
          "Код неверный или истёк. Проверьте письмо или запросите новый код.",
        );
      }
      data.account.email_verified = true;
      data.challenge = null;
      signedIn();
      return { account: data.account };
    },
    async resend() {
      await delay();
      if (!data.challenge)
        throw new ApiError(
          "CODE_INVALID_OR_EXPIRED",
          "Запросите новое письмо на экране регистрации.",
        );
      if (Date.now() < data.challenge.resendAt)
        throw new ApiError(
          "RATE_LIMITED",
          "Новое письмо пока недоступно.",
          Math.ceil((data.challenge.resendAt - Date.now()) / 1000),
        );
      if (scenario() === "delivery")
        throw new ApiError(
          "EMAIL_DELIVERY_UNAVAILABLE",
          "Письмо не отправлено. Предыдущий код остаётся действительным.",
        );
      if (scenario() === "rate")
        throw new ApiError(
          "RATE_LIMITED",
          "Лимит отправки писем. Повторите позже.",
          60,
        );
      return challenge();
    },
    async login({ email }) {
      await delay();
      if (!data.account?.email_verified || data.account.email !== email)
        throw new ApiError(
          "INVALID_CREDENTIALS",
          "Проверьте email и пароль. В preview используйте созданный в этой вкладке тестовый аккаунт.",
        );
      signedIn();
      return { account: data.account, organization: data.organization };
    },
    async lookup({ inn }) {
      await delay();
      authorized();
      if (!validInn(inn))
        throw new ApiError(
          "INN_INVALID",
          "Проверьте ИНН: нужны 10 или 12 цифр с корректной контрольной суммой.",
        );
      if (scenario() === "lookup-down")
        throw new ApiError(
          "ORGANIZATION_LOOKUP_UNAVAILABLE",
          "Сервис реквизитов недоступен. Повторите поиск позже.",
        );
      if (scenario() === "lookup-missing")
        throw new ApiError(
          "RESOURCE_NOT_FOUND",
          "Организация не найдена. Проверьте ИНН и повторите поиск.",
        );
      data.lookup = {
        lookup_id: crypto.randomUUID(),
        inn,
        legal_name: inn === "7707083893" ? "ООО «Пример организации»" : `ООО «Компания ${inn.slice(5,9)}»`,
        legal_address: "г. Москва, ул. Примерная, д. 1",
        expires_at: new Date(Date.now() + 900000).toISOString(),
      };
      save();
      return data.lookup;
    },
    async createOrganization({ lookup_id }, key) {
      await delay();
      authorized();
      if (data.organization && data.createKey === key)
        return { organization: data.organization };
      if (
        !data.lookup ||
        data.lookup.lookup_id !== lookup_id ||
        Date.parse(data.lookup.expires_at) <= Date.now()
      )
        throw new ApiError(
          "LOOKUP_EXPIRED",
          "Реквизиты устарели. Повторите поиск по ИНН.",
        );
      if (data.organization)
        throw new ApiError(
          "ORGANIZATION_ALREADY_EXISTS",
          "Организация уже существует. Вернитесь к выбору кабинета.",
        );
      data.createKey = key;
      data.organization = {
        id: ORG_ID,
        inn: data.lookup.inn,
        legal_name: data.lookup.legal_name,
        role: "owner",
        verified: false,
        trunks_enabled: false,
      };
      save();
      if (scenario() === "create-unknown")
        throw new ApiError(
          "UNKNOWN_RESULT",
          "Ответ не получен. Повторите проверку — повторный запрос не создаст второй кабинет.",
        );
      return { organization: data.organization };
    },
    async openOrganization(id) {
      await delay();
      authorized();
      if (id !== data.organization?.id)
        throw new ApiError(
          "RESOURCE_NOT_FOUND",
          "Кабинет недоступен. Проверьте доступ к организации.",
        );
      return { organization: data.organization };
    },
    async logout() {
      data.signedIn = false;
      data.challenge = null;
      save();
    },
    reset() {
      sessionStorage.removeItem(KEY);
      data = {
        account: null,
        organization: null,
        signedIn: false,
        challenge: null,
        lookup: null,
      };
    },
  };
}
