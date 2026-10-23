import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-agent-version-'));
process.env.POB_AI_HOME = home;
const { createService } = await import('../src/service/server.mjs');
const { writeJson } = await import('../src/state.mjs');
after(() => fs.rmSync(home, { recursive: true, force: true }));

test('outdated Codex is rejected before a model call and without leaving a broken chat', { skip: process.platform !== 'win32' }, async () => {
  const cli = path.join(home, 'old-codex.cmd');
  const marker = path.join(home, 'model-called');
  fs.writeFileSync(cli, `@echo off\r\nif "%~1"=="--version" (\r\n echo codex-cli 0.41.0\r\n exit /b 0\r\n)\r\necho unexpected>"${marker}"\r\nexit /b 1\r\n`);
  writeJson(path.join(home, 'config.json'), { agentPaths: { codex: cli }, lastUpdateCheck: Date.now() });
  const service = await createService({ port: 0, log: () => {} });
  const headers = { authorization: `Bearer ${service.token}`, 'content-type': 'application/json' };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(new URL('/api/agent/chat', service.url), {
        method: 'POST', headers, body: JSON.stringify({ provider: 'codex', message: 'hello' }),
      });
      assert.equal(response.status, 400);
      const { error } = await response.json();
      assert.equal(error.code, 'AGENT_OUTDATED');
      assert.equal(error.diagnostic.version, '0.41.0');
      assert.equal(error.diagnostic.minimumVersion, '0.50.0');
      assert.match(error.diagnostic.executable, /old-codex.cmd$/);
    }
    const sessions = await fetch(new URL('/api/agent/sessions', service.url), { headers }).then(r => r.json());
    assert.deepEqual(sessions.sessions, []);
    assert.equal(fs.existsSync(marker), false);
  } finally { service.close(); }
});
