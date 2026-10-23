import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { matchLocale, resolveLocale } from '../ui/locale.js';

const saved = new Map();
let writes = 0;
globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => { writes++; saved.set(key, value); } };
Object.defineProperty(globalThis, 'navigator', { value: { languages: ['en-US'] }, configurable: true });
globalThis.document = { documentElement: { dataset: { systemLocale: 'ko' } } };
const { detectLocale, locale, localePreference, setLocale } = await import('../ui/i18n.js');
assert.equal(writes, 0, 'detecting the initial language must not save an override');

beforeEach(() => {
  saved.clear(); writes = 0;
  document.documentElement.dataset.systemLocale = 'ko';
  setLocale('system', { remember: false });
});

test('system language is mapped to the ten supported locales with an English fallback', () => {
  const cases = { 'en-GB': 'en', 'ko-KR': 'ko', 'ja-JP': 'ja', 'zh-Hant-TW': 'zh-Hant', 'zh-HK': 'zh-Hant', 'zh-MO': 'zh-Hant',
    'ru-RU': 'ru', 'de-DE': 'de', 'fr-FR': 'fr', 'es-MX': 'es', 'pt-PT': 'pt-BR', 'th-TH': 'th', 'sv-SE': 'en', 'zh-CN': 'en' };
  for (const [system, expected] of Object.entries(cases)) assert.equal(matchLocale([system]), expected, system);
  assert.equal(resolveLocale('en', 'ko-KR'), 'en', 'an explicit preference wins');
  assert.equal(resolveLocale('system', 'ko-KR'), 'ko');
});

test('a fresh panel follows Windows display language instead of the browser language without saving it', () => {
  assert.equal(detectLocale(), 'ko');
  assert.equal(locale(), 'ko');
  assert.equal(localePreference(), 'system');
  assert.equal(writes, 0);
  document.documentElement.dataset.systemLocale = 'ja';
  setLocale(localePreference(), { remember: false });
  assert.equal(locale(), 'ja', 'automatic mode can follow a later system language');
  assert.equal(writes, 0);
});

test('manual language choices persist, and returning to system mode stores the preference rather than its resolved language', () => {
  setLocale('en');
  assert.equal(detectLocale(), 'en');
  assert.equal(saved.get('pobai.locale'), 'en');
  setLocale('system');
  assert.equal(locale(), 'ko');
  assert.equal(saved.get('pobai.locale'), 'system');
  setLocale('system', { remember: false });
  assert.equal(writes, 2, 'syncing another window must not rewrite its preference');
});

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-locale-'));
process.env.POB_AI_HOME = home;
after(() => fs.rmSync(home, { recursive: true, force: true }));

test('the PoB language command remembers system mode and applies the resolved system language', async () => {
  const { LOCAL } = await import('../src/commands/local.mjs');
  const { systemLocale } = await import('../src/i18n/system-locale.mjs');
  const applied = [];
  const runtime = { liveConnected: true, service: { windowLanguage: async language => { applied.push(language); return { entries: 1 }; } } };
  await LOCAL.windowLanguage({ language: 'en' }, runtime);
  const { result } = await LOCAL.windowLanguage({ language: 'system' }, runtime);
  assert.deepEqual(applied, ['en', systemLocale()]);
  assert.equal(result.preference, 'system');
  assert.equal(result.language, systemLocale());
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'config.json'))).pobLanguage, 'system');
});
