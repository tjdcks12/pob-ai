// ui/tokens.css is read by the panel and by the PoB window (adapter/live/tokens.lua), so its
// format is fixed: one `--name: value;` per line, #rrggbb colours, the same names in every palette.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { THEMES } from '../ui/themes.js';

const css = fs.readFileSync(new URL('../ui/tokens.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const block = selector => {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `${selector} block`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
};
const dark = block(':root, [data-theme="dark"]');
const light = block('[data-theme="light"]');
const palettes = Object.fromEntries(THEMES.filter(id => id !== 'pob').map(id => [id, block(`[data-theme="${id}"]`)]));

test('all palettes define the same tokens', () => {
  for (const [id, palette] of Object.entries(palettes)) assert.deepEqual(Object.keys(palette).sort(), Object.keys(dark).sort(), id);
});

test('colours are #rrggbb and sizes are px', () => {
  for (const theme of Object.values(palettes)) {
    for (const [name, value] of Object.entries(theme)) {
      if (name === 'font' || name === 'mono') continue;
      assert.match(value, /^(#[0-9a-f]{6}|\d+px)$/i, `--${name}: ${value}`);
    }
  }
});

test('new palettes keep small text and primary actions readable', () => {
  const luminance = hex => {
    const rgb = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
  for (const id of ['ocean', 'forest', 'sand']) {
    const p = palettes[id];
    for (const fg of ['fg', 'fg-2', 'fg-3']) for (const bg of ['bg', 'surface', 'surface-inner', 'table-alt']) {
      assert.ok(ratio(p[fg], p[bg]) >= 4.5, `${id} ${fg} on ${bg}`);
    }
    for (const bg of ['primary', 'primary-strong']) assert.ok(ratio(p['on-primary'], p[bg]) >= 4.5, `${id} primary action`);
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
