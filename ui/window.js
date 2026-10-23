// The browser version keeps its browser frame. The WebView2 host provides one compact
// header and accepts only these window-specific messages from the local panel origin.
import { t } from './i18n.js';

const host = window.chrome?.webview;
let maximized = false, lastTheme;
export function refreshWindowChrome() {
  if (!host) return;
  const button = document.getElementById('window-maximize');
  button.title = t(maximized ? 'restore' : 'maximize');
  button.setAttribute('aria-label', button.title);
  button.querySelector('use').setAttribute('href', 'icons.svg#i-window-' + (maximized ? 'restore' : 'maximize'));
  const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (background !== lastTheme) { lastTheme = background; host.postMessage('theme:' + background); }
}

if (host) {
  document.documentElement.dataset.host = 'desktop';
  document.querySelector('.window-controls').hidden = false;
  for (const action of ['minimize', 'maximize', 'close'])
    document.getElementById('window-' + action).addEventListener('click', () => host.postMessage('window:' + action));
  host.addEventListener('message', event => {
    if (event.data?.kind !== 'window-state' || typeof event.data.maximized !== 'boolean') return;
    maximized = event.data.maximized;
    refreshWindowChrome();
  });
}
