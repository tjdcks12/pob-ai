import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-http-port-'));
process.env.POB_AI_HOME = home;
const { createService } = await import('../src/service/server.mjs');
const { writeJson } = await import('../src/state.mjs');
writeJson(path.join(home, 'config.json'), { lastUpdateCheck: Date.now() });
after(() => fs.rmSync(home, { recursive: true, force: true }));

async function reachable(service) {
  try {
    const response = await fetch(new URL('/api/health', service.url), { headers: { authorization: `Bearer ${service.token}` } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally { service.close(); }
}

test('a previously saved browser-blocked HTTP port is replaced with a reachable address', async () => {
  writeJson(path.join(home, 'service.json'), { port: 10080 });
  await reachable(await createService({ log: () => {} }));
});

test('a blocked port assigned by the OS is retried before the HTTP address is published', async t => {
  const listen = http.Server.prototype.listen;
  let assignedBlockedPort = false;
  t.mock.method(http.Server.prototype, 'listen', function (...args) {
    if (!assignedBlockedPort && args[0] === 0 && args[1] === '127.0.0.1') {
      assignedBlockedPort = true;
      args[0] = 10080; // Simulates a low Windows dynamic port range.
    }
    return listen.apply(this, args);
  });
  const service = await createService({ port: 0, log: () => {} });
  assert.ok(assignedBlockedPort);
  await reachable(service);
});
