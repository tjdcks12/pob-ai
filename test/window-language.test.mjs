// Exercise the dictionary and the actual window translator together in PoB's LuaJIT.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { writeDictionary } from '../src/live/window-language.mjs';
import { locatePob } from '../src/pob/locate.mjs';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-language-test-'));
const previousHome = process.env.POB_AI_HOME;
process.env.POB_AI_HOME = home;
after(() => {
  if (previousHome === undefined) delete process.env.POB_AI_HOME;
  else process.env.POB_AI_HOME = previousHome;
  fs.rmSync(home, { recursive: true, force: true });
});
let install;
try { install = locatePob(); } catch {}
const skip = !install && 'PoB (PoE2) not found; set POB_PATH';
const luaPath = value => value.split(path.sep).join('/');

async function localize(locale, strings, { before = '', after = '' } = {}) {
  const { default: koffi } = await import('koffi');
  const lib = koffi.load(path.join(install.dir, 'lua51.dll'));
  const create = lib.func('void *luaL_newstate()'), open = lib.func('void luaL_openlibs(void*)');
  const load = lib.func('int luaL_loadbuffer(void*, const uint8_t*, size_t, const char*)');
  const call = lib.func('int lua_pcall(void*, int, int, int)');
  const text = lib.func('void *lua_tolstring(void*, int, _Out_ size_t*)'), close = lib.func('void lua_close(void*)');
  const L = create(); open(L);
  try {
    const dictionary = writeDictionary(locale);
    const source = Buffer.from(`
      package.path = ${JSON.stringify(luaPath(install.dir) + '/lua/?.lua;')} .. package.path
      local json = require('dkjson')
      POBAI_FONT = { install = function() end, setLocale = function() end }
      ${before}
      local tr = dofile(${JSON.stringify(luaPath(fileURLToPath(new URL('../adapter/live/translate.lua', import.meta.url))))})
      tr.enable(${JSON.stringify(locale)}, ${JSON.stringify(dictionary.file)})
      local input = json.decode(${JSON.stringify(JSON.stringify(strings))})
      local output = {}
      for i, value in ipairs(input) do output[i] = tr.localize(value) or value end
      ${after}
      return json.encode(output)
    `);
    let status = load(L, source, source.length, '=window-language-test');
    if (!status) status = call(L, 0, 1, 0);
    const length = [0], pointer = text(L, -1, length);
    const value = Buffer.from(koffi.decode(pointer, 'uint8_t', Number(length[0]))).toString('utf8');
    assert.equal(status, 0, value);
    return JSON.parse(value);
  } finally { close(L); }
}

test('the item list displays the official unique name and base together', { skip }, async () => {
  assert.deepEqual(await localize('ko', ['Amor Mandragora, Changeling Talisman']), ['아모르 만드라고라, 체인질링 부적']);
});

test('item modifier roll ranges use official stat descriptions without changing numbers', { skip }, async () => {
  const result = await localize('ko', ['Adds (16-20) to (23-27) Physical Damage', '+(8-15) to Intelligence']);
  assert.deepEqual(result, ['물리 피해 (16-20)~(23-27) 추가', '지능 +(8-15)']);
});

test('the unique-only options and unsupported calculation warning are both visible in Korean', { skip }, async () => {
  const values = await localize('ko', [
    'Enemies in your Presence are Hindered',
    '^xFF0000Gain 1 Druidic Prowess for every 20 total Rage spent^7 (Not supported in PoB yet)',
    '(10-15)% increased Skill Effect Duration',
  ]);
  assert.equal(values[0], '접근해 있는 적들이 이동 방해를 받음');
  assert.equal(values[1], '^xFF0000소모한 총 격노 20당 드루이드의 기량 1 획득 ^7(PoB 계산 미지원)^xFF0000');
  assert.equal(values[2], '스킬 효과 지속시간 (10-15)% 증가');
});

test('rolled values retain their original colours, signs and precision after reordering', { skip }, async () => {
  const values = await localize('ko', [
    '^x8888FFAdds ^x00FF00(16-20)^x8888FF to ^xFF000023.00(23-27)^x8888FF Physical Damage',
    '+12 Intelligence', '-0.43 Attack Rate (-24.2%)', '+3.00% Crit Chance',
    '  +12.50 to Intelligence  ', 'A made-up modifier with (16-20) Physical Damage',
  ]);
  assert.match(values[0], /\^x00FF00\(16-20\)/);
  assert.match(values[0], /\^xFF000023\.00\(23-27\)/);
  assert.equal(values[0].replace(/\^x[\da-f]{6}/gi, ''), '물리 피해 (16-20)~23.00(23-27) 추가');
  assert.deepEqual(values.slice(1), ['+12 지능', '-0.43 공격 빈도 (-24.2%)', '+3.00% 치명타 확률', '  지능 +12.50  ', 'A made-up modifier with (16-20) Physical Damage']);
});

test('official stat slot order is respected in every supported game language', { skip }, async () => {
  const load = locale => JSON.parse(gunzipSync(fs.readFileSync(new URL(`../data/window-game-text/${locale}.json.gz`, import.meta.url))));
  const en = load('en');
  const descriptions = ['local_minimum_added_physical_damage', 'additional_intelligence'];
  const format = (text, values) => text.replace(/\{(\d+)(?::([^}]*))?\}/g, (_, id, spec = '') => (spec.startsWith('+') ? '+' : '') + values[id]);
  for (const locale of ['ko', 'ja', 'zh-Hant', 'ru', 'de', 'fr', 'es', 'pt-BR', 'th']) {
    const pack = load(locale);
    const source = [], expected = [];
    for (const stat of descriptions) {
      const d = en.statTemplates.find(d => d.stats[0] === stat);
      source.push(format(d.variants[0].text, ['(16-20)', '(23-27)']));
      expected.push(format(pack.statTemplates.find(t => t.id === d.id).variants[0].text, ['(16-20)', '(23-27)']));
    }
    assert.deepEqual(await localize(locale, source), expected, locale);
  }
});

test('flavour text translates before the real PoB tooltip splits and wraps its lines', { skip }, async () => {
  const prose = 'A sensitive few among the first settlers of Ezomyr\nfollowed the wisps by canoe. On a misty forested\nisland, Cirel of Tarth stood waiting to greet them.';
  const result = await localize('ko', [prose], {
    before: `
      common = { classes = {} }
      newClass = function(name) local class = {} common.classes[name] = class return class end
      wipeTable = function(t) for k in pairs(t) do t[k] = nil end end
      main = { showFlavourText = true, WrapString = function(self, text) return { text } end }
      dofile(${JSON.stringify(luaPath(path.join(install?.dir ?? '', 'Classes/Tooltip.lua')))})
    `,
    after: `
      local tooltip = setmetatable({lines = {}, blocks = { {height = 0} }, maxWidth = 300}, { __index = common.classes.Tooltip })
      tooltip:AddLine(16, input[1])
      output = {} for _, line in ipairs(tooltip.lines) do output[#output + 1] = line.text end
      assert(#tooltip.lines == 3)
      tr.disable()
      tooltip:Clear() tooltip:AddLine(16, input[1])
      assert(tooltip.lines[1].text == 'A sensitive few among the first settlers of Ezomyr')
    `,
  });
  assert.deepEqual(result, ['에조미어 최초의 정착자들 중 예민한 몇몇은', '카누를 타고 도깨비불들을 따라갔다. 연무가 자욱하고 숲이 우거진', '섬에, 타르스의 키렐이 서서 그들을 맞이했다.']);
});

test('item filters, rare templates and league restrictions share the display translation', { skip }, async () => {
  assert.deepEqual(await localize('ko', ['Any slot', 'Anywhere', 'Obtainable', '+2 Critical Quiver, Visceral Quiver', 'Exclusive to: Fate of the Vaal', 'Weapon Range: 1.2 metres', 'Equipping this item in Weapon 1 will give you:']),
    ['모든 슬롯', '전체 검색', '획득 가능', '+2 치명타 화살통, 본능적인 화살통', '획득 리그: 바알의 운명', '무기 범위: 1.2 m', '무기 1에 장착하면 다음과 같이 변경됩니다:']);
});

test('item flavour already split into separate PoB AddLine calls keeps the official paragraph', { skip }, async () => {
  const source = ['A sensitive few among the first settlers of Ezomyr', 'followed the wisps by canoe. On a misty forested', 'island, Cirel of Tarth stood waiting to greet them.'];
  const result = await localize('ko', source);
  assert.equal(result.join('\n'), '에조미어 최초의 정착자들 중 예민한 몇몇은\n카누를 타고 도깨비불들을 따라갔다. 연무가 자욱하고 숲이 우거진\n섬에, 타르스의 키렐이 서서 그들을 맞이했다.');
});
