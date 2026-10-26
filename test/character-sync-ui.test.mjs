import assert from 'node:assert/strict';
import { test } from 'node:test';
import { characterSyncSettings } from '../ui/character-sync.js';

function fixture(t, handleAction = async () => ({ ok: true, enabled: true, phase: 'ready', revision: 1 })) {
  class Control {
    constructor() { this.options = []; this.value = ''; this.checked = false; this.disabled = false; this.textContent = ''; this.listeners = {}; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    trigger(type) { return Promise.all((this.listeners[type] ?? []).map(fn => fn({ target: this }))); }
    replaceChildren() { this.options = []; this.value = ''; }
    add(option) { this.options.push(option); if (this.options.length === 1) this.value = option.value; }
  }
  const controls = Object.fromEntries(['sync-enabled','sync-character','sync-interval','sync-list','sync-now','sync-file','sync-status'].map(id => [id, new Control()]));
  controls['sync-interval'].options = [60,120,300,600].map(value => ({ value: String(value), textContent: '' }));
  const previous = { document: globalThis.document, Option: globalThis.Option };
  globalThis.document = { getElementById: id => controls[id] };
  globalThis.Option = class { constructor(text, value) { this.textContent = text; this.value = value; } };
  t.after(() => { for (const key of Object.keys(previous)) { if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key]; } });
  const status = { enabled: false, intervalSeconds: 120, phase: 'off', revision: 0, character: 'Character A' };
  const context = { available: true, signedIn: true, file: 'C:/Builds/test.xml', unsaved: false,
    suggestedCharacter: 'Character A', characters: [{ name: 'Character A', id: 'a', level: 38, league: 'Test' }, { name: 'Character B', id: 'b', level: 40, league: 'Test' }] };
  const controller = characterSyncSettings({ locale: () => 'en', t: key => key,
    api: async (route, body) => route.includes('/context') ? { ok: true, ...context }
      : body === undefined ? { ok: true, ...status } : handleAction(route, body) });
  return { controls, controller, status, context };
}

test('unchanged live context preserves option nodes instead of rebuilding an open character menu', async t => {
  const f = fixture(t); await f.controller.load();
  const options = [...f.controls['sync-character'].options];
  await f.controller.load();
  assert.equal(f.controls['sync-character'].options[1], options[1]);
});

test('routine context updates preserve the character the user is choosing', async t => {
  const f = fixture(t); await f.controller.load();
  f.controls['sync-character'].value = 'Character B';
  await f.controls['sync-character'].trigger('change');
  await f.controller.load();
  assert.equal(f.controls['sync-character'].value, 'Character B');
});

test('unchanged status leaves the interval menu captions untouched', async t => {
  const f = fixture(t); await f.controller.load(); let writes = 0;
  for (const option of f.controls['sync-interval'].options) {
    let text = option.textContent;
    Object.defineProperty(option, 'textContent', { get: () => text, set: value => { writes++; text = value; } });
  }
  f.controller.render(); await f.controller.load();
  assert.equal(writes, 0);
});

test('the switch shows its requested state while the save is pending and remains operable afterward', async t => {
  let finish; const f = fixture(t, () => new Promise(resolve => { finish = resolve; }));
  await f.controller.load(); f.controls['sync-enabled'].checked = true;
  const pending = f.controls['sync-enabled'].trigger('change');
  assert.equal(f.controls['sync-enabled'].checked, true);
  finish({ ok: true, enabled: true, intervalSeconds: 120, phase: 'ready', revision: 1 }); await pending;
  assert.equal(f.controls['sync-enabled'].checked, true);
  assert.equal(f.controls['sync-enabled'].disabled, false);
});

test('a failed request restores usable controls and a useful status without rejecting the UI event', async t => {
  const f = fixture(t, async () => { throw Error('connection interrupted'); }); await f.controller.load();
  f.controls['sync-enabled'].checked = true;
  await assert.doesNotReject(f.controls['sync-enabled'].trigger('change'));
  assert.equal(f.controls['sync-enabled'].disabled, false);
  assert.equal(f.controls['sync-enabled'].checked, false);
  assert.equal(f.controls['sync-status'].textContent, 'syncError');
});

test('an unsaved build explains the pause after later routine refreshes too', async t => {
  const f = fixture(t, async () => ({ ok: false, error: { code: 'UNSAVED' } }));
  f.context.unsaved = true; await f.controller.load();
  f.controls['sync-enabled'].checked = true; await f.controls['sync-enabled'].trigger('change');
  await f.controller.load();
  assert.equal(f.controls['sync-status'].textContent, 'syncUnsaved');
});

test('a rate-limited character list reload keeps the loaded characters and explains the limit', async t => {
  const f = fixture(t); await f.controller.load();
  f.context.reloadError = 'RATE_LIMITED';
  await f.controls['sync-list'].trigger('click');
  assert.equal(f.controls['sync-character'].options.length, 3);
  assert.equal(f.controls['sync-status'].textContent, 'syncRateLimited');
});
