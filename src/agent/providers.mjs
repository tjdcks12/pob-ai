// Detects the AI coding agents the user already has installed and signed in to.
// POB_AI_CLAUDE / POB_AI_CODEX point at a specific executable when it is not on PATH.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function which(name) {
  try {
    const out = execFileSync('where.exe', [name], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const lines = out.split(/\r?\n/).filter(Boolean);
    return lines.find(l => l.toLowerCase().endsWith('.exe')) ?? lines[0] ?? null;
  } catch { return null; }
}

function firstExisting(paths) { return paths.find(p => p && fs.existsSync(p)) ?? null; }

const home = os.homedir();
const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');

export const PROVIDERS = {
  claude: {
    label: 'Claude Code',
    find: () => firstExisting([process.env.POB_AI_CLAUDE, path.join(home, '.local', 'bin', 'claude.exe'), which('claude'), path.join(appData, 'npm', 'claude.cmd')]),
  },
  codex: {
    label: 'Codex',
    find: () => firstExisting([process.env.POB_AI_CODEX, which('codex'), path.join(appData, 'npm', 'codex.cmd')]),
  },
};

let cache = null;
export function detectProviders({ refresh = false } = {}) {
  if (cache && !refresh) return cache;
  cache = Object.entries(PROVIDERS).map(([id, p]) => {
    const command = p.find();
    return { id, label: p.label, available: Boolean(command), command };
  });
  return cache;
}
