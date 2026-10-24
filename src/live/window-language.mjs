// PoB window translation, service side: builds the phrase dictionary for a language. The window
// draws the translations through its glyph atlas (adapter/live/translate.lua, glyph-atlas.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { loadTerms } from '../i18n/terms.mjs';
import { cleanGameMarkup } from '../items/localization.mjs';
import { statePath, writeJson } from '../state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const gameText = new Map();

function windowPack(locale) {
  if (gameText.has(locale)) return gameText.get(locale);
  const dir = path.join(ROOT, 'data/window-game-text');
  const source = JSON.parse(fs.readFileSync(path.join(dir, 'source.json'), 'utf8'));
  const bytes = fs.readFileSync(path.join(dir, `${locale}.json.gz`));
  if (createHash('sha256').update(bytes).digest('hex') !== source.locales[locale]?.sha256) throw Error(`Invalid window game text: ${locale}`);
  const pack = JSON.parse(gunzipSync(bytes));
  gameText.set(locale, pack);
  return pack;
}

const clean = text => cleanGameMarkup(text).replace(/\\n/g, '\n').replace(/\r/g, '').trim();
const slots = text => [...text.matchAll(/\{(\d*)(?::([^}]*))?\}/g)].map((m, i) => ({ start: m.index, length: m[0].length, index: m[1] ? Number(m[1]) : i, signed: m[2]?.startsWith('+') ?? false }));
const signature = variant => JSON.stringify([variant.conditions, variant.handlers.filter(h => !['canonical_line', 'canonical_stat'].includes(h.name)).sort((a, b) => a.index - b.index || a.name.localeCompare(b.name))]);
const escapeLua = text => text.replace(/[%^$().[\]*+?\-]/g, '%$&');

/** Match display values as text: a rolled range must never be evaluated or rounded. */
function template(en, local) {
  const input = slots(en), output = slots(local);
  if (!input.length || input.length > 8 || !/[a-z]{3}/i.test(en.replace(/\{[^}]*\}/g, ''))) return null;
  if (output.some(s => !input.some(v => v.index === s.index && v.signed === s.signed)) || input.some(s => !output.some(v => v.index === s.index))) return null;
  let pattern = '^', end = 0;
  for (const s of input) {
    pattern += escapeLua(en.slice(end, s.start));
    pattern += `()(${s.signed ? '[%+%-]' : '%-?'}[%d%(][%d%.,%(%)%+%-]*)()`;
    end = s.start + s.length;
  }
  pattern += escapeLua(en.slice(end)) + '$';
  const parts = [];
  end = 0;
  for (const s of output) {
    parts.push(local.slice(end, s.start), s.index);
    end = s.start + s.length;
  }
  parts.push(local.slice(end));
  return { pattern, slots: input.map(s => s.index), parts, bucket: en.match(/^[A-Za-z]+/)?.[0] ?? '#' };
}

// Exact phrases plus numeric display templates. Game text joins on stable IDs, conditions and
// value handlers; UI translations override exact labels. Unresolved meanings stay in English.
function buildLanguage(locale) {
  const templates = new Map();
  const entries = {};
  const add = (en, local) => {
    if (typeof en !== 'string' || typeof local !== 'string') return;
    const key = clean(en), value = clean(local);
    if (!key || !value || key === value || !/[a-z]/i.test(key) || /\{\d*(?::[^}]*)?\}/.test(key + value)) return;
    entries[key] = value;
  };
  const phrases = new Map();
  const pair = (en, local, priority = 0) => {
    if (typeof en !== 'string' || typeof local !== 'string') return;
    en = clean(en); local = clean(local);
    if (!en || !local || !/[a-z]/i.test(en)) return;
    let phrase = phrases.get(en);
    if (phrase && phrase.priority > priority) return;
    if (!phrase || phrase.priority < priority) phrase = { priority, values: new Set() };
    phrase.values.add(local); phrases.set(en, phrase);
  };
  const enFull = windowPack('en'), full = windowPack(locale);
  for (const table of ['clientStringsById', 'flavourById']) {
    for (const [id, en] of Object.entries(enFull[table])) {
      // UI labels and item flavour, excluding dialogue and long quest prose.
      if (table === 'flavourById' || en.length <= 120) pair(en, full[table][id]);
      // PoB's FlavourText.lua also emits one AddLine per official source line. Join those
      // only when the game's two paragraphs have the same line count; never zip unequal lists.
      if (table === 'flavourById' && full[table][id]) {
        const a = clean(en).split('\n'), b = clean(full[table][id]).split('\n');
        if (a.length === b.length && a.length > 1) a.forEach((line, i) => pair(line, b[i]));
      }
    }
  }
  const descriptions = new Map(full.statTemplates.map(d => [d.id, d]));
  for (const description of enFull.statTemplates) {
    const local = descriptions.get(description.id);
    if (!local) continue;
    for (const variant of description.variants) {
      if (variant.tableOnly || variant.unsupportedHandlers.length) continue;
      for (const translated of local.variants) {
        // Shared item descriptions take precedence over passive-only typography (e.g. Chinese
        // '+X Intelligence' with/without the word 'points'). Conflicts within a domain still fail closed.
        if (!translated.tableOnly && !translated.unsupportedHandlers.length && signature(variant) === signature(translated)) pair(variant.text, translated.text, description.source === 'data/statdescriptions/stat_descriptions.csd' ? 2 : 1);
      }
    }
  }
  for (const [en, { values }] of phrases) {
    // Capitalization alone is not a meaning conflict (the French local/global damage CSDs).
    if (new Set([...values].map(value => value.toLowerCase())).size !== 1) continue;
    const local = [...values].sort()[0];
    const rule = template(en, local);
    if (rule && en !== local) templates.set(en, rule);
    else add(en, local);
  }

  const terms = loadTerms(locale);
  const en = loadTerms('en');
  if (terms) {
    for (const [enName, local] of Object.entries(terms.names)) add(enName, local);
    for (const [id, lines] of Object.entries(terms.passives)) {
      const enLines = en.passives[id];
      if (!enLines) continue;
      lines.forEach((line, i) => add(enLines[i], line));
    }
  }
  const uiFile = path.join(ROOT, 'data', 'ui', `${locale}.json`);
  if (fs.existsSync(uiFile)) for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(uiFile, 'utf8')))) add(k, v);
  // Different English templates may compile to the same pattern; keep only an agreed output.
  const patterns = new Map();
  for (const rule of templates.values()) {
    const previous = patterns.get(rule.pattern);
    if (previous === undefined) patterns.set(rule.pattern, rule);
    else if (previous && JSON.stringify([previous.parts, previous.slots]) !== JSON.stringify([rule.parts, rule.slots])) patterns.set(rule.pattern, null);
  }
  return { entries, templates: [...patterns.values()].filter(Boolean) };
}

export function buildDictionary(locale) { return buildLanguage(locale).entries; }

export function writeDictionary(locale) {
  const file = statePath('window-language', `${locale}.json`);
  const { entries, templates } = buildLanguage(locale);
  writeJson(file, { locale, entries, templates });
  return { file: file.split(path.sep).join('/'), count: Object.keys(entries).length };
}
