// Runs real PoB operations headless. Skipped when no PoB (PoE2) install is found
// (set POB_PATH to point at one). Saves go to a temporary folder, never the user's builds.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-test-'));
process.env.POB_AI_HOME = home;
process.env.POBAI_BUILD_DIR = path.join(home, 'builds');
fs.mkdirSync(process.env.POBAI_BUILD_DIR);

const { locatePob } = await import('../src/pob/locate.mjs');
const { Runtime } = await import('../src/runtime.mjs');

let install = null;
try { install = locatePob(); } catch { /* no PoB here */ }
const skip = install ? false : 'PoB (PoE2) not found; set POB_PATH';
let runtime;
const run = async (name, args) => (await runtime.run(name, args, { target: 'headless' })).result;

before(() => { if (install) runtime = new Runtime(); });
after(() => { runtime?.close(); fs.rmSync(home, { recursive: true, force: true }); });

test('a new build can be created, edited and calculated', { skip, timeout: 120000 }, async () => {
  const created = await run('build.new', { name: 'Engine Test', class: 'Ranger', level: 60 });
  assert.equal(created.class, 'Ranger');
  assert.equal(created.level, 60);
  const group = await run('skills.add', { gems: ['Spark'], level: 10 });
  assert.equal(group.gems[0].name, 'Spark');
  await run('skills.main', { group: group.group });
  const before = await run('calc.stats', { keys: ['TotalDPS', 'Life'] });
  assert.ok(before.stats.TotalDPS > 0, 'Spark deals damage');
  const allocated = await run('tree.allocate', { node: (await run('tree.search', { text: 'life', type: 'notable', limit: 1 })).nodes[0].name });
  assert.ok(allocated.pointsSpent > 0);
  const summary = await run('build.summary', {});
  assert.ok(summary.points.used >= allocated.pointsSpent);
});

test('configuration changes are validated and applied', { skip, timeout: 60000 }, async () => {
  const [option] = (await run('config.list', { search: 'enemyIsBoss', limit: 1 })).options;
  assert.equal(option.key, 'enemyIsBoss');
  const changed = await run('config.set', { key: 'enemyIsBoss', value: 'None' });
  assert.equal(changed.option.value, 'None');
  await assert.rejects(run('config.set', { key: 'enemyIsBoss', value: 'Nonsense' }), /must be one of/);
});

test('items: craft, equip, unequip', { skip, timeout: 60000 }, async () => {
  const item = await run('items.craft', { base: 'Lunar Amulet', mod: ['+50 to maximum Life'], equip: 'Amulet' });
  assert.deepEqual(item.equippedIn, ['Amulet']);
  const removed = await run('items.unequip', { slot: 'Amulet' });
  assert.equal(removed.slot, 'Amulet');
});

test('saves go to the build folder and reopen', { skip, timeout: 60000 }, async () => {
  const saved = await run('build.save', { name: 'Engine Test Save' });
  assert.ok(fs.existsSync(path.join(process.env.POBAI_BUILD_DIR, 'Engine Test Save.xml')), saved.file);
  const list = await run('build.list', { search: 'Engine Test' });
  assert.equal(list.builds[0].name, 'Engine Test Save');
  const reopened = await run('build.open', { build: 'Engine Test Save' });
  assert.equal(reopened.class, 'Ranger');
});

test('every registry command has an adapter operation', { skip, timeout: 30000 }, async () => {
  const { COMMANDS } = await import('../src/commands/registry.mjs');
  const { ops } = await run('engine.ops', {});
  const missing = COMMANDS.filter(c => !c.local).map(c => c.op ?? c.name).filter(op => !ops.includes(op));
  assert.deepEqual(missing, []);
});

test('live-only commands explain how to open PoB', { skip, timeout: 30000 }, async () => {
  await assert.rejects(runtime.run('ui.tab', { tab: 'items' }), /pob open/);
});
