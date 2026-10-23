import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-permissions-'));
process.env.POB_AI_HOME = home;
const { createService } = await import('../src/service/server.mjs');
const { writeJson } = await import('../src/state.mjs');
// Node exits on the CLI arguments, without invoking an AI provider or running a prompt.
// Session persistence and the actual HTTP/event-stream contract still run end to end.
writeJson(path.join(home, 'config.json'), { agentPaths: { codex: process.execPath }, lastUpdateCheck: Date.now() });
after(() => fs.rmSync(home, { recursive: true, force: true }));

test('chat permissions default off, stay per chat, survive restart and can be revoked', async () => {
  let service = await createService({ port: 0, log: () => {} });
  const request = (pathname, body) => fetch(new URL(pathname, service.url), {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${service.token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const chat = async body => {
    const response = await request('/api/agent/chat', { provider: 'codex', message: 'permission fixture', ...body });
    assert.equal(response.status, 200);
    const events = (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
    assert.equal(events.at(-1).type, 'end');
    return events.find(event => event.type === 'start');
  };
  try {
    const normal = await chat({});
    assert.equal(normal.fullAccess, false);
    const full = await chat({ fullAccess: true });
    assert.equal(full.fullAccess, true);
    const sessions = (await (await request('/api/agent/sessions')).json()).sessions;
    assert.equal(sessions.find(s => s.id === normal.sessionId).fullAccess, false);
    assert.equal(sessions.find(s => s.id === full.sessionId).fullAccess, true);
    service.close();
    service = await createService({ port: 0, log: () => {} });
    assert.equal((await (await request(`/api/agent/sessions/${full.sessionId}`)).json()).session.fullAccess, true);
    assert.equal((await chat({ sessionId: full.sessionId })).fullAccess, true, 'omitting the value preserves this chat only');
    assert.equal((await chat({ sessionId: full.sessionId, fullAccess: false })).fullAccess, false);
    assert.equal((await chat({ sessionId: full.sessionId })).fullAccess, false, 'revocation stays saved');
    assert.equal((await chat({})).fullAccess, false, 'new chats never inherit full access');
    for (const fullAccess of ['true', 'false', 1, null, {}]) {
      const response = await request('/api/agent/chat', { sessionId: normal.sessionId, message: 'invalid', fullAccess });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, 'BAD_REQUEST');
    }
    assert.equal((await (await request(`/api/agent/sessions/${normal.sessionId}`)).json()).session.fullAccess, false);
  } finally { service.close(); }
});
