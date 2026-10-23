// Commands that need Node (network, files, processes) before or instead of PoB's Lua.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { prepareItemText } from '../items/prepare.mjs';
import { runDoctor } from '../doctor.mjs';
import { installPob } from '../pob/install.mjs';
import { inspectInstall, locatePob } from '../pob/locate.mjs';
import { statePath, updateConfig } from '../state.mjs';
import { APP_ROOT, applyUpdate, checkForUpdate, installedUpdate, VERSION } from '../update/updater.mjs';
import { windowLocale } from '../i18n/system-locale.mjs';
import { resolveTheme } from '../../ui/themes.js';

const SERVICE_MAIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../service/main.mjs');
const LAUNCHER = path.join(APP_ROOT, 'launcher.mjs');

// Same sites and download rules as PoB's Modules/BuildSiteTools.lua.
export const BUILD_SITES = [
  { label: 'Maxroll', match: /maxroll\.gg\/poe2\/pob\/([^\s?#]+)/, raw: id => `https://maxroll.gg/poe2/api/pob/${id}` },
  { label: 'pobb.in', match: /pobb\.in\/([^\s?#]+)/, raw: id => `https://pobb.in/pob/${id.replace(/^pob\//, '')}` },
  { label: 'poe.ninja', match: /poe2?\.ninja\/(?:poe2\/)?pob\/(?:raw\/)?([^\s?#]+)/, raw: id => `https://poe.ninja/poe2/pob/raw/${id}` },
  { label: 'poe2db.tw', match: /poe2db\.tw\/pob\/([^\s?#/]+)/, raw: id => `https://poe2db.tw/pob/${id}/raw` },
  { label: 'Pastebin', match: /pastebin\.com\/(?:raw\/)?(\w+)/, raw: id => `https://pastebin.com/raw/${id}` },
  { label: 'PastebinP', match: /pastebinp\.com\/(?:raw\/)?(\w+)/, raw: id => `https://pastebinp.com/raw/${id}` },
  { label: 'Rentry', match: /rentry\.co\/(?:paste\/)?(\w+)/, raw: id => `https://rentry.co/paste/${id}/raw` },
];

// Upload endpoints, from the same file (postUrl, postFields, codeOut).
export const SHARE_SITES = {
  'pobb.in': { url: 'https://pobb.in/pob/', field: '', link: body => `https://pobb.in/${body.trim()}` },
  'poe.ninja': { url: 'https://poe.ninja/poe2/pob/api/upload', field: 'code=', link: body => body.trim() },
  maxroll: { url: 'https://maxroll.gg/poe2/api/pob', field: 'pobCode=', link: body => `https://maxroll.gg/poe2/pob/${body.trim()}` },
  poe2db: { url: 'https://poe2db.tw/pob/api/gen', field: '', link: body => body.trim() },
};

export const TRADE_HOSTS = { global: 'https://www.pathofexile.com', kakao: 'https://poe.kakaogames.com' };

/** Official trade site search URL; the site accepts the query as JSON in `q`. */
export function tradeSearchUrl(query, { site = 'global', league = 'Standard' } = {}) {
  return `${TRADE_HOSTS[site]}/trade2/search/poe2/${encodeURIComponent(league)}?q=${encodeURIComponent(JSON.stringify(query))}`;
}

export function decodeBuildCode(code) {
  const clean = code.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  let xml;
  try { xml = inflateSync(Buffer.from(clean, 'base64')).toString('utf8'); } catch {
    throw Object.assign(new Error('This is not a valid PoB build code.'), { code: 'BAD_CODE' });
  }
  if (!/<PathOfBuilding2?[\s>]/.test(xml)) throw Object.assign(new Error('The code does not contain a PoE2 build.'), { code: 'BAD_CODE' });
  if (/<PathOfBuilding[\s>]/.test(xml) && !/<PathOfBuilding2[\s>]/.test(xml)) {
    throw Object.assign(new Error('This is a Path of Exile 1 build. PoB AI works with PoE2 builds.'), { code: 'WRONG_GAME' });
  }
  return xml;
}

export const encodeBuildCode = xml => deflateSync(Buffer.from(xml, 'utf8'), { level: 9 }).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

/** Resolves a code, a link to a supported site, a saved build name or an .xml path to build XML. */
export async function resolveBuildSource(source, runtime) {
  const text = source.trim();
  if (/^https?:\/\//i.test(text)) {
    const site = BUILD_SITES.find(s => s.match.test(text));
    if (!site) throw Object.assign(new Error(`Unsupported link. Supported: ${BUILD_SITES.map(s => s.label).join(', ')}.`), { code: 'UNSUPPORTED_SITE' });
    const url = site.raw(text.match(site.match)[1]);
    const response = await fetch(url, { headers: { 'user-agent': 'PoB-AI (Path of Building companion)' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Object.assign(new Error(`${site.label} answered ${response.status} for ${url}.`), { code: 'DOWNLOAD_FAILED' });
    return { xml: decodeBuildCode(await response.text()), origin: { site: site.label, url } };
  }
  if (/\.xml$/i.test(text) && fs.existsSync(text)) return { xml: fs.readFileSync(text, 'utf8'), origin: { file: path.resolve(text) } };
  if (/^[A-Za-z0-9+/=_-]{40,}$/.test(text.replace(/\s+/g, ''))) return { xml: decodeBuildCode(text), origin: { code: true } };
  if (runtime) {
    const { result } = await runtime.run('build.list', { search: text });
    const match = result.builds.find(b => b.name.toLowerCase() === text.toLowerCase()) ?? (result.builds.length === 1 ? result.builds[0] : null);
    if (match) return { xml: fs.readFileSync(match.file, 'utf8'), origin: { file: match.file } };
  }
  throw Object.assign(new Error('Give a PoB build code, a supported link, a saved build name or an .xml file.'), { code: 'BAD_SOURCE' });
}

const safeFileName = name => {
  const clean = String(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim();
  if (!clean) throw Object.assign(new Error('The name is empty after removing characters files cannot use.'), { code: 'BAD_NAME' });
  return clean;
};

/** A saved build by name, and whether it is the build currently open. */
async function findSavedBuild(query, runtime) {
  const { result } = await runtime.run('build.paths', {});
  const root = result.buildPath;
  const builds = scanBuilds(root, {});
  const wanted = query.toLowerCase();
  const exact = builds.filter(b => b.name.toLowerCase() === wanted || b.relative.toLowerCase() === wanted);
  const matches = exact.length ? exact : builds.filter(b => b.name.toLowerCase().includes(wanted));
  if (!matches.length) throw Object.assign(new Error(`No saved build matches "${query}".`), { code: 'NOT_FOUND' });
  if (matches.length > 1) throw Object.assign(new Error(`"${query}" matches ${matches.length} builds.`), { code: 'AMBIGUOUS', details: { candidates: matches.slice(0, 15).map(b => b.relative) } });
  const summary = (await runtime.run('build.summary', {})).result;
  const open = Boolean(summary.file) && path.resolve(summary.file) === path.resolve(matches[0].file);
  return { file: matches[0].file, open, root };
}

/** Saved builds under PoB's build folder, newest first, with level and class from each file. */
export function scanBuilds(root, { search, folder } = {}) {
  const base = folder ? path.join(root, folder) : root;
  const out = [];
  const attr = (head, key) => head.match(new RegExp(`<Build\\b[^>]*\\b${key}="([^"]*)"`))?.[1];
  const walk = dir => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.toLowerCase().endsWith('.xml')) continue;
      const name = entry.name.slice(0, -4);
      if (search && !name.toLowerCase().includes(search.toLowerCase())) continue;
      let head = '';
      try {
        const fd = fs.openSync(full, 'r');
        const buf = Buffer.alloc(4096);
        fs.readSync(fd, buf, 0, 4096, 0);
        fs.closeSync(fd);
        head = buf.toString('utf8');
      } catch { /* unreadable file */ }
      const ascendancy = attr(head, 'ascendClassName');
      out.push({ name, relative: path.relative(root, full).split(path.sep).join('/'), file: full, level: Number(attr(head, 'level')) || undefined,
        class: attr(head, 'className'), ascendancy: ascendancy && ascendancy !== 'None' ? ascendancy : undefined, modified: fs.statSync(full).mtime.toISOString() });
    }
  };
  walk(base);
  return out.sort((a, b) => b.modified.localeCompare(a.modified));
}

async function startServiceDetached() {
  // Through the launcher when there is one, so the newest installed version starts.
  const entry = fs.existsSync(LAUNCHER) ? LAUNCHER : SERVICE_MAIN;
  const child = spawn(process.execPath, [entry, '--quiet'], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  const { serviceInfo } = await import('../service/client.mjs');
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 250));
    const info = await serviceInfo();
    if (info) return info;
  }
  throw Object.assign(new Error('The PoB AI service did not start. See the log in the data folder.'), { code: 'SERVICE_START' });
}

export const LOCAL = {
  /** Runs inside the service when one is running; otherwise starts it and asks it to open PoB. */
  async open(args, runtime) {
    if (runtime.service) {
      const result = runtime.service.openPob({ buildFile: args.build });
      if (!result.alreadyOpen) await runtime.service.waitForPob();
      return { target: 'app', result: { ...result, connected: true } };
    }
    const info = await startServiceDetached();
    const { callService } = await import('../service/client.mjs');
    return callService(info, 'open', args);
  },

  async status(_args, runtime) {
    let pob;
    try { pob = locatePob(); } catch (error) { pob = { found: false, message: error.message, ...error.details }; }
    const { serviceInfo } = await import('../service/client.mjs');
    const service = runtime.service ? null : await serviceInfo();
    return { target: 'app', result: { pob, service: runtime.service ? { running: true, port: runtime.service.port } : { running: Boolean(service), ...service, token: undefined },
      window: runtime.service ? { connected: runtime.liveConnected, ...runtime.bridge?.info } : { connected: null, note: 'Run inside the service to know.' }, dataFolder: statePath() } };
  },

  async setup(args, runtime) {
    let install;
    if (args.installPob) install = await installPob();
    else {
      if (!args.pobPath) throw Object.assign(new Error('Give the PoB folder, or use --install-pob to download PoB.'), { code: 'BAD_ARGS' });
      install = inspectInstall(args.pobPath);
      if (!install) throw Object.assign(new Error(`No PoB (PoE2) install in ${args.pobPath}. Pick the folder that contains "Path of Building-PoE2.exe".`), { code: 'POB_NOT_FOUND' });
      updateConfig({ pobPath: install.dir });
    }
    runtime?.refreshInstall();
    runtime?.service?.broadcast('pob-install', install);
    return { target: 'app', result: install };
  },

  async version() {
    let pob = null;
    try { const found = locatePob(); pob = { version: found.version, branch: found.branch, dir: found.dir }; } catch { /* not installed */ }
    const update = installedUpdate();
    return { target: 'app', result: { pobAi: VERSION, node: process.versions.node, pob, ...(update ? { updateInstalled: update.version } : {}) } };
  },

  async doctor(_args, runtime) {
    return { target: 'app', result: await runDoctor({ runtime }) };
  },

  async updateCheck() {
    return { target: 'app', result: await checkForUpdate() };
  },

  async updateApply(args, runtime) {
    const result = await applyUpdate();
    if (result.updated && args.restart && runtime.service) return LOCAL.restart({}, runtime).then(r => ({ ...r, result: { ...result, ...r.result } }));
    return { target: 'app', result };
  },

  /** Restarts the service through the launcher; the open PoB window and panel reconnect. */
  async restart(_args, runtime) {
    const service = runtime.service;
    if (!service) throw Object.assign(new Error('PoB AI is not running; `pob open` starts it.'), { code: 'SERVICE_NOT_RUNNING' });
    const launcher = process.env.POB_AI_LAUNCHER || LAUNCHER;
    if (!fs.existsSync(launcher)) throw Object.assign(new Error('This copy has no launcher.mjs; start PoB AI again by hand.'), { code: 'NO_LAUNCHER' });
    setTimeout(() => {
      service.close();
      const line = `/d /c start "PoB AI" /min "${process.execPath}" "${launcher}" --open --no-browser`;
      spawn('cmd.exe', [line], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
      setTimeout(() => process.exit(0), 300);
    }, 300);
    return { target: 'app', result: { restarting: true } };
  },

  async importBuild(args, runtime) {
    const { xml, origin } = await resolveBuildSource(args.source, null);
    const outcome = await runtime.run('build.load_xml', { xml, name: args.name });
    return { ...outcome, origin };
  },

  async exportBuild(args, runtime) {
    const { target, result } = await runtime.run('build.xml', {});
    const text = args.format === 'xml' ? result.xml : encodeBuildCode(result.xml);
    if (args.out) {
      fs.writeFileSync(args.out, text);
      return { target, result: { file: path.resolve(args.out), format: args.format, bytes: text.length } };
    }
    return { target, result: { format: args.format, [args.format]: text } };
  },

  async listBuilds(args, runtime) {
    const { target, result } = await runtime.run('build.paths', {});
    return { target, result: { folder: result.buildPath, builds: scanBuilds(result.buildPath, args) } };
  },

  async openBuild(args, runtime) {
    let file = args.build;
    let buildPath = null;
    if (!(/\.xml$/i.test(file) && fs.existsSync(file))) {
      const { result } = await runtime.run('build.paths', {});
      buildPath = result.buildPath;
      const builds = scanBuilds(buildPath, {});
      const wanted = args.build.toLowerCase();
      const exact = builds.filter(b => b.name.toLowerCase() === wanted || b.relative.toLowerCase() === wanted);
      const partial = builds.filter(b => b.name.toLowerCase().includes(wanted));
      const matches = exact.length ? exact : partial;
      if (!matches.length) throw Object.assign(new Error(`No saved build matches "${args.build}". See \`pob build list\`.`), { code: 'NOT_FOUND' });
      if (matches.length > 1) throw Object.assign(new Error(`"${args.build}" matches ${matches.length} builds.`), { code: 'AMBIGUOUS', details: { candidates: matches.slice(0, 15).map(b => b.relative) } });
      file = matches[0].file;
    }
    const xml = fs.readFileSync(file, 'utf8');
    const relative = buildPath && path.resolve(file).startsWith(path.resolve(buildPath)) ? path.relative(buildPath, file).split(path.sep).join('/') : undefined;
    return runtime.run('build.load_xml', { xml, name: path.basename(file, '.xml'), file: relative, discard: args.discard });
  },

  async windowLanguage(args, runtime) {
    const language = windowLocale(args.language);
    let applied = null;
    if (runtime.liveConnected && runtime.service?.windowLanguage) applied = await runtime.service.windowLanguage(language);
    updateConfig({ pobLanguage: args.language });
    runtime.service?.broadcast?.('language', { preference: args.language, language });
    return { target: runtime.liveConnected ? 'live' : 'app', result: { language, preference: args.language, applied: Boolean(applied), entries: applied?.entries, remembered: true } };
  },

  async theme(args, runtime) {
    const theme = resolveTheme(args.theme);
    if (runtime.liveConnected) await runtime.run('ui.theme_apply', { theme });
    updateConfig({ pobTheme: theme });
    runtime.service?.broadcast('theme', { theme });
    return { target: runtime.liveConnected ? 'live' : 'app', result: { theme, applied: runtime.liveConnected, remembered: true } };
  },

  async addItem(args, runtime) {
    const { text, conversion } = await prepareItemText(args.text, { log: runtime.log });
    const outcome = await runtime.run('items.add_english', { text, equip: args.equip });
    return conversion ? { ...outcome, conversion } : outcome;
  },

  async whatif(args, runtime) {
    let conversion = null;
    if (args.item) ({ text: args.item, conversion } = await prepareItemText(args.item, { log: runtime.log }));
    const outcome = await runtime.run('calc.whatif_english', args);
    return conversion ? { ...outcome, conversion } : outcome;
  },

  async shareBuild(args, runtime, { fetchImpl = fetch } = {}) {
    const site = SHARE_SITES[args.site];
    const { result } = await runtime.run('build.xml', {});
    const response = await fetchImpl(site.url, {
      method: 'POST', body: site.field + encodeBuildCode(result.xml),
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'PoB-AI (Path of Building companion)' },
      signal: AbortSignal.timeout(20000),
    });
    const body = await response.text();
    if (!response.ok || !body.trim()) throw Object.assign(new Error(`${args.site} answered ${response.status}.`), { code: 'UPLOAD_FAILED' });
    return { target: 'app', result: { site: args.site, url: site.link(body), name: result.name } };
  },

  async deleteBuild(args, runtime) {
    const { file, open } = await findSavedBuild(args.build, runtime);
    if (!args.yes) throw Object.assign(new Error(`This deletes ${path.basename(file)} permanently. Repeat with --yes to confirm.`), { code: 'CONFIRM_REQUIRED' });
    if (open) throw Object.assign(new Error('That build is open in PoB. Open another build first.'), { code: 'BUILD_OPEN' });
    fs.rmSync(file);
    return { target: 'app', result: { deleted: file } };
  },

  async renameBuildFile(args, runtime) {
    const { file, open } = await findSavedBuild(args.build, runtime);
    if (open) throw Object.assign(new Error('That build is open in PoB; use `pob build save --name` to save it under a new name.'), { code: 'BUILD_OPEN' });
    const name = safeFileName(args.name);
    const target = path.join(path.dirname(file), `${name}.xml`);
    if (fs.existsSync(target)) throw Object.assign(new Error(`${name}.xml already exists.`), { code: 'EXISTS' });
    fs.renameSync(file, target);
    return { target: 'app', result: { from: file, to: target } };
  },

  async moveBuild(args, runtime) {
    const { file, open, root } = await findSavedBuild(args.build, runtime);
    if (open) throw Object.assign(new Error('That build is open in PoB. Open another build first.'), { code: 'BUILD_OPEN' });
    const folder = path.resolve(root, args.folder || '.');
    if (!folder.startsWith(path.resolve(root))) throw Object.assign(new Error('The folder must be inside the build folder.'), { code: 'BAD_FOLDER' });
    fs.mkdirSync(folder, { recursive: true });
    const target = path.join(folder, path.basename(file));
    if (fs.existsSync(target)) throw Object.assign(new Error(`${path.basename(file)} already exists there.`), { code: 'EXISTS' });
    fs.renameSync(file, target);
    return { target: 'app', result: { from: file, to: target } };
  },

  async newBuildFolder(args, runtime) {
    const { result } = await runtime.run('build.paths', {});
    const folder = path.resolve(result.buildPath, args.folder.split(/[\\/]/).map(safeFileName).join(path.sep));
    if (!folder.startsWith(path.resolve(result.buildPath))) throw Object.assign(new Error('The folder must be inside the build folder.'), { code: 'BAD_FOLDER' });
    fs.mkdirSync(folder, { recursive: true });
    return { target: 'app', result: { folder } };
  },

  async editItem(args, runtime) {
    const { text, conversion } = await prepareItemText(args.text, { log: runtime.log });
    const outcome = await runtime.run('items.edit_english', { item: args.item, text });
    return conversion ? { ...outcome, conversion } : outcome;
  },

  async trade(args, runtime) {
    const outcome = await runtime.run('items.trade_query', { item: args.item, minPercent: args.minPercent, base: args.base, status: args.status });
    const { query, ...rest } = outcome.result;
    return { ...outcome, result: { ...rest, url: tradeSearchUrl(query, { site: args.site, league: args.league }), league: args.league } };
  },

  async compare(args, runtime) {
    const { xml, origin } = await resolveBuildSource(args.other, runtime);
    const outcome = await runtime.run('calc.compare_xml', { xml, keys: args.keys });
    return { ...outcome, origin };
  },
};
