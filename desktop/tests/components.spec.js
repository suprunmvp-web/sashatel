import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function call(page) {
  await page.getByLabel('Номер телефона', { exact: true }).fill('+7 (999) 123-45-67');
  await page.getByRole('button', { name: 'Тестовый звонок' }).click();
}
async function setupFixture(page) {
  await page.goto('/tests/fixture.html');
  await page.evaluate(async () => {
    const { DesktopController } = await import('/src/controller.js');
    const { DemoCallAdapter } = await import('/src/demo-adapter.js');
    const { DemoHistory } = await import('/src/demo-history.js');
    const { mountDesktop } = await import('/src/view.js');
    const calls = new DemoCallAdapter();
    const listeners = new Set();
    const audio = {
      snapshot: { available: true, permission: 'granted', outputSelection:true, result:'', inputs: [{id:'mic',label:'USB microphone'}], outputs: [{id:'out',label:'USB headset'}], inputId:'mic', outputId:'out', volume:.7, testing:null, level:0, message:'' },
      getSnapshot() { return this.snapshot; },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      publish() { for (const fn of listeners) fn(this.snapshot); },
      async selectInput(id) { this.snapshot.inputId = id; this.publish(); },
      async selectOutput(id) { this.snapshot.outputId = id; this.publish(); },
      async setVolume(value) { this.snapshot.volume = value; this.publish(); },
      async testMicrophone() { this.snapshot.testing = 'microphone'; this.publish(); },
      async testSpeaker() { throw new Error('device disconnected'); },
      async requestPermission() { this.snapshot.permission='granted'; this.publish(); },
      async stopTest() { this.snapshot.testing = null; this.snapshot.level = 0; this.publish(); },
    };
    const history = new DemoHistory();
    const controller = new DesktopController({ calls, audio, history, demo: calls });
    const unmount = mountDesktop(document.getElementById('app'), controller);
    window.fixture = { controller, calls, audio, history, unmount, listeners };
  });
}

test('input editing, selection, clipboard, Enter and duplicate commands', async ({ page }) => {
  await page.goto('/');
  const input = page.getByLabel('Номер телефона', {exact:true});
  await expect(page.getByRole('button', {name:'Тестовый звонок'})).toBeDisabled();
  await input.fill('abc+7 (999) 123-45-67#');
  await expect(input).toHaveValue('+7 (999) 123-45-67');
  await input.evaluate(el => el.setSelectionRange(4, 7));
  await page.getByRole('button', {name:'1',exact:true}).click();
  await expect(input).toHaveValue('+7 (1) 123-45-67');
  await page.getByRole('button', {name:'Удалить символ'}).click();
  await expect(input).toHaveValue('+7 () 123-45-67');
  await input.evaluate(el => { el.value=''; el.dispatchEvent(new Event('input',{bubbles:true})); const dt=new DataTransfer(); dt.setData('text','call 9991234567'); el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt})); });
  await expect(page.getByRole('alert')).toContainText('Вставьте только номер');
  await input.fill('123'); await input.press('Enter');
  await expect(page.getByRole('alert')).toContainText('10 цифр');
  // Use the real browser clipboard path for formatted numbers.
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('+7 (999) 123-45-67'));
  await input.fill(''); await input.press('Control+V');
  await expect(input).toHaveValue('+7 (999) 123-45-67');
  await input.press('Enter'); await input.press('Enter');
  await expect(page.locator('#call-screen')).toBeVisible();
  await expect(page.locator('.bottom-nav')).toBeHidden();
  await expect(page.locator('#call-timer')).toHaveText('—:—');
  await page.waitForTimeout(1800);
  await expect(page.locator('#call-state')).toHaveText('Демо · Соединяем…');
  await page.getByRole('button',{name:'Гудки',exact:true}).click();
  await expect(page.locator('#call-state')).toContainText('Ожидаем ответа');
  await page.getByRole('button',{name:'Ответ',exact:true}).click();
  await expect(page.locator('#call-timer')).toHaveText('00:00');
  await page.waitForTimeout(1100);
  await expect(page.locator('#call-timer')).toHaveText('00:01');
  await page.getByRole('button',{name:'Завершить',exact:true}).click();
  await expect(page.locator('#last-result')).toContainText('Демо · Вызов завершён');
  await page.getByRole('button',{name:'История',exact:true}).click();
  await expect(page.locator('.history-row')).toHaveCount(1);
  await expect(page.locator('.history-row')).toContainText('Демо · Исходящий · Завершён');
  await page.getByRole('button',{name:'Набрать +7 999 123-45-67'}).click();
  await expect(input).toHaveValue('+79991234567');
  await expect(page.locator('#call-screen')).toBeHidden();
});

test('empty history, failure, cancelled call and theme persistence', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button',{name:'История',exact:true}).click();
  await expect(page.getByText('Пока ни одного звонка')).toBeVisible();
  await page.getByRole('button',{name:'Телефон',exact:true}).click();
  await call(page); await page.getByRole('button',{name:'Отказ',exact:true}).click();
  await expect(page.locator('#last-result')).toContainText('Абонент отклонил');
  await call(page); await page.getByRole('button',{name:'Отменить вызов',exact:true}).click();
  await page.getByRole('button',{name:'История',exact:true}).click();
  await expect(page.locator('.history-row')).toHaveCount(2);
  await expect(page.locator('.history-row').first()).toContainText('Без ответа');
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  await expect(page.getByLabel('Микрофон',{exact:true})).toBeDisabled();
  await expect(page.getByText('Разрешение микрофона не запрашивалось.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Проверить звук',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Тёмная',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
});

test('service-driven terminating, blocked cleanup, history error and recovery', async ({page}) => {
  await setupFixture(page);
  await page.getByLabel('Номер телефона',{exact:true}).fill('9991234567');
  await page.getByRole('button',{name:'Тестовый звонок'}).click();
  await page.evaluate(() => { const {calls}=window.fixture; calls.snapshot={...calls.snapshot,state:'terminating',canStart:false}; calls.publish(); });
  await expect(page.locator('#call-state')).toContainText('Завершаем');
  await expect(page.locator('#hangup')).toBeDisabled();
  await page.evaluate(() => { const {calls}=window.fixture; calls.snapshot={...calls.snapshot,state:'failed',canStart:false,reason:'termination-timeout'}; calls.publish(); });
  await expect(page.getByRole('button',{name:'Тестовый звонок'})).toBeDisabled();
  await expect(page.locator('#last-result')).toContainText('Завершение не подтверждено');
  await page.evaluate(() => { window.fixture.history.load=async()=>{throw Error('offline');}; });
  await page.getByRole('button',{name:'История',exact:true}).click();
  await expect(page.getByText('История недоступна')).toBeVisible();
  await page.evaluate(() => { window.fixture.history.load=async()=>[]; });
  await page.getByRole('button',{name:'Попробовать снова'}).click();
  await expect(page.getByText('Пока ни одного звонка')).toBeVisible();
});

test('audio contract consumes real service levels, handles denial, hot unplug and releases resources', async ({page}) => {
  await setupFixture(page);
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  await page.evaluate(() => { const {audio}=window.fixture; audio.snapshot.inputs.push({id:'second',label:'Second microphone'}); audio.snapshot.outputs.push({id:'second-out',label:'Second headset'}); audio.publish(); });
  await page.locator('#microphone').selectOption('second');
  await expect.poll(()=>page.evaluate(()=>window.fixture.audio.snapshot.inputId)).toBe('second');
  await page.locator('#speaker').selectOption('second-out');
  await expect.poll(()=>page.evaluate(()=>window.fixture.audio.snapshot.outputId)).toBe('second-out');
  await page.locator('#volume').fill('40');
  await page.locator('#volume').dispatchEvent('change');
  await expect.poll(()=>page.evaluate(()=>window.fixture.audio.snapshot.volume)).toBe(.4);
  await page.getByRole('button',{name:'Проверить',exact:true}).click();
  await expect(page.getByRole('meter')).toHaveAttribute('aria-valuenow','0');
  await page.evaluate(() => { window.fixture.audio.snapshot.level=.63; window.fixture.audio.publish(); });
  await expect(page.getByRole('meter')).toHaveAttribute('aria-valuenow','63');
  await page.getByRole('button',{name:'Телефон',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.fixture.audio.snapshot.testing)).toBeNull();
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  await page.getByRole('button',{name:'Проверить звук',exact:true}).click();
  await expect(page.locator('#audio-action')).toContainText('Проверьте устройство');
  await page.evaluate(() => { const {audio}=window.fixture; audio.snapshot.permission='denied'; audio.snapshot.message='Устройство отключено'; audio.snapshot.inputs=[]; audio.publish(); });
  await expect(page.getByText('Доступ к микрофону запрещён. Проверьте разрешения системы.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Проверить',exact:true})).toBeDisabled();
  await page.evaluate(() => { window.fixture.unmount(); window.fixture.controller.dispose(); });
  expect(await page.evaluate(()=>window.fixture.listeners.size)).toBe(0);
  expect(await page.evaluate(()=>window.fixture.calls.listeners.size)).toBe(0);
});

test('both themes accessible and controls contained at minimum, wide and scaled viewports', async ({page}) => {
  await page.goto('/');
  for (const theme of ['light','dark']) {
    await page.evaluate(theme => { localStorage.setItem('sashatel.theme',theme); }, theme); await page.reload();
    for (const screen of ['Телефон','История','Настройки']) {
      await page.getByRole('button',{name:screen,exact:true}).click();
      await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
      const results = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
      expect(results.violations, JSON.stringify(results.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})))).toEqual([]);
    }
  }
  for (const size of [{width:400,height:640},{width:460,height:780},{width:760,height:900},{width:320,height:512}]) {
    await page.setViewportSize(size);
    for (const screen of ['Телефон','История','Настройки']) {
      await page.getByRole('button',{name:screen,exact:true}).click();
      const overflow = await page.evaluate(()=>({horizontal:document.documentElement.scrollWidth>innerWidth,vertical:document.documentElement.scrollHeight>innerHeight}));
      expect(overflow).toEqual({horizontal:false,vertical:false});
      await expect(page.locator('.bottom-nav')).toBeInViewport();
      if (screen === 'Телефон' && size.height >= 640) expect(await page.locator('#call').evaluate(el => {const r=el.getBoundingClientRect(),m=document.getElementById('main').getBoundingClientRect(); return r.bottom<=m.bottom && r.top>=m.top;})).toBe(true);
    }
    await page.getByRole('button',{name:'Телефон',exact:true}).click(); await call(page);
    await expect(page.locator('#hangup')).toBeInViewport();
    await page.getByRole('button',{name:'Отменить вызов',exact:true}).click();
  }
});


test('pending audio diagnostic can be stopped and a late result is cleaned up after navigation', async ({page}) => {
  await setupFixture(page);
  await page.evaluate(() => {
    const {audio}=window.fixture;
    audio.testMicrophone=()=>new Promise(resolve=>{audio.snapshot.testing='microphone';audio.publish();window.fixture.finishTest=resolve;});
  });
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  await page.getByRole('button',{name:'Проверить',exact:true}).click();
  await page.getByRole('button',{name:'Остановить',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.fixture.audio.snapshot.testing)).toBeNull();
  await page.getByRole('button',{name:'Телефон',exact:true}).click();
  await page.evaluate(()=>{window.fixture.audio.snapshot.testing='microphone';window.fixture.finishTest();});
  await expect.poll(()=>page.evaluate(()=>window.fixture.audio.snapshot.testing)).toBeNull();
});
