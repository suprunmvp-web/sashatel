const invalid = error => Object.freeze({ ok: false, error });

/**
 * Conservative RU dial policy, not proof that a number is allocated/reachable.
 * Accepts national 10 digits and 7 / 8 / +7 with 10 subscriber digits.
 * Does not strip arbitrary text into a dialable number. Never mutates input.
 * @param {unknown} raw
 */
export function normalizeRussianNumber(raw) {
  if (typeof raw !== 'string') return invalid('invalid-type');
  // Bound work BEFORE trim/replace, including paste containing megabytes of whitespace.
  if (raw.length > 128) return invalid('too-long');
  const input = raw.trim();
  if (!input) return invalid('empty');
  // Clipboard whitespace (including NBSP) is allowed; controls, bidi, letters,
  // emoji and non-ASCII digits are not silently transformed.
  if (/[^0-9+() .\-\t\r\n\u00a0\u202f]/u.test(input)) return invalid('invalid-characters');
  const compact = input.replace(/[() .\-\t\r\n\u00a0\u202f]/g, '');
  if (!/^\+?\d+$/.test(compact)) return invalid('invalid-format');
  const digits = compact.replace(/^\+/, '');
  if (compact.startsWith('+') && !digits.startsWith('7')) return invalid('invalid-prefix');
  if (digits.length > 11) return invalid('too-long');
  if (digits.length < 10) return invalid('incomplete');
  let national;
  if (digits.length === 11) {
    if (digits[0] !== '7' && digits[0] !== '8') return invalid('invalid-prefix');
    national = digits.slice(1);
  } else {
    if (compact.startsWith('+')) return invalid('incomplete');
    national = digits;
  }
  // RU geographic/mobile/service numbering policy. +7 6xx/7xx are Kazakhstan;
  // 0xx/1xx/2xx are not accepted RU destination codes. Extend via a new policy.
  if (!/^[3489]\d{9}$/.test(national)) return invalid('invalid-prefix');
  return Object.freeze({ ok: true, number: `+7${national}`, country: 'RU' });
}
