'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPolicy } = require('../security.cjs');

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
test('resource allowlist excludes external URLs and arbitrary local files', () => {
  for (const resource of ['index.html', 'renderer.js', 'style.css', 'audio/bootstrap.mjs', 'audio/resources.mjs']) {
    assert.equal(policy.allowedResource(`file:///app/${resource}`), true);
  }
  for (const url of ['https://example.com', 'file:///etc/passwd', 'file:///app/main.cjs',
    'file:///app/audio/../../secret.js', 'file:///app/test/fakes.mjs', 'data:text/javascript,alert(1)']) {
    assert.equal(policy.allowedResource(url), false);
  }
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
