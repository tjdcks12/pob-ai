// The PoB window font (adapter/live/atlas.lua) run in PoB's own LuaJIT with stand-ins for the
// SimpleGraphic host functions and PoB's real bitmap font metrics. Skipped when no PoB (PoE2)
// install is found (set POB_PATH). The live window comparison is done by hand (see atlas.lua).
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ADAPTER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../adapter').split(path.sep).join('/');
const { locatePob } = await import('../src/pob/locate.mjs');
let install = null;
try { install = locatePob(); } catch { /* no PoB here */ }
const skip = install ? false : 'PoB (PoE2) not found; set POB_PATH';

let lua = null;
async function luaState() {
  if (lua) return lua;
  const { default: koffi } = await import('koffi');
  const lib = koffi.load(path.join(install.dir, 'lua51.dll'));
  const fn = {
    newstate: lib.func('void *luaL_newstate()'),
    openlibs: lib.func('void luaL_openlibs(void *L)'),
    loadbuffer: lib.func('int luaL_loadbuffer(void *L, const uint8_t *buff, size_t sz, const char *name)'),
    pcall: lib.func('int lua_pcall(void *L, int nargs, int nresults, int errfunc)'),
    tolstring: lib.func('void *lua_tolstring(void *L, int idx, _Out_ size_t *len)'),
    settop: lib.func('void lua_settop(void *L, int idx)'),
    close: lib.func('void lua_close(void *L)'),
  };
  lua = { koffi, fn };
  return lua;
}

// Host stand-ins: PoB's fonts are 'measured' by the Lua copy of SimpleGraphic's layout itself,
// which the live check showed to match DrawStringWidth/DrawStringCursorIndex at 100-250 %.
const PRELUDE = `
package.path = POB .. '/lua/?.lua;' .. package.path
json = require('dkjson')
calls = {}
local function log(...) calls[#calls + 1] = { ... } end
SCALE, NOW = 1, 0
GetScreenScale = function() return SCALE end
GetTime = function() return NOW end
GetVirtualScreenSize = function() return 1000, 800 end
DrawImage = function(h, x, y, w, hh, u0, v0, u1, v1) log('img', h and h.path or false, x, y, w, hh) end
NewImageHandle = function() return { Load = function(self, p) self.path = p end } end
emitted = {}
pobai_emit = function(e) emitted[#emitted + 1] = e end
POBAI_FRAMES = 1
POBAI_ROOT = POB
local F
local function rawWidth(h, name, text)
  local ph = F.physicalHeight(h, SCALE)
  local best = 0
  for line in (text .. '\\n'):gmatch('([^\\n]*)\\n') do best = math.max(best, F.lineWidth(F.cellsFor(name, ph), F.setFor(name, ph), line, 1, #line)) end
  return best / SCALE
end
POBAI_RAW = {
  DrawString = function(l, t, a, h, f, s) log('raw', l, t, a, h, f, s) end,
  DrawStringWidth = function(h, f, s) return rawWidth(h, f, s) end,
  SetDrawColor = function(c, ...) log('color', c, ...) end,
}
DrawString = POBAI_RAW.DrawString
DrawStringWidth = POBAI_RAW.DrawStringWidth
DrawStringCursorIndex = function(h, f, s, x, y) return -1 end
F = dofile(ADAPTER .. '/live/atlas.lua')
F.install()
-- Answers every glyph request: advance = 0.5 em for ASCII, 1 em otherwise.
function answer()
  for _, e in ipairs(emitted) do
    local glyphs = {}
    for k, c in ipairs(e.clusters) do glyphs[k] = { 0, 0, 10, 10, -2, -2, (#c == 1 and 0.5 or 1) * e.px } end
    F.onAtlas({ id = e.id, path = 'page' .. e.id, w = 100, h = 100, glyphs = glyphs })
  end
  emitted = {}
end
function frame() POBAI_FRAMES = POBAI_FRAMES + 1 end
`;

async function runLua(body) {
  const { koffi, fn } = await luaState();
  const L = fn.newstate();
  fn.openlibs(L);
  try {
    const source = `POB = ${JSON.stringify(install.dir.split(path.sep).join('/'))}; ADAPTER = ${JSON.stringify(ADAPTER)}\n${PRELUDE}\nlocal result = (function() ${body} end)()\nreturn json.encode(result)`;
    const code = Buffer.from(source, 'utf8');
    let status = fn.loadbuffer(L, code, code.length, '=test');
    if (status === 0) status = fn.pcall(L, 0, 1, 0);
    const len = [0];
    const pointer = fn.tolstring(L, -1, len);
    const text = pointer ? Buffer.from(koffi.decode(pointer, 'uint8_t', Number(len[0]))).toString('utf8') : '';
    if (status !== 0) throw new Error(text);
    return JSON.parse(text);
  } finally { fn.close(L); }
}

test('ASCII keeps PoB\'s own text functions under the PoB font', { skip }, async () => {
  const r = await runLua(`
    F.apply('pob')
    DrawString(10, 20, 'LEFT', 16, 'VAR', '^7Life: 123')
    return { calls = calls, emitted = #emitted, width = DrawStringWidth(16, 'VAR', 'Life'), cursor = DrawStringCursorIndex(16, 'VAR', 'Life', 3, 0) }`);
  assert.deepEqual(r.calls, [['raw', 10, 20, 'LEFT', 16, 'VAR', '^7Life: 123']]);
  assert.equal(r.emitted, 0, 'nothing is asked for');
  assert.equal(r.cursor, -1, 'PoB answers the caret for ASCII');
});

test('characters PoB lacks are asked for once per frame and drawn when they arrive', { skip }, async () => {
  const r = await runLua(`
    F.apply('pob')
    DrawString(0, 0, 'LEFT', 16, 'VAR', 'ab생명')
    DrawString(0, 20, 'LEFT', 16, 'VAR', '생명력')
    local before = #emitted
    frame()
    DrawString(0, 0, 'LEFT', 16, 'VAR', 'ab생명')
    local asked = emitted[1]
    answer()
    calls = {}
    frame()
    DrawString(0, 0, 'LEFT', 16, 'VAR', 'ab생명')
    return { before = before, asked = asked, calls = calls, emitted = #emitted }`);
  assert.equal(r.before, 0, 'requests wait for the next frame');
  assert.equal(r.asked.kind, 'glyphs');
  assert.equal(r.asked.px, 16);
  assert.equal(r.asked.face, 'regular');
  assert.deepEqual(r.asked.clusters.slice(-3), ['생', '명', '력']);
  assert.equal(r.asked.clusters.length, 95 + 3, 'printable ASCII comes with the first page');
  // 'ab' by PoB at x=0, then two 16 px glyphs from the atlas page.
  assert.deepEqual(r.calls[0], ['raw', 0, 0, 'LEFT', 16, 'VAR', 'ab']);
  assert.equal(r.calls.filter(c => c[0] === 'img').length, 2);
  assert.equal(r.emitted, 0);
});

test('the Pretendard font keeps PoB\'s widths, alignment, tabs, lines and colours', { skip }, async () => {
  const r = await runLua(`
    F.apply('pretendard')
    DrawString(0, 0, 'LEFT', 16, 'VAR', 'x생')
    frame() DrawString(0, 0, 'LEFT', 16, 'VAR', 'x') answer() frame()
    local function draw(...) calls = {} DrawString(...) return calls end
    local W = function(t) return DrawStringWidth(16, 'VAR', t) end
    local left = draw(100, 50, 'LEFT', 16, 'VAR', 'Life')
    local cx = draw(100, 50, 'CENTER_X', 16, 'VAR', 'Life')
    local rx = draw(100, 50, 'RIGHT_X', 16, 'VAR', 'Life')
    local center = draw(0, 50, 'CENTER', 16, 'VAR', 'Life')
    local right = draw(10, 50, 'RIGHT', 16, 'VAR', 'Life')
    local tab = draw(0, 0, 'LEFT', 16, 'VAR', 'a\\tb')
    local lines = draw(0, 0, 'LEFT', 16, 'VAR', 'a\\nb')
    local colours = draw(0, 0, 'LEFT', 16, 'VAR', '^1a^xFF8000b^xZZ')
    return { W = { life = W('Life'), a = W('a'), atab = W('a\\t'), wide = W('Life생'), lines = W('ab\\nLife') },
      left = left, cx = cx, rx = rx, center = center, right = right, tab = tab, lines = lines, colours = colours }`);
  const xs = calls => calls.filter(c => c[0] === 'img').map(c => c[2]);
  const life = r.W.life;
  // The run fills PoB's box: glyphs are spread so the last one ends where PoB's text ends.
  const left = xs(r.left);
  assert.equal(left.length, 4);
  // (a glyph cell starts 2 px left of its pen position in these stand-in pages)
  assert.ok(left[0] + 2 >= 100 - 3 && left[3] + 2 + 8 <= 100 + life + 3, `${left} inside ${life}`);
  assert.deepEqual(xs(r.cx), left.map(x => x - 100 + Math.floor(100 - life / 2)));
  assert.deepEqual(xs(r.rx), left.map(x => x - life));
  assert.deepEqual(xs(r.center), left.map(x => x - 100 + Math.floor((1000 - life) / 2)));
  assert.deepEqual(xs(r.right), left.map(x => x - 100 + Math.floor(1000 - life - 10)));
  // b after the tab sits where PoB puts it.
  const tab = xs(r.tab);
  assert.ok(Math.abs(tab[1] + 2 - r.W.atab) <= 3, `${tab} vs ${r.W.atab}`);
  // Second line one line height down.
  assert.deepEqual(r.lines.filter(c => c[0] === 'img').map(c => c[3]), [-2, 14]);
  // Escapes set the colour like SimpleGraphic; a broken one is drawn as text.
  assert.deepEqual(r.colours.filter(c => c[0] === 'color').map(c => c[1]), ['^1', '^xFF8000']);
  assert.equal(r.colours.filter(c => c[0] === 'img').length, 6, 'a, b and "^xZZ"');
  assert.equal(r.W.wide, life + 16, 'a wide glyph adds its own advance');
  assert.equal(r.W.lines, life, 'the widest line');
});

test('caret positions round-trip through text PoB cannot draw', { skip }, async () => {
  const r = await runLua(`
    F.apply('pretendard')
    DrawString(0, 0, 'LEFT', 16, 'VAR', 'Life 생명력 ok')
    frame() DrawString(0, 0, 'LEFT', 16, 'VAR', 'Life 생명력 ok') answer() frame()
    local out = {}
    for _, scale in ipairs({ 1, 1.5 }) do
      SCALE = scale
      for _, text in ipairs({ 'Life 생명력 ok', '한\\n국어 x', 'Tab\\t탭 a' }) do
        local i = 1
        while i <= #text + 1 do
          local b = text:byte(i)
          if not b or b < 0x80 or b >= 0xC0 then
            local pre = text:sub(1, i - 1)
            local line = pre:match('[^\\n]*$')
            local y = select(2, pre:gsub('\\n', '')) * 16 + 8
            local x = DrawStringWidth(16, 'VAR', line)
            out[#out + 1] = { i, DrawStringCursorIndex(16, 'VAR', text, x + 1, y), text }
          end
          i = i + 1
        end
      end
    end
    -- A click on a colour escape lands after it, like PoB.
    out[#out + 1] = { 3, DrawStringCursorIndex(16, 'VAR', '^1빨강', 1, 0), 'escape' }
    return out`);
  for (const [index, back, text] of r) assert.equal(back, index, `${JSON.stringify(text)} at ${index}`);
});

test('a request without an answer is asked again later', { skip }, async () => {
  const r = await runLua(`
    F.apply('pob')
    DrawString(0, 0, 'LEFT', 16, 'VAR', '가')
    frame() DrawString(0, 0, 'LEFT', 16, 'VAR', '가')
    local first = #emitted
    emitted = {}
    NOW = 5000
    frame() DrawString(0, 0, 'LEFT', 16, 'VAR', '가')
    local early = #emitted
    NOW = 20000
    frame() DrawString(0, 0, 'LEFT', 16, 'VAR', '가')
    return { first = first, early = early, again = #emitted, clusters = emitted[1] and emitted[1].clusters }`);
  assert.equal(r.first, 1);
  assert.equal(r.early, 0, 'not while the answer may still come');
  assert.equal(r.again, 1);
  assert.equal(r.clusters.length, 95 + 1, 'the whole page again');
  assert.equal(r.clusters.at(-1), '가');
});

test('Thai marks stay with their consonant', { skip }, async () => {
  const r = await runLua(`
    F.apply('pob')
    DrawString(0, 0, 'LEFT', 16, 'VAR', 'ที่สุดน้ำกำ')
    frame() DrawString(0, 0, 'LEFT', 16, 'VAR', 'ก')
    local list = emitted[1].clusters
    local u = table.unpack or unpack
    return { u(list, #list - 4) }`);
  assert.deepEqual(r, ['ที่', 'สุ', 'ด', 'น้ำ', 'กำ']);
});

test('the window language draws translations once their glyphs are ready', { skip }, async () => {
  const r = await runLua(`
    POBAI_FONT = F
    local tr = dofile(ADAPTER .. '/live/translate.lua')
    local file = os.tmpname()
    local f = io.open(file, 'wb') f:write(json.encode({ entries = { Life = '생명력' } })) f:close()
    tr.enable('ko', file)
    os.remove(file)
    F.apply('pob')
    calls = {}
    DrawString(0, 0, 'LEFT', 16, 'VAR', '^7Life:')
    local first = calls
    calls = {}
    frame() DrawString(0, 0, 'LEFT', 16, 'VAR', '가') answer() frame()
    calls = {}
    DrawString(0, 0, 'LEFT', 16, 'VAR', '^7Life:')
    local second = calls
    local width = DrawStringWidth(16, 'VAR', 'Life:')
    tr.disable()
    calls = {}
    DrawString(0, 0, 'LEFT', 16, 'VAR', '^7Life:')
    return { first = first, second = second, width = width, english = POBAI_RAW.DrawStringWidth(16, 'VAR', 'Life:'), after = calls }`);
  assert.deepEqual(r.first, [['raw', 0, 0, 'LEFT', 16, 'VAR', '^7Life:']], 'English until the glyphs arrive');
  assert.equal(r.second.filter(c => c[0] === 'img').length, 3, 'three Hangul glyphs');
  assert.ok(r.second.some(c => c[0] === 'raw' && c[6] === ':'), 'the colon by PoB');
  // A translation wider than the English is squeezed towards the English width, to at most 70%.
  assert.ok(r.width >= r.english - 0.01 && r.width <= r.english / 0.7 + 0.01, `width ${r.width} vs English ${r.english}`);
  assert.deepEqual(r.after, [['raw', 0, 0, 'LEFT', 16, 'VAR', '^7Life:']]);
});
