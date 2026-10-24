import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-sync-api-'));
process.env.POB_AI_HOME = home;
const { createService } = await import('../src/service/server.mjs');
const { writeJson } = await import('../src/state.mjs');
writeJson(path.join(home, 'config.json'), { lastUpdateCheck: Date.now() });
after(() => fs.rmSync(home, { recursive: true, force: true }));

test('sync API requires the existing service token and stays off until explicitly enabled', async () => {
  const service = await createService({ port: 0, log: () => {} });
  let calls = 0;
  service.runtime.run = async () => { calls++; return { result: { available: true, signedIn: true, unsaved: false, file: 'C:/Builds/test.xml', characters: [{ name: 'Test', id: 'id' }] } }; };
  const request = (route, body, authorized = true) => fetch(new URL(route, service.url), {
    method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(authorized ? { authorization: `Bearer ${service.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    for (const [route, body] of [['/api/character-sync'], ['/api/character-sync/context'], ['/api/character-sync', { enabled: true }], ['/api/character-sync/refresh', {}]]) {
      assert.equal((await request(route, body, false)).status, 401);
    }
    assert.equal(calls, 0);
    const status = await (await request('/api/character-sync')).json(); assert.equal(status.enabled, false);
    await request('/api/character-sync/refresh', {}); assert.equal(calls, 0);
    const context = await (await request('/api/character-sync/context')).json(); assert.equal(context.file, 'C:/Builds/test.xml'); assert.equal(calls, 1);
    const bad = await (await request('/api/character-sync', { enabled: true, character: 'Test', intervalSeconds: 2 })).json(); assert.equal(bad.error.code, 'BAD_INTERVAL');
    await request('/api/character-sync', { enabled: false }); assert.equal(service.characterSync.status().enabled, false);
  } finally { service.close(); }
});
