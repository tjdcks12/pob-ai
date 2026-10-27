import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-panel-'));
process.env.POB_AI_HOME = home;
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ lastUpdateCheck: Date.now() }));
const { createService } = await import('../src/service/server.mjs');
after(() => fs.rmSync(home, { recursive: true, force: true }));

test('repeated open requests reuse the PoB being started and timed-out waits release listeners', async () => {
  const service = await createService({ port: 0, log: () => {} });
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
  await once(child, 'spawn');
  service.pobProcess = child;
  try {
    assert.deepEqual(service.openPob(), { opening: true, pid: child.pid });
    assert.deepEqual(service.openPob(), { opening: true, pid: child.pid });
    const before = service.bridge.listenerCount('connected');
    await assert.rejects(service.waitForPob(1), { code: 'LIVE_TIMEOUT' });
    assert.equal(service.bridge.listenerCount('connected'), before);
  } finally {
    const stopped = once(child, 'close'); child.kill(); await stopped;
    service.close();
  }
});

test('PoB settings and the authenticated settings button open a separate modal without opening AI', async () => {
  const agent = [], settings = [];
  const service = await createService({ port: 0, log: () => {}, openAgentPanel: url => agent.push(url),
    openSettingsPanel: (url, options) => { settings.push({ url, options }); return { host: 'webview2' }; } });
  try {
    service.bridge.emit('event', { kind: 'open-settings', ownerPid: 4321 });
    assert.equal(settings.length, 1);
    assert.equal(settings[0].options.ownerPid, 4321);
    const endpoint = new URL('/api/settings/open', service.url);
    endpoint.search = '';
    assert.equal((await fetch(endpoint, { method: 'POST', body: '{}' })).status, 401);
    assert.equal(settings.length, 1, 'an unauthenticated caller cannot open a window');
    const reply = await fetch(endpoint, { method: 'POST', headers: { authorization: 'Bearer ' + service.token, 'content-type': 'application/json' }, body: JSON.stringify({ focus: 'pob-path' }) }).then(r => r.json());
    assert.equal(reply.ok, true);
    assert.equal(settings[1].options.focus, 'pob-path');
    assert.deepEqual(agent, [], 'settings never opens or resets an AI conversation');
  } finally { service.close(); }
});

test('a browser subscriber does not suppress opening the desktop panel', async () => {
  const opened = [];
  const service = await createService({ port: 0, log: () => {}, openAgentPanel: url => opened.push(url) });
  const abort = new AbortController();
  try {
    const response = await fetch(new URL('/api/events', service.url), {
      headers: { authorization: 'Bearer ' + service.token }, signal: abort.signal,
    });
    const status = await fetch(new URL('/api/status', service.url), {
      headers: { authorization: 'Bearer ' + service.token },
    }).then(r => r.json());
    assert.equal(status.settings.pobTheme, 'pob', 'new installations start with the original template');
    assert.equal(status.settings.pobLanguage, 'system', 'a fresh PoB follows the Windows display language');
    assert.equal(status.settings.pobLanguageResolved, status.settings.systemLocale);
    const html = await fetch(new URL('/', service.url)).then(r => r.text());
    assert.ok(html.includes(`data-system-locale="${status.settings.systemLocale}"`), 'the panel and PoB receive the same system language');
    const reader = response.body.getReader();
    await reader.read();
    service.bridge.emit('event', { kind: 'open-panel', panelFound: false });
    assert.deepEqual(opened, [service.url], 'an in-app browser tab is not an existing Edge app window');
    const focus = await reader.read();
    assert.match(new TextDecoder().decode(focus.value), /event: focus-panel/);
    service.bridge.emit('event', { kind: 'open-panel', panelFound: true });
    assert.equal(opened.length, 1, 'the existing native panel is reused');
    service.bridge.emit('event', { kind: 'open-panel', panelFound: true, panelFocused: false });
    assert.equal(opened.length, 2, 'the host retries activation when Windows declined the first attempt');
  } finally {
    abort.abort();
    service.close();
  }
});

test('closing the PoB window ends PoB AI unless PoB is restarting or updating', async () => {
  let closed = 0, ended;
  const done = new Promise(r => { ended = r; });
  const service = await createService({ port: 0, log: () => {}, pobClosedGraceMs: 20, onPobClosed: () => { closed++; ended(); } });
  const settle = () => new Promise(r => setTimeout(r, 100));
  try {
    service.bridge.emit('event', { kind: 'pob-updating', mode: 'normal' });
    service.bridge.emit('disconnected');
    await settle();
    assert.equal(closed, 0, 'a "normal" PoB update restarts in place and reconnects');
    service.bridge.emit('connected', { version: '0.23.1' });
    service.bridge.emit('disconnected');
    await done;
    assert.equal(closed, 1, 'the closed PoB window takes the panel and the service with it');
  } finally {
    service.close();
  }
});
