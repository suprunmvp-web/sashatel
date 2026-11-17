'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPolicy } = require('../security.cjs');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

function resourceFixture(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sashatel-policy-'));
  const root = path.join(parent, 'desktop'); fs.mkdirSync(root);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const write = relative => {
    const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'fixture'); return pathToFileURL(target).href;
  };
  write('index.html');
  return { root, parent, write, allowed: createPolicy(path.join(root, 'index.html'), () => null).allowedResource };
}

const url = 'file:///app/index.html';
const contents = { getURL: () => url, mainFrame: { url } };
const policy = createPolicy('/app/index.html', () => ({ isDestroyed: () => false, webContents: contents }));
const details = { requestingUrl: url, isMainFrame: true, mediaTypes: ['audio'], mediaType: 'audio' };

test('only exact local entry URL is trusted', () => {
  assert.equal(policy.trustedURL(url), true);
  assert.equal(policy.trustedURL(url + '#settings'), true);
  for (const bad of ['https://example.com', 'file:///app/other.html', url + '?x=1', 'invalid', 'file:///app/index.html.evil']) {
    assert.equal(policy.trustedURL(bad), false);
  }
});
test('new app-authored JS/CSS/SVG/raster assets load without filename registration', t => {
  const f = resourceFixture(t);
  for (const resource of ['index.html', 'renderer.js', 'ui/settings/audio.mjs', 'ui/chunk-172.js',
    'assets/new.css', 'assets/icon.svg', 'assets/photo.webp', 'assets/Иконка звука.png']) {
    const url = f.write(resource);
    assert.equal(f.allowed(url), true, resource);
    assert.equal(f.allowed(`${url}?v=2#cache`), true, resource);
  }
});
test('external protocols, UNC, malformed encodings and traversal fail closed', t => {
  const f = resourceFixture(t); const url = f.write('assets/good.js');
  const base = pathToFileURL(f.root).href;
  for (const bad of ['https://example.com/a.js', 'http://localhost/a.js', 'ws://localhost',
    'ftp://example.com/a.js', 'data:text/javascript,alert(1)', 'blob:file:///x',
    'file://localhost' + new URL(url).pathname, 'file://server/share/a.js',
    'file:////server/share/a.js', url.replace('file:///', 'file:/'),
    `${base}/assets/../assets/good.js`, `${base}/assets/%2e%2e/assets/good.js`,
    `${base}/assets/.%2e/assets/good.js`, `${base}/assets/%252e%252e/good.js`,
    `${base}/assets%2fgood.js`, `${base}/assets%5cgood.js`, `${base}/assets\\good.js`,
    `${base}/assets/%00good.js`, `${base}/assets/%0agood.js`, `${base}/assets/%zz.js`,
    `${base}/assets/%`, ` ${url}`, `${url}\n`, undefined, null, {}]) {
    assert.equal(f.allowed(bad), false, String(bad));
  }
});
test('outside siblings, privileged sources, secrets and non-assets are denied even when present', t => {
  const f = resourceFixture(t);
  const sibling = path.join(f.parent, 'desktop-evil'); fs.mkdirSync(sibling);
  fs.writeFileSync(path.join(sibling, 'steal.js'), 'secret');
  assert.equal(f.allowed(pathToFileURL(path.join(sibling, 'steal.js')).href), false);
  for (const relative of ['main.cjs', 'preload.js', 'security.js', 'sub/main.mjs', 'package.json',
    '.env.js', '.git/config.js', 'node_modules/lib/index.js', 'test/fakes.mjs', 'tests/spec.js',
    'runtime/core/index.js', 'integration/test-transport.mjs', 'scripts/package.mjs', 'build/generated.js', 'dist/old.js', 'docs/example.js', 'assets/sound.wav', 'assets/secret.json',
    'assets/module.js.map', 'assets/dialer.test.js', 'ui/other.html', 'native.node', 'keys.pem']) {
    assert.equal(f.allowed(f.write(relative)), false, relative);
  }
  assert.equal(f.allowed(pathToFileURL(path.join(f.root, 'missing.js')).href), false);
  fs.mkdirSync(path.join(f.root, 'directory.js'));
  assert.equal(f.allowed(pathToFileURL(path.join(f.root, 'directory.js')).href), false);
});
test('symlink files/directories (including in-root links), loops and replacement after approval are denied', t => {
  const f = resourceFixture(t); const good = f.write('assets/good.js');
  const outside = path.join(f.parent, 'outside.js'); fs.writeFileSync(outside, 'secret');
  for (const [name, target] of [['link.js', outside], ['local.js', path.join(f.root, 'assets/good.js')],
    ['linked-dir', path.join(f.root, 'assets')], ['loop.js', path.join(f.root, 'loop.js')]]) {
    fs.symlinkSync(target, path.join(f.root, name));
    const url = pathToFileURL(path.join(f.root, name === 'linked-dir' ? 'linked-dir/good.js' : name)).href;
    assert.equal(f.allowed(url), false, name);
  }
  assert.equal(f.allowed(good), true);
  fs.unlinkSync(path.join(f.root, 'assets/good.js'));
  fs.symlinkSync(outside, path.join(f.root, 'assets/good.js'));
  assert.equal(f.allowed(good), false);
});
test('missing/replaced/symlink roots are fail-closed', t => {
  const f = resourceFixture(t); const good = f.write('assets/good.js');
  const moved = path.join(f.parent, 'moved'); fs.renameSync(f.root, moved);
  fs.symlinkSync(moved, f.root);
  assert.equal(f.allowed(good), false);
  const symlinkRoot = createPolicy(path.join(f.root, 'index.html'), () => null);
  assert.equal(symlinkRoot.allowedResource(good), false);
  const missing = createPolicy(path.join(f.parent, 'absent/index.html'), () => null);
  assert.equal(missing.allowedResource(good), false);
});
test('CSP remains network-denying with no inline/eval or embedded document permissions', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.equal(csp, "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self' blob:; connect-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'");
});
test('IPC requires owning webContents, main frame, exact URL and zero arguments', () => {
  const event = { sender: contents, senderFrame: contents.mainFrame };
  assert.equal(policy.validIPC(event, []), true);
  assert.equal(policy.validIPC(event, ['microphone']), false);
  assert.equal(policy.validIPC({ ...event, senderFrame: { url } }, []), false);
  assert.equal(policy.validIPC({ sender: { ...contents }, senderFrame: contents.mainFrame }, []), false);
});
test('only main frame audio permission allowed; camera, subframes and external origins denied', () => {
  assert.equal(policy.permissionRequest(contents, 'media', details), true);
  assert.equal(policy.permissionCheck(contents, 'media', details), true);
  for (const permission of ['display-capture', 'geolocation', 'notifications', 'openExternal', 'unknown']) {
    assert.equal(policy.permissionRequest(contents, permission, details), false);
    assert.equal(policy.permissionCheck(contents, permission, details), false);
  }
  for (const patch of [{ mediaTypes: ['audio', 'video'] }, { mediaTypes: [] }, { mediaTypes: ['video'] },
    { isMainFrame: false }, { requestingUrl: 'https://evil.example' }]) {
    assert.equal(policy.permissionRequest(contents, 'media', { ...details, ...patch }), false);
  }
  for (const patch of [{ mediaType: 'video' }, { mediaType: 'unknown' }, { isMainFrame: false }, { requestingUrl: '' }]) {
    assert.equal(policy.permissionCheck(contents, 'media', { ...details, ...patch }), false);
  }
  assert.equal(policy.permissionCheck(null, 'media', details), false);
});
