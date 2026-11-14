'use strict';
// Demo adapter only. Real SIP/WebRTC/Asterisk integration must replace this adapter.
// No calls, audio or billing are performed in this version.
const $ = id => document.getElementById(id);
const phone = $('phone');
const callButton = $('call');
const hangupButton = $('hangup');
const stateText = $('call-state');
const timerText = $('call-timer');
const historyList = $('history-list');
const countText = $('count');
const history = [];
let active = null;
let interval = null;
let transition = null;

function normalize(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '8') return '+7' + digits.slice(1);
  if (digits.length === 11 && digits[0] === '7') return '+' + digits;
  if (digits.length === 10) return '+7' + digits;
  return null;
}
function secondsLabel(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return m + ':' + s;
}
function updateTimer() {
  if (!active) return;
  const elapsed = active.answeredAt ? Math.max(0, Math.floor((Date.now() - active.answeredAt) / 1000)) : 0;
  timerText.textContent = active.answeredAt ? secondsLabel(elapsed) : '';
}
function renderHistory() {
  countText.textContent = history.length + ' записей';
  historyList.replaceChildren();
  if (!history.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Здесь появятся тестовые вызовы. История хранится только до закрытия приложения.';
    historyList.append(empty);
    return;
  }
  for (const item of history) {
    const row = document.createElement('div'); row.className = 'history-row';
    const left = document.createElement('div');
    const number = document.createElement('strong'); number.textContent = item.number;
    const status = document.createElement('small'); status.textContent = item.answered ? 'Тестовый · отвечен' : 'Тестовый · отменён';
    left.append(number, status);
    const time = document.createElement('span'); time.textContent = item.at.toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'});
    const duration = document.createElement('span'); duration.className = 'duration'; duration.textContent = secondsLabel(item.seconds);
    row.append(left, time, duration); historyList.append(row);
  }
}
function cleanupTimers() {
  if (interval) clearInterval(interval);
  if (transition) clearTimeout(transition);
  interval = null; transition = null;
}
function endCall() {
  if (!active) return;
  cleanupTimers();
  const item = { number:active.number, at:active.startedAt, answered:!!active.answeredAt,
    seconds:active.answeredAt ? Math.max(0,Math.floor((Date.now()-active.answeredAt)/1000)) : 0 };
  history.unshift(item);
  active = null;
  stateText.textContent = 'Тестовый звонок завершён · реальной тарификации нет';
  timerText.textContent = '';
  callButton.hidden = false;
  hangupButton.hidden = true;
  phone.disabled = false;
  renderHistory();
}
function startCall() {
  if (active) return;
  const number = normalize(phone.value);
  if (!number) {
    stateText.textContent = 'Введите номер РФ: 10 цифр или +7XXXXXXXXXX';
    phone.focus(); return;
  }
  cleanupTimers();
  active = { number, startedAt:new Date(), answeredAt:null };
  phone.value = number;
  phone.disabled = true;
  stateText.textContent = 'Имитация вызова...';
  timerText.textContent = '';
  callButton.hidden = true;
  hangupButton.hidden = false;
  transition = setTimeout(() => {
    if (!active) return;
    active.answeredAt = Date.now();
    stateText.textContent = 'Демо-соединение · звук не передаётся';
    interval = setInterval(updateTimer, 250);
    updateTimer();
  }, 1600);
}
document.querySelectorAll('[data-digit]').forEach(btn => btn.addEventListener('click', () => {
  if (active) return;
  phone.value += btn.dataset.digit;
  phone.focus();
}));
callButton.addEventListener('click', startCall);
hangupButton.addEventListener('click', endCall);
$('clear').addEventListener('click', () => { if (active) return; history.length = 0; renderHistory(); });
phone.addEventListener('keydown', e => { if (e.key === 'Enter' && !active) startCall(); });
renderHistory();
