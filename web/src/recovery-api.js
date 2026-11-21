/** Password reset API contract. Backend integration is a separate task.
 * Keep the frontend usable and do not simulate delivery, verification or success.
 * Replace these fail-closed methods only after confirming server endpoints and CSRF semantics.
 */
const unsupported = () => { throw new Error('Восстановление пароля пока недоступно. Повторите позже.'); };
export async function requestResetCode(_email) { unsupported(); }
export async function verifyResetCode(_email, _code) { unsupported(); }
export async function completePasswordReset(_email, _resetToken, _newPassword) { unsupported(); }
