// Official game names in ten languages (data/terms). PoB itself only knows English names, so
// results get localized companions (`name_ko`) and localized input is mapped back to English.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

export const TERM_LOCALES = ['en', 'ko', 'ja', 'zh-Hant', 'ru', 'de', 'fr', 'es', 'pt-BR', 'th'];
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/terms');
const cache = new Map();

/** Accepts ko, ko-KR, zh-TW, pt … and returns a supported locale or null. */
export function normalizeLocale(value) {
  if (!value) return null;
  const v = String(value).trim();
  if (/^zh[-_](tw|hk|hant)/i.test(v)) return 'zh-Hant';
  if (/^pt/i.test(v)) return 'pt-BR';
  const base = v.split(/[-_]/)[0].toLowerCase();
  return TERM_LOCALES.includes(base) ? base : null;
}

export function loadTerms(locale) {
  if (cache.has(locale)) return cache.get(locale);
  const file = path.join(DIR, `${locale}.json.gz`);
  if (!fs.existsSync(file)) return null;
  const doc = JSON.parse(gunzipSync(fs.readFileSync(file)));
  const en = locale === 'en' ? doc : loadTerms('en');
  // English passive name -> localized name (first id wins; repeated small nodes share names).
  const passiveNames = {};
  for (const [id, [name]] of Object.entries(doc.passives)) {
    const enName = en.passives[id]?.[0];
    if (enName && name && !(enName in passiveNames)) passiveNames[enName] = name;
  }
  const terms = { ...doc, passiveNames };
  cache.set(locale, terms);
  return terms;
}

const NAME_KEYS = new Set(['name', 'base', 'mainSkill', 'class', 'ascendancy', 'item', 'mine', 'other', 'displayLabel', 'label', 'imported', 'notable', 'removed']);
const NAME_LIST_KEYS = new Set(['keystones', 'notables', 'ascendancyNodes', 'added', 'removed', 'activeSkills', 'onlyMine', 'onlyOther', 'candidates']);

/** Adds `<key>_<locale>` next to every English game name it recognises. Returns a new value. */
export function localizeResult(value, locale) {
  if (!locale || locale === 'en') return value;
  const terms = loadTerms(locale);
  if (!terms) return value;
  const en = loadTerms('en');
  const single = text => terms.names[text] ?? terms.passiveNames[text];
  // PoB lists uniques as "Name, Base".
  const lookup = text => {
    if (typeof text !== 'string') return undefined;
    const direct = single(text);
    if (direct) return direct;
    const parts = text.split(', ');
    if (parts.length === 2 && single(parts[0])) return `${single(parts[0])}, ${single(parts[1]) ?? parts[1]}`;
    return undefined;
  };
  const walk = node => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out = {};
    for (const [key, child] of Object.entries(node)) {
      out[key] = walk(child);
      if (NAME_KEYS.has(key) && typeof child === 'string') {
        const local = lookup(child);
        if (local && local !== child) out[`${key}_${locale}`] = local;
      }
      if (NAME_LIST_KEYS.has(key) && Array.isArray(child) && child.every(c => typeof c === 'string')) {
        const local = child.map(c => lookup(c) ?? c);
        if (local.some((l, i) => l !== child[i])) out[`${key}_${locale}`] = local;
      }
    }
    // Passive nodes: name and stat lines in the user's language, by node id.
    if (typeof node.id === 'number' && terms.passives[node.id] && en.passives[node.id]?.[0] === node.name) {
      const [name, ...stats] = terms.passives[node.id];
      out[`name_${locale}`] = name;
      if (Array.isArray(node.stats)) out[`stats_${locale}`] = stats;
    }
    return out;
  };
  return walk(value);
}

const nonAscii = text => /[^\x00-\x7f]/.test(text);

/**
 * Maps a localized name back to what PoB understands. Passive names become node ids (several
 * nodes share some names; PoB AI picks among them). Returns null when nothing matches.
 */
export function toEnglish(text, kind = 'any') {
  if (typeof text !== 'string' || !nonAscii(text)) return null;
  const wanted = text.trim().toLowerCase();
  const en = loadTerms('en');
  for (const locale of TERM_LOCALES.slice(1)) {
    const terms = loadTerms(locale);
    if (!terms) continue;
    if (kind === 'any' || kind === 'passive') {
      const ids = Object.entries(terms.passives).filter(([, [name]]) => name?.toLowerCase() === wanted).map(([id]) => id);
      if (ids.length) return { english: en.passives[ids[0]][0], ids: ids.map(Number), locale };
    }
    if (kind === 'any' || kind === 'name') {
      for (const [enName, local] of Object.entries(terms.names)) {
        if (local.toLowerCase() === wanted) return { english: enName, locale };
      }
    }
  }
  return null;
}

/** Localized search text -> English names and passive ids whose localized name or text contains it. */
export function searchLocalized(text, kind = 'any') {
  if (typeof text !== 'string' || !nonAscii(text)) return null;
  const wanted = text.trim().toLowerCase();
  const en = loadTerms('en');
  const names = new Set();
  const ids = new Set();
  for (const locale of TERM_LOCALES.slice(1)) {
    const terms = loadTerms(locale);
    if (!terms) continue;
    if (kind === 'any' || kind === 'passive') {
      for (const [id, lines] of Object.entries(terms.passives)) {
        if (lines.some(l => l?.toLowerCase().includes(wanted))) ids.add(Number(id));
      }
    }
    if (kind === 'any' || kind === 'name') {
      for (const [enName, local] of Object.entries(terms.names)) if (local.toLowerCase().includes(wanted)) names.add(enName);
    }
    if (names.size || ids.size) break;
  }
  return { names: [...names], ids: [...ids], englishPassives: [...ids].map(id => en.passives[id]?.[0]).filter(Boolean) };
}
