// PoB AI self-update and PoB installation against a local release server (no internet).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-update-'));
process.env.POB_AI_HOME = home;
delete process.env.POB_PATH;
const { applyUpdate, checkForUpdate, compareVersions, installedUpdate, VERSION } = await import('../src/update/updater.mjs');
const { installPob } = await import('../src/pob/install.mjs');
const { locatePob } = await import('../src/pob/locate.mjs');

const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const serveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-serve-'));
const zipFolder = (folder, name, zip) => execFileSync(tar, ['-a', '-c', '-f', zip, '-C', folder, name]);
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
let server;
let base;
const next = VERSION.replace(/\d+$/, n => String(Number(n) + 1));

before(async () => {
  // A newer "release": just the files the updater checks.
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-stage-'));
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
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
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
after(() => server?.close());

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
