// Resolves a localized modifier line to its official stat description identity (CSD) and
// renders the English line from the same identity, honouring value handlers and conditions.
import { cleanGameMarkup, compileGameTemplate, gameLocale, gameLocaleRegistry, gameNumber } from './localization.mjs';

const matchers = new WeakMap();
const semantic = new Set(['canonical_line', 'canonical_stat']);

function transform(value, handler, inverse) {
  if (semantic.has(handler)) return value;
  if (handler === 'negate') return -value;
  if (handler === 'subtract_one') return value + (inverse ? 1 : -1);
  const divisor = handler === 'milliseconds_to_seconds' ? 1000
    : /^per_minute_to_per_second(?:_2dp(?:_if_required)?)?$/.test(handler) ? 60
    : handler === 'divide_by_one_hundred' ? 100
    : /^divide_by_ten(?:_1dp_if_required)?$/.test(handler) ? 10 : undefined;
  if (divisor === undefined) return undefined;
  const number = inverse ? value * divisor : value / divisor;
  return inverse ? Math.round(number * 1e9) / 1e9 : number;
}

function condition(value, token) {
  if (!token || token === '#') return true;
  if (token.startsWith('!')) return !condition(value, token.slice(1));
  const bounds = token.split('|');
  if (bounds.length === 2) return (bounds[0] === '#' || value >= Number(bounds[0])) && (bounds[1] === '#' || value <= Number(bounds[1]));
  return value === Number(token);
}

function prepare(locale) {
  const pack = gameLocale(locale); if (!pack) return [];
  const hit = matchers.get(pack); if (hit) return hit;
  const all = pack.statTemplates.flatMap(description => description.variants.map(variant => {
    const compiled = compileGameTemplate(variant.text.replace(/\\n/g, '\n'), true);
    return { description, variant, ...compiled };
  }));
  matchers.set(pack, all); return all;
}

function underlying(matcher, captures, locale) {
  const values = matcher.description.stats.map(() => undefined);
  matcher.indices.forEach((index, n) => {
    const value = gameNumber(captures[n + 1], locale);
    if (values[index] !== undefined && values[index] !== value) values[index] = NaN;
    else values[index] = value;
  });
  for (const handler of [...matcher.variant.handlers].reverse()) {
    if (semantic.has(handler.name)) continue;
    const value = values[handler.index];
    if (value === undefined) continue;
    values[handler.index] = transform(value, handler.name, true);
    if (values[handler.index] === undefined) return undefined;
  }
  for (let i = 0; i < values.length; i++) {
    if (values[i] === undefined && /^[-+]?\d+(?:\.\d+)?$/.test(matcher.variant.conditions[i] ?? '')) values[i] = Number(matcher.variant.conditions[i]);
    if (values[i] === undefined || !Number.isFinite(values[i]) || !condition(values[i], matcher.variant.conditions[i])) return undefined;
  }
  return values;
}

function render(variant, values) {
  if (variant.tableOnly || variant.unsupportedHandlers?.length) return undefined;
  if (!values.every((v, i) => condition(v, variant.conditions[i]))) return undefined;
  const displayed = [...values];
  for (const handler of variant.handlers) {
    const value = displayed[handler.index];
    if (value === undefined && semantic.has(handler.name)) continue;
    const next = transform(value, handler.name, false);
    if (next === undefined) return undefined;
    displayed[handler.index] = next;
  }
  let missing = false, implicit = 0;
  const text = cleanGameMarkup(variant.text).replace(/\\n/g, '\n').replace(/\{(\d*)(?::([^}]*))?\}/g, (_all, number, spec = '') => {
    const value = displayed[number ? Number(number) : implicit++];
    if (value === undefined) { missing = true; return ''; }
    const precision = /\.(\d+)f/.exec(spec)?.[1];
    const text = precision ? value.toFixed(Number(precision)) : String(Math.round(value * 1e9) / 1e9);
    return spec.startsWith('+') && value >= 0 ? `+${text}` : text;
  });
  return missing ? undefined : text;
}

/**
 * Resolve official stat identities first, then render English by identity and conditions.
 * Returns { status: resolved | ambiguous | unsupported, candidates, english?, englishValues? }.
 * Ambiguous candidates are never first-picked.
 */
export function canonicalStat(text, locale, context) {
  const clean = cleanGameMarkup(text).replace(/\s*\((?:augmented|implicit|rune|enchant|crafted|desecrated|fractured|mutated)\)\s*$/i, '').trim();
  const englishPack = gameLocale('en');
  if (!englishPack) return undefined;
  let hits = [];
  let unsupported = false;
  for (const matcher of prepare(locale)) {
    if (context && !context.relic && /sanctum_relic/u.test(matcher.description.source)) continue;
    const match = matcher.re.exec(clean); if (!match) continue;
    if (matcher.variant.tableOnly || matcher.variant.unsupportedHandlers?.length) { unsupported = true; continue; }
    const values = underlying(matcher, match, locale); if (!values) { unsupported = true; continue; }
    const exact = englishPack.statTemplates.filter(d => d.id === matcher.description.id);
    const same = exact.length ? exact : englishPack.statTemplates.filter(d => d.stats.join('\0') === matcher.description.stats.join('\0'));
    const options = same.flatMap(d => d.variants.flatMap(variant => {
      const text = render(variant, values);
      const specificity = variant.conditions.reduce((score, token) => score + (token === '#' ? 0 : /^[-+]?\d+(?:\.\d+)?$/.test(token) ? 4 : token.startsWith('!') ? 1 : 2), 0);
      return text === undefined ? [] : [{ text, specificity }];
    }));
    const best = Math.max(...options.map(option => option.specificity));
    const rendered = new Set(options.filter(option => option.specificity === best).map(option => option.text));
    const english = rendered.size === 1 ? [...rendered][0] : undefined;
    const candidate = { templateId: matcher.description.id, stats: matcher.description.stats, values, ...(english ? { english } : {}) };
    if (!hits.some(h => JSON.stringify([h.stats, h.values, h.english]) === JSON.stringify([candidate.stats, candidate.values, candidate.english]))) hits.push(candidate);
  }
  if (!hits.length) return unsupported ? { status: 'unsupported', candidates: [] } : undefined;
  if (context?.relic) {
    const relic = hits.filter(hit => hit.templateId.startsWith('sanctum_relic_'));
    if (relic.length) hits = relic;
  }
  if (context && hits.length > 1) {
    const statsById = gameLocaleRegistry().statsById;
    const local = h => h.stats.some(stat => statsById?.[stat]?.local || statsById?.[stat]?.weaponLocal);
    const eligible = hits.filter(h => context.local ? !h.stats.some(stat => statsById?.[stat]?.weaponLocal && !context.weapon) : !local(h));
    const preferred = context.local ? eligible.filter(local) : eligible;
    if (preferred.length) hits = preferred;
    else if (eligible.length) hits = eligible;
  }
  const identities = new Set(hits.map(h => JSON.stringify([h.stats, h.values])));
  const english = new Set(hits.map(h => h.english).filter(Boolean));
  if (identities.size !== 1 || english.size !== 1) return { status: 'ambiguous', candidates: hits };
  const rendered = [...english][0];
  // Separate number tokens, without guessing a cross-language ordinal correspondence.
  const values = [...rendered.matchAll(/(?<![\p{L}\p{N}])[-+]?\d+(?:\.\d+)?/gu)].map(m => Number(m[0]));
  return { status: 'resolved', candidates: hits, english: rendered, englishValues: values };
}
