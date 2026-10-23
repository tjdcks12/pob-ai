// A separate Edge WebView2 window with the panel's own title bar. Edge --app remains
// the fallback on machines without the host/runtime.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { statePath } from '../state.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const host = path.join(root, 'desktop/bin/pob-ai-panel.exe');
const run = promisify(execFile);
let building;
function log(error) {
  fs.mkdirSync(statePath('logs'), { recursive: true });
  fs.appendFileSync(statePath('logs/panel-host.log'), new Date().toISOString() + ' ' + String(error.message ?? error).replace(/token=[a-z0-9]+/g, 'token=[redacted]') + '\n');
}
function browserPanel(url) {
  const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
  const child = edge
    ? spawn(edge, [`--app=${url}`, '--window-size=460,900', `--user-data-dir=${statePath('panel-profile')}`], { detached: true, stdio: 'ignore' })
    : spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' });
  child.unref();
  child.on('error', log);
  return { host: edge ? 'edge' : 'browser', pid: child.pid };
}

export async function openSettings(url, { ownerPid = 0, focus } = {}) {
  const target = new URL(url);
  target.searchParams.set('view', 'settings');
  if (focus === 'pob-path') target.searchParams.set('focus', focus);
  return openPanel(target.href, { ownerPid });
}

export async function openPanel(url, { ownerPid = 0 } = {}) {
  if (process.platform === 'win32' && !fs.existsSync(host) && fs.existsSync(path.join(root, 'scripts/build-panel.mjs'))) {
    try {
      building ??= run(process.execPath, [path.join(root, 'scripts/build-panel.mjs')], { windowsHide: true });
      await building;
    } catch (error) { log(error); }
    finally { building = null; }
  }
  if (!fs.existsSync(host)) return browserPanel(url);
  const args = [url, statePath('panel-webview')];
  if (Number.isSafeInteger(ownerPid) && ownerPid > 0) args.push('', '', String(ownerPid));
  const child = spawn(host, args, { detached: true, stdio: 'ignore' });
  child.on('error', error => { log(error); browserPanel(url); });
  child.unref();
  return { host: 'webview2', pid: child.pid };
}
