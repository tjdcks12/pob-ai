import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { listenHttp } from '../src/service/http-port.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-auto-update-'));
process.env.POB_AI_HOME = path.join(root, 'state');
const { createAutomaticUpdater } = await import('../src/update/automatic.mjs');
const { installedUpdate, VERSION } = await import('../src/update/updater.mjs');
const { updateConfig } = await import('../src/state.mjs');
const { LOCAL } = await import('../src/commands/local.mjs');
const next = VERSION.replace(/\d+$/, n => String(Number(n) + 1));
let server, endpoint, zip, downloads = 0, corrupt = false;
before(async () => {
  const app = path.join(root, 'stage', 'PoB AI');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'pob-ai', version: next }));
  const file = path.join(root, 'app.zip');
  execFileSync(path.join(process.env.SystemRoot || 'C:/Windows', 'System32/tar.exe'), ['-a', '-c', '-f', file, '-C', path.dirname(app), 'PoB AI']);
  zip = fs.readFileSync(file);
  server = http.createServer((req, res) => {
    if (req.url === '/latest.json') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ version: next, url: 'app.zip', size: zip.length, sha256: corrupt ? '0'.repeat(64) : createHash('sha256').update(zip).digest('hex') }));
    }
    downloads++; res.setHeader('content-length', zip.length); res.end(zip);
  });
  await listenHttp(server);
  endpoint = `http://127.0.0.1:${server.address().port}`;
  process.env.POB_AI_UPDATE_URL = endpoint + '/latest.json';
});
after(() => { server?.close(); fs.rmSync(root, { recursive: true, force: true }); });
function reset(tag, automatic = true) {
  process.env.POB_AI_HOME = path.join(root, tag);
  updateConfig({ autoDownloadUpdates: automatic });
  corrupt = false;
}

test('automatic download prepares a verified update once and never restarts a running conversation', async () => {
  reset('automatic');
  const states = [], before = downloads;
  const updater = createAutomaticUpdater({ autoStart: false, onChange: state => states.push(state) });
  try {
    await Promise.all([updater.check(true), updater.check(true)]);
    assert.equal(downloads - before, 1, 'concurrent checks share the same download');
    assert.equal(updater.state.phase, 'ready');
    assert.equal(installedUpdate().version, next);
    assert.ok(states.some(state => state.phase === 'downloading' && state.progress?.received === zip.length));
    assert.equal(updater.state.restartNeeded, true, 'applying remains an explicit user action');
    assert.equal(states.some(state => state.restarting), false);
  } finally { updater.close(); }
});

test('automatic downloads can be disabled while manual download remains available', async () => {
  reset('manual', false);
  const before = downloads;
  const updater = createAutomaticUpdater({ autoStart: false });
  try {
    await updater.check(true);
    assert.equal(updater.state.phase, 'available');
    assert.equal(downloads, before);
    await updater.download();
    assert.equal(updater.state.phase, 'ready');
    assert.equal(downloads, before + 1);
  } finally { updater.close(); }
});

test('an update already prepared stays ready after an offline check and can be applied without another download', async () => {
  const offline = async () => { throw new Error('offline'); };
  const updater = createAutomaticUpdater({ autoStart: false, fetchImpl: offline });
  try {
    assert.equal(updater.state.phase, 'ready');
    await assert.rejects(updater.check(true), /offline/);
    assert.equal(updater.state.phase, 'ready');
    const before = downloads;
    const result = await LOCAL.updateApply({}, { service: { update: updater.state, updates: updater } });
    assert.equal(result.result.restartNeeded, true);
    assert.equal(downloads, before);
    const restart = LOCAL.restart;
    let restarts = 0;
    try {
      LOCAL.restart = async () => { restarts++; return { target: 'app', result: { restarting: true } }; };
      const restarted = await LOCAL.updateApply({ restart: true }, { service: { update: updater.state, updates: updater } });
      assert.equal(restarted.result.restarting, true);
      assert.equal(restarts, 1, 'an already-downloaded update still restarts when explicitly applied');
      assert.equal(downloads, before);
    } finally { LOCAL.restart = restart; }
  } finally { updater.close(); }
});

test('checksum failures leave a retryable state and no installed pointer or partial download', async () => {
  reset('corrupt'); corrupt = true;
  const updater = createAutomaticUpdater({ autoStart: false });
  try {
    await assert.rejects(updater.check(true), { code: 'DOWNLOAD_CORRUPT' });
    assert.equal(updater.state.phase, 'error');
    assert.equal(installedUpdate(), null);
    const folder = path.join(process.env.POB_AI_HOME, 'app/downloads');
    assert.deepEqual(fs.readdirSync(folder), []);
    corrupt = false;
    await updater.download();
    assert.equal(updater.state.phase, 'ready');
  } finally { updater.close(); }
});

test('the periodic updater discovers releases without requiring an app restart', async () => {
  reset('periodic');
  const updater = createAutomaticUpdater({ autoStart: false, intervalMs: 20 });
  try {
    const deadline = Date.now() + 3000;
    while (updater.state?.phase !== 'ready' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(updater.state.phase, 'ready');
  } finally { updater.close(); }
});

test('the service persists automatic-download preferences and exposes prepared updates to both panels', async () => {
  reset('service-preference', false);
  const { createService } = await import('../src/service/server.mjs');
  const service = await createService({ port: 0, log: () => {} });
  const request = async (route, body) => fetch(new URL(route, service.url), { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + service.token, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }).then(r => r.json());
  try {
    await service.updates.check(true);
    let status = await request('/api/status');
    assert.equal(status.version, VERSION);
    assert.equal(status.settings.autoDownloadUpdates, false);
    assert.equal(status.update.phase, 'available');
    const reply = await request('/api/run', { command: 'update.automatic', args: { enabled: true } });
    assert.equal(reply.ok, true);
    await service.updates.check(true);
    status = await request('/api/status');
    assert.equal(status.settings.autoDownloadUpdates, true);
    assert.equal(status.update.phase, 'ready');
    const config = JSON.parse(fs.readFileSync(path.join(process.env.POB_AI_HOME, 'config.json'), 'utf8'));
    assert.equal(config.autoDownloadUpdates, true);
  } finally { service.close(); }
});
