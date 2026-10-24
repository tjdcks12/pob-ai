import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { setTimeout } from 'node:timers/promises';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-auth-'));
process.env.POB_AI_HOME = home;
const { createService } = await import('../src/service/server.mjs');
const { writeJson } = await import('../src/state.mjs');

after(() => fs.rmSync(home, { recursive: true, force: true }));

test('an unavailable or unresponsive CLI is not treated as a signed-out account', { skip: process.platform !== 'win32' }, async () => {
  const { probeAuthentication } = await import('../src/agent/providers.mjs');
  assert.equal(await probeAuthentication({ id: 'codex', available: false }), 'unavailable');
  const script = path.join(home, 'stall.mjs'), command = path.join(home, 'stall.cmd');
  fs.writeFileSync(script, 'setInterval(()=>{},1000);');
  fs.writeFileSync(command, `@echo off\r\n"${process.execPath}" "${script}"\r\n`);
  const started = Date.now();
  assert.equal(await probeAuthentication({ id: 'codex', available: true, command }, { timeoutMs: 100 }), 'unknown');
  assert.ok(Date.now() - started < 2000, 'status checks cannot stall the picker');
});

test('provider status checks CLI authentication again when the login session changes', { skip: process.platform !== 'win32' }, async () => {
  const dir = path.join(home, 'agents with spaces');
  fs.mkdirSync(dir);
  const mode = path.join(dir, 'mode.json');
  const fixture = path.join(dir, 'auth.mjs');
  fs.writeFileSync(fixture, `
    import fs from 'node:fs';
    const [provider, mode, ...args] = process.argv.slice(2);
    const expected = provider === 'claude' ? ['auth','status','--json'] : provider === 'antigravity' ? ['models'] : ['login','status'];
    if (JSON.stringify(args) !== JSON.stringify(expected)) process.exit(2);
    const state = JSON.parse(fs.readFileSync(mode, 'utf8'));
    if (state === 'unknown') { console.error('Invalid CLI configuration'); process.exit(1); }
    if (provider === 'claude') console.log(JSON.stringify({ loggedIn: state === 'signed_in', email: 'private@example.com', accessToken: 'must-not-leak' }));
    else if (provider === 'antigravity') { if(state === 'signed_in') console.log('gemini-fixture-medium  Gemini fixture'); else console.error('Please sign in'); }
    else console.error(state === 'signed_in' ? 'Logged in using ChatGPT' : 'Not logged in');
    process.exit(state === 'signed_in' ? 0 : 1);
  `);
  const agentPaths = {};
  for (const id of ['claude', 'codex', 'antigravity']) {
    agentPaths[id] = path.join(dir, `${id}.cmd`);
    fs.writeFileSync(agentPaths[id], `@echo off\r\n"${process.execPath}" "${fixture}" "${id}" "${mode}" %*\r\n`);
  }
  writeJson(path.join(home, 'config.json'), { agentPaths, lastUpdateCheck: Date.now() });
  const service = await createService({ port: 0, log: () => {} });
  try {
    for (const state of ['signed_in', 'signed_out', 'signed_in', 'unknown']) {
      writeJson(mode, state);
      const response = await fetch(new URL('/api/agent/providers', service.url), { headers: { authorization: `Bearer ${service.token}` } });
      const text = await response.text();
      assert.doesNotMatch(text, /private@example|must-not-leak/);
      const reply = JSON.parse(text);
      assert.equal(reply.ok, true);
      for (const provider of reply.providers) {
        assert.equal(provider.available, true, 'installed and signed in are separate states');
        assert.equal(provider.auth, state, `${provider.id}: the new-chat picker needs the current login state`);
      }
    }
    const { openLogin, providerStatus, resolveProvider } = await import('../src/agent/providers.mjs');
    writeJson(mode, 'signed_out');
    await openLogin('codex'); // This fixture rejects login commands: exercise a failed sign-in.
    let status;
    for (let i = 0; i < 30; i++) {
      status = await providerStatus(resolveProvider('codex'));
      if (!status.signingIn) break;
      await setTimeout(20);
    }
    assert.equal(status.loginFailed, true);
    writeJson(mode, 'signed_in');
    assert.equal((await providerStatus(resolveProvider('codex'))).loginFailed, false, 'successful authentication clears old failure feedback');
    writeJson(mode, 'signed_out');
    assert.equal((await providerStatus(resolveProvider('codex'))).loginFailed, false, 'a later sign-out must not resurrect an old failure');
    assert.equal(service.agents.sessions.length, 0, 'status never creates a conversation or calls a model');
  } finally { service.close(); }
});
