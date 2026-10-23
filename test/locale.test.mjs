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

test('the panel uses the service language and ignores an old independent browser preference', () => {
  saved.set('pobai.locale', 'en');
  document.documentElement.dataset.language = 'ja';
  assert.equal(detectLocale(), 'ja');
  setLocale('ja');
  assert.equal(locale(), 'ja');
  setLocale('system');
  assert.equal(locale(), 'ko');
  assert.equal(document.documentElement.dataset.language, 'system');
  assert.equal(saved.get('pobai.locale'), 'en', 'legacy browser data is neither the authority nor rewritten');
  assert.equal(writes, 0);
});

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-locale-'));
process.env.POB_AI_HOME = home;
after(() => fs.rmSync(home, { recursive: true, force: true }));

test('the PoB language command remembers system mode and applies the resolved system language', async () => {
  const { LOCAL } = await import('../src/commands/local.mjs');
  const { systemLocale } = await import('../src/i18n/system-locale.mjs');
  const applied = [];
  const events = [];
  const runtime = { liveConnected: true, service: { windowLanguage: async language => { applied.push(language); return { entries: 1 }; },
    broadcast: (event, data) => events.push({ event, ...data }) } };
  await LOCAL.windowLanguage({ language: 'en' }, runtime);
  const { result } = await LOCAL.windowLanguage({ language: 'system' }, runtime);
  assert.deepEqual(applied, ['en', systemLocale()]);
  assert.equal(result.preference, 'system');
  assert.equal(result.language, systemLocale());
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'config.json'))).pobLanguage, 'system');
  assert.deepEqual(events.at(-1), { event: 'language', preference: 'system', language: systemLocale() });
});

test('a failed PoB language change preserves the shared preference and does not notify panels', async () => {
  const { LOCAL } = await import('../src/commands/local.mjs');
  const { updateConfig, readConfig } = await import('../src/state.mjs');
  updateConfig({ pobLanguage: 'ja' });
  const events = [];
  await assert.rejects(LOCAL.windowLanguage({ language: 'ko' }, { liveConnected: true, service: {
    windowLanguage: async () => { throw new Error('PoB unavailable'); }, broadcast: event => events.push(event),
  } }));
  assert.equal(readConfig().pobLanguage, 'ja');
  assert.deepEqual(events, []);
});

test('the shared language reaches open panels, new settings windows and a restarted service', async () => {
  const { createService } = await import('../src/service/server.mjs');
  const { updateConfig } = await import('../src/state.mjs');
  updateConfig({ pobLanguage: 'en', lastUpdateCheck: Date.now() });
  let service = await createService({ port: 0, log: () => {} });
  const abort = new AbortController();
  try {
    const endpoint = route => new URL(route, service.url);
    const headers = { authorization: 'Bearer ' + service.token, 'content-type': 'application/json' };
    const stream = await fetch(endpoint('/api/events'), { headers, signal: abort.signal });
    const reader = stream.body.getReader();
    await reader.read();
    const result = await fetch(endpoint('/api/run'), { method: 'POST', headers,
      body: JSON.stringify({ command: 'ui.language', args: { language: 'ja' } }) }).then(r => r.json());
    assert.equal(result.ok, true);
    assert.equal(result.result.applied, false);
    assert.match(new TextDecoder().decode((await reader.read()).value), /event: language\ndata: {"preference":"ja","language":"ja"}/);
    for (const route of ['/', '/?view=settings']) assert.match(await fetch(endpoint(route)).then(r => r.text()), /data-language="ja"/);
    abort.abort(); service.close();
    service = await createService({ port: 0, log: () => {} });
    const status = await fetch(new URL('/api/status', service.url), { headers: { authorization: 'Bearer ' + service.token } }).then(r => r.json());
    assert.equal(status.settings.pobLanguage, 'ja');
    assert.equal(status.settings.pobLanguageResolved, 'ja');
    assert.match(await fetch(new URL('/', service.url)).then(r => r.text()), /data-language="ja"/);
  } finally { abort.abort(); service.close(); }
});
