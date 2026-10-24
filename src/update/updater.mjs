// PoB AI self-update. A release is one zip (the same file people download the first time) plus a
// small manifest, latest.json: { version, url, sha256, size, notes }. Updates are unpacked into the
// data folder (app/<version>) and launcher.mjs starts the newest copy, so the folder the user
// unzipped once never has to be replaced. PoB itself is not part of this: it updates itself.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { readConfig, readJson, statePath, updateConfig, writeJson } from '../state.mjs';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKAGE = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8'));
export const VERSION = PACKAGE.version;
export const UPDATE_CHECK_MS = 30 * 60 * 1000;

/** Compares "1.2.3" style versions; returns <0, 0 or >0. */
export function compareVersions(a, b) {
  const pa = String(a).split(/[.+-]/).map(n => parseInt(n, 10) || 0);
  const pb = String(b).split(/[.+-]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** Where releases are announced: env, then settings, then the address baked into the release. */
export function updateUrl() {
  return process.env.POB_AI_UPDATE_URL || readConfig().updateUrl || PACKAGE.pobAi?.updateUrl || null;
}

/** The update installed into the data folder, if it is newer than this copy. */
export function installedUpdate() {
  const current = readJson(statePath('app', 'current.json'), null);
  if (!current?.version || !current.dir || !fs.existsSync(path.join(current.dir, 'package.json'))) return null;
  return compareVersions(current.version, VERSION) > 0 ? current : null;
}

async function fetchManifest(fetchImpl) {
  const url = updateUrl();
  if (!url) throw Object.assign(new Error('No update channel is configured for this copy of PoB AI.'), { code: 'NO_UPDATE_CHANNEL' });
  const response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Object.assign(new Error(`The update server answered ${response.status}.`), { code: 'UPDATE_CHECK_FAILED' });
  const manifest = await response.json();
  if (!/^\d+\.\d+\.\d+$/.test(manifest?.version ?? '') || !manifest.url || !/^[0-9a-f]{64}$/i.test(manifest.sha256 ?? '')
    || (manifest.size != null && (!Number.isSafeInteger(manifest.size) || manifest.size <= 0))) {
    throw Object.assign(new Error('The update manifest is incomplete.'), { code: 'UPDATE_CHECK_FAILED' });
  }
  return { ...manifest, url: new URL(manifest.url, url).href };
}

export async function checkForUpdate({ fetchImpl = fetch } = {}) {
  const manifest = await fetchManifest(fetchImpl);
  const installed = installedUpdate()?.version ?? VERSION;
  updateConfig({ lastUpdateCheck: Date.now() });
  return {
    current: VERSION,
    installed,
    latest: manifest.version,
    available: compareVersions(manifest.version, installed) > 0,
    restartNeeded: compareVersions(installed, VERSION) > 0,
    notes: manifest.notes ?? null,
    size: manifest.size ?? null,
  };
}

/** The service checks on startup and periodically while it remains open. */
export const updateCheckDue = () => Boolean(updateUrl()) && Date.now() - (readConfig().lastUpdateCheck ?? 0) >= UPDATE_CHECK_MS;

const tarExe = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');

/** Unpacks a zip with Windows' own tar (bsdtar reads zip files). */
export function extractZip(zip, dir) {
  fs.mkdirSync(dir, { recursive: true });
  return new Promise((resolve, reject) => {
    execFile(tarExe(), ['-xf', zip, '-C', dir], { windowsHide: true }, error => error
      ? reject(Object.assign(new Error(`Could not unpack ${path.basename(zip)}: ${error.message}`), { code: 'UNPACK_FAILED' }))
      : resolve(dir));
  });
}

/** A zip may hold the files directly or inside one top folder. */
export function packageRoot(dir, marker) {
  if (fs.existsSync(path.join(dir, marker))) return dir;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory());
  if (entries.length === 1 && fs.existsSync(path.join(dir, entries[0].name, marker))) return path.join(dir, entries[0].name);
  return null;
}

/** Downloads `url` to `file`, checking the size and SHA-256 when given. */
export async function download(url, file, { sha256, size, fetchImpl = fetch, onProgress = () => {} } = {}) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!response.ok) throw Object.assign(new Error(`Download failed (${response.status}): ${url}`), { code: 'DOWNLOAD_FAILED' });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const partial = `${file}.download`;
  const hash = createHash('sha256');
  let bytes = 0;
  const total = size || Number(response.headers.get('content-length')) || null;
  let lastProgress = 0;
  try {
    onProgress({ received: 0, total });
    await pipeline(Readable.fromWeb(response.body), async function* (chunks) {
      for await (const chunk of chunks) {
        hash.update(chunk); bytes += chunk.length;
        if (Date.now() - lastProgress >= 100) { lastProgress = Date.now(); onProgress({ received: bytes, total }); }
        yield chunk;
      }
    }, fs.createWriteStream(partial));
    const digest = hash.digest('hex');
    const fail = message => { throw Object.assign(new Error(message), { code: 'DOWNLOAD_CORRUPT' }); };
    if (size && bytes !== size) fail(`The download has ${bytes} bytes, expected ${size}.`);
    if (sha256 && digest.toLowerCase() !== sha256.toLowerCase()) fail('The download does not match its checksum.');
    fs.renameSync(partial, file);
    onProgress({ received: bytes, total: total ?? bytes });
    return { file, bytes, sha256: digest };
  } catch (error) {
    fs.rmSync(partial, { force: true });
    throw error;
  }
}

/** Downloads, verifies and unpacks the latest release; it is used from the next start. */
let updateJob;
export function applyUpdate(options = {}) {
  updateJob ??= installUpdate(options).finally(() => { updateJob = null; });
  return updateJob;
}
async function installUpdate({ fetchImpl = fetch, onProgress } = {}) {
  const manifest = await fetchManifest(fetchImpl);
  const installed = installedUpdate()?.version ?? VERSION;
  if (compareVersions(manifest.version, installed) <= 0) return { updated: false, current: VERSION, installed, latest: manifest.version, restartNeeded: compareVersions(installed, VERSION) > 0 };

  const appDir = statePath('app');
  const zip = path.join(appDir, 'downloads', `pob-ai-${manifest.version}.zip`);
  await download(manifest.url, zip, { sha256: manifest.sha256, size: manifest.size, fetchImpl, onProgress });
  const temp = path.join(appDir, `${manifest.version}.partial`);
  fs.rmSync(temp, { recursive: true, force: true });
  await extractZip(zip, temp);
  const root = packageRoot(temp, 'package.json');
  const unpacked = root && readJson(path.join(root, 'package.json'), null);
  if (unpacked?.name !== PACKAGE.name || unpacked.version !== manifest.version) {
    fs.rmSync(temp, { recursive: true, force: true });
    throw Object.assign(new Error('The downloaded release is not the announced PoB AI version.'), { code: 'DOWNLOAD_CORRUPT' });
  }
  const target = path.join(appDir, manifest.version);
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(root, target);
  fs.rmSync(temp, { recursive: true, force: true });
  fs.rmSync(zip, { force: true });
  writeJson(path.join(appDir, 'current.json'), { version: manifest.version, dir: target, installedAt: new Date().toISOString() });
  prune(appDir, [manifest.version, VERSION]);
  return { updated: true, current: VERSION, installed: manifest.version, dir: target.split(path.sep).join('/'), restartNeeded: true, notes: manifest.notes ?? null };
}

/** Keeps the new version and the one running now; older unpacked versions are removed. */
function prune(appDir, keep) {
  for (const entry of fs.readdirSync(appDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+\.\d+\.\d+/.test(entry.name) || keep.includes(entry.name)) continue;
    if (path.resolve(appDir, entry.name) === APP_ROOT) continue;
    fs.rmSync(path.join(appDir, entry.name), { recursive: true, force: true });
  }
}
