// Real PoB headless: loadouts, undo, minion library, tree links, item editing, trade queries,
// party, options and calcs settings. Skipped without a PoB install (set POB_PATH).
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
const { tradeSearchUrl } = await import('../src/commands/local.mjs');

let install = null;
try { install = locatePob(); } catch { /* no PoB here */ }
const skip = install ? false : 'PoB (PoE2) not found; set POB_PATH';
let runtime;
const run = async (name, args = {}) => (await runtime.run(name, args, { target: 'headless' })).result;

before(async () => {
  if (!install) return;
  runtime = new Runtime();
  await run('build.new', { name: 'More Test', class: 'Ranger', level: 70 });
  await run('skills.add', { gems: ['Spark'], level: 15 });
});
after(() => { runtime?.close(); fs.rmSync(home, { recursive: true, force: true }); });

test('undo and redo per area', { skip, timeout: 60000 }, async () => {
  const before = (await run('tree.summary')).points.used;
  await run('tree.allocate', { node: 'Essence of the Storm' });
  assert.ok((await run('tree.summary')).points.used > before);
  await run('build.undo', { area: 'tree' });
  assert.equal((await run('tree.summary')).points.used, before);
  await run('build.redo', { area: 'tree' });
  assert.ok((await run('tree.summary')).points.used > before);
});

test('tree link round trip', { skip, timeout: 60000 }, async () => {
  const { url } = await run('tree.url_export');
  assert.match(url, /^https?:\/\//);
  const used = (await run('tree.summary')).points.used;
  await run('tree.reset', { keepAscendancy: false });
  assert.equal((await run('tree.summary')).points.used, 0);
  await run('tree.url_import', { url });
  assert.equal((await run('tree.summary')).points.used, used);
});

test('loadouts', { skip, timeout: 60000 }, async () => {
  const created = await run('build.loadout_new', { name: 'Boss' });
  assert.ok(created.loadouts.includes('Boss'));
  const renamed = await run('build.loadout_rename', { loadout: 'Boss', name: 'Pinnacle' });
  assert.ok(renamed.loadouts.includes('Pinnacle'));
});

test('minion library', { skip, timeout: 60000 }, async () => {
  const { available } = await run('build.minions', { search: 'a', limit: 1 });
  assert.equal(available.length, 1);
  const added = await run('build.minion_add', { minion: available[0].id });
  assert.ok(added.minions.some(m => m.id === available[0].id));
  const removed = await run('build.minion_remove', { minion: available[0].id });
  assert.ok(!removed.minions.some(m => m.id === available[0].id));
});

test('item editing: mods, anoint, corrupt, edit', { skip, timeout: 60000 }, async () => {
  const amulet = await run('items.craft', { base: 'Lunar Amulet', mod: ['+40 to maximum Life'], equip: 'Amulet' });
  let item = await run('items.mod_add', { item: 'Amulet', line: '+20% to Fire Resistance' });
  assert.ok(item.explicits.includes('+20% to Fire Resistance'));
  item = await run('items.mod_remove', { item: 'Amulet', line: 'maximum Life' });
  assert.ok(!item.explicits.some(l => l.includes('maximum Life')));
  item = await run('items.anoint', { item: 'Amulet', notable: 'Essence of the Storm' });
  assert.ok(item.enchants.some(l => l.includes('Allocates Essence of the Storm')));
  item = await run('items.corrupt', { item: 'Amulet' });
  assert.equal(item.corrupted, true);
  assert.equal(item.id, amulet.id);
  assert.deepEqual(item.equippedIn, ['Amulet']);
  item = await run('items.edit_english', { item: 'Amulet', text: 'Rarity: RARE\nEdited Charm\nLunar Amulet\nImplicits: 0\n+10 to Strength' });
  assert.equal(item.name, 'Edited Charm');
  assert.deepEqual(item.equippedIn, ['Amulet']);
});

test('trade search query and URL', { skip, timeout: 60000 }, async () => {
  const q = await run('items.trade_query', { item: 'Amulet' });
  assert.ok(q.modifiers.length >= 1);
  const url = tradeSearchUrl(q.query, { league: 'Standard' });
  assert.match(url, /^https:\/\/www\.pathofexile\.com\/trade2\/search\/poe2\/Standard\?q=/);
});

test('runes', { skip, timeout: 60000 }, async () => {
  const { runes } = await run('items.runes', { search: 'Rune', limit: 1 });
  if (!runes.length) return;
  const text = 'Rarity: NORMAL\nAdvanced Shortbow\nSockets: S\nRune: None\nImplicits: 0';
  const bow = await run('items.add_english', { text });
  const socketed = await run('items.set_rune', { item: String(bow.id), socket: 1, rune: runes[0] });
  assert.ok(socketed.text.includes(`Rune: ${runes[0]}`));
});

test('party, options and calcs settings', { skip, timeout: 60000 }, async () => {
  const party = await run('party.set', { field: 'auras', text: 'Nothing to parse' });
  assert.equal(party.party.auras, 'Nothing to parse');
  await run('party.clear');
  const { options } = await run('options.list');
  assert.ok(options.some(o => o.key === 'defaultCharLevel'));
  const calcs = await run('calc.calcs_options', { mode: 'BUFFED' });
  assert.equal(calcs.mode, 'BUFFED');
});
