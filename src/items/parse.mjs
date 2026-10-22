// Structures a game clipboard item (Ctrl+Alt+C): head, properties, requirements, state flags and
// modifiers with their roll ranges. Korean and English are read directly; other locales are first
// rewritten structurally to English labels (localization.mjs) while modifier text stays original.
import { classIdentity, detectItemLanguage, gameLocale, gameNumber, itemMetadataIds, localizedClassName, normalizeItemStructure } from './localization.mjs';
import { canonicalStat } from './stat-identity.mjs';

const SEP = /\r?\n-{8}\r?\n/;
/** Link markup "[Physical|물리]" -> "물리". Removed from the whole text before parsing. */
const MARKUP = /\[(?:[^|\]]*\|)?([^|\]]+)\]/g;
const NAME_MARKUP = /<<[^>]*>>/g;
const label = keys => new RegExp(`^(?:${keys.join('|')}):\\s*(.+)$`);
const ITEM_CLASS = label(['아이템 종류', 'Item Class']);
const RARITY = label(['아이템 희귀도', 'Rarity']);

const RARITIES = new Set(['일반', '마법', '희귀', '고유', '젬', '화폐', '점술 카드', '퀘스트', 'Normal', 'Magic', 'Rare', 'Unique', 'Gem', 'Currency', 'Divination Card', 'Quest']);
/** ItemPopupCannotUseItem: when this follows the class/rarity lines, the name lines are in the next section. */
const CANNOT_USE = new Set(['아이템 착용 불가. 아이템 효과 미적용', 'You cannot use this item. Its stats will be ignored']);
// The Kakao client writes "중첩 개수"
const STACK = /^(?:중첩 개수|스택 크기|Stack Size):\s*([\d.,\s]+)(?:\/\s*([\d.,\s]+))?/;
const ITEM_LEVEL = /^(?:아이템 레벨|Item Level):\s*(\d+)/;
const REQUIREMENTS = /^(?:요구 사항|요구사항|Requires|Requirements):\s*(.*)$/;
const REQ_LEVEL = /(?:레벨|Level)\s*:?\s*(\d+)/i;
/** Korean prints "94 민첩", English "94 Dex"; trade listings may print "민첩: 94". */
const REQ_ATTR = [
  [/힘|\bStr(?:ength)?\b/i, 'str'],
  [/민첩|\bDex(?:terity)?\b/i, 'dex'],
  [/지능|\bInt(?:elligence)?\b/i, 'int'],
];
const SOCKETS = /^(?:홈|Sockets):\s*(.+)$/;
const NOTE = /^(?:메모|Note): (.*)$/;
const CORRUPTED = /^(?:타락|Corrupted)$/;
const DOUBLE_CORRUPTED = /^(?:두 번 타락|Twice Corrupted)$/;
/** The game writes "복제"; older spellings are accepted too. */
const MIRRORED = /^(?:복제|복제됨|복제된|Mirrored)$/;
const SANCTIFIED = /^(?:축성|Sanctified)$/;
const FRACTURED_ITEM = /^(?:분열된 아이템|Fractured Item)$/;
const UNIDENTIFIED = /^(?:미확인|Unidentified)(?:\s*\((?:(\d+)등급|Tier (\d+))\))?$/;
/** Unrevealed desecrated modifiers (ItemDisplayVeiledPrefix/Suffix). */
const VEILED = /^(?:훼손된 (접두어|접미어)|Desecrated (Prefix|Suffix))/;
const MUTATED_MARK = /\s\(mutated\)|바알 고유 속성|Vaal Unique Modifier/;
/** ItemDisplayGrantedSkill: "스킬 부여: {1}레벨 {0}" / "Grants Skill: Level {1} {0}" */
const GRANTED_SKILL = /^(?:스킬 부여|Grants Skill): \S/;
/** Flask charge lines (ItemDisplayCharges*): sections holding them are not modifiers. */
const CHARGES = /^(?:현재 충전량: \S+|Currently has \S+ Charges?)$/;
const GEM_LEVEL_CORRUPTION = /^(?:타락으로 인한 레벨 ([+-])(\d+)|([+-])(\d+) Levels? from Corruption)$/;
const GEM_LEVEL_FROM_GEM = /^(?:(\d+) 레벨 \(젬(?:, 최대)?\)|(\d+) Levels? from Gem(?: \(Max\))?)(\s*\(augmented\))?(?:\s*\(unmet\))?$/i;
const GEM_LEVEL_FROM_GEM_SUFFIX = /\s*(?:레벨 \(젬(?:, 최대)?\)|Levels? from Gem(?: \(Max\))?)$/i;
/** "Name: value"; the name may hold parentheses ("퀄리티 (생명력 속성 부여): +20%"). */
const PROPERTY = /^([^:{}]+?):\s*(.+)$/;
// { 접두어 속성 부여 "큰뿔염소의" (등급: 2) — 생명력, 회피 } / { Prefix Modifier "Hale" (Tier: 2) — Life }
const MOD_HEADER = /^\{\s*(.+?)(?:\s+"(.+?)")?(?:\s+\((?:등급|단계|Tier|Rank|랭크):\s*(\d+)\))?\s*(?:—\s*(.+?))?\s*\}$/;

const LINE_TAG = /\s*\((augmented|rune|implicit|enchant|crafted|desecrated|fractured|mutated|crucible|scourge|vestigial|bonded)\)\s*$/i;
/** "— Unscalable Value": not changed by effect increases (the line may still have a roll). */
const UNSCALABLE = /\s*[—–]\s*(?:변경이 불가능한 값|변경 불가능한 값|Unscalable Value)\s*$/i;
// Name ranges without digits, "(Amethyst-Topaz)". Parentheses without a hyphen ("(Local)") are left alone.
const CHOICE = /\s*\(\s*([^()\d\-–]+?)\s*[-–]\s*([^()\d\-–]+?)\s*\)/;
/** A value and its roll range "36(33-38)". A "-" sign counts only at line start, after a space or "(". */
const VALUE = /((?<![^\s(])-)?(\d+(?:\.\d+)?)(\s*\(\s*(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*\))?/g;

const PROPERTY_KEYS = [
  [/^(?:퀄리티|Quality)(?: \(.+\))?$/i, 'quality'],
  [/^(?:방어도|Armour)$/i, 'ar'],
  [/^(?:회피|회피 정확도|Evasion Rating|Evasion)$/i, 'ev'],
  [/^(?:에너지 보호막|Energy Shield)$/i, 'es'],
  [/^(?:룬 수호|Runic Ward|Ward)$/i, 'ward'],
  [/^(?:막기 확률|Block chance|Chance to Block)$/i, 'block'],
  [/^(?:정신력|Spirit)$/i, 'spirit'],
  [/^(?:레벨|Level)$/i, 'gem_level'],
  [/^(?:경로석 등급|웨이스톤 등급|지도 등급|Waystone Tier|Map Tier)$/i, 'map_tier'],
  [/^(?:무리 규모|Pack Size)$/i, 'map_packsize'],
  [/^(?:몬스터 효율|Monster Effectiveness)$/i, 'map_magic_monsters'],
  [/^(?:아이템 희귀도|Item Rarity)$/i, 'map_iir'],
  [/^(?:몬스터 희귀도|Monster Rarity)$/i, 'map_rare_monsters'],
  [/^(?:부활 횟수|Revives Available)$/i, 'map_revives'],
  [/^(?:경로석 출현 확률|Waystone Drop Chance)$/i, 'map_bonus'],
  [/^(?:물리 피해|Physical Damage)$/i, 'phys'],
  [/^(?:원소 피해|화염 피해|냉기 피해|번개 피해|Elemental Damage|Fire Damage|Cold Damage|Lightning Damage)$/i, 'ele'],
  [/^(?:카오스 피해|Chaos Damage)$/i, 'chaos'],
  [/^(?:치명타 확률|치명타 명중 확률|Critical Hit Chance|Critical Strike Chance)$/i, 'crit'],
  [/^(?:초당 공격 횟수|Attacks per Second)$/i, 'aps'],
];

const toInt = s => Number(s.replace(/[\s,.]/g, ''));

function modKind(header) {
  if (/접두어|Prefix/.test(header)) return 'prefix';
  if (/접미어|Suffix/.test(header)) return 'suffix';
  // "타락 향상" (Corruption Enhancement) is an enchant, so check it before implicit
  if (/향상|Enhancement|Enchant/.test(header)) return 'enchant';
  if (/고정 속성|암시|Implicit/.test(header)) return 'implicit';
  if (/룬|Rune/.test(header)) return 'rune';
  if (/고유|Unique/.test(header)) return 'unique';
  if (/제작|Crafted/.test(header)) return 'crafted';
  return undefined;
}

const CORRUPTION_ENCHANT = /타락 향상|Corruption Enhancement/i;

function modOrigin(header) {
  if (/분열|Fractured/i.test(header)) return 'fractured';
  if (/바알 고유 속성|Vaal Unique Modifier/i.test(header)) return 'mutated';
  return undefined;
}

function modMark(header) {
  if (/제작된|Crafted/i.test(header)) return 'crafted';
  if (/훼손|모독|Desecrated/i.test(header)) return 'desecrated';
  return undefined;
}

const TAG_KIND = new Map([['implicit', 'implicit'], ['enchant', 'enchant'], ['rune', 'rune'], ['crafted', 'crafted']]);
const ORIGIN_TAGS = new Set(['fractured', 'desecrated', 'mutated']);
const BEFORE_SKILL = new Set(['enchant', 'implicit', 'rune']);

/** Line-end tags, outermost first. */
function lineTags(raw) {
  const tags = [];
  let s = raw.replace(UNSCALABLE, '');
  for (let m = s.match(LINE_TAG); m; m = s.match(LINE_TAG)) {
    tags.push(m[1].toLowerCase());
    s = s.slice(0, m.index).replace(UNSCALABLE, '');
  }
  return tags;
}

/** Splits values, roll ranges and tags: "회피 36(33-38)% 증가" -> text "회피 36% 증가", values [36], ranges [[33, 38]]. */
export function parseModLine(raw) {
  let s = raw.trim();
  let unscalable = false;
  // Tags and the unscalable marker can come in either order
  for (let before = ''; before !== s;) {
    before = s;
    s = s.replace(LINE_TAG, '');
    if (UNSCALABLE.test(s)) {
      unscalable = true;
      s = s.replace(UNSCALABLE, '');
    }
  }
  const picked = s.match(CHOICE);
  const choice = picked ? [picked[1].trim(), picked[2].trim()] : undefined;
  if (picked) s = s.replace(CHOICE, '');
  const values = [];
  const ranges = [];
  const text = s
    .replace(VALUE, (_, sign, value, range, lo, hi) => {
      values.push(sign ? -Number(value) : Number(value));
      ranges.push(range ? [Number(lo), Number(hi)] : undefined);
      return `${sign ?? ''}${value}`;
    })
    .trim();
  return { text, raw: raw.trim(), values, ranges, fixed: !ranges.some(Boolean), unscalable, ...(choice ? { choice } : {}) };
}

function propertyNumber(value) {
  const pairs = [...value.matchAll(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/g)];
  if (pairs.length) return pairs.reduce((sum, m) => sum + (Number(m[1]) + Number(m[2])) / 2, 0);
  const single = value.match(/\d+(?:\.\d+)?/);
  return single ? Number(single[0]) : undefined;
}

function parseProperty(line) {
  const gem = line.match(GEM_LEVEL_FROM_GEM);
  if (gem) {
    const value = gem[1] ?? gem[2];
    return { label: gem[1] ? '레벨' : 'Level', value, num: Number(value), augmented: !!gem[3], key: 'gem_level' };
  }
  const m = line.match(PROPERTY);
  if (!m) return undefined;
  const augmented = /\(augmented\)\s*$/i.test(m[2]);
  let value = m[2].replace(/\s*\((?:augmented|unmet|최대|Max)\)/gi, '').trim();
  const name = m[1].trim();
  const key = PROPERTY_KEYS.find(([re]) => re.test(name))?.[1];
  if (key === 'gem_level') value = value.replace(GEM_LEVEL_FROM_GEM_SUFFIX, '').trim();
  return { label: name, value, num: propertyNumber(value), augmented, key };
}

/** "레벨 75, 94 민첩" -> { level: 75, dex: 94 }; each piece loses its "(unmet)" tag first. */
function parseRequirements(text) {
  const out = { text };
  const pieces = {};
  for (const raw of text.split(',')) {
    const piece = raw.replace(/\s*\((?:augmented|unmet)\)/gi, '').trim();
    const level = piece.match(REQ_LEVEL);
    if (level) {
      out.level = Number(level[1]);
      pieces.level = piece;
      continue;
    }
    const num = piece.match(/\d+/);
    const key = REQ_ATTR.find(([re]) => re.test(piece))?.[1];
    if (!num || !key) continue;
    out[key] = Number(num[0]);
    pieces[key] = piece;
  }
  if (Object.keys(pieces).length) out.pieces = pieces;
  return out;
}

const isRarity = (item, ...names) => (!!item.rarity && names.includes(item.rarity)) || (!!item.rarityId && names.includes(item.rarityId));
const isUnique = item => isRarity(item, '고유', 'Unique');
const isMagic = item => isRarity(item, '마법', 'Magic');
const isRare = item => isRarity(item, '희귀', 'Rare');
const isNormal = item => isRarity(item, '일반', 'Normal');
const isGem = item => isRarity(item, '젬', 'Gem');

/**
 * Undefined when the text is not an item copy: the first line is neither a class nor a rarity line,
 * the rarity is unknown, or there are not one or two name lines.
 * With locale packs available every modifier line also gets its official identity (`canonical`).
 */
export function parseItem(text) {
  const locale = detectItemLanguage(text);
  const normalized = locale && locale !== 'ko' && locale !== 'en' ? normalizeItemStructure(text, locale) : text.replace(/^﻿/u, '');
  const item = parseCore(normalized);
  if (!item) return undefined;
  item.raw = text;
  if (locale) item.gameLanguage = locale;
  item.classId = item.itemClass ? classIdentity(item.itemClass, locale) : undefined;
  if (locale) {
    item.rarityId = item.rarity;
    const ids = itemMetadataIds(item.baseType, locale, item.classId, isMagic(item) || isNormal(item));
    if (ids.length) item.baseMetadataIds = ids;
    // Keep original human-facing labels, while canonical keys drive calculations.
    if (locale !== 'ko' && locale !== 'en') {
      const rawLines = text.split(/\r?\n/u).map(s => s.trim());
      const normalizedLines = normalized.split(/\r?\n/u).map(s => s.trim());
      const rarityAt = normalizedLines.findIndex(s => /^Rarity:/u.test(s));
      if (rarityAt >= 0) item.rarity = rawLines[rarityAt].split(/[:：]/u).slice(1).join(':').trim();
      for (const property of item.properties) {
        const at = normalizedLines.findIndex(s => s.startsWith(`${property.label}:`));
        if (at >= 0) property.label = rawLines[at].split(/[:：]/u)[0];
      }
      const reqAt = normalizedLines.findIndex(s => /^(?:Requires|Requirements):/u.test(s));
      if (reqAt >= 0 && item.requirements) item.requirements.text = rawLines[reqAt].split(/[:：]/u).slice(1).join(':').trim();
      for (const mod of item.mods) for (let n = 0; n < mod.lines.length; n++) {
        const line = mod.lines[n];
        const at = normalizedLines.indexOf(line.raw);
        const original = at >= 0 ? rawLines[at] : line.raw;
        const numbers = original.replace(/\d+(?:(?:[.,  ])\d+| [0-9]{3})+/gu, value => String(gameNumber(value, locale)));
        mod.lines[n] = { ...parseModLine(numbers), raw: original };
      }
    }
    const englishClass = localizedClassName(item.classId ?? item.itemClass ?? '', 'en') ?? '';
    const context = { local: !!englishClass && !/Ring|Amulet|Belt|Jewel|Flask|Charm|Quiver/iu.test(englishClass), weapon: /(?:Sword|Axe|Mace|Bow|Wand|Staff|Staves|Sceptre|Spear|Flail|Dagger|Claw|Talisman)/iu.test(englishClass), relic: /^Relics?$/u.test(englishClass) };
    if (gameLocale(locale) && gameLocale('en')) for (const mod of item.mods) {
      for (const line of mod.lines) line.canonical = canonicalStat(line.text, locale, context);
      if (mod.lines.length > 1 && mod.lines.some(line => !line.canonical)) {
        const joined = canonicalStat(mod.lines.map(line => line.text).join('\n'), locale, context);
        if (joined) {
          mod.lines[0].canonical = joined;
          if (joined.status === 'resolved') mod.lines[0].canonicalSpan = mod.lines.length;
        }
      }
    }
  }
  return item;
}

function parseCore(text) {
  const sections = text
    .replace(MARKUP, '$1')
    .trim()
    .split(SEP)
    .map(s => s.split(/\r?\n/).map(l => l.trim()).filter(Boolean));
  const head = sections[0];
  if (!head?.length) return undefined;

  const itemClass = head[0].match(ITEM_CLASS)?.[1];
  // The head starts with the class or the rarity line; after a class line the rarity may come anywhere
  if (!itemClass && !RARITY.test(head[0])) return undefined;
  const rarityAt = head.findIndex(l => RARITY.test(l));
  const rarity = rarityAt < 0 ? undefined : head[rarityAt].match(RARITY)?.[1].trim();
  if (rarity !== undefined && !RARITIES.has(rarity)) return undefined;
  let body = sections.slice(1).filter(s => s.length > 0);
  let names = head.filter((_, i) => i !== rarityAt && !(i === 0 && itemClass !== undefined));
  if (names.length && CANNOT_USE.has(names[0])) {
    names = body[0] ?? [];
    body = body.slice(1);
  }
  names = names.map(n => n.replace(NAME_MARKUP, '').trim());
  if (names.length < 1 || names.length > 2) return undefined;

  const item = {
    itemClass,
    rarity,
    name: names.length > 1 ? names[0] : undefined,
    baseType: names[names.length - 1],
    properties: [],
    corrupted: false,
    doubleCorrupted: false,
    unidentified: false,
    mirrored: false,
    sanctified: false,
    fractured: false,
    mutated: false,
    mods: [],
    flavour: [],
    raw: text,
  };
  // A plain Ctrl+C copy has no headers. When any section has headers, header-less sections are not modifiers.
  const advanced = body.some(s => s.some(l => MOD_HEADER.test(l)));
  // The property section is the first one with a known property name, else the first one
  const keyedAt = body.findIndex(s => s.some(l => !!parseProperty(l)?.key));
  const propsAt = keyedAt >= 0 ? keyedAt : 0;
  const veiled = { prefix: 0, suffix: 0 };
  let gemLevelShift = 0;
  let modSeen = false;
  if (isUnique(item) && body.some(s => s.some(l => MUTATED_MARK.test(l)))) item.mutated = true;

  body.forEach((section, index) => {
    const props = index === propsAt;
    // Flask charge sections are skipped; in the property section only the charge line is
    if (!(props && keyedAt >= 0) && section.some(l => CHARGES.test(l))) return;
    let current;
    const plain = [];
    for (const line of section) {
      const stack = line.match(STACK);
      if (stack) {
        item.stack = { size: toInt(stack[1]), max: stack[2] ? toInt(stack[2]) : undefined };
        continue;
      }
      const ilvl = line.match(ITEM_LEVEL);
      if (ilvl) {
        item.itemLevel = Number(ilvl[1]);
        continue;
      }
      const req = line.match(REQUIREMENTS);
      if (req) {
        item.requirements = parseRequirements(req[1].trim());
        continue;
      }
      const sockets = line.match(SOCKETS);
      if (sockets) {
        // A gem's "G-G-G" counts support sockets, not rune sockets
        if (isGem(item)) item.gemSockets = sockets[1].split('G').length - 1;
        else item.sockets = sockets[1].split(/[\s-]+/).filter(Boolean);
        continue;
      }
      const note = line.match(NOTE);
      if (note) {
        item.note = note[1];
        continue;
      }
      if (DOUBLE_CORRUPTED.test(line)) {
        item.corrupted = true;
        item.doubleCorrupted = true;
        continue;
      }
      if (CORRUPTED.test(line)) {
        item.corrupted = true;
        continue;
      }
      const unidentified = line.match(UNIDENTIFIED);
      if (unidentified) {
        item.unidentified = true;
        const tier = unidentified[1] ?? unidentified[2];
        if (tier) item.unidentifiedTier = Number(tier);
        continue;
      }
      if (MIRRORED.test(line)) {
        item.mirrored = true;
        continue;
      }
      if (SANCTIFIED.test(line)) {
        item.sanctified = true;
        continue;
      }
      if (FRACTURED_ITEM.test(line)) {
        item.fractured = true;
        continue;
      }
      const hidden = line.match(VEILED);
      if (hidden) {
        if (hidden[1] === '접두어' || hidden[2] === 'Prefix') veiled.prefix++;
        else veiled.suffix++;
        // Do not attach following lines to the previous header
        current = undefined;
        continue;
      }
      // Gem level shifts only count in the property section
      const shift = props ? line.match(GEM_LEVEL_CORRUPTION) : null;
      if (shift) {
        const sign = shift[1] ?? shift[3];
        gemLevelShift += (sign === '-' ? -1 : 1) * Number(shift[2] ?? shift[4]);
        continue;
      }
      if (CHARGES.test(line)) continue;

      const header = line.match(MOD_HEADER);
      if (header) {
        current = {
          kind: modKind(header[1]),
          origin: modOrigin(header[1]),
          mark: modMark(header[1]),
          name: header[2],
          tier: header[3] ? Number(header[3]) : undefined,
          ...(CORRUPTION_ENCHANT.test(header[1]) ? { corruption: true } : {}),
          tags: header[4] ? header[4].split(/,\s*/) : [],
          lines: [],
        };
        item.mods.push(current);
        modSeen = true;
        continue;
      }
      const tags = lineTags(line);
      const tagOrigin = tags.find(t => ORIGIN_TAGS.has(t));
      const tagKind = tags.map(t => TAG_KIND.get(t)).find(Boolean);
      // A granted skill under an enchant/implicit/rune header keeps that kind. Directly under an
      // empty header it turns that header into the skill modifier, so no empty modifier is left.
      if (GRANTED_SKILL.test(line) && !BEFORE_SKILL.has(current ? current.kind : tagKind)) {
        if (current && !current.lines.length) {
          current.kind = 'skill';
          current.lines.push(parseModLine(line));
        } else item.mods.push({ kind: 'skill', tags: [], lines: [parseModLine(line)] });
        modSeen = true;
        continue;
      }
      if (current) {
        current.lines.push(parseModLine(line));
        // "(desecrated)"/"(mutated)" under a header are its origin; "(crafted)" only changes the display
        current.origin ??= tagOrigin;
        if (tags.includes('crafted')) current.mark ??= 'crafted';
        continue;
      }
      // Header-less tagged lines: rune lines "… (rune)", implicit "(implicit)" in a plain copy
      if (tagKind || tagOrigin) {
        item.mods.push({ kind: tagKind ?? (isUnique(item) ? 'unique' : undefined), origin: tagOrigin, tags: [], lines: [parseModLine(line)] });
        modSeen = true;
        continue;
      }
      if (props) {
        const prop = parseProperty(line);
        if (prop) {
          item.properties.push(prop);
          continue;
        }
        // Other lines of a keyed property section (weapon type, flask recovery …) are not modifiers
        if (keyedAt >= 0) continue;
      }
      plain.push(line);
    }
    if (!plain.length) return;
    if (isUnique(item) && modSeen) item.flavour.push(...plain);
    else if (!advanced && (isMagic(item) || isRare(item)) && item.itemLevel !== undefined) {
      item.mods.push({ tags: [], lines: plain.map(parseModLine) });
    }
  });

  if (veiled.prefix || veiled.suffix) item.veiled = veiled;
  const gemLevel = item.properties.find(p => p.key === 'gem_level');
  if (gemLevelShift && gemLevel?.num !== undefined) {
    gemLevel.num += gemLevelShift;
    gemLevel.value = String(gemLevel.num);
  }
  item.quality = item.properties.find(p => p.key === 'quality')?.num;
  return item;
}
