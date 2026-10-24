// Entry point: `node src/service/main.mjs [--open] [--no-browser]`
// Starts the local service, optionally opens the PoB window and the agent panel.
import fs from 'node:fs';
import { listPobProcesses } from '../pob/processes.mjs';
import { statePath } from '../state.mjs';
import { callService, serviceInfo } from './client.mjs';
import { openPanel } from './panel.mjs';
import { createService } from './server.mjs';

const argv = new Set(process.argv.slice(2));
fs.mkdirSync(statePath('logs'), { recursive: true });
const logFile = fs.createWriteStream(statePath('logs', 'service.log'), { flags: 'a' });
const log = line => {
  const stamped = `${new Date().toISOString()} ${line}`;
  logFile.write(`${stamped}\n`);
  if (!argv.has('--quiet')) process.stderr.write(`${stamped}\n`);
};

// Started again while PoB AI already runs (e.g. "PoB AI.cmd" clicked twice): use that one
// and let this process end by itself.
const running = await serviceInfo();
if (running) {
  if (argv.has('--open')) await callService(running, 'open', {}).catch(error => log(`Could not open PoB: ${error.message}`));
  if (argv.has('--settings')) {
    await fetch(`http://127.0.0.1:${running.port}/api/settings/open`, { method: 'POST', headers: { authorization: `Bearer ${running.token}`, 'content-type': 'application/json' }, body: '{}' });
  } else if (!argv.has('--no-browser') || argv.has('--reopen-panel')) await openPanel(`http://127.0.0.1:${running.port}/?token=${running.token}`, { replace: argv.has('--reopen-panel') });
  logFile.end();
} else {
  await start();
}

async function start() {
  const service = await createService({ log });
  log(`PoB AI service on ${service.url.replace(/token=.*/, 'token=…')}`);

  if (argv.has('--open')) {
    try {
      // After a restart (an update) the PoB window that is still open reconnects within seconds.
      const attached = (await listPobProcesses(service.runtime.install()).catch(() => [])).some(p => p.shim);
      if (attached) await service.waitForPob(8000).catch(() => {});
      service.openPob();
    } catch (error) { log(`Could not open PoB: ${error.message}`); }
  }
  if (argv.has('--settings')) {
    await service.waitForPob(4000).catch(() => {});
    await service.openSettings();
  } else if (!argv.has('--no-browser') || argv.has('--reopen-panel')) await openPanel(service.url, { replace: argv.has('--reopen-panel') });

  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { service.close(); process.exit(0); });
}

