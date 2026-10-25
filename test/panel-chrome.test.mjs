import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = fs.readFileSync(new URL('../ui/window.js', import.meta.url), 'utf8').replace(/^import .*;$/m, '').replaceAll('export function ', 'function ');
function fixture({ desktop = true, search = '' } = {}) {
  const messages = [], receivers = [], elements = new Map();
  const element = () => ({ hidden: true, dataset: {}, attributes: {}, title: '', onclick: null,
    setAttribute(key, value) { this.attributes[key] = value; },
    querySelector() { return this; }, addEventListener(name, listener) { this.onclick = listener; },
  });
  for (const id of ['window-maximize', 'window-minimize', 'window-close', 'window-dock']) elements.set(id, element());
  const controls = element();
  const window = { dispatchEvent() {}, chrome: desktop ? { webview: { postMessage: value => messages.push(value), addEventListener: (_, listener) => receivers.push(listener) } } : undefined };
  const context = vm.createContext({ window, document: { documentElement: { dataset: {} }, getElementById: id => elements.get(id), querySelector: () => controls }, location: { search }, URLSearchParams, t: key => key, getComputedStyle: () => ({ getPropertyValue: () => '#171b23' }), Event });
  vm.runInContext(source, context);
  return { context, messages, elements, controls, receive: data => receivers.forEach(listener => listener({ data })) };
}

test('native toggle changes docking through the host and reflects confirmed state without reloading the chat', () => {
  const f = fixture();
  const toggle = f.elements.get('window-dock');
  assert.equal(toggle.hidden, false);
  toggle.onclick();
  assert.deepEqual(f.messages, ['window:dock']);
  f.receive({ kind: 'window-state', maximized: false, docked: true, attached: true });
  assert.equal(toggle.attributes['aria-checked'], 'true');
  assert.equal(toggle.attributes['aria-label'], 'dockPanel', 'switch name stays stable');
  assert.equal(toggle.title, 'undockPanel');
  assert.equal(f.controls.hidden, true, 'the shared PoB frame owns minimize, maximize and close');
  assert.equal(f.context.document.documentElement.dataset.dock, 'attached');
  f.receive({ kind: 'window-state', maximized: false, docked: true, attached: false });
  assert.equal(toggle.attributes['aria-checked'], 'true');
  assert.equal(toggle.title, 'dockWaiting');
  assert.equal(f.controls.hidden, false, 'waiting is still a usable independent window');
  f.receive({ kind: 'window-state', maximized: false, docked: false, attached: false });
  assert.equal(toggle.attributes['aria-checked'], 'false');
  assert.equal(toggle.title, 'dockPanel');
});

test('only connected, valid process identities reach the native docking target', () => {
  const f = fixture();
  f.context.setPobWindow({ connected: true, pid: 1234 });
  for (const live of [{ connected: false, pid: 1234 }, { connected: true, pid: '1234' }, { connected: true, pid: -5 }, null]) f.context.setPobWindow(live);
  assert.deepEqual(f.messages, ['pob:1234', 'pob:0', 'pob:0', 'pob:0', 'pob:0']);
});

test('browser and separate settings windows do not offer a native agent docking toggle', () => {
  const browser = fixture({ desktop: false });
  browser.context.setPobWindow({ connected: true, pid: 1234 });
  assert.equal(browser.elements.get('window-dock').hidden, true);
  assert.deepEqual(browser.messages, []);
  assert.equal(fixture({ search: '?view=settings' }).elements.get('window-dock').hidden, true);
});
