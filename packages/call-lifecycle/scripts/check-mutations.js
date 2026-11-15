// Small, dependency-free sensitivity check. Mutations run in temporary copies;
// the reviewed source and the developer's working tree are never changed.
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('..', import.meta.url));
const mutations = [
  {
    name: 'old attempt can mutate the current call',
    from: 'call !== this.#call || event.callId !== call.id ||', to: '',
  },
  {
    name: 'double click bypasses reservation',
    from: "if (lease !== null) return { ok: false, error: 'busy' };", to: '',
  },
  {
    name: 'duration starts before confirmed connection',
    from: 'startedAt: this.#clock.now(), connectedAt: null,',
    to: 'startedAt: this.#clock.now(), connectedAt: this.#clock.now(),',
  },
  {
    name: 'cleanup deadline releases uncertain session',
    from: 'call.reason = event;', to: 'lease = null; call.reason = event;',
  },
];

for (const mutation of mutations) {
  const temp = await mkdtemp(join(root, '.mutation-'));
  try {
    await cp(join(root, 'src'), join(temp, 'src'), { recursive: true });
    await cp(join(root, 'test'), join(temp, 'test'), { recursive: true });
    await cp(join(root, 'package.json'), join(temp, 'package.json'));
    const target = join(temp, 'src', 'call-lifecycle.js');
    const original = await readFile(target, 'utf8');
    assert.ok(original.includes(mutation.from), `Mutation no longer applies: ${mutation.name}`);
    await writeFile(target, original.replaceAll(mutation.from, mutation.to));
    const result = spawnSync(process.execPath, ['--input-type=module'], {
      cwd: root, encoding: 'utf8', timeout: 10_000,
      input: `await import(${JSON.stringify(pathToFileURL(join(temp, 'test', 'call-lifecycle.test.js')).href)});`,
    });
    assert.equal(result.error, undefined, `Mutation runner failed: ${mutation.name}`);
    assert.equal(result.status, 1, `Mutation survived: ${mutation.name}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout + result.stderr, /AssertionError|ERR_ASSERTION/, 'Must fail an assertion');
    console.log(`Detected: ${mutation.name}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
