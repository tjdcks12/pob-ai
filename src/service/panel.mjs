// Opens the agent panel as a desktop-like window: an Edge app window, or the default browser.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { statePath } from '../state.mjs';

export function openPanel(url) {
  const edge = ['C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', 'C:\Program Files\Microsoft\Edge\Application\msedge.exe'].find(p => fs.existsSync(p));
  const child = edge
    ? spawn(edge, [`--app=${url}`, '--window-size=460,900', `--user-data-dir=${statePath('panel-profile')}`], { detached: true, stdio: 'ignore' })
    : spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' });
  child.unref();
}
