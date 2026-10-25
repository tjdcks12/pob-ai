import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CharacterSync } from '../src/service/character-sync.mjs';

test('enabling refresh on a named unsaved build keeps the switch on and waits without importing or saving', async () => {
  let config = {}, imports = 0, backups = 0;
  const context = { available: true, signedIn: true, file: 'C:/Builds/test.xml', unsaved: true, characters: [{ name: 'Test', id: 'test' }] };
  const sync = new CharacterSync({ autoStart: false, read: () => config, write: patch => { config = { ...config, ...patch }; },
    runtime: { run: async op => { if (op === 'account.sync_context') return { result: context }; imports++; return { result: { file: context.file } }; } },
    timer: () => ({ unref() {} }), cancel: () => {}, backup: () => { backups++; } });
  try {
    await sync.configure({ enabled: true, character: 'Test', intervalSeconds: 120 });
    assert.equal(sync.status().enabled, true); assert.equal(sync.status().phase, 'unsaved');
    await sync.refresh(); assert.equal(imports, 0); assert.equal(backups, 0);
    context.unsaved = false;
    await sync.refresh(); assert.equal(imports, 1); assert.equal(backups, 1); assert.equal(sync.status().phase, 'updated');
  } finally { sync.close(); }
});
