import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

test('actual Electron window: security, navigation, call states, screenshots, sizes and zoom', async () => {
  const packaged = process.env.SASHATEL_EXECUTABLE;
  const app = await electron.launch({ ...(packaged ? {executablePath:packaged} : {}), chromiumSandbox: true, args: [...(process.platform === 'linux' && !process.env.DISPLAY ? ['--headless', '--ozone-platform=headless', '--disable-gpu'] : []), ...(packaged ? [] : [path.resolve('.')])], env: { ...process.env, SASHATEL_DEMO:'1' } });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await expect(page.locator('#phone')).toBeVisible();
    const security = await app.evaluate(({BrowserWindow, app})=>{
      const win=BrowserWindow.getAllWindows()[0]; const prefs=win.webContents.getLastWebPreferences();
      return {noSandbox:app.commandLine.hasSwitch('no-sandbox'),isolated:prefs.contextIsolation,node:prefs.nodeIntegration,sandbox:prefs.sandbox,webSecurity:prefs.webSecurity,min:win.getMinimumSize()};
    });
    expect(security).toMatchObject({noSandbox:false,isolated:true,node:false,sandbox:true,webSecurity:true});
    // useContentSize includes native menu/titlebar in the outer minimum on Linux.
    expect(security.min[0]).toBeGreaterThanOrEqual(400);
    expect(security.min[1]).toBeGreaterThanOrEqual(640);
    expect(await page.evaluate(()=>({require:typeof window.require,mode:window.sashatel.mode,keys:Object.keys(window.sashatel).sort()}))).toEqual({require:'undefined',mode:'DEMO',keys:['audio','calls','demo','mode','platform','version']});
    await expect(page.getByRole('button', { name: 'Транки', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => typeof window.sashatelTrunks)).toBe('undefined');
    await mkdir('artifacts',{recursive:true});
    for (const theme of ['light','dark']) {
      await page.evaluate(theme=>localStorage.setItem('sashatel.theme',theme),theme); await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
      if (theme === 'dark') await page.locator('#phone').fill('+7 999 123-45-67');
      await page.screenshot({animations:'disabled',path:`artifacts/electron-dialer-${theme}.png`});
    }
    await page.locator('#phone').fill('+79991234567');
    await page.locator('#call').click();
    await expect(page.locator('#call-state')).toContainText('Соединяем');
    await page.screenshot({animations:'disabled',path:'artifacts/electron-connecting-dark.png'});
    await page.getByRole('button',{name:'Гудки',exact:true}).click();
    await page.getByRole('button',{name:'Ответ',exact:true}).click();
    await expect(page.locator('#call-state')).toContainText('Разговор');
    await page.screenshot({animations:'disabled',path:'artifacts/electron-active-dark.png'});
    await page.getByRole('button',{name:'Обрыв',exact:true}).click();
    await expect(page.locator('#last-result')).toContainText('Соединение потеряно');
    await page.screenshot({animations:'disabled',path:'artifacts/electron-failed-dark.png'});
    // Actual demo events exercise cancelled, missed and confirmed sub-second calls.
    for (const outcome of ['cancelled','missed','answered']) {
      await page.locator('#call').click();
      if (outcome === 'answered') await page.getByRole('button',{name:'Ответ',exact:true}).click();
      if (outcome === 'missed') await page.getByRole('button',{name:'Абонент завершил',exact:true}).click();
      else await page.locator('#hangup').click();
    }
    await page.getByRole('button',{name:'История',exact:true}).click();
    await expect(page.locator('.history-row')).toHaveCount(4);
    await expect(page.locator('.history-details > span')).toHaveText([
      'Демо · Исходящий · Завершён', 'Демо · Исходящий · Без ответа',
      'Демо · Исходящий · Отменён', 'Демо · Исходящий · Ошибка',
    ]);
    await page.screenshot({animations:'disabled',path:'artifacts/electron-history-dark.png'});
    await page.getByRole('button',{name:'Настройки',exact:true}).click();
    await expect(page.locator('#microphone')).toBeDisabled();
    await page.screenshot({animations:'disabled',path:'artifacts/electron-settings-dark.png'});
    for (const [width,height,zoom] of [[400,640,1],[460,780,1.25],[460,780,1.5],[760,900,1]]) {
      await app.evaluate(({BrowserWindow},{width,height,zoom})=>{const win=BrowserWindow.getAllWindows()[0];win.setContentSize(width,height);win.webContents.setZoomFactor(zoom);},{width,height,zoom});
      for (const screen of ['Телефон','История','Настройки']) {
        await page.getByRole('button',{name:screen,exact:true}).click();
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await expect(page.locator('.bottom-nav')).toBeInViewport();
      }
      if(width===400) await page.screenshot({animations:'disabled',path:'artifacts/electron-settings-minimum.png'});
    }
    await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setContentSize(400,640);win.webContents.setZoomFactor(1);});
    await page.getByRole('button',{name:'Телефон',exact:true}).click();
    await page.screenshot({animations:'disabled',path:'artifacts/electron-dialer-minimum.png'});
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});

test('single real owner survives active window reload; protocol rejects stale/forbidden commands and deduplicates replay', async () => {
  const packaged = process.env.SASHATEL_EXECUTABLE;
  const app = await electron.launch({ chromiumSandbox: true, ...(packaged ? { executablePath: packaged } : {}), args: [...(process.platform === 'linux' && !process.env.DISPLAY ? ['--headless', '--ozone-platform=headless', '--disable-gpu'] : []), ...(packaged ? [] : [path.resolve('.')])], env: { ...process.env, SASHATEL_DEMO: '1' } });
  try {
    const page = await app.firstWindow();
    await page.locator('#phone').fill('9991234567'); await page.locator('#phone').press('Enter'); await page.locator('#phone').press('Enter');
    await expect(page.locator('#call-state')).toContainText('Соединяем');
    const before = await page.evaluate(async () => (await window.sashatel.calls.getSnapshot()).snapshot);
    expect(before.call.connectedAt).toBe(null);
    await page.waitForTimeout(1700); await expect(page.locator('#call-timer')).toHaveText('—:—');
    await page.getByRole('button', { name: 'Ответ', exact: true }).click();
    await expect(page.locator('#call-state')).toContainText('Разговор');
    await page.reload();
    await expect(page.locator('#call-state')).toContainText('Разговор');
    const after = await page.evaluate(async () => (await window.sashatel.calls.getSnapshot()).snapshot);
    expect(after.ownerId).toBe(before.ownerId); expect(after.call.callId).toBe(before.call.callId);
    expect(after.call.connectedAt).not.toBe(null);
    const responses = await page.evaluate(async () => {
      const api = window.sashatel.calls; const { snapshot } = await api.getSnapshot();
      const base = { protocolVersion: 1, ownerId: snapshot.ownerId, requestId: 'negative' };
      return [await api.request({ ...base, type: 'connected' }), await api.request({ ...base, type: 'end', callId: snapshot.call.callId, ownerId: 'stale-owner' })];
    });
    expect(responses.map(r => r.error.code)).toEqual(['INVALID_COMMAND', 'OWNER_CHANGED']);
    await page.locator('#hangup').click(); await expect(page.locator('#call-screen')).toBeHidden();
    const replay = await page.evaluate(async () => {
      const api = window.sashatel.calls; const { snapshot } = await api.getSnapshot();
      const command = { protocolVersion: 1, ownerId: snapshot.ownerId, requestId: 'replay', type: 'start', number: '9991234567' };
      const first = await api.request(command); const again = await api.request(command);
      await api.request({ protocolVersion: 1, ownerId: snapshot.ownerId, requestId: 'end-replay', type: 'end', callId: first.callId });
      return { first, again, replayAfterEnd: await api.request(command), state: (await api.getSnapshot()).snapshot.call.state };
    });
    expect(replay.first).toEqual(replay.again); expect(replay.first).toEqual(replay.replayAfterEnd); expect(replay.state).toBe('ended');
    await page.screenshot({ path: 'artifacts/electron-reload-owner.png' });
  } finally { await app.close(); }
});

test('default launch has real audio but no Demo transport controls and cannot originate calls', async () => {
  const packaged = process.env.SASHATEL_EXECUTABLE;
  const app = await electron.launch({ chromiumSandbox: true, ...(packaged ? { executablePath: packaged } : {}), args: [...(process.platform === 'linux' && !process.env.DISPLAY ? ['--headless', '--ozone-platform=headless', '--disable-gpu'] : []), ...(packaged ? [] : [path.resolve('.')])], env: { ...process.env, SASHATEL_DEMO: '0' } });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.mode-note')).toContainText('вызовы недоступны');
    await page.locator('#phone').fill('9991234567'); await expect(page.locator('#call')).toBeDisabled();
    expect(await page.evaluate(() => typeof window.sashatel.demo)).toBe('undefined');
    expect(await page.evaluate(() => !!window.sashatelAudio)).toBe(true);
    const result = await page.evaluate(async () => {
      const { snapshot } = await window.sashatel.calls.getSnapshot();
      return window.sashatel.calls.request({ protocolVersion: 1, ownerId: snapshot.ownerId, requestId: 'forbidden-live', type: 'start', number: '9991234567' });
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'TRANSPORT_UNAVAILABLE' } });
    await page.screenshot({ path: 'artifacts/electron-default-unavailable.png' });
  } finally { await app.close(); }
});

test('settings UI drives actual Audio service: measured microphone, device selection, generated tone and screen-exit release', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const temp = await mkdtemp(path.join(os.tmpdir(), 'sashatel-integrated-audio-'));
  const wavPath = path.join(temp, 'signal.wav');
  const samples = 48000 * 4; const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(36 + samples * 2, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 48000) * 10000), 44 + i * 2);
  await writeFile(wavPath, wav);
  const packaged = process.env.SASHATEL_EXECUTABLE;
  const app = await electron.launch({ chromiumSandbox: true, ...(packaged ? { executablePath: packaged } : {}), args: [...(process.platform === 'linux' && !process.env.DISPLAY ? ['--headless', '--ozone-platform=headless', '--disable-gpu'] : []), '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wavPath}`, ...(packaged ? [] : [path.resolve('.')])], env: { ...process.env, SASHATEL_DEMO: '0' } });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await page.locator('#request-microphone').click();
    await expect(page.locator('#audio-permission')).toContainText('разрешён');
    const input = await page.locator('#microphone option').last().getAttribute('value');
    await page.locator('#microphone').selectOption(input);
    await expect.poll(() => page.evaluate(() => window.sashatelAudio.getState().inputId)).toBe(input);
    if (await page.locator('#speaker').isEnabled()) {
      const output = await page.locator('#speaker option').last().getAttribute('value');
      await page.locator('#speaker').selectOption(output);
      await expect.poll(() => page.evaluate(() => window.sashatelAudio.getState().outputId)).toBe(output);
    }
    await page.locator('#volume').fill('35'); await page.locator('#volume').dispatchEvent('change');
    await expect.poll(() => page.evaluate(() => window.sashatelAudio.getState().volume)).toBe(.35);
    await page.locator('#test-microphone').click();
    await expect.poll(async () => Number(await page.getByRole('meter').getAttribute('aria-valuenow'))).toBeGreaterThan(0);
    await page.locator('#main').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: 'artifacts/electron-settings-measured-pcm.png' });
    await page.getByRole('button', { name: 'Телефон', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.sashatelAudio.getState().testing)).toBe(null);
    await expect.poll(() => page.evaluate(() => window.sashatelAudio.getState().capture.status)).toBe('idle');
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await page.locator('#test-speaker').click();
    await expect.poll(() => page.evaluate(() => window.sashatelAudio.getState().testing)).toBe('playback');
    await page.getByRole('button', { name: 'Телефон', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.sashatelAudio.getState().testing)).toBe(null);
    expect(await page.evaluate(() => window.sashatelAudio.getState().lastTest.playbackStarted)).toBe(true);
    expect(await page.evaluate(() => window.sashatelAudio.getState().lastTest.audibilityConfirmed)).toBe(false);
  } finally { await app.close(); await rm(temp, { recursive: true, force: true }); }
});
