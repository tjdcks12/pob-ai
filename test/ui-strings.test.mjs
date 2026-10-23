// Every panel string exists in all ten languages, and the page uses dialogs instead of
// expanding sections.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
globalThis.navigator ??= { languages: ['en'] };
globalThis.document ??= { documentElement: {} };
const { STRINGS, LOCALES } = await import('../ui/i18n.js');
const html = fs.readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');

test('all ten languages have every string', () => {
  assert.equal(Object.keys(LOCALES).length, 10);
  for (const locale of Object.keys(LOCALES)) {
    for (const key of Object.keys(STRINGS.en)) assert.ok(String(STRINGS[locale]?.[key] ?? '').trim(), `${locale}.${key}`);
    for (const key of Object.keys(STRINGS[locale])) assert.ok(key in STRINGS.en, `${locale}.${key} is not an English key`);
  }
});

test('the console-free launcher provides recovery text in the same ten languages', () => {
  const strings = JSON.parse(fs.readFileSync(new URL('../desktop/launcher-strings.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(strings).sort(), Object.keys(LOCALES).sort());
  for (const row of Object.values(strings)) assert.ok(row.length === 3 && row.every(text => typeof text === 'string' && text.trim()));
});

test('the page and the script only use known strings', () => {
  const keys = new Set([...html.matchAll(/data-(?:i18n|title|placeholder|suggest)="([^"]+)"/g)].map(m => m[1]));
  for (const m of app.matchAll(/\bt\('([A-Za-z0-9]+)'\)/g)) keys.add(m[1]);
  for (const key of keys) assert.ok(key in STRINGS.en, key);
});

test('settings and history are dialogs, nothing expands in place', () => {
  assert.doesNotMatch(html, /<details|class="drawer"/);
  assert.doesNotMatch(app, /<details/);
  assert.match(html, /<dialog id="settings-dialog"/);
  assert.match(html, /<dialog id="history-dialog"/);
  assert.match(html, /<template id="settings-template">\s*<dialog id="settings-dialog"/);
  assert.doesNotMatch(html, /id="open-settings"/, 'the agent header has no general settings button');
});
