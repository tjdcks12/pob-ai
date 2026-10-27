// Entry point: `node src/service/main.mjs [--open] [--no-browser]`
// Starts the local service, optionally opens the PoB window and the agent panel.
import fs from 'node:fs';
import { listPobProcesses } from '../pob/processes.mjs';
import { statePath } from '../state.mjs';
import { callService, serviceInfo } from './client.mjs';
import { closePreviousPanels, openPanel } from './panel.mjs';
import { createService } from './server.mjs';
import { upgradeRunningService } from './startup-upgrade.mjs';

const argv = new Set(process.argv.slice(2));
fs.mkdirSync(statePath('logs'), { recursive: true });
const logFile = fs.createWriteStream(statePath('logs', 'service.log'), { flags: 'a' });
const log = line => {
  const stamped = `${new Date().toISOString()} ${line}`;
  logFile.write(`${stamped}\n`);
  if (!argv.has('--quiet')) process.stderr.write(`${stamped}\n`);
};

// Reuse the same/newer service; a newer ZIP first asks the old service to apply its update.
let running = await serviceInfo();
if (running) {
  try { running = await upgradeRunningService(running, { log }); }
  catch (error) {
    log(`Could not update the running PoB AI: ${error.message}`);
    if (error.restartRequested) running = { ...running, restarted: true };
  }
}
if (running) {
  // The restart launcher already opens/reconnects PoB and replaces the panel. Repeating open
  // here while its bridge reconnects could create a second PoB window.
  if (argv.has('--open') && !running.restarted) await callService(running, 'open', {}).catch(error => log(`Could not open PoB: ${error.message}`));
  if (argv.has('--settings')) {
    await fetch(`http://127.0.0.1:${running.port}/api/settings/open`, { method: 'POST', headers: { authorization: `Bearer ${running.token}`, 'content-type': 'application/json' }, body: '{}' });
  } else if (!running.restarted && (!argv.has('--no-browser') || argv.has('--reopen-panel'))) await openPanel(`http://127.0.0.1:${running.port}/?token=${running.token}`, { replace: argv.has('--reopen-panel') });
  logFile.end();
} else {
  await start();
}

async function start() {
  const service = await createService({ log, onPobClosed: async () => {
    if (process.platform === 'win32') await closePreviousPanels().catch(error => log(`Could not close the panel: ${error.message}`));
    service.close();
    logFile.end(() => process.exit(0));
  } });
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

