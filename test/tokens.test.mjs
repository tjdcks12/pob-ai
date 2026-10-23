// ui/tokens.css is read by the panel and by the PoB window (adapter/live/tokens.lua), so its
// format is fixed: one `--name: value;` per line, #rrggbb colours, the same names in both themes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const css = fs.readFileSync(new URL('../ui/tokens.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const block = selector => {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `${selector} block`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
};
const dark = block(':root, [data-theme="dark"]');
const light = block('[data-theme="light"]');

test('both themes define the same tokens', () => {
  assert.deepEqual(Object.keys(light).sort(), Object.keys(dark).sort());
});

test('colours are #rrggbb and sizes are px', () => {
  for (const theme of [dark, light]) {
    for (const [name, value] of Object.entries(theme)) {
      if (name === 'font' || name === 'mono') continue;
      assert.match(value, /^(#[0-9a-f]{6}|\d+px)$/i, `--${name}: ${value}`);
    }
  }
});

test('the PoB window finds every token it uses', () => {
  for (const name of ['bg', 'surface', 'surface-inner', 'surface-hover', 'divider', 'line', 'fg', 'fg-2', 'fg-3', 'fg-4',
    'primary', 'primary-soft', 'primary-line', 'primary-text', 'red', 'ok', 'radius', 'radius-small', 'titlebar-h', 'titlebar-btn-w']) {
    assert.ok(dark[name], `--${name}`);
  }
});

test('one declaration per line', () => {
  for (const line of css.split('\n')) assert.ok((line.match(/--[\w-]+\s*:/g) ?? []).length <= 1, line);
});
