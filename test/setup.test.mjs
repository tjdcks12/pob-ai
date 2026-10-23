import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-setup-'));
process.env.POB_AI_HOME = home;
delete process.env.POB_PATH;
const { createService } = await import('../src/service/server.mjs');
const { readConfig, writeJson } = await import('../src/state.mjs');
const { locatePob } = await import('../src/pob/locate.mjs');
after(() => fs.rmSync(home, { recursive: true, force: true }));

function fixture(name) {
  const dir = path.join(home, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Path of Building-PoE2.exe'), '');
  fs.writeFileSync(path.join(dir, 'Launch.lua'), '-- fixture');
  fs.writeFileSync(path.join(dir, 'manifest.xml'), '<PoBVersion><Version number="0.23.1" branch="master" /></PoBVersion>');
  return dir;
}
const oldDir = fixture('previous');
const selectedDir = fixture('selected');
const managedDir = fixture('pob');

for (const mode of ['folder', 'install']) test(`setup ${mode} replaces the cached folder and remains selected after reopening settings and restarting the service`, async () => {
  writeJson(path.join(home, 'config.json'), { pobPath: oldDir, lastUpdateCheck: Date.now() });
  let service = await createService({ port: 0, log: () => {} });
  const getStatus = () => fetch(new URL('/api/status', service.url), { headers: { authorization: 'Bearer ' + service.token } }).then(r => r.json());
  const target = mode === 'folder' ? selectedDir : managedDir;
  try {
    assert.equal((await getStatus()).pob.dir, oldDir, 'opening settings resolves and caches the previous install');
    const result = await fetch(new URL('/api/run', service.url), {
      method: 'POST', headers: { authorization: 'Bearer ' + service.token, 'content-type': 'application/json' },
      body: JSON.stringify({ command: 'setup', args: mode === 'folder' ? { pobPath: target } : { installPob: true } }),
    }).then(r => r.json());
    assert.equal(result.ok, true);
    assert.equal(result.result.dir, target);
    assert.equal(readConfig().pobPath, target, 'the installation was saved successfully');
    assert.equal((await getStatus()).pob.dir, target, 'reopening settings must not return the cached previous folder');
    assert.equal(service.runtime.install().dir, target, 'the next PoB launch uses the new folder');
    service.close();
    service = await createService({ port: 0, log: () => {} });
    assert.equal((await getStatus()).pob.dir, target, 'a new service preserves the selection');
  } finally { service.close(); }
});

test('the PoB installed by PoB AI is automatically found when no explicit folder is saved', () => {
  writeJson(path.join(home, 'config.json'), {});
  assert.equal(locatePob().dir, managedDir);
  assert.equal(locatePob().source, 'managed');
});
