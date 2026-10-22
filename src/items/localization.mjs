// Official game strings from the GGPK locale packs (data/items). Every lookup goes through
// stable IDs (metadata IDs, ClientStrings IDs), never by translating a translated name.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DATA = new URL('../../data/items/', import.meta.url);

let registry;
/** Shared registry: supported locales, structural ClientStrings, base classes, stat locality. */
export function gameLocaleRegistry() {
  return registry ??= JSON.parse(fs.readFileSync(new URL('locale-registry.json', DATA), 'utf8'));
}

const loaded = new Map();
const tidy = s => cleanGameMarkup(s).replace(/\s+/gu, ' ').trim();
export const cleanGameMarkup = s => s.replace(/\[(?:[^|\]]*\|)?([^|\]]+)\]/g, '$1').replace(/<[^>]+>/g, '').replace(/\{\{([\s\S]*)\}\}/g, '$1');

/**
 * The full pack for a locale, read from disk on first use. A pack must come from the same
 * extraction as the registry, otherwise IDs could point at different strings.
 */
export function gameLocale(locale) {
  if (loaded.has(locale)) return loaded.get(locale);
  const file = gameLocaleRegistry().files[locale];
  if (!file) return undefined;
  const compressed = fs.readFileSync(new URL(`locales/${path.posix.basename(file.path)}`, DATA));
  if (file.sha256 && createHash('sha256').update(compressed).digest('hex') !== file.sha256) throw new Error(`Game locale pack does not match the registry: ${locale}`);
  const data = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
  if (data.revision && data.revision !== gameLocaleRegistry().revision) throw new Error(`Game locale pack revision does not match the registry: ${locale}`);
  loaded.set(locale, data.pack ?? data);
  return loaded.get(locale);
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Slots carry their explicit index; language-specific word order is never zipped. */
export function compileGameTemplate(text, numeric = false, anchored = true) {
  const indices = [];
  let source = '', end = 0;
  for (const slot of cleanGameMarkup(text).matchAll(/\{(\d*)(?::([^}]*))?\}/g)) {
    source += escape(cleanGameMarkup(text).slice(end, slot.index)).replace(/\s+/g, '\\s*');
    indices.push(slot[1] ? Number(slot[1]) : indices.length);
    // `+d` prints a mandatory sign. Keeping it distinct from an unsigned slot
    // prevents fixed and additive stats with otherwise identical text colliding.
    const sign = slot[2]?.startsWith('+') ? '[+−-]' : '[−-]?';
    source += numeric ? `(${sign}(?:[0-9]+(?:[.,\\u00a0\\u202f][0-9]+| [0-9]{3})*))` : '(.+?)';
    end = slot.index + slot[0].length;
  }
  source += escape(cleanGameMarkup(text).slice(end)).replace(/\s+/g, '\\s*');
  return { re: new RegExp(anchored ? `^${source}$` : source, 'u'), indices };
}

export function fillGameTemplate(text, slots) {
  let missing = false, implicit = 0;
  const result = cleanGameMarkup(text).replace(/\{(\d*)(?::[^}]*)?\}/g, (_all, id) => {
    const value = slots.get(id ? Number(id) : implicit++);
    if (value === undefined) missing = true;
    return value ?? '';
  });
  return missing ? undefined : result;
}

/** Game copies may use decimal commas and non-breaking thousands separators. */
export function gameNumber(value, locale = 'en') {
  let text = value.replace(/[\s  ]/gu, '').replace(/−/g, '-');
  const comma = text.lastIndexOf(','), dot = text.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) text = comma > dot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  else if (comma >= 0) text = /^(?:de|fr|ru|pt-BR|es)$/.test(locale) ? text.replace(',', '.') : /^[-+]?\d{1,3}(?:,\d{3})+$/.test(text) ? text.replace(/,/g, '') : text.replace(',', '.');
  return Number(text);
}

const HEADER_IDS = ['ItemDisplayStringClass', 'ItemDisplayStringRarity'];
/** The first line must be the client's own "Item Class:" / "Rarity:" label in exactly one locale. */
export function detectItemLanguage(raw) {
  const first = cleanGameMarkup(raw).replace(/^﻿/u, '').split(/\r?\n/u).map(s => s.trim()).find(Boolean);
  if (!first) return undefined;
  if (/^(?:아이템 종류|아이템 희귀도):/u.test(first)) return 'ko';
  if (/^(?:Item Class|Rarity):/u.test(first)) return 'en';
  const { locales, packs } = gameLocaleRegistry();
  const matches = locales.filter(locale => HEADER_IDS.some(id => {
    const template = packs[locale]?.clientStringsById[id];
    return !!template && compileGameTemplate(`${template}: {0}`).re.test(first.replace(/：/g, ':'));
  }));
  return matches.length === 1 ? matches[0] : undefined;
}

const reverseNames = new Map();
function nameIndex(locale) {
  let index = reverseNames.get(locale);
  if (!index) {
    index = new Map();
    for (const [id, name] of Object.entries(gameLocale(locale)?.namesByMetadataId ?? {})) {
      const key = tidy(name), ids = index.get(key) ?? [];
      ids.push(id); index.set(key, ids);
    }
    reverseNames.set(locale, index);
  }
  return index;
}

/** `contained` finds the longest base inside a magic name ("Hale Iron Ring of the Kiln"). */
export function itemMetadataIds(name, locale, classId, contained = false) {
  const direct = nameIndex(locale).get(tidy(name));
  const found = direct ?? (contained ? [...nameIndex(locale)].filter(([n]) => tidy(name).includes(n)).sort(([a], [b]) => b.length - a.length).filter(([n], _i, all) => n.length === all[0][0].length).flatMap(([, ids]) => ids) : []);
  return found.filter(id => !classId || gameLocaleRegistry().basesByMetadataId[id]?.classId === classId);
}

export function classIdentity(name, locale) {
  const { locales, packs } = gameLocaleRegistry();
  const ids = new Set((locale ? [locale] : locales).flatMap(l => Object.entries(packs[l]?.classesById ?? {}).filter(([, text]) => tidy(text) === tidy(name)).map(([id]) => id)));
  return ids.size === 1 ? [...ids][0] : undefined;
}

export function localizedItemName(nameOrId, locale) {
  const direct = gameLocale(locale)?.namesByMetadataId[nameOrId];
  if (direct) return cleanGameMarkup(direct);
  const ids = new Set([...loaded.keys()].flatMap(l => nameIndex(l).get(tidy(nameOrId)) ?? []));
  const names = new Set([...ids].map(id => gameLocale(locale)?.namesByMetadataId[id]).filter(Boolean));
  return names.size === 1 ? cleanGameMarkup([...names][0]) : undefined;
}

export function localizedClassName(nameOrId, locale) {
  const { packs } = gameLocaleRegistry();
  const id = packs[locale]?.classesById[nameOrId] ? nameOrId : classIdentity(nameOrId);
  return id ? packs[locale]?.classesById[id] : undefined;
}

export function localizedUniqueNames(name, from, to) {
  const ids = Object.entries(gameLocale(from)?.uniqueNamesById ?? {}).filter(([, text]) => tidy(text) === tidy(name)).map(([id]) => id);
  return [...new Set(ids.map(id => gameLocale(to)?.uniqueNamesById?.[id]).filter(Boolean))];
}

const structural = new Map();
function structure(locale) {
  const previous = structural.get(locale); if (previous) return previous;
  const { packs } = gameLocaleRegistry();
  const strings = packs[locale]?.clientStringsById ?? {};
  const english = packs.en?.clientStringsById ?? {};
  const templates = [], fragments = [];
  for (const [id, text] of Object.entries(strings)) {
    const en = english[id];
    if (!en || !text || text === en) continue;
    if (/\{\d*(?::[^}]*)?\}/u.test(text) && /^(?:ItemDisplay(?:Flask|Charges|GrantedSkill|SkillGem(?:Plus|Minus|Level)|TalismanTier)|ModDescription)/u.test(id) && cleanGameMarkup(text).replace(/\{\d*(?::[^}]*)?\}/gu, '').trim().length >= 3) templates.push({ local: compileGameTemplate(text), english: en, id });
    else if (tidy(text) && text.length < 180) fragments.push([cleanGameMarkup(text).trim(), cleanGameMarkup(en).trim()]);
  }
  fragments.sort(([a], [b]) => b.length - a.length);
  templates.sort((a, b) => b.english.length - a.english.length);
  const result = { templates, fragments }; structural.set(locale, result); return result;
}

/** Only structural game strings are rewritten. Item names and modifier text stay untouched. */
export function englishStructuralLine(line, locale) {
  if (locale === 'en') return line;
  if (/^\{.*\}$/u.test(line.trim())) return englishModHeader(line, locale);
  const rules = structure(locale);
  const { packs } = gameLocaleRegistry();
  const local = packs[locale]?.clientStringsById ?? {};
  const english = packs.en?.clientStringsById ?? {};
  const clean = cleanGameMarkup(line);
  // Labels are composed with a colon by the client; they are not CSD templates.
  const colon = clean.search(/[:：]/u);
  if (colon >= 0) {
    const label = clean.slice(0, colon).trim();
    const candidates = Object.keys(local).filter(id => !local[id].includes('{') && cleanGameMarkup(local[id]).replace(/[:：]\s*$/u, '').trim() === label && english[id]);
    const preferred = candidates.find(id => /^(?:ItemDisplayString|ItemPopupRequirements|ItemRequirementsLabel)/u.test(id)) ?? candidates[0];
    if (preferred) {
      const value = clean.slice(colon + 1).trim().replace(/^[:：]\s*/u, '');
      // Class names have their own stable-ID table. Replacing structural words
      // inside a CJK/Thai class name can corrupt an otherwise exact identity.
      const translated = preferred === 'ItemDisplayStringClass' ? value : translateFragments(value, rules.fragments);
      return `${cleanGameMarkup(english[preferred]).replace(/:\s*$/u, '').trim()}: ${translated}`;
    }
  }
  const exact = Object.keys(local).find(id => !local[id].includes('{') && tidy(local[id]) === tidy(clean) && english[id]);
  if (exact) return cleanGameMarkup(english[exact]);
  for (const entry of rules.templates) {
    const match = entry.local.re.exec(cleanGameMarkup(line));
    if (!match) continue;
    const slots = new Map(entry.local.indices.map((id, i) => [id, match[i + 1]]));
    const translated = fillGameTemplate(entry.english, slots);
    if (translated !== undefined) return translateFragments(translated, rules.fragments);
  }
  return translateFragments(line, rules.fragments);
}

function englishModHeader(line, locale) {
  const { packs } = gameLocaleRegistry();
  const local = packs[locale]?.clientStringsById ?? {};
  const english = packs.en?.clientStringsById ?? {};
  let body = line.trim().slice(1, -1).trim();
  const dash = body.indexOf('—');
  const tags = dash >= 0 ? body.slice(dash) : '';
  if (dash >= 0) body = body.slice(0, dash).trim();
  let tier = '';
  for (const id of ['ModDescriptionLineTierLevel', 'ModDescriptionLineRankLevel', 'ModDescriptionLineTier', 'ModDescriptionLineRank', 'ModDescriptionLineLevel']) {
    if (!local[id] || !english[id]) continue;
    const compiled = compileGameTemplate(local[id].trim(), false, false);
    const match = compiled.re.exec(body); if (!match) continue;
    const slots = new Map(compiled.indices.map((index, n) => [index, match[n + 1]]));
    tier = (fillGameTemplate(english[id], slots) ?? '').replace(/, Lvl: \d+/u, '').replace(/\(Lvl: \d+\)/u, '');
    body = body.replace(match[0], '').trim(); break;
  }
  const translate = (text, depth = 0) => {
    if (depth > 3) return text;
    for (const id of ['ModDescriptionLineCrafted', 'ModDescriptionLineFractured', 'ModDescriptionLineDesecrated', 'ModDescriptionLinePrefix', 'ModDescriptionLineSuffix']) {
      if (!local[id] || !english[id]) continue;
      const compiled = compileGameTemplate(local[id]);
      const match = compiled.re.exec(text); if (!match) continue;
      const slots = new Map(compiled.indices.map((index, n) => [index, /(?:Crafted|Fractured|Desecrated)$/u.test(id) ? translate(match[n + 1], depth + 1) : match[n + 1]]));
      return fillGameTemplate(english[id], slots) ?? text;
    }
    return translateFragments(text, structure(locale).fragments);
  };
  return `{ ${translate(body)}${tier}${tags ? ` ${translateFragments(tags, structure(locale).fragments)}` : ''} }`;
}

function translateFragments(line, fragments) {
  const choices = fragments.filter(([text]) => line.includes(text));
  if (!choices.length) return line;
  const values = new Map(choices.map(([local, english]) => [local, english]));
  const expression = choices.map(([local]) => {
    const boundary = /^[\p{L}\p{N}]/u.test(local) && /[\p{L}\p{N}]$/u.test(local) && /[A-Za-zÀ-žА-я]/u.test(local);
    return boundary ? `(?<![\\p{L}\\p{N}])${escape(local)}(?![\\p{L}\\p{N}])` : escape(local);
  }).join('|');
  return line.replace(new RegExp(expression, 'gu'), text => values.get(text) ?? text);
}

/** Names are intentionally not translated here, so the original display remains available. */
export function normalizeItemStructure(raw, locale) {
  const lines = raw.replace(/^﻿/u, '').split(/\r?\n/u);
  let inHead = true;
  return lines.map(original => {
    const line = original.trim();
    if (/^-{8}$/u.test(line)) { inHead = false; return line; }
    const english = englishStructuralLine(line, locale);
    if (inHead && !/^(?:Item Class|Rarity):/u.test(english) && !/cannot use this item/u.test(english)) return line;
    const structuralLine = inHead || /^[{]|^[^:{}]+[:：]|^(?:Corrupted|Twice Corrupted|Unidentified|Mirrored|Sanctified|Fractured Item|Desecrated|Currently has|[+−-]?\d.*Levels? from)/u.test(english);
    if (!structuralLine) return line;
    const unidentified = /^Unidentified\s*\([^\d)]*(\d+)[^\d)]*\)$/u.exec(english);
    if (unidentified) return `Unidentified (Tier ${unidentified[1]})`;
    return english.replace(/：/g, ':').replace(/−/g, '-').replace(/\d+(?:(?:[.,  ])\d+| [0-9]{3})+/gu, n => String(gameNumber(n, locale)));
  }).join('\n');
}
