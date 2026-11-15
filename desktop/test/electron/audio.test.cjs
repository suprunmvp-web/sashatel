'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '../..');
const headless = process.platform === 'linux' && !process.env.DISPLAY ? ['--headless', '--ozone-platform=headless', '--disable-gpu'] : [];

async function launch(extra = []) {
  // Playwright otherwise adds --no-sandbox by default. Never disable it here.
  const app = await electron.launch({ chromiumSandbox: true, args: [...headless, ...extra, root], timeout: 20000 });
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.sashatelAudio && !window.sashatelAudio.pending);
  return { app, page };
}

function sineWav() {
  const samples = 48000 * 3;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(48000, 24); buffer.writeUInt32LE(96000, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 48000) * 10000), 44 + i * 2);
  return buffer;
}

test('real Electron: secure startup, IPC, external navigation, and empty hardware inventory', { timeout: 30000 }, async t => {
  const { app, page } = await launch();
  try {
    const prefs = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
    assert.equal(prefs.contextIsolation, true);
    assert.equal(prefs.sandbox, true);
    assert.equal(prefs.nodeIntegration, false);
    assert.equal(prefs.webSecurity, true);
    assert.equal(await page.evaluate(() => typeof require), 'undefined');
    assert.equal(await page.evaluate(() => typeof window.sashatel.send), 'undefined');
    assert.equal(typeof await page.evaluate(() => window.sashatel.audio.getMicrophonePermission()), 'string');
    const before = page.url();
    await page.evaluate(() => { location.href = 'https://example.com'; });
    assert.equal(page.url(), before);
    await page.evaluate(() => window.open('https://example.com'));
    assert.equal((await app.windows()).length, 1);
    const state = await page.evaluate(() => window.sashatelAudio.getState());
    t.diagnostic(`Native inventory counts: inputs=${state.devices.inputs.length}, outputs=${state.devices.outputs.length}. No physical capture requested at startup.`);
    if (!state.devices.inputs.length) {
      const code = await page.evaluate(async () => {
        try { await window.sashatelAudio.testMicrophone({ durationMs: 200 }); return 'unexpected-success'; }
        catch (error) { return error.code; }
      });
      assert.ok(['NO_INPUT', 'PERMISSION_DENIED', 'DEVICE_UNAVAILABLE'].includes(code), code);
    }
    if (!state.devices.outputs.length) {
      assert.equal(await page.evaluate(async () => {
        try { await window.sashatelAudio.testPlayback(); } catch (error) { return error.code; }
      }), 'NO_OUTPUT');
    }
    assert.equal(await page.locator('#call-state').textContent(), 'Готово к тесту');
  } finally { await app.close(); }
});

test('real Electron / Chromium: synthetic capture through production permission handlers and Web Audio', { timeout: 45000 }, async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'sashatel-audio-'));
  const wav = path.join(temp, 'signal.wav');
  await writeFile(wav, sineWav());
  let app;
  try {
    const launched = await launch(['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`]);
    app = launched.app;
    const { page } = launched;
    const errors = [];
    page.on('pageerror', error => errors.push(error.name));
    await page.evaluate(() => {
      window.audioTestContexts = [];
      const create = window.sashatelAudio.createContext;
      window.sashatelAudio.createContext = () => {
        const context = create(); window.audioTestContexts.push(context); return context;
      };
    });
    await t.test('actual PCM input gives nonzero RMS; three repeated tests close resources', async () => {
      const results = await page.evaluate(async () => {
        const service = window.sashatelAudio;
        const results = [];
        for (let i = 0; i < 3; i++) results.push(await service.testMicrophone({ durationMs: 650 }));
        return { results, inputReleased: service.input === null };
      });
      assert.equal(results.inputReleased, true);
      for (const result of results.results) {
        assert.equal(result.reason, 'completed');
        assert.equal(result.signalDetected, true);
        assert.ok(result.maxRms > 0.01);
        assert.ok(result.frames >= 3);
      }
    });
    await t.test('software gain modifies a real outgoing stream; zero gain yields silence', async () => {
      const result = await page.evaluate(async () => {
        const service = window.sashatelAudio;
        const lease = await service.acquireInput();
        const context = new AudioContext();
        const source = context.createMediaStreamSource(lease.stream);
        const analyser = context.createAnalyser();
        const mute = context.createGain(); mute.gain.value = 0;
        source.connect(analyser); analyser.connect(mute); mute.connect(context.destination);
        await context.resume();
        const measure = async gain => {
          service.setInputGain(gain);
          await new Promise(resolve => setTimeout(resolve, 250));
          const samples = new Float32Array(analyser.fftSize);
          analyser.getFloatTimeDomainData(samples);
          return Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
        };
        try { return { audible: await measure(1), muted: await measure(0) }; }
        finally { source.disconnect(); analyser.disconnect(); mute.disconnect(); await context.close(); lease.release(); service.setInputGain(1); }
      });
      assert.ok(result.audible > 0.01);
      assert.equal(result.muted, 0);
    });
    await t.test('exact input device selection and real setSinkId routing', async () => {
      const result = await page.evaluate(async () => {
        const service = window.sashatelAudio;
        const devices = await service.refreshDevices();
        await service.selectInput(devices.inputs.find(d => d.selectable).id);
        const lease = await service.acquireInput();
        lease.release();
        const output = devices.outputs.find(d => d.selectable);
        if (!output) return { routed: false };
        await service.selectOutput(output.id);
        const playing = service.testPlayback({ durationMs: 250 });
        const result = await playing;
        return { routed: true, result };
      });
      assert.equal(result.routed, true);
      assert.equal(result.result.playbackStarted, true);
      assert.equal(result.result.audibilityConfirmed, false);
    });
    await t.test('concurrent requests, stopTests and suspend/resume are safe in Chromium', async () => {
      const result = await page.evaluate(async () => {
        const service = window.sashatelAudio;
        const testing = service.testMicrophone();
        let code;
        try { await service.acquireInput(); } catch (error) { code = error.code; }
        // Allow either pending cancellation or an already running test to finish.
        service.stopTests();
        try { await testing; } catch (error) { if (error.code !== 'CANCELLED') throw error; }
        const lease = await service.acquireInput();
        service.suspend();
        const stopped = lease.stream.getTracks().every(track => track.readyState === 'ended');
        await service.resume();
        return { code, stopped, inputReleased: service.input === null };
      });
      assert.equal(result.code, 'BUSY');
      assert.equal(result.stopped, true);
      assert.equal(result.inputReleased, true);
    });
    await t.test('camera remains denied despite audio permission', async () => {
      const name = await page.evaluate(async () => {
        try { const stream = await navigator.mediaDevices.getUserMedia({ video: true }); stream.getTracks().forEach(t => t.stop()); return 'unexpected-success'; }
        catch (error) { return error.name; }
      });
      assert.equal(name, 'NotAllowedError');
    });
    await t.test('all service-owned AudioContexts are actually closed', async () => {
      await page.waitForFunction(() => window.audioTestContexts.every(context => context.state === 'closed'));
      assert.ok(await page.evaluate(() => window.audioTestContexts.length >= 6));
    });
    await t.test('reload creates a fresh service with no active capture', async () => {
      await page.reload();
      await page.waitForFunction(() => window.sashatelAudio && !window.sashatelAudio.pending);
      assert.equal(await page.evaluate(() => window.sashatelAudio.input === null && window.sashatelAudio.output === null), true);
      assert.deepEqual(errors, []);
    });
    t.diagnostic('Synthetic WAV and Chromium fake devices only: no physical microphone, output audibility, macOS TCC or sleep tested.');
  } finally { if (app) await app.close(); await rm(temp, { recursive: true, force: true }); }
});
