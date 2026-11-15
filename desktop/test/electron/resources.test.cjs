'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { _electron: electron } = require('playwright');

test('real Electron: new local UI assets load; private/symlink files, inline script and network remain denied', { timeout: 30000 }, async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sashatel-ui-assets-'));
  const root = path.join(temp, 'desktop');
  const original = path.resolve(__dirname, '../..');
  let app;
  try {
    await fs.mkdir(path.join(root, 'assets'), { recursive: true });
    for (const file of ['main.cjs', 'preload.cjs', 'security.cjs', 'index.html', 'renderer.js', 'style.css', 'package.json']) {
      await fs.copyFile(path.join(original, file), path.join(root, file));
    }
    await fs.cp(path.join(original, 'audio'), path.join(root, 'audio'), { recursive: true });
    await fs.writeFile(path.join(root, 'assets', 'review-new-module.mjs'), 'export const localAsset = 42;');
    await fs.writeFile(path.join(root, 'assets', 'review-new-style.css'), ':root { --audio-policy-fixture: permitted; }');
    await fs.writeFile(path.join(root, 'assets', 'review-new-icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
    const secret = path.join(temp, 'outside.js');
    await fs.writeFile(secret, 'globalThis.unsafeAssetExecuted = true;');
    await fs.symlink(secret, path.join(root, 'assets', 'escaped.js'));
    await fs.mkdir(path.join(root, 'test'));
    await fs.writeFile(path.join(root, 'test', 'private.js'), 'globalThis.unsafeAssetExecuted = true;');
    const headless = process.platform === 'linux' && !process.env.DISPLAY ? ['--headless', '--ozone-platform=headless', '--disable-gpu'] : [];
    app = await electron.launch({ chromiumSandbox: true, args: [...headless, root], timeout: 15000 });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.sashatelAudio);
    const asset = await page.evaluate(async () => {
      const module = await import('./assets/review-new-module.mjs');
      const load = (tag, attribute, value) => new Promise(resolve => {
        const element = document.createElement(tag); element[attribute] = value;
        element.onload = () => resolve(true); element.onerror = () => resolve(false);
        if (tag === 'link') element.rel = 'stylesheet';
        document.head.append(element);
      });
      return { module: module.localAsset, css: await load('link', 'href', './assets/review-new-style.css'),
        svg: await load('img', 'src', './assets/review-new-icon.svg') };
    });
    assert.deepEqual(asset, { module: 42, css: true, svg: true });
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--audio-policy-fixture').trim()), 'permitted');
    const failures = await page.evaluate(async outsideURL => {
      const urls = ['./assets/escaped.js', './test/private.js', './main.cjs', outsideURL, 'https://example.com/module.js'];
      const denied = [];
      for (const url of urls) {
        try { await import(url); denied.push(false); } catch { denied.push(true); }
      }
      const inline = document.createElement('script'); inline.textContent = 'window.unsafeAssetExecuted = true'; document.head.append(inline);
      let fetchDenied = false;
      try { await fetch('https://example.com'); } catch { fetchDenied = true; }
      return { denied, fetchDenied, unsafe: window.unsafeAssetExecuted === true };
    }, pathToFileURL(secret).href);
    assert.deepEqual(failures, { denied: [true, true, true, true, true], fetchDenied: true, unsafe: false });
    // Exercise the actual session webRequest hook independently of CSP's network denial.
    assert.equal(await app.evaluate(async ({ net }) => {
      try { await net.fetch('https://example.com', { useSessionCookies: true }); return false; }
      catch { return true; }
    }), true);
    t.diagnostic('App copied to a temporary directory; production HTML/renderer/CSS were not edited. CSP/network rules stayed enabled.');
  } finally { if (app) await app.close(); await fs.rm(temp, { recursive: true, force: true }); }
});
