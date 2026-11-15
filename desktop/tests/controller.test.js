import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DesktopController } from '../src/controller.js';
import { DemoCallAdapter } from '../src/demo-adapter.js';
import { DemoHistory } from '../src/demo-history.js';
import { UnavailableAudio } from '../src/unavailable-audio.js';
import { sanitizePhone, normalizePhone, duration } from '../src/format.js';

function fixture(calls = new DemoCallAdapter()) {
  const services = { calls, history: new DemoHistory(), audio: new UnavailableAudio(), demo: calls };
  return { calls, controller: new DesktopController(services), services };
}
for (const raw of ['9991234567', '+7 (999) 123-45-67', '8 999 123 45 67']) {
  test(`RU input: ${raw}`, () => assert.equal(normalizePhone(raw), '+79991234567'));
}
for (const raw of ['abc9991234567', '+1 999 123 4567', '123', '+7+9991234567', '799912345678', '']) {
  test(`invalid input rejected: ${raw}`, () => assert.equal(normalizePhone(raw), null));
}
test('sanitizes allowed characters, duplicate + and bounded input', () => {
  assert.equal(sanitizePhone('abc+7+ (999) 123-45-67#*'), '+7 (999) 123-45-67');
  assert.equal(sanitizePhone('9'.repeat(100)).length, 32);
  assert.equal(duration(3_661_999), '61:01');
});
test('no timer or automatic success before explicit answer; duplicate answer does not reset time', () => {
  let now = 0;
  const { calls, controller } = fixture(new DemoCallAdapter(() => now));
  controller.edit('9991234567'); controller.start();
  now = 100000;
  assert.equal(calls.getSnapshot().state, 'connecting');
  assert.equal(calls.getSnapshot().durationMs, 0);
  calls.send('ringing'); now += 8000;
  assert.equal(calls.getSnapshot().durationMs, 0);
  calls.send('connected'); now += 2500; calls.send('connected');
  assert.equal(calls.getSnapshot().durationMs, 2500);
  assert.equal(calls.getSnapshot().connection, 'unavailable');
  controller.dispose();
});
test('rapid clicks and Enter share one command; navigation locked in call', async () => {
  let resolve;
  const { calls, controller } = fixture();
  let starts = 0;
  const original = calls.start.bind(calls);
  calls.start = number => { starts++; return new Promise(done => { resolve = () => done(original(number)); }); };
  controller.edit('9991234567');
  const pending = controller.start();
  await controller.start(); controller.navigate('settings');
  assert.equal(starts, 1); assert.equal(controller.screen, 'dialer');
  resolve(); await pending;
  assert.equal(controller.inCall, true);
  controller.navigate('history'); assert.equal(controller.screen, 'dialer');
  controller.dispose();
});
test('cancellation, failure and answered history recorded once; redial does not place a call', async () => {
  let now = 0;
  const { calls, controller, services } = fixture(new DemoCallAdapter(() => now));
  controller.edit('9991234567'); await controller.start(); await controller.end();
  calls.publish();
  assert.equal((await services.history.load()).length, 1);
  assert.equal((await services.history.load())[0].status, 'cancelled');
  await controller.start(); calls.send('connected'); now = 5300; await controller.end(); now = 9000;
  assert.equal(calls.getSnapshot().durationMs, 5300);
  await controller.start(); calls.send('rejected');
  await controller.loadHistory();
  assert.deepEqual(controller.history.map(row => row.status), ['failed', 'answered', 'cancelled']);
  assert.equal(controller.history[1].durationMs, 5300);
  controller.redial('+79991234567');
  assert.equal(controller.phone, '+79991234567'); assert.equal(controller.inCall, false);
  controller.dispose();
});
test('start rejection and exceptions stay editable with clear error', async () => {
  const { calls, controller } = fixture();
  controller.edit('123'); await controller.start();
  assert.match(controller.error, /10 цифр/); assert.equal(controller.inCall, false);
  calls.start = () => { throw Error('private details'); };
  await controller.start(); assert.match(controller.error, /Проверьте подключение/);
  assert.equal(controller.busy, false); assert.doesNotMatch(controller.error, /private details/);
  controller.dispose();
});
test('terminating and unconfirmed cleanup block new calls, failed terminal can remain locked', async () => {
  const { calls, controller } = fixture();
  controller.edit('9991234567'); await controller.start();
  calls.snapshot = { ...calls.snapshot, state: 'terminating', canStart: false }; calls.publish();
  let ends = 0; calls.endCall = () => { ends++; return { ok: true }; };
  await controller.end(); await controller.start(); assert.equal(ends, 0);
  calls.snapshot = { ...calls.snapshot, state: 'failed', reason: 'termination-timeout', canStart: false }; calls.publish();
  await controller.start(); assert.equal(calls.getSnapshot().state, 'failed');
  controller.dispose();
});
test('end failure does not falsely claim termination and double end is guarded', async () => {
  const { calls, controller } = fixture();
  controller.edit('9991234567'); await controller.start();
  let reject; let ends = 0;
  calls.endCall = () => { ends++; return new Promise((_, failure) => { reject = failure; }); };
  const pending = controller.end(); await controller.end();
  assert.equal(ends, 1); reject(Error('failure')); await pending;
  assert.equal(controller.inCall, true); assert.match(controller.error, /Повторите попытку/);
  controller.dispose();
});
test('history errors can be retried and disposed views stop observing', async () => {
  const { controller, calls, services } = fixture();
  services.history.load = async () => { throw Error('network'); };
  await controller.loadHistory(); assert.match(controller.historyError, /Не удалось/);
  services.history.load = async () => [];
  await controller.loadHistory(); assert.equal(controller.historyError, '');
  let notifications = 0;
  controller.subscribe(() => notifications++);
  controller.dispose(); calls.publish();
  assert.equal(notifications, 0); assert.equal(calls.listeners.size, 0);
});
test('live history is not manufactured from client call events', async () => {
  const { calls, controller, services } = fixture(); calls.mode = 'live';
  controller.edit('9991234567'); await controller.start(); calls.send('connected'); await controller.end();
  assert.deepEqual(await services.history.load(), []);
  controller.dispose();
});
