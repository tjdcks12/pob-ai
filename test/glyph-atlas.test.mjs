// Service side of the PoB window font: which font draws each character, what the window may ask
// for, the bundled font files, and (on Windows) a real atlas page drawn by text-renderer.ps1.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-atlas-'));
process.env.POB_AI_HOME = home;
const { FONT_DIR, GlyphAtlas, atlasRequest, fontsFor, rendererJob } = await import('../src/live/glyph-atlas.mjs');
after(() => fs.rmSync(home, { recursive: true, force: true }));

test('Pretendard draws Latin, Cyrillic, Hangul and kana first', () => {
  for (const c of ['A', 'ж', '한', 'あ']) assert.equal(fontsFor(c)[0], 'Pretendard', c);
});

test('Thai and Han come from fonts that have them, in the forms of the window language', () => {
  assert.equal(fontsFor('ที่')[0], 'Leelawadee UI');
  assert.equal(fontsFor('體', 'ja')[0], 'Yu Gothic UI');
  assert.equal(fontsFor('あ', 'ja')[0], 'Yu Gothic UI', 'kana with the kanji in Japanese');
  assert.equal(fontsFor('體', 'zh')[0], 'Microsoft JhengHei UI');
  assert.equal(fontsFor('體', 'base')[0], 'Malgun Gothic');
  // Every list ends with the same fallbacks, without repeats.
  for (const list of [fontsFor('A'), fontsFor('體', 'ja'), fontsFor('ก')]) {
    assert.equal(new Set(list).size, list.length);
    assert.ok(list.includes('Pretendard') && list.includes('Leelawadee UI') && list.includes('Yu Gothic UI'));
  }
});

test('glyph requests from the window are checked', () => {
  const ok = { face: 'regular', px: 16, group: 'base', clusters: ['a', '가'] };
  assert.deepEqual(atlasRequest(ok), ok);
  for (const bad of [{ ...ok, face: 'italic' }, { ...ok, px: 0 }, { ...ok, px: 16.5 }, { ...ok, px: 999 }, { ...ok, group: 'xx' },
    { ...ok, clusters: [] }, { ...ok, clusters: ['a', 3] }, { ...ok, clusters: ['x'.repeat(33)] }, null]) {
    assert.equal(atlasRequest(bad), null, JSON.stringify(bad));
  }
});

test('the renderer gets the em size and baseline for the line height', () => {
  const job = rendererJob({ face: 'bold', px: 16, group: 'ja', clusters: ['a', '日'] }, 'out.png');
  assert.equal(job.bold, true);
  assert.equal(job.em, 14);
  assert.equal(job.baseline, 13);
  assert.equal(job.glyphs[1].fonts[0], 'Yu Gothic UI');
});

test('the Pretendard fonts ship unmodified with their licence', () => {
  for (const name of ['Pretendard-Regular.ttf', 'Pretendard-Bold.ttf']) {
    const head = fs.readFileSync(path.join(FONT_DIR, name)).subarray(0, 4);
    assert.equal(head.readUInt32BE(0), 0x00010000, `${name} is a TrueType font (GDI+ cannot read CFF)`);
  }
  const license = fs.readFileSync(path.join(FONT_DIR, 'Pretendard-LICENSE.txt'), 'utf8');
  assert.match(license, /SIL Open Font License, Version 1\.1/);
  assert.match(license, /Reserved Font Name Pretendard/);
});

test('an atlas page is drawn and then read from the cache', { skip: process.platform !== 'win32' && 'Windows only (GDI+)', timeout: 60000 }, async () => {
  const atlas = new GlyphAtlas();
  try {
    const request = { kind: 'glyphs', face: 'regular', px: 24, group: 'base', clusters: ['A', 'g', ' ', '생', 'Ж', 'ที่', '體'] };
    const page = await atlas.render(request);
    assert.ok(fs.statSync(page.path).size > 100, 'a PNG');
    assert.equal(page.glyphs.length, request.clusters.length);
    for (const [x, y, w, h, ox, oy, advance] of page.glyphs) {
      assert.ok(x >= 0 && y >= 0 && x + w <= page.w && y + h <= page.h, 'inside the page');
      assert.ok(ox < 0 && oy < 0, 'the cell has room around the glyph');
      assert.ok(advance >= 0);
    }
    const advance = c => page.glyphs[request.clusters.indexOf(c)][6];
    assert.ok(advance('생') > advance('A') && advance('A') > advance(' '));
    const started = Date.now();
    const again = await atlas.render(request);
    assert.deepEqual(again, page);
    assert.ok(Date.now() - started < 1000, 'from the cache');
    await assert.rejects(atlas.render({ ...request, px: -1 }), /Bad glyph request/);
  } finally { atlas.close(); }
});
