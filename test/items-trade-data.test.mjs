// Trade list download and cache rules, with a fake fetch and a temporary cache folder.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { convertItemText } from '../src/items/convert.mjs';
import { loadTradeData, TRADE_SOURCES, TradeDataError } from '../src/items/trade-data.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/items/convert.fixture.json', import.meta.url), 'utf8'));
const S = JSON.parse(fs.readFileSync(new URL('./fixtures/items/samples-ko.json', import.meta.url), 'utf8'));
const BODIES = { statsKo: fixture.statsKo, statsEn: fixture.statsEn, itemsKo: fixture.itemsKo, itemsEn: fixture.itemsEn };
const nameOf = url => Object.keys(TRADE_SOURCES).find(name => TRADE_SOURCES[name] === url);
const HOUR = 60 * 60 * 1000;

/** Fake fetch: records requests; `fail` names lists that answer HTTP 503. */
function fakeFetch(fail = []) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ name: nameOf(url), userAgent: init.headers['User-Agent'] });
    if (fail.includes(nameOf(url))) return new Response('down', { status: 503 });
    return Response.json(BODIES[nameOf(url)]);
  };
  return { fetch, calls };
}

let cacheDir;
beforeEach(() => { cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pob-ai-trade-')); });
afterEach(() => fs.rmSync(cacheDir, { recursive: true, force: true }));

describe('loadTradeData', () => {
  it('downloads the four lists with a descriptive User-Agent, caches them, and the result converts Korean', async () => {
    const { fetch, calls } = fakeFetch();
    const trade = await loadTradeData({ cacheDir, fetch });
    assert.deepEqual(calls.map(c => c.name).sort(), ['itemsEn', 'itemsKo', 'statsEn', 'statsKo']);
    assert.ok(calls.every(c => /^pob-ai\/\S+ \(/.test(c.userAgent)));
    assert.deepEqual(fs.readdirSync(cacheDir).sort(), ['itemsEn.json', 'itemsKo.json', 'statsEn.json', 'statsKo.json']);
    assert.deepEqual(trade.warnings, []);
    assert.equal(trade.uniques.get('마법사의 피'), 'Mageblood');
    const r = convertItemText(S.MAGES_BLOOD, { trade });
    assert.equal(r.status, 'ok');
    assert.ok(r.text.includes('Mageblood'));
  });

  it('uses a cache younger than 24 hours without any request', async () => {
    let now = Date.now();
    await loadTradeData({ cacheDir, fetch: fakeFetch().fetch, now: () => now });
    now += 23 * HOUR;
    const { fetch, calls } = fakeFetch();
    await loadTradeData({ cacheDir, fetch, now: () => now });
    assert.equal(calls.length, 0);
  });

  it('refreshes after 24 hours, and keeps the old copy with a warning when the site is down', async () => {
    let now = Date.now();
    await loadTradeData({ cacheDir, fetch: fakeFetch().fetch, now: () => now });
    now += 25 * HOUR;
    const offline = fakeFetch(['statsKo', 'statsEn', 'itemsKo', 'itemsEn']);
    const stale = await loadTradeData({ cacheDir, fetch: offline.fetch, now: () => now });
    assert.equal(offline.calls.length, 4);
    assert.equal(stale.warnings.length, 4);
    assert.match(stale.warnings[0], /refresh failed \(HTTP 503\); using the copy from/);
    assert.ok(stale.en.size > 0);
    const online = fakeFetch();
    await loadTradeData({ cacheDir, fetch: online.fetch, now: () => now });
    assert.equal(online.calls.length, 4);
    const saved = JSON.parse(fs.readFileSync(path.join(cacheDir, 'statsKo.json'), 'utf8'));
    assert.equal(saved.fetchedAt, now);
  });

  it('without a cache: missing stat lists fail, missing item lists only lose unique names', async () => {
    await assert.rejects(loadTradeData({ cacheDir, fetch: fakeFetch(['statsKo']).fetch }), TradeDataError);
    fs.rmSync(cacheDir, { recursive: true, force: true });
    const trade = await loadTradeData({ cacheDir, fetch: fakeFetch(['itemsEn']).fetch });
    assert.equal(trade.uniques.size, 0);
    assert.match(trade.warnings.join('\n'), /itemsEn: not available/);
    assert.equal(convertItemText(S.MAGES_BLOOD, { trade }).text.split('\r\n')[2], 'Unique Item');
  });
});
