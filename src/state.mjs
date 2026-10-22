// Per-user data folder: settings, the headless session build, logs and the service address.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function stateDir() {
  const dir = process.env.POB_AI_HOME
    || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'pob-ai');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const statePath = (...parts) => path.join(stateDir(), ...parts);

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

/** Writes through a temporary file so readers never see half a document. */
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}

export const readConfig = () => readJson(statePath('config.json'), {});
export function updateConfig(patch) {
  const next = { ...readConfig(), ...patch };
  writeJson(statePath('config.json'), next);
  return next;
}
