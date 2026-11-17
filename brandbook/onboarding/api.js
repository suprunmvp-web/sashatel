// This boundary can be wired only after AUTH-01 and CSRF bootstrap ship.
export class ApiError extends Error {
  constructor(code, message, retryAfter = 0) { super(message); this.code = code; this.retryAfter = retryAfter; }
}
export function createUnavailableApi() {
  const unavailable = async () => { throw new ApiError('AUTH_UNAVAILABLE', 'Регистрация пока недоступна. Сервис авторизации ещё не подключён.'); };
  return { resume: async () => null, register: unavailable, verify: unavailable, resend: unavailable,
    login: unavailable, lookup: unavailable, createOrganization: unavailable, openOrganization: unavailable,
    logout: unavailable };
}
