// Ctrl+V of a non-English copy in the Items tab: adapter/live/paste.lua in PoB's LuaJIT.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { convertItemText } from '../src/items/convert.mjs';
import { gameLocaleRegistry } from '../src/items/localization.mjs';
import { prepareItemText } from '../src/items/prepare.mjs';
import { locatePob } from '../src/pob/locate.mjs';
import { localeFixture } from './fixtures/items/locale-fixture.mjs';

let install;
try { install = locatePob(); } catch {}
const skip = !install && 'PoB (PoE2) not found; set POB_PATH';
const luaPath = value => value.split(path.sep).join('/');

async function runLua(body) {
  const { default: koffi } = await import('koffi');
  const lib = koffi.load(path.join(install.dir, 'lua51.dll'));
  const create = lib.func('void *luaL_newstate()'), open = lib.func('void luaL_openlibs(void*)');
  const load = lib.func('int luaL_loadbuffer(void*, const uint8_t*, size_t, const char*)');
  const call = lib.func('int lua_pcall(void*, int, int, int)');
  const text = lib.func('void *lua_tolstring(void*, int, _Out_ size_t*)'), close = lib.func('void lua_close(void*)');
  const L = create(); open(L);
  try {
    const source = Buffer.from(`
      package.path = ${JSON.stringify(luaPath(install.dir) + '/lua/?.lua;')} .. package.path
      local json = require('dkjson')
      -- PoB reads only English: an item has a base when the copy starts with "Item Class:".
      function new(_, raw) return { raw = raw, base = raw:find('^Item Class:') and true or nil } end
      local shift = false
      function IsKeyDown(key) return key == 'SHIFT' and shift end
      POBAI_FRAMES = 1
      local emitted, added = {}, {}
      function pobai_emit(event) emitted[#emitted + 1] = event return true end
      local ItemsTab = {}
      function ItemsTab:CreateDisplayItemFromRaw(raw) local item = new('Item', raw) if item.base then self.displayItem = item end end
      function ItemsTab:AddDisplayItem() added[#added + 1] = self.displayItem.raw end
      common = { classes = { ItemsTab = ItemsTab } }
      local paste = dofile(${JSON.stringify(luaPath(fileURLToPath(new URL('../adapter/live/paste.lua', import.meta.url))))})
      paste.install()
      local tab = setmetatable({}, { __index = ItemsTab })
      ${body}
    `);
    let status = load(L, source, source.length, '=item-paste-test');
    if (!status) status = call(L, 0, 1, 0);
    const length = [0], pointer = text(L, -1, length);
    const value = Buffer.from(koffi.decode(pointer, 'uint8_t', Number(length[0]))).toString('utf8');
    assert.equal(status, 0, value);
    return JSON.parse(value);
  } finally { close(L); }
}

test('an unreadable paste is sent to the service and the converted item replaces it', { skip }, async () => {
  const result = await runLua(`
    tab:CreateDisplayItemFromRaw('Gegenstandsklasse: Ringe', true)
    local first = #emitted
    paste.onConverted({ id = emitted[1].id, text = 'Item Class: Rings' })
    tab:CreateDisplayItemFromRaw('Item Class: Amulets', true)
    return json.encode({ first = first, event = emitted[1], shown = tab.displayItem.raw, total = #emitted })
  `);
  assert.deepEqual(result, { first: 1, event: { kind: 'item-paste', id: 1, text: 'Gegenstandsklasse: Ringe' }, shown: 'Item Class: Amulets', total: 1 });
});

test('Ctrl+Shift+V adds the converted item, not the item shown before the paste', { skip }, async () => {
  const result = await runLua(`
    tab:CreateDisplayItemFromRaw('Item Class: Belts', true)
    shift = true
    tab:CreateDisplayItemFromRaw('아이템 종류: 반지', true)
    if tab.displayItem and IsKeyDown('SHIFT') then tab:AddDisplayItem() end
    POBAI_FRAMES = 2
    paste.onConverted({ id = emitted[1].id, text = 'Item Class: Rings' })
    return json.encode(added)
  `);
  assert.deepEqual(result, ['Item Class: Rings']);
});

test('an answer without text leaves the shown item alone', { skip }, async () => {
  const result = await runLua(`
    tab:CreateDisplayItemFromRaw('Item Class: Belts', true)
    tab:CreateDisplayItemFromRaw('hello', true)
    paste.onConverted({ id = emitted[1].id })
    return json.encode({ shown = tab.displayItem.raw })
  `);
  assert.deepEqual(result, { shown: 'Item Class: Belts' });
});

test('every locale: the text the service sends back is an item PoB reads', { skip, timeout: 120000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-paste-test-'));
  const previous = { POB_AI_HOME: process.env.POB_AI_HOME, POB_PATH: process.env.POB_PATH };
  Object.assign(process.env, { POB_AI_HOME: home, POB_PATH: install.dir });
  const { Runtime } = await import('../src/runtime.mjs');
  const runtime = new Runtime();
  try {
    const run = async (name, args = {}) => (await runtime.run(name, args, { target: 'headless' })).result;
    await run('build.new', { name: 'Paste Test', class: 'Ranger', level: 70 });
    assert.deepEqual(await prepareItemText('hello'), { text: 'hello', conversion: null });
    for (const locale of gameLocaleRegistry().locales.filter(l => l !== 'en')) {
      // A base PoB has; the first glove base in the packs (Golden Bracers) is not in PoB.
      const { raw, base } = localeFixture(locale, 'Metadata/Items/Armours/Gloves/FourGlovesStr1');
      // Korean without the trade lists takes the same offline route as the other locales.
      const { text, conversion } = locale === 'ko' ? { text: convertItemText(raw).text, conversion: { language: 'ko' } } : await prepareItemText(raw);
      assert.equal(conversion?.language, locale);
      const added = await run('items.add_english', { text });
      const item = await run('items.show', { item: String(added.id) });
      assert.equal(item.base, base, locale);
      assert.ok(JSON.stringify(item).includes('+92 to maximum Life'), `${locale}: ${JSON.stringify(item)}`);
    }
  } finally {
    runtime.close();
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
