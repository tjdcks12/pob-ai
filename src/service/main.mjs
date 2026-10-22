// Entry point: `node src/service/main.mjs [--open] [--no-browser]`
// Starts the local service, optionally opens the PoB window and the agent panel.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { statePath } from '../state.mjs';
import { createService } from './server.mjs';

const argv = new Set(process.argv.slice(2));
fs.mkdirSync(statePath('logs'), { recursive: true });
const logFile = fs.createWriteStream(statePath('logs', 'service.log'), { flags: 'a' });
const log = line => {
  const stamped = `${new Date().toISOString()} ${line}`;
  logFile.write(`${stamped}\n`);
  if (!argv.has('--quiet')) process.stderr.write(`${stamped}\n`);
};

const service = await createService({ log });
log(`PoB AI service on ${service.url.replace(/token=.*/, 'token=…')}`);

if (argv.has('--open')) {
  try { service.openPob(); } catch (error) { log(`Could not open PoB: ${error.message}`); }
}
if (!argv.has('--no-browser')) openPanel(service.url);

function openPanel(url) {
  // An app-mode window looks like a desktop panel; fall back to the default browser.
  const edge = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p));
  const child = edge
    ? spawn(edge, [`--app=${url}`, '--window-size=460,900', `--user-data-dir=${statePath('panel-profile')}`], { detached: true, stdio: 'ignore' })
    : spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' });
  child.unref();
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { service.close(); process.exit(0); });
