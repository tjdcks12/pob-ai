// PoB AI self-update and PoB installation against a local release server (no internet).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { listenHttp } from '../src/service/http-port.mjs';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-update-'));
process.env.POB_AI_HOME = home;
delete process.env.POB_PATH;
const { applyUpdate, checkForUpdate, compareVersions, download, installedUpdate, VERSION } = await import('../src/update/updater.mjs');
const { installPob } = await import('../src/pob/install.mjs');
const { locatePob } = await import('../src/pob/locate.mjs');

const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const serveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-serve-'));
const zipFolder = (folder, name, zip) => execFileSync(tar, ['-a', '-c', '-f', zip, '-C', folder, name]);
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
let server;
let base;
let stage;
const next = VERSION.replace(/\d+$/, n => String(Number(n) + 1));

before(async () => {
  // A newer "release": just the files the updater checks.
  stage = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-stage-'));
  fs.mkdirSync(path.join(stage, 'PoB AI', 'src', 'cli'), { recursive: true });
  fs.writeFileSync(path.join(stage, 'PoB AI', 'package.json'), JSON.stringify({ name: 'pob-ai', version: next }));
  fs.writeFileSync(path.join(stage, 'PoB AI', 'src', 'cli', 'main.mjs'), 'export const main = async () => 0;\n');
  zipFolder(stage, 'PoB AI', path.join(serveDir, 'app.zip'));
  // A PoB portable release.
  fs.mkdirSync(path.join(stage, 'pob'));
  for (const file of ['Path of Building-PoE2.exe', 'Launch.lua']) fs.writeFileSync(path.join(stage, 'pob', file), '');
  fs.writeFileSync(path.join(stage, 'pob', 'manifest.xml'), '<?xml version="1.0"?>\n<PoBVersion>\n\t<Version number="9.9.9" branch="master" platform="win32"/>\n</PoBVersion>\n');
  zipFolder(stage, 'pob', path.join(serveDir, 'PoB-Portable.zip'));

  server = http.createServer((req, res) => {
    const file = path.join(serveDir, req.url.slice(1));
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200);
    res.end(fs.readFileSync(file));
  });
  await listenHttp(server);
  base = `http://127.0.0.1:${server.address().port}`;
  const appZip = path.join(serveDir, 'app.zip');
  fs.writeFileSync(path.join(serveDir, 'latest.json'), JSON.stringify({ version: next, url: 'app.zip', sha256: sha(appZip), size: fs.statSync(appZip).size }));
  fs.writeFileSync(path.join(serveDir, 'bad.json'), JSON.stringify({ version: next, url: 'app.zip', sha256: '0'.repeat(64) }));
  const pobZip = path.join(serveDir, 'PoB-Portable.zip');
  fs.writeFileSync(path.join(serveDir, 'release.json'), JSON.stringify({ tag_name: 'v9.9.9', assets: [
    { name: 'PoB-Setup.exe', size: 1, browser_download_url: `${base}/missing` },
    { name: 'PoB-Portable.zip', size: fs.statSync(pobZip).size, browser_download_url: `${base}/PoB-Portable.zip` },
  ] }));
});
after(() => {
  server?.close();
  for (const dir of [home, serveDir, stage]) if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test('versions compare numerically', () => {
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.ok(compareVersions('1.2.3', '1.3.0') < 0);
});

test('without an update channel the check says so', async () => {
  delete process.env.POB_AI_UPDATE_URL;
  await assert.rejects(checkForUpdate(), { code: 'NO_UPDATE_CHANNEL' });
});

test('a download that does not match its checksum is rejected', async () => {
  process.env.POB_AI_UPDATE_URL = `${base}/bad.json`;
  await assert.rejects(applyUpdate(), { code: 'DOWNLOAD_CORRUPT' });
  assert.equal(installedUpdate(), null);
});

test('an interrupted download removes its partial file and can be retried', async () => {
  const file = path.join(home, 'interrupted.zip');
  const fetchImpl = async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array([1, 2, 3]));
    setTimeout(() => controller.error(new Error('connection lost')), 5);
  } }));
  await assert.rejects(download('https://example.invalid/app.zip', file, { fetchImpl }), /connection lost/);
  assert.equal(fs.existsSync(file + '.download'), false);
  assert.equal(fs.existsSync(file), false);
});

test('invalid version paths are rejected before any download or extraction', async () => {
  process.env.POB_AI_UPDATE_URL = `${base}/latest.json`;
  const fetchImpl = async () => new Response(JSON.stringify({ version: '../escape', url: 'app.zip', sha256: '1'.repeat(64) }));
  await assert.rejects(applyUpdate({ fetchImpl }), { code: 'UPDATE_CHECK_FAILED' });
});

test('a newer release is found, verified and unpacked into the data folder', async () => {
  process.env.POB_AI_UPDATE_URL = `${base}/latest.json`;
  const check = await checkForUpdate();
  assert.equal(check.available, true);
  assert.equal(check.latest, next);
  const applied = await applyUpdate();
  assert.equal(applied.updated, true);
  assert.equal(installedUpdate()?.version, next);
  assert.ok(fs.existsSync(path.join(home, 'app', next, 'package.json')));
  const again = await applyUpdate();
  assert.equal(again.updated, false);
});

test('PoB is installed from its portable release and remembered', async () => {
  process.env.POB_AI_POB_RELEASES = `${base}/release.json`;
  const result = await installPob();
  assert.equal(result.installed, true);
  assert.equal(result.version, '9.9.9');
  assert.equal(locatePob().source, 'config');
  assert.equal((await installPob()).alreadyInstalled, true);
});
