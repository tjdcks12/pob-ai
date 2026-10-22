// Starts the newest PoB AI on this computer: the copy this file belongs to, or a newer one that
// `pob update apply` unpacked into the data folder. Keep this file small and stable: it is the
// one part of the folder the user unzipped that never gets replaced.
//   node launcher.mjs [service options]      (what "PoB AI.cmd" runs)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.POB_AI_HOME || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'pob-ai');
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const parts = v => String(v).split('.').map(n => parseInt(n, 10) || 0);
const newer = (a, b) => { const [x, y] = [parts(a), parts(b)]; for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0); return false; };

let appDir = here;
const own = read(path.join(here, 'package.json'))?.version ?? '0.0.0';
const update = read(path.join(dataDir, 'app', 'current.json'));
if (update?.dir && newer(update.version, own) && fs.existsSync(path.join(update.dir, 'src', 'service', 'main.mjs'))) appDir = update.dir;

const bundledNode = path.join(appDir, 'runtime', 'node', 'node.exe');
const node = fs.existsSync(bundledNode) ? bundledNode : process.execPath;
const child = spawn(node, [path.join(appDir, 'src', 'service', 'main.mjs'), ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, POB_AI_LAUNCHER: fileURLToPath(import.meta.url) },
});
child.on('exit', code => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
