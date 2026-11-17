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
  {
    name: 'previous owner epoch can issue commands',
    file: 'desktop-call-owner.js', test: 'integration/desktop-owner.test.js',
    from: "if (command.ownerId !== this.#ownerId) return failure('OWNER_CHANGED');", to: '',
  },
  {
    name: 'revoked renderer can still command calls',
    file: 'desktop-call-owner.js', test: 'integration/desktop-owner.test.js',
    from: "if (!session.active) return failure('SESSION_CLOSED');", to: '',
  },
  {
    name: 'audio loss silently ends the SIP call',
    file: 'desktop-call-owner.js', test: 'integration/desktop-owner.test.js',
    from: "this.#audioIssue = Object.freeze({ domain: 'audio', callId, code });",
    to: "this.#core.endCall(callId); this.#audioIssue = Object.freeze({ domain: 'audio', callId, code });",
  },
];

for (const mutation of mutations) {
  const temp = await mkdtemp(join(root, '.mutation-'));
  try {
    await cp(join(root, 'src'), join(temp, 'src'), { recursive: true });
    await cp(join(root, 'test'), join(temp, 'test'), { recursive: true });
    await cp(join(root, 'package.json'), join(temp, 'package.json'));
    const target = join(temp, 'src', mutation.file ?? 'call-lifecycle.js');
    const original = await readFile(target, 'utf8');
    assert.ok(original.includes(mutation.from), `Mutation no longer applies: ${mutation.name}`);
    await writeFile(target, original.replaceAll(mutation.from, mutation.to));
    const result = spawnSync(process.execPath, ['--input-type=module'], {
      cwd: root, encoding: 'utf8', timeout: 10_000,
      input: `await import(${JSON.stringify(pathToFileURL(join(temp, 'test', mutation.test ?? 'call-lifecycle.test.js')).href)});`,
    });
    assert.equal(result.error, undefined, `Mutation runner failed: ${mutation.name}`);
    assert.equal(result.status, 1, `Mutation survived: ${mutation.name}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout + result.stderr, /AssertionError|ERR_ASSERTION/, 'Must fail an assertion');
    console.log(`Detected: ${mutation.name}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
