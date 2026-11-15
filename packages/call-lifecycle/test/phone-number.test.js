import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRussianNumber as normalize } from '../src/index.js';
import { random } from './helpers.js';

test('RU prefixes, mobile, geographic, service and clipboard formatting', () => {
  for (const raw of ['79991234567', '89991234567', '+79991234567', '9991234567',
    '+7 (999) 123-45-67', '8\t(999)\u00a0123.45.67\r\n', ' +7\u202f999\u202f123 45 67 ']) {
    assert.deepEqual(normalize(raw), { ok: true, number: '+79991234567', country: 'RU' });
  }
  for (const code of ['495', '343', '812', '800']) {
    assert.equal(normalize(`+7${code}1234567`).ok, true);
  }
});

test('empty, Unicode, emoji, text, wrong types, excessive length, prefixes and incomplete input', () => {
  const cases = [
    [null, 'invalid-type'], [undefined, 'invalid-type'], [79991234567, 'invalid-type'],
    [{}, 'invalid-type'], ['', 'empty'], [' \n\t', 'empty'],
    ['hello 79991234567', 'invalid-characters'], ['Позвони +79991234567', 'invalid-characters'],
    ['+79991234567😀', 'invalid-characters'], ['＋７９９９１２３４５６７', 'invalid-characters'],
    ['+7\u202e9991234567', 'invalid-characters'], ['+7\u200b9991234567', 'invalid-characters'],
    ['٧٩٩٩١٢٣٤٥٦٧', 'invalid-characters'], ['+79991234567\0', 'invalid-characters'],
    ['x'.repeat(129), 'too-long'], [' '.repeat(1_000_000), 'too-long'],
    ['7'.repeat(12), 'too-long'], ['+89991234567', 'invalid-prefix'],
    ['19991234567', 'invalid-prefix'], ['+19991234567', 'invalid-prefix'],
    ['+77271234567', 'invalid-prefix'], ['+76001234567', 'invalid-prefix'],
    ['+70001234567', 'invalid-prefix'], ['+71231234567', 'invalid-prefix'],
    ['+72221234567', 'invalid-prefix'], ['1234567890', 'invalid-prefix'],
    ['999123', 'incomplete'], ['7', 'incomplete'], ['8', 'incomplete'],
    ['+7', 'incomplete'], ['+7999123456', 'incomplete'],
    ['7+9991234567', 'invalid-format'], ['++79991234567', 'invalid-format'],
    ['()', 'invalid-format'], ['+', 'invalid-format'],
    ['tel:+79991234567', 'invalid-characters'], ['+79991234567#123', 'invalid-characters'],
    ['+79991234567;+79991234568', 'invalid-characters'],
  ];
  for (const [raw, error] of cases) assert.deepEqual(normalize(raw), { ok: false, error }, String(raw));
});

test('partial entry and repeated deletion are pure, never pad or retain an old number', () => {
  let raw = '+79991234567';
  assert.equal(normalize(raw).ok, true);
  while (raw.length) {
    raw = raw.slice(0, -1);
    assert.equal(normalize(raw).ok, false, raw);
  }
  for (let i = 0; i < 10; i++) assert.deepEqual(normalize(''), { ok: false, error: 'empty' });
});

test('seeded number properties: canonicalization, idempotence and junk rejection (5000 samples)', () => {
  const rng = random(0x5a5a);
  const formats = [' ', '-', '.', '\u00a0', '\u202f', '\t'];
  for (let i = 0; i < 5000; i++) {
    const national = '3489'[Math.floor(rng() * 4)] +
      Array.from({ length: 9 }, () => Math.floor(rng() * 10)).join('');
    const prefix = ['+7', '7', '8', ''][Math.floor(rng() * 4)];
    const formatted = prefix + [...national].map(d => d + formats[Math.floor(rng() * formats.length)]).join('');
    const result = normalize(formatted);
    assert.equal(result.number, `+7${national}`);
    assert.deepEqual(normalize(result.number), result);
    assert.equal(normalize(formatted + ['a', '😀', '\u202e'][i % 3]).ok, false);
  }
});
