import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { locatePob } from '../src/pob/locate.mjs';

let install;
try { install = locatePob(); } catch {}
const skip = !install && 'PoB (PoE2) not found; set POB_PATH';
const luaPath = url => fileURLToPath(url).split(path.sep).join('/');
const adapter = luaPath(new URL('../adapter/live/panel.lua', import.meta.url));
const fixture = luaPath(new URL('./fixtures/panel/mock.lua', import.meta.url));
let lua;

async function run(windows, denied = false) {
  if (!lua) {
    const { default: koffi } = await import('koffi');
    const lib = koffi.load(path.join(install.dir, 'lua51.dll'));
    lua = { koffi,
      create: lib.func('void *luaL_newstate()'), open: lib.func('void luaL_openlibs(void*)'),
      load: lib.func('int luaL_loadbuffer(void*, const uint8_t*, size_t, const char*)'),
      call: lib.func('int lua_pcall(void*, int, int, int)'),
      text: lib.func('void *lua_tolstring(void*, int, _Out_ size_t*)'), close: lib.func('void lua_close(void*)'),
    };
  }
  const source = [
    'package.path = ' + JSON.stringify(install.dir.split(path.sep).join('/') + '/lua/?.lua;') + ' .. package.path',
    'local json = require("dkjson")',
    'TEST_WINDOWS = json.decode(' + JSON.stringify(JSON.stringify(windows)) + ')',
    'TEST_DENIED = ' + (denied ? 'true' : 'false'),
    'return json.encode(dofile(' + JSON.stringify(fixture) + ')(' + JSON.stringify(adapter) + '))',
  ].join('\n');
  const state = lua.create();
  lua.open(state);
  try {
    const bytes = Buffer.from(source);
    let status = lua.load(state, bytes, bytes.length, '=native-panel-test');
    if (!status) status = lua.call(state, 0, 1, 0);
    const length = [0];
    const pointer = lua.text(state, -1, length);
    const text = Buffer.from(lua.koffi.decode(pointer, 'uint8_t', Number(length[0]))).toString('utf8');
    assert.equal(status, 0, text);
    return JSON.parse(text);
  } finally { lua.close(state); }
}

const edge = { class: 'Chrome_WidgetWin_1', title: 'PoB AI', exe: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' };
const native = { class: 'WindowsForms10.Window.8.app', title: 'PoB AI', exe: 'C:/PoB AI/desktop/bin/pob-ai-panel.exe', minimized: true };

test('AI restores the custom WebView2 host and ignores another browser with the same title', { skip }, async () => {
  const { result, calls } = await run([{ ...edge, exe: 'C:/Chrome/chrome.exe' }, native]);
  assert.deepEqual(result, { found: true, focused: true });
  assert.deepEqual(calls.show, [[2, 9]]);
  assert.deepEqual(calls.focus, [2]);
  assert.deepEqual(calls.closed, [1, 2]);
});

test('AI activation ignores the separate settings window', { skip }, async () => {
  const { result, calls } = await run([{ ...native, title: 'PoB AI Settings' }, native]);
  assert.equal(result.found, true);
  assert.deepEqual(calls.focus, [2]);
});

test('AI raises the existing Edge app without changing its window size', { skip }, async () => {
  const { result, calls } = await run([edge]);
  assert.deepEqual(result, { found: true, focused: true });
  assert.deepEqual(calls.focus, [1]);
  assert.equal(calls.show.length, 0);
  assert.deepEqual(calls.closed, [1], 'process inspection does not leak handles');
});

test('AI restores a minimized panel before focusing it', { skip }, async () => {
  const { result, calls } = await run([{ ...edge, minimized: true }]);
  assert.equal(result.focused, true);
  assert.deepEqual(calls.show, [[1, 9]]);
  assert.deepEqual(calls.focus, [1]);
});

test('another browser with the same title is not the desktop panel', { skip }, async () => {
  const { result, calls } = await run([{ ...edge, exe: 'C:/Chrome/chrome.exe' }]);
  assert.deepEqual(result, { found: false, focused: false });
  assert.equal(calls.focus.length, 0);
});

test('an existing panel remains found when Windows declines activation', { skip }, async () => {
  const { result } = await run([edge], true);
  assert.deepEqual(result, { found: true, focused: false });
});
