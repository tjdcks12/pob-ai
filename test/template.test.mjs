import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { locatePob } from '../src/pob/locate.mjs';
import { THEMES } from '../ui/themes.js';

let install;
try { install = locatePob(); } catch {}
const skip = !install && 'PoB (PoE2) not found; set POB_PATH';
const luaPath = url => fileURLToPath(url).split(path.sep).join('/');
const results = new Map();
async function run(fixture = 'sheet', failDraw = false) {
  const key = `${fixture}:${failDraw}`;
  if (results.has(key)) return results.get(key);
  const { default: koffi } = await import('koffi');
  const lib = koffi.load(path.join(install.dir, 'lua51.dll'));
  const create = lib.func('void *luaL_newstate()'), open = lib.func('void luaL_openlibs(void*)');
  const load = lib.func('int luaL_loadbuffer(void*, const uint8_t*, size_t, const char*)');
  const call = lib.func('int lua_pcall(void*, int, int, int)');
  const text = lib.func('void *lua_tolstring(void*, int, _Out_ size_t*)'), close = lib.func('void lua_close(void*)');
  const state = create();
  open(state);
  try {
    const source = Buffer.from([
      'POB = ' + JSON.stringify(install.dir.split(path.sep).join('/')),
      'ADAPTER = ' + JSON.stringify(luaPath(new URL('../adapter', import.meta.url))),
      'FAIL_DRAW = ' + String(failDraw),
      'package.path = POB .. "/lua/?.lua;" .. package.path',
      'local result = dofile(' + JSON.stringify(luaPath(new URL(`./fixtures/template/${fixture}.lua`, import.meta.url))) + ')',
      'return require("dkjson").encode(result)',
    ].join('\n'));
    let status = load(state, source, source.length, '=template-test');
    if (!status) status = call(state, 0, 1, 0);
    const length = [0], pointer = text(state, -1, length);
    const value = Buffer.from(koffi.decode(pointer, 'uint8_t', Number(length[0]))).toString('utf8');
    assert.equal(status, 0, value);
    const result = JSON.parse(value);
    results.set(key, result);
    return result;
  } finally { close(state); }
}

test('every palette reaches PoB paint, controls and caption while light palettes preserve tree art', { skip }, async () => {
  const r = await run('themes');
  assert.deepEqual(r.names, THEMES);
  assert.deepEqual(r.aliases, ['dark', 'light', 'pob']);
  for (const id of THEMES) {
    assert.equal(r[id].current, id);
    assert.equal(r[id].caption, id);
    assert.equal(r[id].lightTree, ['light', 'sand'].includes(id));
    if (id === 'pob') assert.deepEqual(r[id].bg, [0, 0, 0]);
    else assert.deepEqual(r[id].skin, r[id].bg, id);
  }
});

test('action buttons remain visibly bounded at rest, with distinct hover, press, disabled and focus states', { skip }, async () => {
  const result = await run('buttons');
  for (const mode of THEMES.filter(id => id !== 'pob')) {
    const states = result[mode];
    const shapes = state => states[state].filter(call => call.kind === 'rect');
    const normal = shapes('normal');
    assert.notDeepEqual(normal[0].colour.slice(0, 3), states.surface, mode + ': button boundary must differ from the containing panel');
    assert.ok(normal.some(call => call.colour.slice(0, 3).join() !== normal[0].colour.slice(0, 3).join()), mode + ': button needs both a border and an inset fill');
    assert.notDeepEqual(shapes('hover'), normal, mode + ': hover feedback');
    assert.notDeepEqual(shapes('pressed'), shapes('hover'), mode + ': pressed feedback');
    assert.notDeepEqual(shapes('disabled'), normal, mode + ': disabled feedback');
    assert.deepEqual(shapes('focused')[0].colour.slice(0, 3), states.primary, mode + ': keyboard focus border');
    const label = states.normal.find(call => call.kind === 'text');
    const nativeLabel = result.original.find(call => call.kind === 'text');
    assert.deepEqual([label.x, label.y, label.size, label.text], [nativeLabel.x, nativeLabel.y, nativeLabel.size, nativeLabel.text], 'native layout and action label stay intact');
  }
  assert.equal(result.clicks, 1, 'only an enabled click released inside the button activates it');
  assert.deepEqual(result.restored, result.original, 'the original PoB theme retains its exact drawing');
  assert.equal(result.drawFunctionsRestored, true);
});

test('the original template restores native geometry and drawing exactly', { skip }, async () => {
  const r = await run();
  assert.deepEqual(r.restored, r.original);
  assert.deepEqual(r.restoredDraw, r.originalDraw);
  assert.deepEqual(r.overlay, r.original, 'floating panes keep their native input geometry');
});

test('floating calculation sheets are themed when PoB supports them and remain unavailable otherwise', { skip }, async () => {
  const r = await run('popups');
  assert.equal(r.overlaySupportedAfter, r.overlaySupported, 'the skin does not invent an unsupported PoB API');
  assert.equal(Array.isArray(r.native.overlay), r.overlaySupported);
  for (const mode of THEMES.filter(id => id !== 'pob')) {
    const calls = r[mode].overlay;
    if (!r.overlaySupported) {
      assert.equal(calls, false, 'stable PoB still exercises hover and pinned breakdowns without a floating sheet');
      continue;
    }
    assert.ok(calls.some(c => c.kind === 'rect' && c.colour.every((v, i) => v === [...r[mode].surface, 1][i])), 'opaque themed background');
    assert.ok(!calls.some(c => c.kind === 'rect' && c.colour.slice(0, 3).join() === '1,0.5,0'), 'no native orange table frame');
    assert.deepEqual(calls.filter(c => c.kind === 'text').map(c => c.text), r.native.overlay.filter(c => c.kind === 'text').map(c => c.text));
  }
  assert.deepEqual(r.restored, r.native, 'original template restores both popup renderers exactly');
});

test('calculation hover and pinned breakdowns use neutral and blue borders with unchanged content', { skip }, async () => {
  const r = await run('popups');
  assert.equal(r.nativeFieldsUnchanged, true, 'the skin uses the actual PoB constructor without adding beta-only fields');
  for (const mode of THEMES.filter(id => id !== 'pob')) {
    for (const name of ['hover', 'pinned']) {
      const calls = r[mode][name];
      const border = name === 'pinned' ? r[mode].primary : r[mode].line;
      assert.ok(calls.some(c => c.kind === 'rect' && c.colour.every((v, i) => v === [...border, 1][i])), name + ' border');
      assert.ok(!calls.some(c => c.kind === 'rect' && c.colour[3] < 1), 'no translucent black popup');
      assert.deepEqual(calls.filter(c => c.kind === 'text').map(c => c.text), r.native[name].filter(c => c.kind === 'text').map(c => c.text));
    }
  }
  assert.equal(r.drawFunctionsRestored, true, 'nested popup drawing restores global drawing functions');
});

test('modern rows grow together with their hover targets and embedded controls', { skip }, async () => {
  const { modern: m, original: o, collapsed } = await run();
  assert.equal(m.rowHeight, 22);
  assert.equal(m.secondY - m.firstY, m.rowHeight);
  assert.equal(m.controlY + 8, m.controlCellY + 11, 'embedded controls are centred inside their row');
  assert.equal(m.hidden, false);
  assert.equal(m.hitSecond, true);
  assert.equal(m.hoverSecond, true);
  assert.ok(m.height > o.height);
  assert.equal(m.height - collapsed.height, 28, 'collapsed section removes its row and bottom padding');
});

test('a failed calculation popup restores the drawing host before PoB paints its error dialog', { skip }, async () => {
  const r = await run('popups', true);
  assert.equal(r.drawFailed, true);
  assert.match(r.drawError, /simulated native draw failure/);
  assert.equal(r.restoredAfterFailure, true);
  assert.equal(r.errorPopupOk, true);
});

test('all custom palettes retain every formatted value and remove saturated table frames', { skip }, async () => {
  const r = await run();
  for (const calls of Object.values(r.themeDraws)) {
    const strings = calls.filter(c => c[0] === 'text').map(c => c[1].replace(/\^x[0-9a-f]{6}|\^\d/gi, ''));
    for (const value of ['1,234', '0.98', '20%']) assert.ok(strings.includes(value), value);
    assert.ok(!strings.includes('wrong'), 'hidden rows remain hidden');
    for (const c of calls.filter(c => c[0] === 'rect')) {
      assert.ok(Array.isArray(c[5]) && c[5].every(Number.isFinite));
      assert.notDeepEqual(c[5].slice(0, 3), [1, 0.5, 0], 'native orange frame removed');
    }
  }
  assert.notDeepEqual(r.darkDraw, r.lightDraw, 'both palettes reach the native sheet renderer');
});
