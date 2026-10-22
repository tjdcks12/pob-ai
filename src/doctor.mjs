// `pob doctor`: checks everything PoB AI depends on and says what to do about each problem.
import fs from 'node:fs';
import { detectProviders } from './agent/providers.mjs';
import { Engine } from './engine/engine.mjs';
import { locatePob } from './pob/locate.mjs';
import { serviceInfo } from './service/client.mjs';
import { statePath } from './state.mjs';
import { checkForUpdate, installedUpdate, updateUrl, VERSION } from './update/updater.mjs';

export async function runDoctor({ runtime } = {}) {
  const checks = [];
  const add = (name, ok, detail, fix) => checks.push({ name, ok, detail, ...(ok || !fix ? {} : { fix }) });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 22, `Node.js ${process.versions.node}`, 'PoB AI needs Node.js 22 or newer; use the copy bundled in runtime/node.');

  let install = null;
  try {
    install = locatePob();
    add('pob', true, `PoB ${install.version} (${install.branch ?? '?'}) at ${install.dir} [found via ${install.source}]`);
  } catch (error) {
    add('pob', false, error.message, 'Run `pob setup "<PoB folder>"`, or `pob setup --install-pob` to install PoB.');
  }

  if (install) {
    // A separate engine so the self-test never touches the user's session build.
    const engine = new Engine(install);
    try {
      const info = await engine.call('engine.info');
      await engine.call('build.new', { name: 'PoB AI self-test', class: 'Ranger', level: 50 });
      const summary = await engine.call('build.summary');
      add('adapter', Boolean(summary?.class), `PoB ${info.version ?? install.version} loads in the headless engine and calculates a build`);
    } catch (error) {
      add('adapter', false, `The adapter does not work with this PoB version: ${error.message}`, 'Run `pob update check`; a PoB AI update usually follows PoB changes within days.');
    } finally { engine.stop(); }
  }

  const service = await serviceInfo();
  if (service) {
    let live = null;
    try {
      const response = await fetch(`http://127.0.0.1:${service.port}/api/status`, { headers: { authorization: `Bearer ${service.token}` }, signal: AbortSignal.timeout(3000) });
      live = (await response.json()).live;
    } catch { /* reported below */ }
    add('service', true, `running on port ${service.port}`);
    add('window', Boolean(live?.connected), live?.connected ? `PoB window connected (PoB ${live.version})` : 'No PoB window is connected', 'Run `pob open`.');
  } else if (!runtime?.service) {
    add('service', true, 'not running (commands use the headless engine; `pob open` starts it)');
  }

  const windowLog = statePath('logs', 'pob-window.log');
  if (fs.existsSync(windowLog)) {
    const recent = fs.readFileSync(windowLog, 'utf8').split(/\r?\n/).filter(Boolean).slice(-50);
    const failures = recent.filter(line => /failed|error/i.test(line));
    add('window-log', failures.length === 0, failures.length ? failures.slice(-3).join(' | ') : 'no recent errors in the PoB window log', `See ${windowLog}.`);
  }

  if (updateUrl()) {
    try {
      const update = await checkForUpdate();
      add('update', true, update.available ? `PoB AI ${update.latest} is available (running ${VERSION}); run \`pob update apply\`` : `PoB AI ${update.installed} is the latest version`);
    } catch (error) {
      add('update', false, error.message, 'Check the internet connection, or try again later.');
    }
  } else {
    add('update', true, `PoB AI ${VERSION}${installedUpdate() ? ` (update ${installedUpdate().version} installed, used from the next start)` : ''}; no update channel configured`);
  }

  const agents = detectProviders({ refresh: true });
  const found = agents.filter(a => a.available);
  add('agents', found.length > 0, found.length ? found.map(a => `${a.label}: ${a.command}`).join('; ') : 'No Claude Code or Codex found',
    'Install Claude Code or Codex and sign in, or set POB_AI_CLAUDE / POB_AI_CODEX to the executable.');

  return { ok: checks.every(c => c.ok), version: VERSION, checks };
}
