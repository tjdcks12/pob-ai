// Detects the AI coding agents the user already has installed and signed in to.
// Path order: a path the user chose (config.json agentPaths), then POB_AI_CLAUDE / POB_AI_CODEX,
// then automatic discovery, which also finds the copies bundled with the Claude and Codex desktop apps.
// Model lists follow poe2way desktop: Codex reads its own models_cache.json, Claude is asked over
// its stream-json control protocol (initialize), which needs no sign-in and makes no model request.
import { execFile, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { readConfig, updateConfig } from '../state.mjs';

export const PROVIDERS = {
  claude: { label: 'Claude Code', envKey: 'POB_AI_CLAUDE', login: ['auth', 'login'] },
  codex: { label: 'Codex', envKey: 'POB_AI_CODEX', login: ['login'] },
};

const EXECUTABLE = /\.(exe|cmd|bat)$/i;
const SEMVER = /\d+\.\d+\.\d+/;
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
// Like poe2way's valid_model, plus [ ] for Claude ids such as `claude-…[1m]`.
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9\-_.:/[\]]{0,127}$/;
/** poe2way desktop sends medium when the user picked no effort; quick build questions rarely need more. */
export const DEFAULT_EFFORT = 'medium';
// 0.50 has the thread.started/item.completed JSON protocol used by the panel.
export const MIN_CODEX_VERSION = '0.50.0';
export function codexVersionSupported(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version ?? ''));
  return Boolean(match && (Number(match[1]) > 0 || Number(match[2]) >= 50));
}

export const validModel = id => typeof id === 'string' && MODEL_ID.test(id);
export const validEffort = (provider, effort) => EFFORTS.includes(effort)
  && !(provider === 'claude' && ['none', 'minimal', 'ultra'].includes(effort));

const isFile = file => { try { return fs.statSync(file).isFile(); } catch { return false; } };
const mtime = file => { try { return fs.statSync(file).mtimeMs; } catch { return 0; } };
const subdirs = dir => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).slice(0, 64).map(e => path.join(dir, e.name)); } catch { return []; } };

/** `<root>\<version>\<binary>` (and `<root>\<version>\<hash>\<binary>` when nested), newest first. */
function versioned(root, binary, nested) {
  const found = [];
  for (const dir of subdirs(root)) {
    found.push(path.join(dir, binary));
    if (nested) for (const child of subdirs(dir)) found.push(path.join(child, binary));
  }
  return found.filter(isFile).sort((a, b) => mtime(b) - mtime(a));
}

/** Every existing executable for `id`, in the order PoB AI tries them (cli_discovery.rs, Windows only). */
export function candidates(id, env = process.env) {
  const home = env.USERPROFILE || os.homedir();
  const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const dirs = [];
  if (id === 'claude') dirs.push(path.join(home, '.local', 'bin'));
  dirs.push(...String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)); // what where.exe searches
  for (const key of ['NPM_CONFIG_PREFIX', 'npm_config_prefix', 'PNPM_HOME']) if (env[key]) dirs.push(env[key]);
  dirs.push(path.join(appData, 'npm'), path.join(local, 'pnpm'), path.join(home, 'scoop', 'shims'), path.join(local, 'Microsoft', 'WinGet', 'Links'));
  const found = [];
  const add = file => { if (path.isAbsolute(file) && isFile(file) && !found.some(f => f.toLowerCase() === file.toLowerCase())) found.push(file); };
  for (const dir of dirs) for (const ext of ['.exe', '.cmd', '.bat']) add(path.join(dir, id + ext));
  const bundled = [];
  if (id === 'codex') bundled.push(...versioned(path.join(local, 'OpenAI', 'Codex', 'bin'), 'codex.exe', false));
  if (id === 'claude') {
    bundled.push(...versioned(path.join(appData, 'Claude', 'claude-code'), 'claude.exe', true));
    for (const pkg of subdirs(path.join(local, 'Packages')).filter(p => path.basename(p).startsWith('Claude_'))) {
      bundled.push(...versioned(path.join(pkg, 'LocalCache', 'Roaming', 'Claude', 'claude-code'), 'claude.exe', true));
    }
  }
  for (const file of bundled.sort((a, b) => mtime(b) - mtime(a))) add(file);
  return found;
}

/** Custom path first (kept even when the file is gone, like providers.rs:69-71), then env, then discovery. */
export function resolveProvider(id, { config = readConfig(), env = process.env } = {}) {
  const p = PROVIDERS[id];
  const custom = config.agentPaths?.[id];
  if (custom) return { id, label: p.label, command: custom, source: 'custom', available: isFile(custom) };
  if (env[p.envKey] && isFile(env[p.envKey])) return { id, label: p.label, command: env[p.envKey], source: 'env', available: true };
  const command = candidates(id, env)[0] ?? null;
  return { id, label: p.label, command, source: 'auto', available: Boolean(command) };
}

let cache = null;
export function detectProviders({ refresh = false } = {}) {
  if (cache && !refresh) return cache;
  cache = Object.keys(PROVIDERS).map(id => resolveProvider(id));
  return cache;
}

/** npm installs agents as .cmd scripts, which only cmd.exe can run; quote every argument for it. */
export const quoteForCmd = arg => `"${String(arg).replace(/"/g, '""')}"`;
export function spawnCli(command, args, options) {
  return /\.(cmd|bat)$/i.test(command)
    ? spawn([command, ...args].map(quoteForCmd).join(' '), { ...options, shell: true })
    : spawn(command, args, options);
}

/** Ends the process and everything it started (a .cmd shim runs cmd.exe -> node -> the CLI). */
export function killTree(child, { sync = false } = {}) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const args = ['/PID', String(child.pid), '/T', '/F'];
  try {
    if (sync) execFileSync('taskkill', args, { windowsHide: true, stdio: 'ignore' });
    else spawn('taskkill', args, { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
  } catch { child.kill(); }
}

const fail = code => Object.assign(new Error(code), { code });

const authProbes = new Map();
const logins = new Map();

/** Ask the CLI, never read or return its credentials. Unknown is not signed out. */
export function probeAuthentication(provider, { timeoutMs = 6000 } = {}) {
  if (!provider.available) return Promise.resolve('unavailable');
  const key = `${provider.id}\0${provider.command}`;
  if (authProbes.has(key)) return authProbes.get(key);
  const probe = new Promise(resolve => {
    let child, output = '', done = false;
    const finish = state => { if (done) return; done = true; clearTimeout(timer); killTree(child); resolve(state); };
    const timer = setTimeout(() => finish('unknown'), timeoutMs);
    try {
      child = spawnCli(provider.command, provider.id === 'claude' ? ['auth', 'status', '--json'] : ['login', 'status'],
        { windowsHide: true, cwd: os.homedir(), stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { finish('unknown'); return; }
    const collect = data => { output += data; if (output.length > 16384) finish('unknown'); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', () => finish('unknown'));
    child.once('close', code => {
      if (provider.id === 'claude') {
        try {
          const status = JSON.parse(output);
          if (status.loggedIn === true && code === 0) return finish('signed_in');
          if (status.loggedIn === false && code === 1) return finish('signed_out');
        } catch { /* unsupported CLI or configuration error */ }
      } else {
        if (code === 0 && /logged in using/i.test(output)) return finish('signed_in');
        if (code === 1 && /not logged in/i.test(output)) return finish('signed_out');
      }
      finish('unknown');
    });
  });
  authProbes.set(key, probe);
  probe.finally(() => { if (authProbes.get(key) === probe) authProbes.delete(key); });
  return probe;
}

export async function providerStatus(provider) {
  const auth = await probeAuthentication(provider);
  const login = logins.get(provider.id);
  if (auth === 'signed_in' && !login?.child) logins.delete(provider.id);
  return { ...provider, auth, signingIn: Boolean(login?.child), loginFailed: auth !== 'signed_in' && login?.failed === true };
}

export function cancelLogin(id) {
  const login = logins.get(id);
  logins.delete(id);
  clearTimeout(login?.timer);
  if (login?.child) killTree(login.child);
}

/** Runs `<file> --version` for up to 6 s and resolves to the semver it prints, or null. */
export function probeVersion(file, timeoutMs = 6000) {
  return new Promise(resolve => {
    let out = '';
    let child;
    try { child = spawnCli(file, ['--version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return resolve(null); }
    const timer = setTimeout(() => { killTree(child); resolve(null); }, timeoutMs);
    child.stdout.on('data', d => { out += d; });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', () => { clearTimeout(timer); resolve(out.match(SEMVER)?.[0] ?? null); });
  });
}

export async function setPath(id, file) {
  if (!PROVIDERS[id]) throw fail('NOT_FOUND');
  file = typeof file === 'string' ? file.trim().replace(/^"(.*)"$/, '$1') : '';
  if (!file || !path.isAbsolute(file) || !EXECUTABLE.test(file) || !isFile(file)) throw fail('AGENT_PATH_INVALID');
  const version = await probeVersion(file);
  if (!version) throw fail('AGENT_NOT_RUNNABLE');
  updateConfig({ agentPaths: { ...readConfig().agentPaths, [id]: file } });
  cache = null;
  modelCache.delete(id);
  return { ...resolveProvider(id), version };
}

export function clearPath(id) {
  if (!PROVIDERS[id]) throw fail('NOT_FOUND');
  const { [id]: _removed, ...rest } = readConfig().agentPaths ?? {};
  updateConfig({ agentPaths: rest });
  cache = null;
  modelCache.delete(id);
  return resolveProvider(id);
}

// A hidden TopMost form owns the dialog so it opens above the browser window.
export const PICK_SCRIPT = [
  '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
  'Add-Type -AssemblyName System.Windows.Forms',
  '$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }',
  '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
  '$dialog.Title = $env:POBAI_PICK_TITLE',
  "$dialog.Filter = '*.exe;*.cmd;*.bat|*.exe;*.cmd;*.bat'",
  '$dialog.CheckFileExists = $true',
  'if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.FileName) }',
  '$owner.Dispose()',
].join('; ');

let picking = false;
/** Opens the native file dialog; resolves to the chosen file, or null when cancelled. */
export function pickPath(id, title) {
  if (!PROVIDERS[id]) return Promise.reject(fail('NOT_FOUND'));
  if (picking) return Promise.reject(fail('BUSY'));
  picking = true;
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', PICK_SCRIPT], {
      windowsHide: true, encoding: 'utf8',
      env: { ...process.env, POBAI_PICK_TITLE: String(title || PROVIDERS[id].label).slice(0, 200) },
    }, (error, stdout) => {
      picking = false;
      if (error) return reject(fail('PICKER_FAILED'));
      resolve(stdout.trim() || null);
    });
  });
}

/** The `cmd /s /c` command; an outer quote pair preserves paths and arguments with spaces. */
export function loginCommandLine(id, file) {
  return `"${[file, ...PROVIDERS[id].login].map(quoteForCmd).join(' ')}"`;
}
export async function openLogin(id) {
  if (!PROVIDERS[id]) throw fail('NOT_FOUND');
  const provider = resolveProvider(id);
  if (!provider.available) throw fail('AGENT_MISSING');
  if (logins.get(id)?.child) return;
  // Both CLI login commands open the browser themselves. Keep their console hidden.
  const child = spawnCli(provider.command, PROVIDERS[id].login, { windowsHide: true, cwd: os.homedir(), stdio: 'ignore' });
  const login = { child };
  logins.set(id, login);
  const finish = failed => { clearTimeout(login.timer); if (logins.get(id) === login) logins.set(id, { failed }); };
  login.timer = setTimeout(() => { killTree(child); finish(true); }, 5 * 60 * 1000);
  login.timer.unref();
  child.once('exit', code => finish(code !== 0));
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', () => { finish(true); reject(fail('AGENT_NOT_RUNNABLE')); });
  });
  child.unref();
}

// ---- models ---------------------------------------------------------------------------------

const option = (id, name, efforts, defaultEffort = null) =>
  ({ id, name: typeof name === 'string' && name.length <= 128 && !/[\x00-\x1f]/.test(name) ? name : id, efforts, defaultEffort });

/** Codex's models_cache.json -> [{id, name, efforts, defaultEffort}] and nothing else. */
export function codexCatalog(value) {
  return (Array.isArray(value?.models) ? value.models : []).slice(0, 100)
    .filter(row => row?.visibility !== 'hide' && validModel(row?.slug))
    .map(row => option(row.slug, row.display_name,
      (row.supported_reasoning_levels ?? []).map(l => l?.effort).filter(e => validEffort('codex', e)),
      validEffort('codex', row.default_reasoning_level) ? row.default_reasoning_level : null));
}

/** The `models` array of Claude's initialize response -> the same shape. */
export function claudeCatalog(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 100)
    .filter(row => validModel(row?.value))
    .map(row => option(row.value, row.displayName, (row.supportedEffortLevels ?? []).filter(e => validEffort('claude', e))));
}

export function codexModels(env = process.env) {
  const home = env.CODEX_HOME || path.join(env.USERPROFILE || os.homedir(), '.codex');
  try {
    const file = path.join(home, 'models_cache.json');
    if (fs.statSync(file).size > 8 * 1024 * 1024) return [];
    return codexCatalog(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch { return []; }
}

/** Starts Claude in stream-json mode, sends `initialize` and reads the model list from the reply. */
export function queryClaudeModels(command, { cwd, timeoutMs = 30000, log = () => {} } = {}) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawnCli(command, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'],
        { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch { return resolve(null); }
    let done = false;
    const finish = models => { if (done) return; done = true; clearTimeout(timer); killTree(child); resolve(models); };
    const timer = setTimeout(() => { log('claude models: no answer to initialize'); finish(null); }, timeoutMs);
    child.on('error', () => finish(null));
    child.on('close', () => finish(null));
    readline.createInterface({ input: child.stdout }).on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.type === 'control_response' && message.response?.request_id === 'pobai-models') {
        finish(message.response.subtype === 'success' ? claudeCatalog(message.response.response?.models) : null);
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: 'pobai-models', request: { subtype: 'initialize' } })}\n`);
  });
}

const modelCache = new Map(); // provider id -> { command, models }
/** Models for the panel's picker. Codex: its local cache file; Claude: asked once per executable. */
export async function listModels(id, { refresh = false, cwd, log } = {}) {
  if (!PROVIDERS[id]) throw fail('NOT_FOUND');
  const provider = resolveProvider(id);
  if (!provider.available) throw fail('AGENT_MISSING');
  if (id === 'codex') return codexModels();
  const cached = modelCache.get(id);
  if (!refresh && cached?.command === provider.command) return cached.models;
  const models = await queryClaudeModels(provider.command, { cwd, log });
  if (!models) return [];
  modelCache.set(id, { command: provider.command, models });
  return models;
}
