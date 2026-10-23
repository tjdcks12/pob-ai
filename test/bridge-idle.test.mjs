import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { locatePob } from '../src/pob/locate.mjs';
import { LOCAL } from '../src/commands/local.mjs';
import { readConfig, updateConfig } from '../src/state.mjs';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-idle-'));
process.env.POB_AI_HOME = home;
after(() => fs.rmSync(home, { recursive: true, force: true }));
let install;
try { install = locatePob(); } catch {}

test('the idle bridge keeps a suspended coroutine visible to SimpleGraphic', { skip: !install && 'Set POB_PATH' }, async () => {
  const { default: koffi } = await import('koffi');
  const lib = koffi.load(path.join(install.dir, 'lua51.dll'));
  const create = lib.func('void *luaL_newstate()'), open = lib.func('void luaL_openlibs(void*)');
  const load = lib.func('int luaL_loadbuffer(void*, const uint8_t*, size_t, const char*)');
  const call = lib.func('int lua_pcall(void*, int, int, int)');
  const text = lib.func('void *lua_tolstring(void*, int, _Out_ size_t*)'), close = lib.func('void lua_close(void*)');
  const state = create();
  open(state);
  try {
    const adapter = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../adapter').replaceAll('\\', '/');
    // The host asks PoB's own Common.lua tracker whether any work is suspended.
    const common = fs.readFileSync(path.join(install.dir, 'Modules/Common.lua'), 'utf8');
    const tracker = common.slice(common.indexOf('-- Optimize coroutines'), common.indexOf('-- Class library'));
    assert.match(tracker, /function coroutine\._list/);
    const source = Buffer.from([
      'package.path = ' + JSON.stringify(install.dir.replaceAll('\\', '/') + '/lua/?.lua;') + ' .. package.path',
      'POBAI_ADAPTER = ' + JSON.stringify(adapter),
      tracker,
      'local realDofile = dofile',
      'local frames = 0',
      'POBAI_MAIN = { OnFrame = function() frames = frames + 1 end }',
      "pobai_log, pobai_read_file = function() end, function() return '' end",
      'GetTime = function() return 0 end',
      "package.loaded.socket = { tcp = function() error('no configured port') end }",
      'dofile = function(file)',
      "  if file:match('/core/dispatch.lua$') then return end",
      "  if file:match('/live/skin.lua$') then return { reset = function() end } end",
      "  if file:match('/live/overlay.lua$') then return { draw = function() end } end",
      "  if file:match('/live/theme.lua$') then return { apply = function() end } end",
      "  if file:match('/live/translate.lua$') then return {} end",
      '  return realDofile(file)',
      'end',
      "os.getenv = function() return '' end",
      "realDofile(POBAI_ADAPTER .. '/live/bridge.lua')",
      'POBAI_MAIN:OnFrame()',
      "collectgarbage('collect')",
      'local active = 0',
      'for co in pairs(coroutine._list()) do',
      "  if type(co) == 'thread' and coroutine.status(co) == 'suspended' then active = active + 1 end",
      'end',
      "return require('dkjson').encode({ active = active, frames = frames })",
    ].join('\n'));
    let status = load(state, source, source.length, '=idle-test');
    if (!status) status = call(state, 0, 1, 0);
    const length = [0], pointer = text(state, -1, length);
    const value = Buffer.from(koffi.decode(pointer, 'uint8_t', Number(length[0]))).toString('utf8');
    assert.equal(status, 0, value);
    const result = JSON.parse(value);
    assert.ok(result.active > 0, 'an inactive SimpleGraphic window must still poll the bridge after all requests finish');
    assert.equal(result.frames, 1, 'PoB keeps control of its normal frame');
  } finally { close(state); }
});

test('a template that fails to apply does not replace the saved choice', async () => {
  updateConfig({ pobTheme: 'dark' });
  await assert.rejects(LOCAL.theme({ theme: 'light' }, {
    liveConnected: true, run: async () => { throw new Error('not answering'); },
  }), /not answering/);
  assert.equal(readConfig().pobTheme, 'dark');
  await LOCAL.theme({ theme: 'light' }, { liveConnected: false });
  assert.equal(readConfig().pobTheme, 'light', 'a closed PoB can still remember the next template');
});
