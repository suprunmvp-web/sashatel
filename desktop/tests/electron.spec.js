import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

test('actual Electron window: security, navigation, call states, screenshots, sizes and zoom', async () => {
  const packaged = process.env.SASHATEL_EXECUTABLE;
  const app = await electron.launch({ ...(packaged ? {executablePath:packaged} : {}), args: ['--no-sandbox', ...(packaged ? [] : [path.resolve('.')])], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS:'true' } });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await expect(page.locator('#phone')).toBeVisible();
    const security = await app.evaluate(({BrowserWindow})=>{
      const win=BrowserWindow.getAllWindows()[0]; const prefs=win.webContents.getLastWebPreferences();
      return {isolated:prefs.contextIsolation,node:prefs.nodeIntegration,sandbox:prefs.sandbox,webSecurity:prefs.webSecurity,min:win.getMinimumSize()};
    });
    expect(security).toMatchObject({isolated:true,node:false,sandbox:true,webSecurity:true});
    // useContentSize includes native menu/titlebar in the outer minimum on Linux.
    expect(security.min[0]).toBeGreaterThanOrEqual(400);
    expect(security.min[1]).toBeGreaterThanOrEqual(640);
    expect(await page.evaluate(()=>({require:typeof window.require,mode:window.sashatel.mode,keys:Object.keys(window.sashatel).sort()}))).toEqual({require:'undefined',mode:'DEMO',keys:['mode','platform','version']});
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
    await page.getByRole('button',{name:'История',exact:true}).click();
    await expect(page.locator('.history-row')).toHaveCount(1);
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
