import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CharacterSync } from '../src/service/character-sync.mjs';

function fixture() {
  let config = {}, time = 1000;
  const calls = [], timers = [], events = [], backups = [];
  const context = { available: true, signedIn: true, file: 'C:/Builds/my.xml', unsaved: false, characters: [{ name: 'My Character', id: 'char-id' }] };
  const runtime = { run: async (op, args, options) => { calls.push({ op, args, options }); return { result: op === 'account.sync_context' ? context : { file: context.file, snapshotHash: 'character-hash', fileHash: 'file-hash' } }; } };
  const sync = new CharacterSync({ runtime, read: () => config, write: patch => { config = { ...config, ...patch }; }, now: () => time,
    timer: (fn, delay) => { const id = { fn, delay, unref() {} }; timers.push(id); return id; }, cancel: id => { id.cancelled = true; },
    broadcast: (name, value) => events.push({ name, value }), backup: file => backups.push(file) });
  return { sync, calls, timers, events, backups, context, runtime, config: () => config, advance: () => { time += 120000; } };
}
test('disabled by default, with no timer, network or build writes', async () => {
  const f = fixture(); await f.sync.refresh(); assert.equal(f.sync.status().enabled, false); assert.equal(f.timers.length, 0); assert.equal(f.calls.length, 0); assert.equal(f.backups.length, 0);
});
test('binds a chosen character to the currently saved file and refreshes through one live operation', async () => {
  const f = fixture(); await f.sync.configure({ enabled: true, character: 'My Character', intervalSeconds: 120 });
  assert.equal(f.config().characterSync.file, f.context.file); assert.equal(f.timers.at(-1).delay, 0);
  await f.sync.refresh();
  assert.deepEqual(f.calls.at(-1), { op: 'account.refresh', args: { file: f.context.file, character: 'My Character', characterId: 'char-id' }, options: { target: 'live' } });
  assert.equal(f.sync.status().phase, 'updated'); assert.equal(f.backups.length, 1); assert.ok(f.events.some(event => event.name === 'build-changed'));
  await f.sync.refresh(); assert.equal(f.calls.at(-1).args.previousHash, 'character-hash');
  await f.sync.configure({ enabled: false }); assert.equal(f.sync.status().enabled, false); assert.ok(f.timers.at(-1).cancelled);
});
test('unsaved edits, a different file or sign-out pause refresh without touching the build', async () => {
  for (const [property, value, phase] of [['unsaved', true, 'unsaved'], ['file', 'C:/Builds/other.xml', 'differentBuild'], ['signedIn', false, 'signIn']]) {
    const f = fixture(); await f.sync.configure({ enabled: true, character: 'My Character' }); f.calls.length = 0; f.context[property] = value;
    await f.sync.refresh(); assert.equal(f.sync.status().phase, phase); assert.equal(f.backups.length, 0); assert.ok(f.calls.every(call => call.op !== 'account.refresh'));
  }
});
test('overlapping timer and manual refreshes share one request', async () => {
  const f = fixture(); await f.sync.configure({ enabled: true, character: 'My Character' });
  let finish; const original = f.runtime.run;
  f.runtime.run = (op, args, options) => op === 'account.refresh' ? new Promise(resolve => { finish = () => resolve({ result: { file: f.context.file } }); }) : original(op, args, options);
  const first = f.sync.refresh(), second = f.sync.refresh(); assert.equal(first, second);
  await Promise.resolve(); await Promise.resolve(); finish(); await first; assert.equal(f.backups.length, 1);
});
test('configuration needs an actual saved build, explicit character and valid cadence', async () => {
  const f = fixture(); await assert.rejects(f.sync.configure({ enabled: true, character: 'Unknown' }), { code: 'CHARACTER_REQUIRED' });
  f.context.unsaved = true; await assert.rejects(f.sync.configure({ enabled: true, character: 'My Character' }), { code: 'UNSAVED' });
  await assert.rejects(f.sync.configure({ enabled: true, intervalSeconds: 1 }), { code: 'BAD_INTERVAL' }); assert.equal(f.sync.status().enabled, false);
});

test('errors back off, success clears the delay, and close cancels the timer', async () => {
  const f = fixture(); await f.sync.configure({ enabled: true, character: 'My Character' });
  const original = f.runtime.run;
  f.runtime.run = async (op, args, options) => { if (op === 'account.refresh') throw Object.assign(new Error('offline'), { code: 'DOWNLOAD_FAILED' }); return original(op, args, options); };
  await f.sync.refresh(); f.sync.schedule(); assert.equal(f.timers.at(-1).delay, 240000);
  await f.sync.refresh(); f.sync.schedule(); assert.equal(f.timers.at(-1).delay, 480000);
  f.runtime.run = original; await f.sync.refresh(); f.sync.schedule(); assert.equal(f.timers.at(-1).delay, 120000);
  f.sync.close(); assert.ok(f.timers.at(-1).cancelled); const count = f.calls.length; await f.sync.refresh(); assert.equal(f.calls.length, count);
});

test('a new file binding discards the previous snapshot and never changes the requested target in status', async () => {
  const f = fixture(); await f.sync.configure({ enabled: true, character: 'My Character' }); await f.sync.refresh();
  await f.sync.configure({ enabled: false }); f.context.file = 'C:/Builds/new.xml';
  await f.sync.configure({ enabled: true, character: 'My Character' }); assert.equal(f.sync.status().file, f.context.file);
  await f.sync.refresh(); assert.equal(f.calls.at(-1).args.previousHash, undefined);
});

test('failed rollback disables future automatic attempts, including after restarting the service', async () => {
  const f = fixture(); await f.sync.configure({ enabled: true, character: 'My Character' });
  const original = f.runtime.run;
  f.runtime.run = async (op, args, options) => { if (op === 'account.refresh') throw Object.assign(new Error('restore failed'), { code: 'SYNC_ROLLBACK_FAILED' }); return original(op, args, options); };
  await f.sync.refresh(); assert.equal(f.sync.status().enabled, false); assert.equal(f.sync.status().phase, 'recovery');
  const count = f.calls.length; await f.sync.refresh(); assert.equal(f.calls.length, count);
  const restarted = new CharacterSync({ runtime: f.runtime, read: f.config, timer: () => { throw new Error('must not schedule'); } });
  assert.equal(restarted.status().phase, 'recovery'); assert.equal(restarted.status().enabled, false); restarted.close();
});
