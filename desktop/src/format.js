/** Keep ordinary number formatting, reject letters instead of silently dialing another number. */
export function sanitizePhone(/** @type {string} */ raw) {
  return raw.replace(/[^\d+()\s-]/g, '').replace(/(?!^)\+/g, '').slice(0, 32);
}

/** UI policy for the existing RU-only dialer; production validation belongs to CallPort. */
export function normalizePhone(/** @type {string} */ raw) {
  if (!/^[+\d\s()-]+$/.test(raw) || /\+/.test(raw.slice(1))) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return '+7' + digits;
  if (digits.length === 11 && /^[78]/.test(digits)) return '+7' + digits.slice(1);
  return null;
}

export function duration(/** @type {number} */ ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function displayNumber(/** @type {string} */ number) {
  return number.replace(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/, '+7 $1 $2-$3-$4');
}
