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
import { launchPob } from '../pob/launch.mjs';
import { Runtime } from '../runtime.mjs';
import { statePath, writeJson } from '../state.mjs';
import { SERVICE_FILE } from './client.mjs';
import { handleMcp } from './mcp.mjs';

const UI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ui');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

export async function createService({ port = 0, log = line => process.stderr.write(`${line}\n`) } = {}) {
  const token = randomBytes(24).toString('hex');
  const events = new Set();
  const broadcast = (type, data) => {
    const frame = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of events) res.write(frame);
  };

  const bridge = new BridgeServer({ log });
  await bridge.listen();
  const runtime = new Runtime({ bridge, log });
  const service = { token, bridge, runtime, broadcast, log, pobProcess: null };
  runtime.service = service;
  service.openPob = (options = {}) => {
    if (bridge.connected) return { alreadyOpen: true, ...bridge.info };
    service.pobProcess = launchPob(runtime.install(), { port: bridge.port, token: bridge.token }, options);
    return { launched: true, pid: service.pobProcess.pid };
  };
  service.waitForPob = (timeoutMs = 45000) => bridge.connected ? Promise.resolve(bridge.info) : new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('The PoB window did not connect in time.'), { code: 'LIVE_TIMEOUT' })), timeoutMs);
    bridge.once('connected', info => { clearTimeout(timer); resolve(info); });
  });
  bridge.on('connected', info => broadcast('pob', { connected: true, ...info }));
  bridge.on('disconnected', () => broadcast('pob', { connected: false }));
  bridge.on('event', event => broadcast('pob-event', event));
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
    if (route === 'GET /api/status') {
      let install = null;
      try { install = runtime.install(); } catch (error) { install = { error: error.message }; }
      return send(res, 200, { ok: true, pob: install, live: { connected: bridge.connected, ...bridge.info }, agents: agents.providers() });
    }
    if (route === 'GET /api/commands') {
      return send(res, 200, { ok: true, commands: COMMANDS.map(({ local, ...c }) => c) });
    }
    if (route === 'POST /api/run') {
      const body = await readBody(req);
      try {
        const outcome = await runtime.run(body.command, body.args ?? {}, { target: body.target });
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
    fs.createReadStream(file).pipe(res);
  }

  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  service.port = server.address().port;
  service.url = `http://127.0.0.1:${service.port}/?token=${token}`;
  writeJson(SERVICE_FILE(), { port: service.port, token, pid: process.pid, startedAt: new Date().toISOString() });
  fs.mkdirSync(statePath('logs'), { recursive: true });
  service.close = () => {
    agents.close();
    runtime.close();
    bridge.close();
    server.close();
    for (const res of events) res.end();
    try { if (JSON.parse(fs.readFileSync(SERVICE_FILE(), 'utf8')).pid === process.pid) fs.rmSync(SERVICE_FILE()); } catch { /* already gone */ }
  };
  return service;
}
