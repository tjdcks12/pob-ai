import assert from 'node:assert/strict';
import test from 'node:test';
import { localizeResult, normalizeLocale, searchLocalized, toEnglish } from '../src/i18n/terms.mjs';
import { translateArgs } from '../src/runtime.mjs';

test('locales normalise', () => {
  assert.equal(normalizeLocale('ko-KR'), 'ko');
  assert.equal(normalizeLocale('zh-TW'), 'zh-Hant');
  assert.equal(normalizeLocale('pt'), 'pt-BR');
  assert.equal(normalizeLocale('xx'), null);
});

test('localized names map back to what PoB reads', () => {
  assert.deepEqual(toEnglish('태풍의 정수', 'passive'), { english: 'Essence of the Storm', ids: [36479], locale: 'ko' });
  assert.equal(toEnglish('전기불꽃', 'name').english, 'Spark');
  assert.equal(toEnglish('タビュラ・ラサ', 'name').english, 'Tabula Rasa');
  assert.equal(toEnglish('Spark'), null);
});

test('arguments are translated per command', () => {
  assert.deepEqual(translateArgs('tree.allocate', { node: '태풍의 정수' }), { node: '36479' });
  assert.deepEqual(translateArgs('skills.add', { gems: ['전기불꽃', 'Arc'] }), { gems: ['Spark', 'Arc'] });
  assert.deepEqual(translateArgs('build.rename', { name: '내 빌드' }), { name: '내 빌드' });
  const search = translateArgs('tree.search', { text: '태풍' });
  assert.equal(search.text, '');
  assert.ok(search.match.includes('36479'));
});

test('results gain localized names', () => {
  const out = localizeResult({ mainSkill: 'Spark', class: 'Ranger', node: { id: 36479, name: 'Essence of the Storm', stats: ['x'] },
    notables: ['Essence of the Storm'], uniques: [{ name: 'Tabula Rasa, Garment' }] }, 'ko');
  assert.equal(out.mainSkill_ko, '전기불꽃');
  assert.equal(out.class_ko, '레인저');
  assert.equal(out.node.name_ko, '태풍의 정수');
  assert.equal(out.node.stats_ko.length, 2);
  assert.deepEqual(out.notables_ko, ['태풍의 정수']);
  assert.match(out.uniques[0].name_ko, /^타뷸라 라사, /);
  assert.ok(searchLocalized('번개', 'name').names.length > 0);
});
