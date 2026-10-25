// The browser version keeps its browser frame. The WebView2 host provides one compact
// header and accepts only these window-specific messages from the local panel origin.
import { t } from './i18n.js';

const host = window.chrome?.webview;
let maximized = false, docked = false, attached = false, lastTheme;
export function setPobWindow(live) {
  if (!host) return;
  const pid = live?.connected && Number.isSafeInteger(live.pid) && live.pid > 0 ? live.pid : 0;
  host.postMessage('pob:' + pid);
}
export function refreshWindowChrome() {
  if (!host) return;
  document.documentElement.dataset.dock = attached ? 'attached' : 'floating';
  document.querySelector('.window-controls').hidden = attached;
  const button = document.getElementById('window-maximize');
  button.title = t(maximized ? 'restore' : 'maximize');
  button.setAttribute('aria-label', button.title);
  button.querySelector('use').setAttribute('href', 'icons.svg#i-window-' + (maximized ? 'restore' : 'maximize'));
  const toggle = document.getElementById('window-dock');
  const title = docked ? (attached ? 'undockPanel' : 'dockWaiting') : 'dockPanel';
  toggle.dataset.title = title;
  toggle.title = t(title);
  toggle.setAttribute('aria-label', t('dockPanel'));
  toggle.setAttribute('aria-checked', String(docked));
  const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (background !== lastTheme) { lastTheme = background; host.postMessage('theme:' + background); }
}

if (host) {
  document.documentElement.dataset.host = 'desktop';
  document.querySelector('.window-controls').hidden = false;
  document.getElementById('window-dock').hidden = new URLSearchParams(location.search).get('view') === 'settings';
  document.getElementById('window-dock').addEventListener('click', () => host.postMessage('window:dock'));
  for (const action of ['minimize', 'maximize', 'close'])
    document.getElementById('window-' + action).addEventListener('click', () => host.postMessage('window:' + action));
  host.addEventListener('message', event => {
    if (event.data?.kind === 'window-activated') { window.dispatchEvent(new Event('pobai:activated')); return; }
    if (event.data?.kind !== 'window-state' || typeof event.data.maximized !== 'boolean') return;
    maximized = event.data.maximized;
    docked = event.data.docked === true;
    attached = event.data.attached === true;
    refreshWindowChrome();
  });
}
