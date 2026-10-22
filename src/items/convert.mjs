/**
 * Game item copy text (Ctrl+Alt+C) -> the English item text Path of Building reads.
 *
 * Why: PoB's item parser (Classes/Item.lua) only reads English game copy text, and sanitiseText
 * (Modules/Common.lua) turns every non-ASCII character into "?". Localized PoB builds only
 * translate the UI; the Lua engine stays English. So a localized copy is rewritten before PoB sees it.
 *
 * Routes (convertItemText)
 *   - en: kept as copied, only normalised (trimmed lines, ASCII, CRLF). PoB reads it natively.
 *   - ko with trade data: each modifier line -> Kakao trade stat id (numbers as #) -> the global
 *     English text of the same id, refilled with the original values and roll ranges ("36(33-38)").
 *     Both trade sites share stat ids. Literal texts (numbers baked in) are matched as is. A
 *     "reduced" line whose stat only exists as "increased" is matched that way and the English is
 *     flipped (more/less likewise).
 *     Base names: GGPK name table (base-names.json). Unique names: Words IDs (name-identities.json)
 *     checked against both trade item lists. Headers and property names: ClientStrings tables below.
 *   - every other locale, and ko without trade data: GGPK locale packs (localized.mjs) rebuild the
 *     item from official IDs. Roll ranges, modifier tags and header names are not kept there.
 *
 * Line rules: English Ctrl+Alt+C shape, ASCII only (dashes -> "-", a/o/i/o for umlaut and accents,
 * lines still holding non-ASCII are dropped), CRLF. Normal/magic/rare drop requirement lines; uniques
 * keep only "Requires Level N", because PoB applies a parsed level requirement to other items with
 * the same name and every rare becomes "Rare Item" (rare names are unused by PoB and would turn into "?").
 * Runic Ward is written "Ward:". Unconvertible lines are dropped (`dropped`), and a header with no
 * surviving line below it goes too. Modifier names in headers are always left out (not used in calcs).
 * Status: ok / partial (some lines dropped) / blocked (cannot be sent to PoB).
 * One Korean base name with several English bases: the copy's requirements and property values are
 * compared with PoB's base data (base-hints.json); blocked when that does not decide it.
 * One Korean stat text with several English stats (STAT_SIBLINGS): weapon-local or global by item
 * class, maximum quality by sign, otherwise dropped.
 */
import fs from 'node:fs';
import { detectItemLanguage } from './localization.mjs';
import { localizedPobText } from './localized.mjs';
import { parseModLine } from './parse.mjs';

const DATA = new URL('../../data/items/', import.meta.url);
const readData = name => JSON.parse(fs.readFileSync(new URL(name, DATA), 'utf8'));
const baseNameFile = readData('base-names.json');
const nameIdentities = readData('name-identities.json');

/** Korean base name -> English base name(s), from the GGPK name table (equipment folders). */
export const BASE_NAMES = baseNameFile.names;
/** Korean item class -> English ("장갑" -> "Gloves") */
const CLASSES = baseNameFile.classes;

// ───────────────────────── game string tables (ClientStrings ko/en) ─────────────────────────

const SEPARATOR = '--------';
const RARITY = {
  일반: 'Normal',
  마법: 'Magic',
  희귀: 'Rare',
  고유: 'Unique',
  젬: 'Gem',
  화폐: 'Currency',
  '점술 카드': 'Divination Card',
  퀘스트: 'Quest',
};
/** ItemPopupCannotUseItem: on unusable items the third head line is this and the names follow in the next section. */
const CANNOT_USE_KO = '아이템 착용 불가. 아이템 효과 미적용';

const QUALITY_KINDS = {
  생명력: 'Life',
  마나: 'Mana',
  방어: 'Defence',
  물리: 'Physical',
  화염: 'Fire',
  냉기: 'Cold',
  번개: 'Lightning',
  카오스: 'Chaos',
  공격: 'Attack',
  시전: 'Caster',
  속도: 'Speed',
  능력치: 'Attribute',
  소환수: 'Minion',
};

/** "Name: value" property names */
const PROPERTY = {
  퀄리티: 'Quality',
  '물리 피해': 'Physical Damage',
  '원소 피해': 'Elemental Damage',
  '화염 피해': 'Fire Damage',
  '냉기 피해': 'Cold Damage',
  '번개 피해': 'Lightning Damage',
  '카오스 피해': 'Chaos Damage',
  '치명타 명중 확률': 'Critical Hit Chance',
  '초당 공격 횟수': 'Attacks per Second',
  방어도: 'Armour',
  회피: 'Evasion Rating',
  '에너지 보호막': 'Energy Shield',
  // The English game says "Runic Ward:" but PoB only knows "Ward:" (it recomputes the value anyway)
  '룬 수호': 'Ward',
  '막기 확률': 'Block chance',
  정신력: 'Spirit',
  '호신부 슬롯': 'Charm Slots',
  '중첩 개수': 'Stack Size',
};

const FLAGS = {
  타락: 'Corrupted',
  '두 번 타락': 'Twice Corrupted',
  복제: 'Mirrored',
  복제됨: 'Mirrored',
  축성: 'Sanctified',
  미확인: 'Unidentified',
  '분열된 아이템': 'Fractured Item',
  '훼손된 접두어': 'Desecrated Prefix',
  '훼손된 접미어': 'Desecrated Suffix',
  '속성 부여 불가': 'Unmodifiable',
};

const HEADER_KIND = {
  '접두어 속성 부여': 'Prefix Modifier',
  '접미어 속성 부여': 'Suffix Modifier',
  '고정 속성 부여': 'Implicit Modifier',
  '고유 속성 부여': 'Unique Modifier',
  '바알 고유 속성': 'Vaal Unique Modifier',
  향상: 'Enhancement',
  '타락 향상': 'Corruption Enhancement',
};
/** Header origin prefixes: ModDescriptionLineDesecrated/Fractured/Crafted "훼손된 {0}" … */
const HEADER_ORIGIN = [
  ['훼손된 ', 'Desecrated ', 'desecrated'],
  ['분열된 ', 'Fractured ', 'fractured'],
  ['제작된 ', 'Crafted ', 'crafted'],
];
const TAGS = {
  젬: 'Gem',
  시전: 'Caster',
  화염: 'Fire',
  냉기: 'Cold',
  번개: 'Lightning',
  카오스: 'Chaos',
  물리: 'Physical',
  생명력: 'Life',
  원소: 'Elemental',
  공격: 'Attack',
  소환수: 'Minion',
  오라: 'Aura',
  마나: 'Mana',
  속도: 'Speed',
  치명타: 'Critical',
  피해: 'Damage',
  저항: 'Resistance',
  능력치: 'Attribute',
  속성: 'Attribute',
  '상태 이상': 'Ailment',
  저주: 'Curse',
  방어: 'Defences',
  회피: 'Evasion',
  방어도: 'Armour',
  '에너지 보호막': 'Energy Shield',
  플라스크: 'Flask',
  호신부: 'Charm',
};

/** Line-end tags; they are copied onto the English line unchanged */
const LINE_TAG = /\s*\((implicit|rune|enchant|crafted|desecrated|fractured|mutated|augmented|unmet)\)\s*$/i;
const UNSCALABLE = /\s*[—–]\s*(?:변경이 불가능한 값|변경 불가능한 값)\s*$/;
/** A value and its roll range "36(33-38)" (the sign is handled separately) */
const VALUE = /([+-]?)(\d+(?:\.\d+)?)(\s*\(\s*-?\d+(?:\.\d+)?\s*-\s*-?\d+(?:\.\d+)?\s*\))?/g;
/** Flask description lines (recovery, charge use, current charges): PoB computes these itself */
const FLASK_INFO = [/^[\d.]+초에 걸쳐 (?:생명력|마나) [\d,]+ 회복$/, /^사용 시 충전 \d+ 중 \d+ 소모$/, /^현재 충전량: \d+$/];
/** On anything but jewellery, jewels, flasks, charms and quivers, defence/attack stats are local to the item */
const NON_LOCAL_CLASS = /반지|목걸이|허리띠|주얼|플라스크|호신부|화살통/;
/** Trade texts end local stats with "(특정)" in Korean and " (Local)" in English */
const LOCAL_TAGS = ['(특정)', '(Local)'];
/** Name-line prefixes that are not part of the base ("Exceptional Tawhoan Greatclub") */
const NAME_ONLY_PREFIXES = ['특출난 ', '상급 ', 'Exceptional ', 'Superior '];

/** When the trade list only has one form: [word in the line, word in the trade text, English trade word, English word to write] */
const SWAPS = [
  ['감소', '증가', /\bincreased\b/, 'reduced'],
  ['증가', '감소', /\breduced\b/, 'increased'],
  ['감폭', '증폭', /\bmore\b/, 'less'],
  ['증폭', '감폭', /\bless\b/, 'more'],
];

/**
 * Trade stats with the same Korean text but different English meanings (21 in the 2026-10-14
 * snapshot, listed by bare stat id). The index keeps the first id per text, and that differs per
 * stat type (explicit, enchant, desecrated …), so each group gets an explicit rule:
 *   weapon: [global, weapon-local]; weapons take the local one (PoB: LifeLeechLocal, LocalChanceToBleed)
 *   sign:   [signed, unsigned]; "+20% to Maximum Quality" vs "Maximum Quality is 40%"
 *   none:   nothing to decide by; the line is dropped with a note ("할당 파편" = Splinters or Shrapnel …)
 * New snapshots may add groups; they belong here.
 */
const STAT_SIBLINGS = [
  { ids: ['stat_2557965901', 'stat_55876295'], rule: 'weapon' }, // leech physical attack damage as life
  { ids: ['stat_707457662', 'stat_669069897'], rule: 'weapon' }, // leech physical attack damage as mana
  { ids: ['stat_2174054121', 'stat_1519615863'], rule: 'weapon' }, // chance to inflict / cause bleeding
  { ids: ['stat_2039822488', 'stat_275498888'], rule: 'sign' }, // maximum quality
  { ids: ['stat_2954116742|7449', 'stat_2954116742|55060'], rule: 'none' }, // Allocates Splinters / Shrapnel
  { ids: ['stat_2954116742|20414', 'stat_2954116742|7395'], rule: 'none' }, // Allocates Reprisal / Retaliation
  { ids: ['stat_2954116742|17762', 'stat_2954116742|3188'], rule: 'none' }, // Allocates Vengeance / Revenge
];
const SIBLING_OF = new Map(STAT_SIBLINGS.flatMap(g => g.ids.map(id => [id, g])));
/** Weapon classes (English item class): leech and bleed use the weapon-local stat */
const WEAPON_CLASS = /^(?:One Hand|Two Hand|Bows|Crossbows|Wands|Staves|Sceptres|Spears|Flails|Quarterstaves|Daggers|Claws|Talismans|Warstaves|Fishing Rods)/;

// ───────────────────────── names ─────────────────────────

const asList = v => (v === undefined ? [] : typeof v === 'string' ? [v] : v);
const tidy = s => s.replace(/\s+/g, ' ').trim();

function stripNameOnly(name) {
  let s = name;
  for (let p = NAME_ONLY_PREFIXES.find(x => s.startsWith(x)); p; p = NAME_ONLY_PREFIXES.find(x => s.startsWith(x))) s = s.slice(p.length);
  return s;
}

/** Korean base -> English candidates. Magic/normal names may wrap the base, so the longest contained base wins. */
function englishBase(name, bases, allowContained) {
  const exact = tidy(name);
  for (const candidate of [exact, stripNameOnly(exact)]) {
    const hit = asList(Object.hasOwn(bases, candidate) ? bases[candidate] : undefined);
    if (hit.length) return { en: hit, matched: candidate };
  }
  if (!allowContained) return { en: [] };
  let best;
  for (const ko of Object.keys(bases)) if (exact.includes(ko) && (!best || ko.length > best.length)) best = ko;
  return best ? { en: asList(bases[best]), matched: best } : { en: [] };
}

// ───────────────────────── choosing between base candidates ─────────────────────────

/** PoB base data (Data/Bases) for the English candidates of ambiguous Korean bases */
const BASE_HINTS = readData('base-hints.json').hints;

const num = s => (s === undefined ? undefined : Number(s.replace(/,/g, '')));

/** Requirement and property values from the copy: "요구 사항: 레벨 33, 42 민첩", "물리 피해: 8-15", "회피: 79 (augmented)" … */
export function readBaseEvidence(lines) {
  const ev = {};
  for (const raw of lines) {
    const l = raw.replace(LINE_TAG, '').trim();
    const req = l.match(/^요구 사항:\s*(.+)$/);
    if (req) {
      ev.level = num(req[1].match(/레벨\s*(\d+)/)?.[1]);
      const attr = word => num(req[1].match(new RegExp(`(\\d+)\\s*${word}`))?.[1]) ?? 0;
      ev.attributes = { str: attr('힘'), dex: attr('민첩'), int: attr('지능') };
      continue;
    }
    const prop = l.match(/^(물리 피해|방어도|회피|에너지 보호막|룬 수호):\s*([\d,]+)(?:\s*-\s*([\d,]+))?/);
    if (!prop) continue;
    const [a, b] = [num(prop[2]), num(prop[3])];
    if (prop[1] === '물리 피해' && b !== undefined) ev.physical = [a, b];
    else if (prop[1] === '방어도') ev.armour = a;
    else if (prop[1] === '회피') ev.evasion = a;
    else if (prop[1] === '에너지 보호막') ev.energyShield = a;
    else if (prop[1] === '룬 수호') ev.ward = a;
  }
  return ev;
}

/**
 * The English base that fits the copy. Modifiers only raise the required level and the defence or
 * damage values (5% slack), so candidates above them are impossible. One left: decided. Several:
 * decided only when exactly one has the same attribute requirements (those stay at the base values
 * unless a modifier lowers them). Otherwise the first candidate, undecided.
 */
export function chooseBase(candidates, ev) {
  const first = { pick: candidates[0], decided: false };
  const known = candidates.filter(c => BASE_HINTS[c]);
  if (known.length < 2) return known.length === 1 && candidates.length === 1 ? { pick: known[0], decided: true } : first;
  const props = ['armour', 'evasion', 'energyShield', 'ward'];
  const hasProps = !!ev.physical || props.some(k => ev[k] !== undefined);
  if (ev.level === undefined && !ev.attributes && !hasProps) return first;
  let byLevel = false;
  const feasible = known.filter(c => {
    const h = BASE_HINTS[c];
    if (ev.level !== undefined && ev.level < h.level) {
      byLevel = true;
      return false;
    }
    if (ev.physical && h.physical && ev.physical[0] + ev.physical[1] < (h.physical[0] + h.physical[1]) * 0.95) return false;
    return props.every(k => ev[k] === undefined || !h[k] || ev[k] >= h[k] * 0.95);
  });
  if (feasible.length === 1) return { pick: feasible[0], decided: true, by: byLevel ? 'requirements' : 'properties' };
  const pool = feasible.length ? feasible : known;
  const attrs = ev.attributes;
  if (attrs) {
    const exact = pool.filter(c => {
      const h = BASE_HINTS[c];
      return h.str === attrs.str && h.dex === attrs.dex && h.int === attrs.int;
    });
    if (exact.length === 1) return { pick: exact[0], decided: true, by: 'requirements' };
  }
  return { pick: pool[0], decided: false };
}

/**
 * Korean -> English unique names, joined by the Words ID of the same extraction. The trade item
 * lists only confirm that the pair exists and sits on a matching base.
 */
export function uniqueNamesFromTrade(ko, en, bases = BASE_NAMES) {
  const out = new Map();
  const identities = nameIdentities.uniqueEnByKo;
  for (const group of ko.result) for (const item of group.entries) {
    if (!item.name) continue;
    const names = identities[item.name] ?? [];
    const known = asList(Object.hasOwn(bases, item.type) ? bases[item.type] : undefined);
    const matches = [...new Set(en.result.filter(g => g.id === group.id).flatMap(g => g.entries).filter(e => !!e.name && names.includes(e.name) && (!known.length || known.includes(e.type))).map(e => e.name))];
    if (matches.length === 1) out.set(item.name, matches[0]);
  }
  return out;
}

/** English -> Korean skill gem names, joined by official metadata ID (list order and size may differ). */
export function gemNamesFromTrade(ko, en) {
  const out = new Map();
  const koGems = ko.result.find(g => g.id === 'gem')?.entries ?? [];
  const enGems = en.result.find(g => g.id === 'gem')?.entries ?? [];
  const identities = nameIdentities.skillKoByEn;
  for (const item of enGems) {
    const candidates = (identities[item.type] ?? []).filter(name => koGems.some(entry => entry.type === name));
    if (candidates.length === 1) out.set(item.type, candidates[0]);
  }
  return out;
}

// ───────────────────────── modifier lines ─────────────────────────

/** Line -> key with values as # and value tokens kept verbatim ("33(33-41)") */
function tokenize(text) {
  const tokens = [];
  const key = text.replace(VALUE, (_m, sign, value, range) => {
    tokens.push({ sign, text: value + (range ? range.replace(/\s+/g, '') : '') });
    return `${sign}#`;
  });
  return { key, tokens };
}

/**
 * Trade texts for the same line, in order. Trade texts drop the "+" before # and before baked-in
 * numbers in both languages; local stats also exist with a "(Local)" suffix.
 */
function keyCandidates(key, local) {
  const unsigned = key.replace(/[+](?=[#\d])/g, '');
  const base = [...new Set([key, unsigned])];
  return local ? [...base.flatMap(k => LOCAL_TAGS.flatMap(tag => [`${k}${tag}`, `${k} ${tag}`])), ...base] : base;
}

function statTypesFor(kind, origin, tag) {
  const order = [];
  const push = (...t) => t.forEach(x => order.includes(x) || order.push(x));
  if (tag === 'implicit' || kind === 'implicit') push('implicit');
  if (tag === 'rune' || kind === 'rune') push('augment', 'rune');
  if (tag === 'enchant' || kind === 'enchant') push('enchant');
  if (origin) push(origin);
  if (tag === 'desecrated' || tag === 'fractured' || tag === 'crafted') push(tag);
  push('explicit', 'implicit', 'skill', 'enchant', 'augment', 'rune', 'desecrated', 'fractured', 'crafted');
  return order;
}

function findStat(index, en, keys, types, local) {
  for (const type of types) {
    const byText = index.byType.get(type);
    if (!byText) continue;
    for (const k of keys.flatMap(c => keyCandidates(c, local))) {
      const candidates = (byText.get(k) ?? []).filter(id => en.has(id));
      const meanings = new Set(candidates.map(id => en.get(id)));
      if (meanings.size > 1 && !candidates.every(id => SIBLING_OF.has(id.slice(id.indexOf('.') + 1)))) continue;
      const id = candidates[0];
      const text = id && en.get(id);
      if (id && text) return { id, en: text };
    }
  }
  return undefined;
}

/**
 * Puts the original values into the English #s in order. The sign follows the original: trade texts
 * omit "+" ("# to maximum Life") but the game prints "+33 to maximum Life" and PoB needs it.
 */
function fill(template, tokens) {
  const parts = template.split('#');
  if (parts.length - 1 !== tokens.length) return undefined;
  let out = parts[0];
  tokens.forEach((t, i) => {
    if (t.sign) {
      if (out.endsWith('+') || out.endsWith('-')) out = out.slice(0, -1);
      out += t.sign;
    }
    out += t.text + parts[i + 1];
  });
  return out;
}

const cleanMarkup = s => s.replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2').replace(/\[([^\]]+)\]/g, '$1');
/** English trade text -> game text: no link markup, no " (Local)" */
const gameText = s => cleanMarkup(s).replace(/\s*\(Local\)\s*$/i, '').trim();

/** Switches to the sibling stat the rules pick; { note } when nothing decides it. */
function resolveSibling(hit, en, ctx, tokens) {
  const dot = hit.id.indexOf('.');
  const [type, bare] = [hit.id.slice(0, dot), hit.id.slice(dot + 1)];
  const group = SIBLING_OF.get(bare);
  if (!group) return hit;
  const textOf = id => en.get(`${type}.${id}`) ?? en.get(`explicit.${id}`);
  if (group.rule === 'none') {
    const names = group.ids.map(id => textOf(id)).filter(Boolean).map(t => gameText(t));
    return { note: `Same Korean text for two English stats, cannot choose: ${names.join(' / ')}` };
  }
  const want = group.rule === 'weapon' ? group.ids[ctx.weapon ? 1 : 0] : group.ids[tokens[0]?.sign === '+' ? 0 : 1];
  if (want === bare) return hit;
  const text = textOf(want);
  return text ? { id: `${en.has(`${type}.${want}`) ? type : 'explicit'}.${want}`, en: text } : hit;
}

function translateMod(raw, data, ctx) {
  let s = raw.trim();
  const tails = [];
  let unscalable = false;
  for (let before = ''; before !== s;) {
    before = s;
    const tag = s.match(LINE_TAG);
    if (tag) {
      tails.unshift(` (${tag[1].toLowerCase()})`);
      s = s.slice(0, tag.index).trimEnd();
    }
    if (UNSCALABLE.test(s)) {
      unscalable = true;
      s = s.replace(UNSCALABLE, '');
    }
  }
  const tagKind = tails.map(t => t.slice(2, -1)).find(t => t !== 'augmented' && t !== 'unmet');
  // Name ranges "비스무트(자수정-토파즈)의 유산" are matched without the range, like the tooltip (PoB reads it without too)
  const line = parseModLine(s);
  const base = line.choice ? line.text : s;
  const { key, tokens } = tokenize(base);
  const literal = tokens.length && !line.ranges.some(Boolean) ? [base] : [];
  const types = statTypesFor(ctx.kind, ctx.origin, tagKind);
  const tryKeys = keys => findStat(data.ko, data.en, keys, types, ctx.local);

  let hit = tryKeys([...literal, key]);
  if (hit) {
    const sibling = resolveSibling(hit, data.en, ctx, tokens);
    if ('note' in sibling) return { note: sibling.note };
    hit = sibling;
  }
  let english = hit ? gameText(hit.en) : undefined;
  // Negative values: the trade site only lists the "+#" form ("화염 저항 -10%" <-> "화염 저항 +#%")
  if (!hit && tokens.some(t => t.sign === '-')) {
    hit = tryKeys([key.replace(/-#/g, '+#'), key.replace(/-#/g, '#')]);
    english = hit ? gameText(hit.en) : undefined;
  }
  if (!hit) {
    for (const [from, to, enFrom, enTo] of SWAPS) {
      if (!key.includes(from)) continue;
      const swapped = tryKeys([key.replace(from, to), ...literal.map(l => l.replace(from, to))]);
      if (swapped && enFrom.test(swapped.en)) {
        hit = swapped;
        english = gameText(swapped.en).replace(enFrom, enTo);
        break;
      }
    }
  }
  if (!hit || english === undefined) return undefined;
  // Texts with baked-in numbers have no # and are used as is
  const text = english.includes('#') ? fill(english, tokens) : english;
  if (text === undefined) return undefined;
  return { text: text + (unscalable ? ' - Unscalable Value' : '') + tails.join(''), stat: hit.id };
}

// ───────────────────────── line kinds ─────────────────────────

const MOD_HEADER = /^\{\s*(.+?)(?:\s+"(.+?)")?(?:\s+\((등급|단계):\s*(\d+)\))?\s*(?:[—–]\s*(.+?))?\s*\}$/;

function translateHeader(line) {
  // Advanced copies report catalyst effect after the tag list. The quality
  // property supplies that multiplier to PoB; it is not another modifier tag.
  const header = line.replace(/\s+[—–]\s+\d+(?:\.\d+)?%\s+(?:증가|감소)\s*(?=\})/, ' ');
  const m = header.match(MOD_HEADER);
  if (!m) return { kind: undefined, note: 'Unknown header shape' };
  let body = m[1].trim();
  let origin;
  let prefix = '';
  for (const [ko, en, o] of HEADER_ORIGIN) {
    if (body.startsWith(ko)) {
      body = body.slice(ko.length);
      prefix = en;
      origin = o;
    }
  }
  const kindEn = HEADER_KIND[body];
  const kind = /접두/.test(body) ? 'prefix' : /접미/.test(body) ? 'suffix' : /향상/.test(body) ? 'enchant' : /고정/.test(body) ? 'implicit' : /고유/.test(body) ? 'unique' : undefined;
  if (!kindEn) return { kind, origin, note: `Unknown header kind: ${body}` };
  let text = `{ ${prefix}${kindEn}`;
  if (m[4]) text += m[3] === '단계' ? ` (Rank: ${m[4]})` : ` (Tier: ${m[4]})`;
  const tags = (m[5] ?? '')
    .split(/,\s*/)
    .map(t => t.trim())
    .filter(Boolean);
  const tagsEn = tags.map(t => TAGS[t]).filter(Boolean);
  // One unknown tag drops them all: PoB barely uses tags, and none is better than a wrong one
  if (tagsEn.length && tagsEn.length === tags.length) text += ` - ${tagsEn.join(', ')}`;
  return { text: text + ' }', kind, origin, note: tags.length && tagsEn.length !== tags.length ? `Dropped unknown tags: ${tags.join(', ')}` : undefined };
}

function translateProperty(label, value) {
  const q = label.match(/^퀄리티 \((.+?) 속성(?: 부여)?\)$/);
  if (q && QUALITY_KINDS[q[1]]) return `Quality (${QUALITY_KINDS[q[1]]} Modifiers): ${value}`;
  const en = PROPERTY[label];
  return en ? `${en}: ${value}` : undefined;
}

/** "레벨 80, 94 민첩" -> 80 */
function requiredLevel(value) {
  const m = value.match(/레벨\s*(\d+)/);
  return m ? Number(m[1]) : undefined;
}

/** Same replacements as PoB's sanitiseText (Modules/Common.lua): long dashes -> "-", ä/ö/í/ó -> a/o/i/o, bullets removed */
export function toAscii(line) {
  return line
    .replace(/[‐-―−]/g, '-')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/í/g, 'i')
    .replace(/ó/g, 'o')
    .replace(/• ?/g, '');
}
const NON_ASCII = /[^\x20-\x7e]/;

/** Lines -> PoB text: repeated, leading and trailing separators folded, CRLF line ends */
function joinPobLines(lines) {
  return lines
    .join('\n')
    .replace(/(?:--------\n)+--------/g, SEPARATOR)
    .replace(/^(?:--------\n)+|(?:\n--------)+$/g, '')
    .replace(/\n/g, '\r\n');
}

// ───────────────────────── basic form (copy into PoB by hand) ─────────────────────────

/** A roll range right after a value: "36(33-38)", "-10(-12--8)", "1.5(1.2-1.8)" (not name ranges) */
const ROLL_RANGE = /(\d)\(\s*-?\d+(?:\.\d+)?\s*-\s*-?\d+(?:\.\d+)?\s*\)/g;
const HEADER_LINE = /^\{.*\}$/;

/**
 * Text for pasting into PoB's item editor: no "{ … }" headers and no roll ranges. Pasting the detailed
 * form makes PoB open its crafting editor from the headers and re-roll the values, so the item no
 * longer matches. Everything else follows convertItemText. The detailed `text` is what a headless
 * engine should get: it does not go through the crafting editor, so values stay.
 */
export function pobBasicText(c) {
  const kept =
    c.language === 'ko'
      ? c.lines.flatMap(l => (l.to === undefined || l.kind === 'header' ? [] : [l.to]))
      : c.text
        .split(/\r?\n/)
        .map(l => toAscii(l.trim()))
        .filter(l => l && !HEADER_LINE.test(l));
  return joinPobLines(kept.map(l => l.replace(ROLL_RANGE, '$1')));
}

// ───────────────────────── entry points ─────────────────────────

/** Source language of a copy: the client's own "Item Class:"/"Rarity:" label, or "unknown". */
export function itemTextLanguage(raw) {
  return detectItemLanguage(raw) ?? 'unknown';
}

const GEAR_RARITY = new Set(['Normal', 'Magic', 'Rare', 'Unique']);

/**
 * Game copy text in any supported locale -> PoB English item text.
 *
 * options.trade: Korean trade data { ko: StatIndex, en: Map<statId, englishText>, uniques?, bases? }
 * as returned by loadTradeData() (trade-data.mjs). Without it Korean uses the locale-pack route.
 *
 * Returns { text, status: 'ok'|'partial'|'blocked', blockedCode?, blockedReason?, language, rarity?,
 * baseName?, baseAlternatives?, baseChoice?, mods: { total, converted }, dropped, notes, lines }.
 */
export function convertItemText(raw, options = {}) {
  const language = itemTextLanguage(raw);
  if (language === 'en') return englishItemText(raw);
  if (language === 'ko' && options.trade) return koreanTradeText(raw, options.trade);
  if (language !== 'unknown') return localizedPobText(raw, language);
  return {
    text: raw.trim(), status: 'blocked', blockedCode: 'notItem', blockedReason: 'Does not look like an item copy (the first line is not an item class or rarity)',
    language, mods: { total: 0, converted: 0 }, dropped: [], notes: [], lines: [],
  };
}

/**
 * English copies already are what PoB reads, so lines are kept as copied (roll ranges, headers, names).
 * The locale-pack route still runs for the facts: rarity, base, and whether it is equipment at all.
 */
function englishItemText(raw) {
  const facts = localizedPobText(raw, 'en');
  const modLines = new Set([...facts.lines.filter(l => l.kind === 'mod').flatMap(l => l.from.split('\n')), ...facts.dropped]);
  const result = {
    text: '', status: facts.status === 'blocked' ? 'blocked' : 'ok', language: 'en',
    ...(facts.blockedCode ? { blockedCode: facts.blockedCode, blockedReason: facts.blockedReason } : {}),
    ...(facts.rarity ? { rarity: facts.rarity } : {}),
    ...(facts.baseName ? { baseName: facts.baseName } : {}),
    ...(facts.baseChoice ? { baseChoice: facts.baseChoice, baseAlternatives: facts.baseAlternatives } : {}),
    mods: { total: 0, converted: 0 }, dropped: [], notes: [...facts.notes], lines: [],
  };
  let head = true;
  for (const from of raw.replace(/^﻿/u, '').trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
    const kind = from === SEPARATOR ? 'separator' : head ? 'head' : HEADER_LINE.test(from) ? 'header' : modLines.has(from) ? 'mod' : /^Requires/.test(from) ? 'requirement' : /^[^:{}]+:\s/.test(from) ? 'property' : 'other';
    if (kind === 'separator') head = false;
    const to = toAscii(from);
    if (kind === 'mod') result.mods.total++;
    if (NON_ASCII.test(to)) {
      result.lines.push({ from, kind, note: 'Non-ASCII left after sanitising; dropped' });
      if (kind === 'mod') result.dropped.push(from);
      continue;
    }
    if (kind === 'mod') result.mods.converted++;
    result.lines.push({ from, to, kind });
  }
  result.text = joinPobLines(result.lines.flatMap(l => (l.to === undefined ? [] : [l.to])));
  if (result.status === 'ok' && result.dropped.length) result.status = 'partial';
  return result;
}

/** Korean copy -> English through the trade stat ids (see the header comment). */
function koreanTradeText(raw, data) {
  const result = { text: raw.trim(), status: 'ok', language: 'ko', mods: { total: 0, converted: 0 }, dropped: [], notes: [], lines: [] };
  const bases = data.bases ?? BASE_NAMES;
  const src = raw.trim().split(/\r?\n/).map(l => l.trim());
  const lines = result.lines;
  const keep = (from, to, kind, extra = {}) => {
    lines.push({ from, to, kind, ...extra });
  };
  const drop = (from, kind, note) => {
    lines.push({ from, kind, note });
  };

  let i = 0;
  let itemClass;
  let rarityKo;
  if (src[i]?.startsWith('아이템 종류:')) {
    itemClass = src[i].slice('아이템 종류:'.length).trim();
    const en = CLASSES[itemClass];
    // PoB only uses this line to detect energy blades (Item.lua:316); an unknown class is dropped
    if (en) keep(src[i], `Item Class: ${en}`, 'head');
    else drop(src[i], 'head', `Unknown item class: ${itemClass}`);
    i++;
  }
  if (src[i]?.startsWith('아이템 희귀도:')) {
    rarityKo = src[i].slice('아이템 희귀도:'.length).trim();
    const rarity = RARITY[rarityKo];
    if (rarity) {
      result.rarity = rarity;
      keep(src[i], `Rarity: ${rarity}`, 'head');
    } else drop(src[i], 'head', `Unknown rarity: ${rarityKo}`);
    i++;
  }
  // Name lines up to the first separator. On unusable items the names are in the next section
  const readHead = () => {
    const head = [];
    while (i < src.length && src[i] !== SEPARATOR) head.push(src[i++]);
    return head;
  };
  let head = readHead();
  if (head[0] === CANNOT_USE_KO) {
    drop(head[0], 'head', 'Dropped the cannot-use line (names are in the next section)');
    result.notes.push('Unusable item: the game marks its requirements as unmet');
    for (const h of head.slice(1)) drop(h, 'head', 'Rest of the cannot-use section');
    if (src[i] === SEPARATOR) i++;
    head = readHead();
  }
  const rarity = result.rarity;
  const gear = !!rarity && GEAR_RARITY.has(rarity);
  const baseLine = head[head.length - 1];
  if ((rarity === 'Rare' || rarity === 'Unique') && head.length >= 2) {
    const name = head[0];
    if (rarity === 'Unique') {
      const en = data.uniques?.get(name);
      keep(name, en ?? 'Unique Item', 'head', en ? {} : { note: 'No English unique name; placeholder used' });
      if (!en) result.notes.push(`No English unique name: ${name}`);
    } else keep(name, 'Rare Item', 'head', { note: 'Rare names are unused in calculations; placeholder used' });
    for (const h of head.slice(1, -1)) drop(h, 'head', 'Extra head line');
  }
  if (baseLine !== undefined) {
    const found = gear ? englishBase(baseLine, bases, rarity === 'Magic' || rarity === 'Normal') : { en: [] };
    if (found.en.length) {
      let pick = found.en[0];
      if (found.en.length > 1) {
        // One Korean base, several English ones: compare requirements and values with PoB's base data
        const choice = chooseBase(found.en, readBaseEvidence(src.slice(i)));
        pick = choice.pick;
        result.baseChoice = { candidates: [...found.en], decided: choice.decided, by: choice.by };
        result.baseAlternatives = found.en.filter(e => e !== pick);
        result.notes.push(
          choice.decided
            ? `Several base candidates, chosen by ${choice.by === 'requirements' ? 'requirements' : 'property values'}: ${baseLine} -> ${pick}`
            : `Several base candidates, undecided: ${baseLine} -> ${found.en.join(' | ')}`,
        );
        if (!choice.decided) return { ...result, text: '', status: 'blocked', blockedCode: 'noBase', blockedReason: `Could not decide the base: ${found.en.join(' / ')}` };
      }
      result.baseName = pick;
      keep(baseLine, pick, 'head', found.matched !== tidy(baseLine) ? { note: `Kept only the base from the name: ${found.matched}` } : {});
    } else drop(baseLine, 'head', gear ? 'No English base name' : 'Not equipment');
  }

  const local = !itemClass || !NON_LOCAL_CLASS.test(itemClass);
  const weapon = !!itemClass && WEAPON_CLASS.test(CLASSES[itemClass] ?? '');
  let section = 0;
  let header = { kind: undefined };
  for (; i < src.length; i++) {
    const l = src[i];
    if (!l) continue;
    if (l === SEPARATOR) {
      keep(l, SEPARATOR, 'separator');
      section++;
      header = { kind: undefined };
      continue;
    }
    if (l.startsWith('{')) {
      const h = translateHeader(l);
      header = { kind: h.kind, origin: h.origin };
      if (h.text) keep(l, h.text, 'header', h.note ? { note: h.note } : {});
      else drop(l, 'header', h.note ?? 'Unknown header');
      continue;
    }
    if (FLAGS[l]) {
      keep(l, FLAGS[l], 'flag');
      continue;
    }
    // The weapon type line ("양손 철퇴") repeats the item class at the top of the first section; PoB does not use it
    if (itemClass && l === itemClass) {
      drop(l, 'property', 'Weapon type line dropped');
      continue;
    }
    const req = l.match(/^요구 사항:\s*(.+)$/);
    if (req) {
      // PoB computes normal/magic/rare requirements from base and affixes. A "Requires Level N" line
      // would spread to other items with the same name ("Rare Item") (Item.lua:612, 2195). Uniques only.
      const level = requiredLevel(req[1]);
      if (rarity === 'Unique' && level !== undefined) keep(l, `Requires Level ${level}`, 'requirement');
      else drop(l, 'requirement', 'Requirement line dropped (PoB computes it from base and affixes)');
      continue;
    }
    const ilvl = l.match(/^아이템 레벨:\s*(\d+)$/);
    if (ilvl) {
      keep(l, `Item Level: ${ilvl[1]}`, 'property');
      continue;
    }
    const sockets = l.match(/^홈:\s*(.+)$/);
    if (sockets) {
      keep(l, `Sockets: ${sockets[1]}`, 'property');
      continue;
    }
    if (/^메모:/.test(l)) {
      drop(l, 'property', 'Note line dropped');
      continue;
    }
    if (FLASK_INFO.some(re => re.test(l))) {
      drop(l, 'property', 'Flask description line dropped (PoB computes it)');
      continue;
    }
    const prop = l.match(/^([^:{}()]+?(?:\s*\([^()]+\))?):\s*(.+)$/);
    if (prop && !l.startsWith('스킬 부여:')) {
      const en = translateProperty(prop[1].trim(), prop[2].trim());
      if (en) {
        keep(l, en, 'property');
        continue;
      }
      if (section <= 1 && !header.kind) {
        drop(l, 'property', 'Unknown property name (PoB does not use it)');
        continue;
      }
    }
    result.mods.total++;
    const t = translateMod(l, data, { kind: header.kind, origin: header.origin, local, weapon });
    if (t && 'text' in t) {
      result.mods.converted++;
      keep(l, t.text, 'mod', { stat: t.stat });
    } else drop(l, 'mod', t?.note ?? 'No trade stat matched');
  }

  // ASCII only: lines that still hold non-ASCII after PoB's own replacements are dropped
  for (const l of lines) {
    if (l.to === undefined) continue;
    l.to = toAscii(l.to);
    if (NON_ASCII.test(l.to)) {
      l.note = 'Non-ASCII left after sanitising; dropped';
      l.to = undefined;
      if (l.kind === 'mod') result.mods.converted--;
    }
  }
  // Unique flavour text: when every line of the last section is unreadable, it is not a modifier
  if (rarity === 'Unique') {
    const tail = lines.slice(lines.map(l => l.kind).lastIndexOf('separator') + 1);
    if (tail.length && tail.every(l => l.kind === 'mod' && l.to === undefined)) {
      for (const l of tail) {
        l.kind = 'other';
        l.note = 'Unique flavour text';
        result.mods.total--;
      }
    }
  }
  // A header with no converted line below it goes too (PoB would see an empty modifier)
  lines.forEach((l, n) => {
    if (l.kind !== 'header' || l.to === undefined) return;
    const below = [];
    for (let k = n + 1; k < lines.length && lines[k].kind !== 'header' && lines[k].kind !== 'separator'; k++) below.push(lines[k]);
    if (!below.some(b => b.kind === 'mod' && b.to !== undefined)) {
      l.to = undefined;
      l.note = 'Header dropped: no line below it was converted';
    }
  });

  result.dropped = lines.filter(l => l.kind === 'mod' && l.to === undefined).map(l => l.from);
  result.text = joinPobLines(lines.flatMap(l => (l.to === undefined ? [] : [l.to])));
  if (!gear) {
    result.status = 'blocked';
    result.blockedCode = rarity ? 'notGear' : 'noRarity';
    result.blockedReason = rarity ? `Not equipment (${rarity}); cannot be sent to PoB` : 'Unknown rarity';
  } else if (!result.baseName) {
    result.status = 'blocked';
    result.blockedCode = 'noBase';
    result.blockedReason = `No English base name: ${baseLine ?? '(no base line)'}`;
  } else if (result.dropped.length || result.baseChoice?.decided === false) result.status = 'partial';
  return result;
}
