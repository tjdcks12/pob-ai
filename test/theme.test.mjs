import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { THEMES, resolveTheme } from '../ui/themes.js';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-theme-'));
process.env.POB_AI_HOME = home;
const { LOCAL } = await import('../src/commands/local.mjs');
const { readConfig, updateConfig } = await import('../src/state.mjs');
const { createService } = await import('../src/service/server.mjs');
after(() => fs.rmSync(home, { recursive: true, force: true }));

test('one choice applies to PoB, persists, and notifies every panel with the same theme', async () => {
  const applied = [], events = [];
  const runtime = { liveConnected: true, run: async (command, args) => applied.push({ command, ...args }), service: { broadcast: (event, data) => events.push({ event, ...data }) } };
  for (const theme of THEMES) {
    const { result } = await LOCAL.theme({ theme }, runtime);
    assert.equal(result.theme, theme);
    assert.equal(readConfig().pobTheme, theme);
    assert.deepEqual(applied.at(-1), { command: 'ui.theme_apply', theme });
    assert.deepEqual(events.at(-1), { event: 'theme', theme });
  }
  assert.equal(resolveTheme('midnight'), 'dark', 'old saved names keep their migration');
});

test('failed PoB application preserves the shared selection and does not broadcast a change', async () => {
  updateConfig({ pobTheme: 'forest' });
  const events = [];
  await assert.rejects(LOCAL.theme({ theme: 'sand' }, { liveConnected: true, run: async () => { throw new Error('unavailable'); }, service: { broadcast: event => events.push(event) } }));
  assert.equal(readConfig().pobTheme, 'forest');
  assert.deepEqual(events, []);
});

test('with PoB closed the setting still updates panel events and survives a service restart', async () => {
  updateConfig({ lastUpdateCheck: Date.now() });
  let service = await createService({ port: 0, log: () => {} });
  const abort = new AbortController();
  try {
    const endpoint = route => new URL(route, service.url);
    const headers = { authorization: 'Bearer ' + service.token, 'content-type': 'application/json' };
    const stream = await fetch(endpoint('/api/events'), { headers, signal: abort.signal });
    const reader = stream.body.getReader();
    await reader.read();
    const response = await fetch(endpoint('/api/run'), { method: 'POST', headers, body: JSON.stringify({ command: 'ui.theme', args: { theme: 'ocean' } }) }).then(r => r.json());
    assert.equal(response.ok, true);
    assert.equal(response.result.applied, false);
    const frame = new TextDecoder().decode((await reader.read()).value);
    assert.match(frame, /event: theme\ndata: {"theme":"ocean"}/);
    const html = await fetch(endpoint('/')).then(r => r.text());
    assert.match(html, /data-theme="ocean"/, 'new panels immediately start with the saved shared palette');
    abort.abort();service.close();
    service = await createService({ port: 0, log: () => {} });
    assert.equal(readConfig().pobTheme, 'ocean');
    assert.match(await fetch(new URL('/', service.url)).then(r => r.text()), /data-theme="ocean"/);
  } finally { abort.abort(); service.close(); }
});
