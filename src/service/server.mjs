// PoB AI local service: owns the PoB window bridge and the headless engine, and serves the
// HTTP API, the MCP endpoint and the agent panel. Listens on 127.0.0.1 only.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentHub } from '../agent/hub.mjs';
import { COMMANDS, findCommand } from '../commands/registry.mjs';
import { BridgeServer } from '../live/bridge-server.mjs';
import { GlyphAtlas } from '../live/glyph-atlas.mjs';
import { writeDictionary } from '../live/window-language.mjs';
import { launchPob } from '../pob/launch.mjs';
import { closePob, listPobProcesses } from '../pob/processes.mjs';
import { Runtime } from '../runtime.mjs';
import { readConfig, readJson, statePath, writeJson } from '../state.mjs';
import { SERVICE_FILE } from './client.mjs';
import { checkForUpdate, updateCheckDue } from '../update/updater.mjs';
import { handleMcp } from './mcp.mjs';
import { openPanel, openSettings } from './panel.mjs';
import { systemLocale, windowLocale } from '../i18n/system-locale.mjs';
import { normalizeLocalePreference } from '../../ui/locale.js';
import { resolveTheme } from '../../ui/themes.js';
import { listenHttp } from './http-port.mjs';
import { CharacterSync } from './character-sync.mjs';

const UI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ui');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon' };

export async function createService({ port, log = line => process.stderr.write(`${line}\n`), openAgentPanel = openPanel, openSettingsPanel = openSettings } = {}) {
  // The address of the previous run is reused when free, so an open agent panel reconnects
  // after a restart (an update) instead of pointing at a dead port.
  const previous = readJson(SERVICE_FILE(), {});
  const token = /^[0-9a-f]{48}$/.test(previous.token ?? '') ? previous.token : randomBytes(24).toString('hex');
  const events = new Set();
  const broadcast = (type, data) => {
    const frame = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of events) res.write(frame);
  };

  // The PoB window keeps the bridge address it was started with, so the address is reused
  // across service restarts (updates) and an open PoB window reconnects by itself.
  const saved = readJson(statePath('bridge.json'), {});
  const bridge = new BridgeServer({ log, token: /^[0-9a-f]{36}$/.test(saved.token ?? '') ? saved.token : undefined });
  await bridge.listen(saved.port ?? 0);
  if (bridge.port !== saved.port || bridge.token !== saved.token) writeJson(statePath('bridge.json'), { port: bridge.port, token: bridge.token });
  const runtime = new Runtime({ bridge, log });
  const service = { token, bridge, runtime, broadcast, log, pobProcess: null };
  service.pobOwnerPid = async () => {
    if (!bridge.connected) return 0;
    if (bridge.info?.pid) return bridge.info.pid;
    if (service.pobProcess?.exitCode === null && !service.pobProcess.signalCode) return service.pobProcess.pid;
    // Compatibility with an already-open PoB using an older shim, after a service update.
    const info = bridge.info;
    let windows = [];
    try { windows = (await listPobProcesses(runtime.install())).filter(p => p.shim); } catch { /* installation may have moved while the legacy window stays open */ }
    return bridge.connected && bridge.info === info && windows.length === 1 ? windows[0].pid : 0;
  };
  service.openSettings = async (focus, ownerPid = service.pobProcess?.exitCode === null ? service.pobProcess.pid : 0) => {
    // An existing PoB can reconnect after a service restart without being our child process.
    if (!ownerPid && bridge.connected) {
      const windows = await listPobProcesses(runtime.install()).catch(() => []);
      if (windows.length === 1) ownerPid = windows[0].pid;
    }
    return openSettingsPanel(service.url, { ownerPid: Number.isSafeInteger(ownerPid) && ownerPid > 0 ? ownerPid : 0, focus: focus === 'pob-path' ? focus : undefined });
  };
  runtime.service = service;
  const characterSync = new CharacterSync({ runtime, broadcast });
  service.characterSync = characterSync;
  service.openPob = (options = {}) => {
    if (bridge.connected) return { alreadyOpen: true, ...bridge.info };
    if (service.pobProcess?.exitCode === null && !service.pobProcess.signalCode) return { opening: true, pid: service.pobProcess.pid };
    const child = launchPob(runtime.install(), { port: bridge.port, token: bridge.token }, options);
    service.pobProcess = child;
    // A PoB that exits before connecting may be applying an update on its first run.
    child.on('exit', () => { if (!child.bridgeConnected && service.pobProcess === child && !service.closed) reopenAfterUpdate(); });
    return { launched: true, pid: child.pid };
  };
  // After a "basic" self-update PoB's updater starts PoB without the shim: close that window
  // and open PoB again through PoB AI so the agent keeps working.
  let reopening = null;
  const reopenAfterUpdate = (timeoutMs = 180000) => reopening ??= (async () => {
    const deadline = Date.now() + timeoutMs;
    try {
      while (Date.now() < deadline && !bridge.connected && !service.closed) {
        runtime.refreshInstall();
        const plain = (await listPobProcesses(runtime.install()).catch(() => [])).filter(p => !p.shim);
        if (plain.length) {
          for (const p of plain) await closePob(p.pid);
          service.openPob();
          log('Reopened PoB with PoB AI after its update.');
          return true;
        }
        await new Promise(r => setTimeout(r, 2000));
      }
      return false;
    } finally { reopening = null; }
  })();
  service.reopenAfterUpdate = reopenAfterUpdate;
  service.waitForPob = (timeoutMs = 45000) => bridge.connected ? Promise.resolve(bridge.info) : new Promise((resolve, reject) => {
    const connected = info => { clearTimeout(timer); resolve(info); };
    const timer = setTimeout(() => { bridge.off('connected', connected); reject(Object.assign(new Error('The PoB window did not connect in time.'), { code: 'LIVE_TIMEOUT' })); }, timeoutMs);
    bridge.once('connected', connected);
  });
  // PoB window font and translation: the window asks for the glyphs it is missing; the
  // language is remembered.
  const atlas = new GlyphAtlas({ log });
  service.windowLanguage = async locale => {
    if (!locale || locale === 'en') return bridge.call('ui.language_apply', { locale: 'en' });
    const { file } = writeDictionary(locale);
    return bridge.call('ui.language_apply', { locale, dict: file }, { timeoutMs: 120000 });
  };
  let updating = null;
  bridge.on('connected', info => {
    updating = null;
    if (service.pobProcess) service.pobProcess.bridgeConnected = true;
    if (runtime.cachedInstall && info.version && info.version !== runtime.cachedInstall.version) runtime.refreshInstall();
    broadcast('pob', { connected: true, ...info });
    const language = windowLocale(readConfig().pobLanguage);
    service.windowLanguage(language).catch(error => log(`window language: ${error.message}`));
  });
  bridge.on('disconnected', () => {
    broadcast('pob', { connected: false, updating: updating?.mode });
    // A "normal" update restarts PoB in place and the shim reconnects by itself.
    if (updating?.mode === 'basic') reopenAfterUpdate();
  });
  bridge.on('event', event => {
    if (event?.kind === 'open-settings') {
      Promise.resolve(service.openSettings(undefined, event.ownerPid)).catch(error => log(`settings: ${error.message}`));
      return;
    }
    // The AI button in the PoB title bar: bring an open panel forward, or open one.
    if (event?.kind === 'open-panel') {
      if (!event.panelFound || event.panelFocused === false) Promise.resolve(openAgentPanel(service.url)).catch(error => log(`panel: ${error.message}`));
      broadcast('focus-panel', {});
      return;
    }
    if (event?.kind === 'pob-updating') {
      updating = { mode: event.mode };
      log(`PoB is applying an update (${event.mode}).`);
    }
    if (event?.kind === 'glyphs') {
      // The window routes every {"type":"rendered"} line to its atlas, so `type` stays first.
      atlas.render(event)
        .then(page => bridge.send({ type: 'rendered', atlas: event.key, id: event.id, ...page }))
        .catch(error => bridge.send({ type: 'rendered', atlas: event.key, id: event.id, error: error.message }));
      return;
    }
    broadcast('pob-event', event);
  });
  const agents = new AgentHub(service);
  service.agents = agents;

  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const readBody = req => new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolve(text ? JSON.parse(text) : {}); } catch { reject(Object.assign(new Error('Invalid JSON body'), { code: 'BAD_REQUEST' })); }
    });
    req.on('error', reject);
  });
  const authorized = (req, url) => req.headers.authorization === `Bearer ${token}` || url.searchParams.get('token') === token;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (url.pathname === '/mcp') {
        if (!authorized(req, url)) return send(res, 401, { error: 'unauthorized' });
        return handleMcp(req, res, service, await readBody(req).catch(() => null));
      }
      if (url.pathname.startsWith('/api/')) {
        if (!authorized(req, url)) return send(res, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'Missing or wrong token.' } });
        return await api(req, res, url);
      }
      return serveStatic(res, url.pathname);
    } catch (error) {
      log(`request failed: ${error.stack ?? error}`);
      if (!res.headersSent) send(res, 500, { ok: false, error: { code: error.code ?? 'INTERNAL', message: error.message } });
    }
  });

  async function api(req, res, url) {
    const route = `${req.method} ${url.pathname}`;
    if (route === 'GET /api/health') return send(res, 200, { ok: true });
    if (route === 'GET /api/character-sync') return send(res, 200, { ok: true, ...characterSync.status() });
    if (route === 'GET /api/character-sync/context') return send(res, 200, { ok: true, ...await characterSync.context(url.searchParams.get('reload') === '1') });
    if (route === 'POST /api/character-sync' || route === 'POST /api/character-sync/refresh') {
      try {
        const status = route.endsWith('/refresh') ? await characterSync.refresh() : await characterSync.configure(await readBody(req));
        return send(res, 200, { ok: true, ...status });
      } catch (error) { return send(res, 200, { ok: false, error: { code: error.code ?? 'REFRESH_FAILED' } }); }
    }
    if (route === 'POST /api/settings/open') {
      const body = await readBody(req);
      const result = await service.openSettings(body.focus);
      return send(res, 200, { ok: true, ...result });
    }
    if (route === 'GET /api/status') {
      let install = null;
      try { install = runtime.install(); } catch (error) { install = { error: error.message }; }
      const { pobLanguage = 'system', pobTheme = 'pob' } = readConfig();
      const pid = await service.pobOwnerPid();
      return send(res, 200, { ok: true, pob: install, live: { connected: bridge.connected, ...bridge.info, pid }, agents: agents.providers(), settings: { pobLanguage, pobLanguageResolved: windowLocale(pobLanguage), systemLocale: systemLocale(), pobTheme: resolveTheme(pobTheme) }, update: service.update ?? null });
    }
    if (route === 'GET /api/commands') {
      return send(res, 200, { ok: true, commands: COMMANDS.map(({ local, ...c }) => c) });
    }
    if (route === 'POST /api/run') {
      const body = await readBody(req);
      try {
        const outcome = await runtime.run(body.command, body.args ?? {}, { target: body.target, lang: body.lang });
        if (findCommand(body.command)?.mutates) broadcast('build-changed', { command: body.command });
        return send(res, 200, { ok: true, ...outcome });
      } catch (error) {
        return send(res, 200, { ok: false, error: { code: error.code ?? 'ERROR', message: error.message, details: error.details } });
      }
    }
    if (route === 'GET /api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`event: pob\ndata: ${JSON.stringify({ connected: bridge.connected, ...bridge.info })}\n\n`);
      events.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clearInterval(ping); events.delete(res); });
      return;
    }
    if (url.pathname.startsWith('/api/agent')) return agents.handle(req, res, url, { send, readBody });
    return send(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: route } });
  }

  function serveStatic(res, pathname) {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    const file = path.resolve(UI_DIR, rel);
    if (!file.startsWith(UI_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); return res.end('Not found');
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    if (file === path.join(UI_DIR, 'index.html')) return res.end(fs.readFileSync(file, 'utf8')
      .replace('<html ', `<html data-system-locale="${systemLocale()}" data-language="${normalizeLocalePreference(readConfig().pobLanguage)}" `)
      .replace('data-theme="dark"', `data-theme="${resolveTheme(readConfig().pobTheme)}"`));
    fs.createReadStream(file).pipe(res);
  }

  try { await listenHttp(server, port ?? previous.port ?? 0, { fixed: Boolean(port), log }); }
  catch (error) {
    characterSync.close(); atlas.close(); agents.close(); runtime.close(); bridge.close();
    throw error;
  }
  service.port = server.address().port;
  service.url = `http://127.0.0.1:${service.port}/?token=${token}`;
  writeJson(SERVICE_FILE(), { port: service.port, token, pid: process.pid, startedAt: new Date().toISOString() });
  fs.mkdirSync(statePath('logs'), { recursive: true });
  // A quiet daily check; the panel offers the update, nothing is downloaded without a click.
  if (updateCheckDue()) {
    checkForUpdate().then(update => {
      service.update = update;
      if (update.available) { log(`PoB AI ${update.latest} is available.`); broadcast('update', update); }
    }).catch(error => log(`update check: ${error.message}`));
  }
  service.close = () => {
    service.closed = true;
    characterSync.close();
    atlas.close();
    agents.close();
    runtime.close();
    bridge.close();
    server.close();
    for (const res of events) res.end();
    // service.json stays: the next start reuses its address, and clients check it is alive.
  };
  return service;
}
