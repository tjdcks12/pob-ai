// PoB window translation, service side: builds the phrase dictionary for a language. The window
// draws the translations through its glyph atlas (adapter/live/translate.lua, glyph-atlas.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { loadTerms } from '../i18n/terms.mjs';
import { statePath, writeJson } from '../state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');

function itemPack(locale) {
  const dir = path.join(ROOT, 'data', 'items', 'locales');
  const file = fs.readdirSync(dir).find(n => n.startsWith(`${locale}.`) && n.endsWith('.json.gz'));
  return file ? JSON.parse(gunzipSync(fs.readFileSync(path.join(dir, file)))).pack : null;
}

/**
 * English phrase -> phrase in `locale`. Sources, later ones winning: game client strings with the
 * same English text, official item/skill/class names, passive names and passive stat lines, and
 * PoB's own interface text (data/ui/<locale>.json, written for PoB AI).
 */
export function buildDictionary(locale) {
  const entries = {};
  const add = (en, local) => {
    if (typeof en !== 'string' || typeof local !== 'string') return;
    const key = en.trim();
    if (!key || key === local || !/[a-z]/i.test(key) || /\{\d\}|%/.test(key) || /\{\d\}/.test(local)) return;
    entries[key] = local.trim();
  };
  const enPack = itemPack('en');
  const pack = itemPack(locale);
  if (enPack && pack) {
    for (const [id, text] of Object.entries(enPack.clientStringsById ?? {})) {
      if (text.length <= 48 && !text.includes('\n')) add(text, pack.clientStringsById?.[id]);
    }
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
  return entries;
}

export function writeDictionary(locale) {
  const file = statePath('window-language', `${locale}.json`);
  const entries = buildDictionary(locale);
  writeJson(file, { locale, entries });
  return { file: file.split(path.sep).join('/'), count: Object.keys(entries).length };
}
