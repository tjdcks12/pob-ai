// Official trade site lists the Korean route of convertItemText needs: stat texts from both realms
// (stat ids are shared, so Korean text -> id -> English text) and both item lists (unique names).
// Responses are cached on disk so conversion keeps working offline or when a site is down.
import fs from 'node:fs';
import { statePath } from '../state.mjs';
import path from 'node:path';
import { gemNamesFromTrade, uniqueNamesFromTrade } from './convert.mjs';

// poe.game.daum.net/api/trade2/... answers with a 301 to the same path on poe.kakaogames.com.
export const TRADE_SOURCES = {
  statsKo: 'https://poe.kakaogames.com/api/trade2/data/stats',
  statsEn: 'https://www.pathofexile.com/api/trade2/data/stats',
  itemsKo: 'https://poe.kakaogames.com/api/trade2/data/items',
  itemsEn: 'https://www.pathofexile.com/api/trade2/data/items',
};
export const TRADE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const { version } = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
// GGG asks API clients to identify themselves in the User-Agent.
export const USER_AGENT = `pob-ai/${version} (Path of Building item text converter; trade2 data lists only)`;

export function defaultTradeCacheDir() {
  return statePath('cache', 'trade');
}

/** Stat list -> lookup by type and text. An entry is also filed under its group id when that differs (runes: group "rune", type "augment"). */
export function buildStatIndex(stats) {
  const byType = new Map();
  const textById = new Map();
  const put = (type, text, id) => {
    const byText = byType.get(type) ?? new Map();
    const ids = byText.get(text) ?? [];
    if (!ids.includes(id)) ids.push(id);
    byText.set(text, ids);
    byType.set(type, byText);
  };
  for (const group of stats.result) {
    for (const e of group.entries) {
      const type = e.type || group.id;
      put(type, e.text, e.id);
      if (group.id && group.id !== type) put(group.id, e.text, e.id);
      if (!textById.has(e.id)) textById.set(e.id, e.text);
    }
  }
  return { byType, textById };
}

export class TradeDataError extends Error {
  constructor(name, url, cause) {
    super(`Could not get ${name} (${url}) and there is no cached copy: ${cause?.message ?? cause}`, { cause });
    this.name = 'TradeDataError';
  }
}

const isList = data => Array.isArray(data?.result);

function readCached(file) {
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    return typeof cached.fetchedAt === 'number' && isList(cached.data) ? cached : undefined;
  } catch { return undefined; }
}

/** Through a temporary file so a concurrent reader never sees half a document. */
function writeCached(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value));
  fs.renameSync(temp, file);
}

/**
 * Downloads (or reads from cache) the four lists and returns the data convertItemText takes as
 * `options.trade`: { ko, en, uniques, skills, warnings }.
 * A cached list younger than maxAgeMs is used without a request. An older one is refreshed, and kept
 * when the download fails. Stat lists are required; item lists only add unique names, so their
 * absence is a warning (uniques then convert as "Unique Item").
 */
export async function loadTradeData({ cacheDir = defaultTradeCacheDir(), maxAgeMs = TRADE_MAX_AGE_MS, fetch = globalThis.fetch, userAgent = USER_AGENT, now = Date.now } = {}) {
  const warnings = [];
  const get = async (name, required) => {
    const url = TRADE_SOURCES[name];
    const file = path.join(cacheDir, `${name}.json`);
    const cached = readCached(file);
    if (cached && now() - cached.fetchedAt < maxAgeMs) return cached.data;
    try {
      const response = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!isList(data)) throw new Error('unexpected response shape');
      writeCached(file, { fetchedAt: now(), url, data });
      return data;
    } catch (error) {
      if (cached) {
        warnings.push(`${name}: refresh failed (${error.message}); using the copy from ${new Date(cached.fetchedAt).toISOString()}`);
        return cached.data;
      }
      if (required) throw new TradeDataError(name, url, error);
      warnings.push(`${name}: not available (${error.message}); unique names will not be translated`);
      return undefined;
    }
  };
  const [statsKo, statsEn, itemsKo, itemsEn] = await Promise.all([get('statsKo', true), get('statsEn', true), get('itemsKo', false), get('itemsEn', false)]);
  const items = itemsKo && itemsEn;
  return {
    ko: buildStatIndex(statsKo),
    en: buildStatIndex(statsEn).textById,
    uniques: items ? uniqueNamesFromTrade(itemsKo, itemsEn) : new Map(),
    skills: items ? gemNamesFromTrade(itemsKo, itemsEn) : new Map(),
    warnings,
  };
}
