// Finds the user's Path of Building (PoE2) installation. Nothing in it is modified.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readConfig, stateDir } from '../state.mjs';

export const EXE_NAME = 'Path of Building-PoE2.exe';
const UNINSTALL_KEY = 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Path of Building Community (PoE2)';

/** Returns { dir, version, branch } when `dir` looks like a PoB PoE2 install, otherwise null. */
export function inspectInstall(dir) {
  if (!dir) return null;
  const required = [EXE_NAME, 'Launch.lua', 'manifest.xml'];
  if (!required.every(name => fs.existsSync(path.join(dir, name)))) return null;
  const manifest = fs.readFileSync(path.join(dir, 'manifest.xml'), 'utf8');
  const version = manifest.match(/<Version\b[^>]*\bnumber="([^"]+)"/)?.[1] ?? null;
  const branch = manifest.match(/<Version\b[^>]*\bbranch="([^"]+)"/)?.[1] ?? null;
  if (!/<PoBVersion>/.test(manifest)) return null;
  return { dir: path.resolve(dir), version, branch };
}

function registryInstallLocation() {
  try {
    const out = execFileSync('reg', ['query', UNINSTALL_KEY, '/v', 'InstallLocation'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const value = out.match(/InstallLocation\s+REG_\w+\s+(.+)/)?.[1]?.trim();
    return value?.replace(/^"|"$/g, '') || null;
  } catch { return null; }
}

/** Candidate folders in the same order the PoB launcher searches, after explicit settings. */
export function candidates() {
  const list = [];
  if (process.env.POB_PATH) list.push({ source: 'env', dir: process.env.POB_PATH });
  const configured = readConfig().pobPath;
  if (configured) list.push({ source: 'config', dir: configured });
  const registry = registryInstallLocation();
  if (registry) list.push({ source: 'registry', dir: registry });
  if (process.env.APPDATA) list.push({ source: 'appdata', dir: path.join(process.env.APPDATA, 'Path of Building Community (PoE2)') });
  return list;
}

/** Finds the first valid install. Throws a user-facing error when none is found. */
export function locatePob() {
  const tried = [];
  for (const candidate of candidates()) {
    const found = inspectInstall(candidate.dir);
    if (found) return { ...found, source: candidate.source };
    tried.push(`${candidate.source}: ${candidate.dir}`);
  }
  const error = new Error('Path of Building (PoE2) was not found. Run `pob setup "<PoB folder>"`, or `pob setup --install-pob` to install it.');
  error.code = 'POB_NOT_FOUND';
  error.details = { tried };
  throw error;
}

/**
 * LuaJIT's io and loadfile use the ANSI code page, so a folder name like "한글 POB" cannot be
 * opened by the headless engine. A directory junction gives the same folder an ASCII path.
 */
export function asciiPath(dir) {
  if (/^[\x20-\x7e]*$/.test(dir)) return dir;
  const links = path.join(stateDir(), 'links');
  fs.mkdirSync(links, { recursive: true });
  const link = path.join(links, `pob-${createHash('sha1').update(dir).digest('hex').slice(0, 10)}`);
  if (!/^[\x20-\x7e]*$/.test(link)) throw new Error(`The data folder needs an ASCII path: ${links}. Set POB_AI_HOME.`);
  if (fs.existsSync(link)) {
    if (fs.realpathSync(link) === fs.realpathSync(dir)) return link;
    fs.rmSync(link, { recursive: false, force: true });
  }
  fs.symlinkSync(dir, link, 'junction');
  return link;
}
