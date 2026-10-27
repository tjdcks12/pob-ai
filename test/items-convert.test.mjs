// Ported from poe2way-overlay src/features/pob/convert.test.ts, plus the ten-locale PoB check from
// src/features/item/localization.test.ts. Trade data comes from saved fixtures; no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import {
  BASE_NAMES,
  chooseBase,
  convertItemText,
  gemNamesFromTrade,
  itemTextLanguage,
  pobBasicText,
  readBaseEvidence,
  toAscii,
  uniqueNamesFromTrade,
} from '../src/items/convert.mjs';
import { gameLocaleRegistry } from '../src/items/localization.mjs';
import { buildStatIndex } from '../src/items/trade-data.mjs';
import { localeFixture } from './fixtures/items/locale-fixture.mjs';

const FIXTURES = new URL('./fixtures/items/', import.meta.url);
const readJson = name => JSON.parse(fs.readFileSync(new URL(name, FIXTURES), 'utf8'));
const fixture = readJson('convert.fixture.json');
const S = readJson('samples-ko.json');
const engineTotals = readJson('pob-engine-mod-totals.json').totals;
const catalystRing = fs.readFileSync(new URL('catalyst-ring-ko.txt', FIXTURES), 'utf8');
const catalystStats = readJson('catalyst-ring-stats.json');

const uniques = uniqueNamesFromTrade(fixture.itemsKo, fixture.itemsEn);
const trade = {
  ko: buildStatIndex(fixture.statsKo),
  en: buildStatIndex(fixture.statsEn).textById,
  uniques,
};
const convert = raw => convertItemText(raw, { trade });
const lines = text => text.split('\r\n');
const item = (...rest) => ['아이템 종류: 장화', '아이템 희귀도: 희귀', '시험 이름', '철제 각반', '--------', ...rest].join('\n');
/** Subset match, like vitest's toMatchObject */
function assertMatch(actual, expected, path = 'value') {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    for (const [key, value] of Object.entries(expected)) assertMatch(actual?.[key], value, `${path}.${key}`);
  } else assert.deepEqual(actual, expected, path);
}

describe('Korean copy -> PoB English text', () => {
  it('real gloves copy: the documented shape (only affix names are dropped)', () => {
    const r = convert(S.GLOVES);
    assertMatch(r, { language: 'ko', status: 'ok', rarity: 'Rare', baseName: 'Runeforged Barbed Bracers', dropped: [] });
    assert.deepEqual(r.mods, { total: 8, converted: 8 });
    assert.deepEqual(lines(r.text), [
      'Item Class: Gloves',
      'Rarity: Rare',
      'Rare Item',
      'Runeforged Barbed Bracers',
      '--------',
      'Quality: +20% (augmented)',
      'Evasion Rating: 364 (augmented)',
      'Ward: 42 (augmented)',
      '--------',
      'Sockets: S J',
      '--------',
      'Item Level: 86',
      '--------',
      'Destroys all Augment Sockets on the item to create a Jewel Socket (rune)',
      '--------',
      '{ Prefix Modifier (Tier: 2) - Life, Evasion }',
      '36(33-38)% increased Evasion Rating',
      '+33(33-41) to maximum Life',
      '{ Prefix Modifier (Tier: 3) - Damage, Elemental, Cold, Attack }',
      'Adds 14(14-15) to 24(22-24) Cold damage to Attacks',
      '{ Desecrated Prefix Modifier (Tier: 3) - Evasion }',
      '69(68-79)% increased Evasion Rating',
      '{ Suffix Modifier (Tier: 1) - Elemental, Fire, Resistance }',
      '+41(41-45)% to Fire Resistance',
      '{ Suffix Modifier (Tier: 2) - Elemental, Lightning, Resistance }',
      '+39(36-40)% to Lightning Resistance',
      '{ Suffix Modifier (Tier: 1) - Elemental, Cold, Resistance }',
      '+44(41-45)% to Cold Resistance',
    ]);
    // Rune line -> rune stat, evasion increase -> the armour-local stat, desecrated line -> desecrated stat
    const stats = r.lines.filter(l => l.kind === 'mod').map(l => l.stat);
    assert.equal(stats[0], 'rune.stat_1933674044');
    assert.equal(stats[1], 'explicit.stat_124859000');
    assert.equal(stats[4], 'desecrated.stat_124859000');
  });

  it('unique: name from the item lists, Requires Level kept, name range (Amethyst-Topaz) removed', () => {
    const r = convert(S.MAGES_BLOOD);
    const out = lines(r.text);
    assert.equal(r.status, 'ok');
    assert.deepEqual(out.slice(0, 4), ['Item Class: Belts', 'Rarity: Unique', 'Mageblood', 'Utility Belt']);
    assert.ok(out.includes('Requires Level 80'));
    assert.ok(out.includes('20% of Flask Recovery applied Instantly (implicit)'));
    assert.ok(out.includes('Has 2(1-3) Charm Slot (implicit)'));
    assert.ok(out.includes('Legacy of Bismuth - Unscalable Value'));
    assert.ok(out.includes("All Mage's Legacies have 43(25-50)% increased effect per duplicate Mage's Legacy you have"));
    assert.doesNotMatch(r.text, /\(Amethyst-Topaz\)|[가-힣]/);
    assert.deepEqual(r.mods, { total: 7, converted: 7 });
  });

  it('old reconstructed sample (BELT): unknown base is blocked, flavour text is not counted as a modifier', () => {
    const r = convert(S.BELT);
    // "중량 허리띠" / "부적 슬롯 +1" in this reconstruction are not real game strings
    assert.equal(r.status, 'blocked');
    assert.equal(r.blockedReason, 'No English base name: 중량 허리띠');
    assert.equal(r.blockedCode, 'noBase');
    assert.equal(r.lines.find(l => l.from.startsWith('피가 흐르는'))?.kind, 'other');
    assert.ok(r.dropped.includes('부적 슬롯 +1 (implicit)'));
    assert.ok(r.text.includes('+30 to Dexterity - Unscalable Value'));
  });

  it("normal weapon: drops 'Exceptional', the weapon type and requirement lines, matches baked-in numbers", () => {
    const r = convert(S.TAWHOAN_GREATCLUB);
    assert.equal(r.status, 'ok');
    assert.deepEqual(lines(r.text).slice(0, 7), [
      'Item Class: Two Hand Maces',
      'Rarity: Normal',
      'Tawhoan Greatclub',
      '--------',
      'Physical Damage: 113-153',
      'Critical Hit Chance: 5.00%',
      'Attacks per Second: 1.10',
    ]);
    assert.ok(!r.text.includes('Requires'));
    assert.ok(r.text.includes('Warcries Empower an additional Attack (implicit)'));
  });

  it('cannot-use item: the line is dropped and the next section becomes the head', () => {
    const r = convert(S.CANNOT_USE_GAUNTLETS);
    assert.equal(r.status, 'ok');
    assert.deepEqual(lines(r.text).slice(0, 5), ['Item Class: Gloves', 'Rarity: Rare', 'Rare Item', 'Plate Gauntlets', '--------']);
    assert.doesNotMatch(r.text, /cannot use|Requires/);
    assert.ok(r.notes[0].includes('Unusable item'));
  });

  it('magic flask: only the base is kept from the name, description lines are dropped', () => {
    const r = convert(S.LIFE_FLASK);
    assertMatch(r, { status: 'ok', baseName: 'Ultimate Life Flask' });
    assert.doesNotMatch(r.text, /Recovers|Charges|Requires/);
    assert.ok(r.text.includes('50(46-50)% increased Recovery rate'));
    assert.deepEqual(r.mods, { total: 1, converted: 1 });
  });

  it('granted skill line uses the skill stats; the header carries no name', () => {
    const r = convert(S.BONE_WAND);
    assert.equal(r.status, 'ok');
    assert.ok(r.text.includes('Grants Skill: Level 11 Bone Blast'));
    assert.ok(r.text.includes('{ Prefix Modifier (Tier: 5) - Mana }'));
  });

  it('non-equipment (waystone, gem, uncut gem) is blocked', () => {
    for (const raw of [S.WAYSTONE_T15, S.FIREBALL_GEM, S.UNCUT_SKILL_GEM_17]) {
      const r = convert(raw);
      assert.equal(r.status, 'blocked');
      assert.ok(r.blockedReason);
    }
    assert.ok(convert(S.FIREBALL_GEM).blockedReason.includes('Not equipment (Gem)'));
    assert.equal(convert(S.FIREBALL_GEM).blockedCode, 'notGear');
  });

  it('test gear samples are all ok, ASCII only, and normal/magic/rare have no Requires line', () => {
    for (const name of ['RING', 'RING_RES', 'BODY', 'BOOTS', 'HELMET', 'AMULET', 'GREATCLUB']) {
      const r = convert(S[name]);
      assert.deepEqual([name, r.status, r.dropped], [name, 'ok', []]);
      assert.match(r.text, /^[\x20-\x7e\r\n]*$/);
      assert.ok(!r.text.includes('Requires'), name);
    }
  });

  it('reduced line of an increased-only stat, more line of a less-only stat, negative values', () => {
    const r = convert(item('이동 속도 10% 감소', '생명력 최대치 5% 증폭', '화염 저항 -10%'));
    assert.deepEqual(lines(r.text).slice(-3), ['10% reduced Movement Speed', '5% more maximum Life', '-10% to Fire Resistance']);
    assert.equal(r.status, 'ok');
  });

  it('unconvertible lines are dropped (partial), and so is a header left without lines', () => {
    const r = convert(item('{ 접두어 속성 부여 "가짜" (등급: 1) — 생명력 }', '이런 속성은 없다 +5', '{ 접미어 속성 부여 "- 곰" (등급: 4) — 능력치 }', '힘 +18(17-20)'));
    assert.equal(r.status, 'partial');
    assert.deepEqual(r.dropped, ['이런 속성은 없다 +5']);
    assert.ok(!r.text.includes('Prefix Modifier'));
    assert.ok(r.text.includes('{ Suffix Modifier (Tier: 4) - Attribute }\r\n+18(17-20) to Strength'));
    assert.ok(r.lines.find(l => l.from.includes('가짜'))?.note.includes('Header dropped'));
  });

  it('a line whose value count differs from the # count is dropped', () => {
    const ko = buildStatIndex({ result: [{ id: 'explicit', label: '', entries: [{ id: 'explicit.test', text: '시험 속성 #', type: 'explicit' }] }] });
    const r = convertItemText(item('시험 속성 5'), { trade: { ko, en: new Map([['explicit.test', 'Test # to #']]) } });
    assert.deepEqual(r.dropped, ['시험 속성 5']);
  });

  it('a header with an unknown tag loses all its tags', () => {
    const r = convert(item('{ 접미어 속성 부여 "- 곰" (등급: 4) — 능력치, 낯선태그 }', '힘 +18(17-20)'));
    assert.ok(r.text.includes('{ Suffix Modifier (Tier: 4) }\r\n+18(17-20) to Strength'));
  });

  it('real fractured ring with catalyst effect: the increase is split from the tags, minion quality kept', () => {
    // The production stat index is much larger; isolate the seven translations
    // in this captured item so missing fixture stats cannot mask header loss.
    const entries = catalystStats.map(([text], i) => ({ id: `explicit.fixture${i}`, text, type: 'explicit' }));
    const r = convertItemText(catalystRing, {
      trade: {
        ko: buildStatIndex({ result: [{ id: 'explicit', label: '', entries }] }),
        en: new Map(catalystStats.map(([, text], i) => [`explicit.fixture${i}`, text])),
      },
    });
    assert.equal(r.status, 'ok');
    assert.deepEqual(r.dropped, []);
    const headers = r.lines.filter(l => l.kind === 'header').map(l => l.to);
    assert.ok(headers.includes('{ Suffix Modifier - Damage, Minion, Critical }'));
    assert.ok(headers.includes('{ Suffix Modifier - Minion, Critical }'));
    assert.ok(headers.includes('{ Suffix Modifier - Attack, Caster, Speed, Minion }'));
    assert.ok(r.text.includes('Quality (Minion Modifiers): +60% (augmented)'));
  });

  for (const tag of ['생명력', '화염', '능력치']) {
    it(`the catalyst increase does not erase another tag (${tag})`, () => {
      const r = convert(item(`{ 접두어 속성 부여 (등급: 2) — ${tag} — 20% 증가 }`, '생명력 최대치 +33(33-41)'));
      const translated = new Map([['생명력', 'Life'], ['화염', 'Fire'], ['능력치', 'Attribute']]).get(tag);
      assert.ok(r.text.includes(`{ Prefix Modifier (Tier: 2) - ${translated} }`));
    });
  }

  it("non-ASCII names are replaced like PoB's sanitiseText; lines still non-ASCII are dropped", () => {
    assert.equal(toAscii("Mjölner — Oisín's Oath – Mórrigan"), "Mjolner - Oisin's Oath - Morrigan");
    const raw = ['아이템 종류: 반지', '아이템 희귀도: 고유', '시험 고유', '철제 반지'].join('\n');
    const named = convertItemText(raw, { trade: { ...trade, uniques: new Map([['시험 고유', 'Mjölner']]) } });
    assert.equal(lines(named.text)[2], 'Mjolner');
    const kanji = convertItemText(raw, { trade: { ...trade, uniques: new Map([['시험 고유', '漢字']]) } });
    assert.equal(lines(kanji.text)[2], 'Iron Ring');
  });

  it('one Korean base name with several English bases: chosen by evidence, blocked without', () => {
    assert.deepEqual(BASE_NAMES['팽팽한 석궁'], ['Taut Crossbow', 'Tense Crossbow']);
    // Level 1, 8 str / 8 dex is Tense Crossbow (Taut needs level 45)
    const crossbow = convert(['아이템 종류: 쇠뇌', '아이템 희귀도: 일반', '팽팽한 석궁', '--------', '쇠뇌', '물리 피해: 8-15', '--------', '요구 사항: 레벨 1, 8 힘, 8 민첩', '--------', '아이템 레벨: 5'].join('\n'));
    assertMatch(crossbow, { status: 'ok', baseName: 'Tense Crossbow', baseAlternatives: ['Taut Crossbow'], baseChoice: { decided: true, by: 'requirements' } });
    assert.equal(lines(crossbow.text)[2], 'Tense Crossbow');
    // Evasion 79, level 33, 42 dex -> Spined Bracers (Spiked needs level 59)
    const bracers = convert(['아이템 종류: 장갑', '아이템 희귀도: 희귀', '시험', '가시 팔보호구', '--------', '회피: 79', '--------', '요구 사항: 레벨 33, 42 민첩'].join('\n'));
    assertMatch(bracers, { status: 'ok', baseName: 'Spined Bracers' });
    // Without evidence the first candidate is not used
    const unknown = convert(['아이템 종류: 장갑', '아이템 희귀도: 희귀', '시험', '가시 팔보호구'].join('\n'));
    assertMatch(unknown, { status: 'blocked', blockedCode: 'noBase', text: '', baseChoice: { decided: false } });
    assert.ok(unknown.notes[0].includes('undecided'));
  });

  it('base choice rules: candidates above the values are out, a single exact attribute match decides', () => {
    const pair = ['Spiked Bracers', 'Spined Bracers'];
    // Evasion 100: Spiked (base 135) is impossible
    assert.deepEqual(chooseBase(pair, readBaseEvidence(['회피: 100 (augmented)'])), { pick: 'Spined Bracers', decided: true, by: 'properties' });
    // High level: both fit by level, but 73 dex equals Spiked
    assertMatch(chooseBase(pair, readBaseEvidence(['요구 사항: 레벨 70, 73 민첩', '회피: 300'])), { pick: 'Spiked Bracers', decided: true });
    // A modifier lowered the requirement (matches neither): undecided
    assertMatch(chooseBase(pair, readBaseEvidence(['요구 사항: 레벨 70, 62 민첩', '회피: 300'])), { decided: false });
    assert.deepEqual(readBaseEvidence(['물리 피해: 1,020-1,100', '요구 사항: 레벨 80, 94 힘, 67 지능']), { physical: [1020, 1100], level: 80, attributes: { str: 94, dex: 0, int: 67 } });
  });

  it('same Korean text, different English stats: leech/bleed by weapon, max quality by sign, otherwise dropped', () => {
    const weapon = convert(['아이템 종류: 한손 철퇴', '아이템 희귀도: 희귀', '시험', '목재 곤봉', '--------', '물리 공격 피해의 5%를 생명력으로 흡수', '명중 시 10%의 확률로 출혈 유발'].join('\n'));
    assert.deepEqual(lines(weapon.text).slice(-2), ['Leeches 5% of Physical Damage as Life', '10% chance to cause Bleeding on Hit']);
    const gloves = convert(item('물리 공격 피해의 5%를 생명력으로 흡수', '물리 공격 피해의 4%를 마나로 흡수', '명중 시 10%의 확률로 출혈 유발'));
    assert.deepEqual(lines(gloves.text).slice(-3), ['Leech 5% of Physical Attack Damage as Life', 'Leech 4% of Physical Attack Damage as Mana', '10% chance to inflict Bleeding on Hit']);
    const quality = convert(item('최대 퀄리티 +20%', '최대 퀄리티 40%'));
    assert.deepEqual(lines(quality.text).slice(-2), ['+20% to Maximum Quality', 'Maximum Quality is 40%']);
    // "할당 파편" is both Splinters and Shrapnel: dropped with the reason, whatever the type
    const allocates = convert(item('할당 파편 (enchant)', '할당 파편', '힘 +18(17-20)'));
    assert.equal(allocates.status, 'partial');
    assert.deepEqual(allocates.dropped, ['할당 파편 (enchant)', '할당 파편']);
    assert.ok(allocates.lines.find(l => l.from === '할당 파편')?.note.includes('Splinters'));
  });

  it('with the small fixture data the samples convert as many lines as the PoB engine read', () => {
    for (const tag of ['GLOVES', 'MAGES_BLOOD', 'RING_RES', 'BONE_WAND', 'CANNOT_USE_GAUNTLETS', 'LIFE_FLASK', 'GREATCLUB']) {
      const r = convert(S[tag]);
      assert.deepEqual([tag, r.dropped, r.mods.converted], [tag, [], engineTotals[tag]]);
    }
  });

  it('English text is kept (normalised to CRLF); non-item text is blocked', () => {
    const en = 'Item Class: Rings\nRarity: Rare\nDoom Loop\nIron Ring';
    assert.equal(itemTextLanguage(en), 'en');
    assertMatch(convert(en), { language: 'en', status: 'ok', text: en.replace(/\n/g, '\r\n') });
    assertMatch(convert('그냥 글'), { language: 'unknown', status: 'blocked', blockedCode: 'notItem' });
  });
});

describe('Basic form for pasting into PoB (no headers, no roll ranges)', () => {
  it('real gloves: headers removed and ranges cleared, other lines and order as in the detailed form', () => {
    const r = convert(S.GLOVES);
    const basic = lines(pobBasicText(r));
    assert.deepEqual(basic, [
      'Item Class: Gloves',
      'Rarity: Rare',
      'Rare Item',
      'Runeforged Barbed Bracers',
      '--------',
      'Quality: +20% (augmented)',
      'Evasion Rating: 364 (augmented)',
      'Ward: 42 (augmented)',
      '--------',
      'Sockets: S J',
      '--------',
      'Item Level: 86',
      '--------',
      'Destroys all Augment Sockets on the item to create a Jewel Socket (rune)',
      '--------',
      '36% increased Evasion Rating',
      '+33 to maximum Life',
      'Adds 14 to 24 Cold damage to Attacks',
      '69% increased Evasion Rating',
      '+41% to Fire Resistance',
      '+39% to Lightning Resistance',
      '+44% to Cold Resistance',
    ]);
    // The detailed form (headless engine input) is unchanged
    assert.ok(r.text.includes('{ Prefix Modifier (Tier: 2) - Life, Evasion }'));
    assert.doesNotMatch(pobBasicText(r), /[{}]|\(\d+-\d+\)/);
  });

  it('unique: keeps the level requirement (uniques only) and tags, clears value ranges', () => {
    const basic = lines(pobBasicText(convert(S.MAGES_BLOOD)));
    assert.deepEqual(basic.slice(0, 4), ['Item Class: Belts', 'Rarity: Unique', 'Mageblood', 'Utility Belt']);
    assert.ok(basic.includes('Requires Level 80'));
    assert.ok(basic.includes('Has 2 Charm Slot (implicit)'));
    assert.ok(basic.includes("All Mage's Legacies have 43% increased effect per duplicate Mage's Legacy you have"));
    assert.ok(basic.includes('Legacy of Bismuth - Unscalable Value'));
  });

  it('normal/magic/rare have no requirement lines; negative and decimal ranges are cleared too', () => {
    for (const raw of [S.RING_RES, S.LIFE_FLASK, S.TAWHOAN_GREATCLUB, S.BONE_WAND]) assert.doesNotMatch(pobBasicText(convert(raw)), /Requires|[{}]/);
    const r = convert(item('화염 저항 -10(-12--8)%', '힘 +18(17-20)'));
    assert.deepEqual(lines(pobBasicText(r)).slice(-2), ['-10% to Fire Resistance', '+18 to Strength']);
  });

  it('dropped lines stay dropped and no header is left alone', () => {
    const r = convert(item('{ 접두어 속성 부여 "가짜" (등급: 1) — 생명력 }', '이런 속성은 없다 +5', '{ 접미어 속성 부여 "- 곰" (등급: 4) — 능력치 }', '힘 +18(17-20)'));
    assert.deepEqual(r.dropped, ['이런 속성은 없다 +5']);
    assert.deepEqual(lines(pobBasicText(r)).slice(-2), ['--------', '+18 to Strength']);
  });

  it('English client text also only loses headers and roll ranges', () => {
    const en = [
      'Item Class: Rings',
      'Rarity: Rare',
      'Doom Loop',
      'Iron Ring',
      '--------',
      'Item Level: 80',
      '--------',
      '{ Prefix Modifier "Hale" (Tier: 7) — Life }',
      '+33(30-39) to maximum Life',
      '{ Suffix Modifier "of the Kiln" (Tier: 3) — Elemental, Fire, Resistance }',
      '+30(26-30)% to Fire Resistance',
    ].join('\n');
    assert.deepEqual(lines(pobBasicText(convert(en))), ['Item Class: Rings', 'Rarity: Rare', 'Doom Loop', 'Iron Ring', '--------', 'Item Level: 80', '--------', '+33 to maximum Life', '+30% to Fire Resistance']);
  });
});

describe('Skill gem names en -> ko (trade item lists)', () => {
  it('joins gems by official metadata ID and leaves unknown names out', () => {
    const names = gemNamesFromTrade(fixture.itemsKo, fixture.itemsEn);
    assert.equal(names.get('Boneshatter'), '뼈 박살');
    assert.equal(names.get('Fireball'), '화염구');
    const uneven = { result: [{ id: 'gem', entries: [{ type: '하나' }] }] };
    assert.equal(gemNamesFromTrade(uneven, { result: [{ id: 'gem', entries: [{ type: 'One' }, { type: 'Two' }] }] }).size, 0);
  });
});

describe('Unique names ko -> en (trade item lists)', () => {
  it('joins unique names by the same official Words ID', () => {
    assert.equal(uniques.get('마법사의 피'), 'Mageblood');
    assert.equal(uniques.get('앤드바리우스'), 'Andvarius');
    assert.equal(uniques.size, 4);
  });

  it('rejects pairs on a different base and groups with a different count', () => {
    const ko = {
      result: [
        { id: 'a', entries: [{ name: '하나', type: '철제 반지' }, { name: '둘', type: '모르는 베이스' }] },
        { id: 'b', entries: [{ name: '셋', type: '철제 반지' }] },
      ],
    };
    const en = {
      result: [
        { id: 'a', entries: [{ name: 'One', type: 'Gold Ring' }, { name: 'Two', type: 'Whatever' }] },
        { id: 'b', entries: [{ name: 'Three', type: 'Iron Ring' }, { name: 'Four', type: 'Iron Ring' }] },
      ],
    };
    const map = uniqueNamesFromTrade(ko, en);
    assert.equal(map.get('하나'), undefined); // 철제 반지 is Iron Ring, paired with Gold Ring
    assert.equal(map.get('둘'), undefined); // unknown name ID: no guessing by position
    assert.equal(map.has('셋'), false); // the group's unique count differs
  });
});

// ───────────── locale packs (from localization.test.ts: official GGPK ten-language item fixtures) ─────────────

describe('Every locale in the packs converts through official IDs', () => {
  for (const locale of gameLocaleRegistry().locales) {
    it(`${locale}: detected, base resolved, life line rendered in English`, () => {
      const { raw, base } = localeFixture(locale);
      assert.equal(itemTextLanguage(raw), locale);
      // Without trade data Korean takes the same locale-pack route as the others
      const r = convertItemText(raw);
      assertMatch(r, { language: locale, status: 'ok', rarity: 'Rare', baseName: base });
      assert.ok(r.text.includes('+92 to maximum Life'), r.text);
      assert.ok(r.text.includes('Rarity: Rare'));
      assert.ok(!r.text.includes('Requires Level'));
      assert.match(r.text, /^[\x20-\x7e\r\n]*$/);
    });
  }

  it('Korean samples without trade data use the locale packs (no roll ranges)', () => {
    const r = convertItemText(S.GLOVES);
    assertMatch(r, { language: 'ko', rarity: 'Rare', baseName: 'Runeforged Barbed Bracers' });
    assert.ok(r.text.includes('36% increased Evasion Rating'), r.text);
    assert.match(r.text, /^[\x20-\x7e\r\n]*$/);
  });
});
